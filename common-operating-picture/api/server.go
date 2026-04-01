package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"connectrpc.com/connect"
	connectcors "connectrpc.com/cors"
	"connectrpc.com/grpcreflect"

	"github.com/dgraph-io/ristretto"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/opentdf/platform/sdk"
	"github.com/rs/cors"
	"github.com/virtru-corp/dsp-cop/api/proto/tdf_note/v1/tdf_notev1connect"
	"github.com/virtru-corp/dsp-cop/api/proto/tdf_object/v1/tdf_objectv1connect"
	"github.com/virtru-corp/dsp-cop/db"
	activeclients "github.com/virtru-corp/dsp-cop/pkg/activeClients"
	"github.com/virtru-corp/dsp-cop/pkg/config"
	"github.com/virtru-corp/dsp-cop/pkg/ui"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

const pgNotifyChannel = "tdf_objects_inserted"

var shutdownServer func()
var EntitlementCacheWeight = int64(1000)
var EntitlementCacheTTL = time.Minute * 15
var EntitlementCacheKey = "entitlements-"

type TdfObjectStreamClient struct {
	Object          *db.TdfObject
	ClientsNotified []string
}
type TdfObjectStream struct {
	Lock    sync.Mutex
	Objects []*TdfObjectStreamClient
}

type TokenEntitlements struct {
	Entitlements map[string]bool
	LastUpdated  time.Time
}

type CopServer struct {
	Config        *config.Config
	StaticServer  *http.Server
	GrpcServer    *http.Server
	DBConn        *pgxpool.Pool
	DBQuery       *db.Queries
	ActiveClients *activeclients.ActiveClients
	SDK           *sdk.SDK

	cache *ristretto.Cache
}

func NewCopServer(c *config.Config, staticFs fs.FS) *CopServer {
	// Create cache
	cache, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: 1e7,     // number of keys to track frequency of (10M).
		MaxCost:     1 << 30, // maximum cost of cache (1GB).
		BufferItems: 64,      // number of keys per Get buffer.
	})
	if err != nil {
		panic(err)
	}

	dbCtx := context.Background()

	// Create database connection
	dbPool, err := db.NewPool(dbCtx, c)
	if err != nil {
		slog.ErrorContext(dbCtx, "Error connecting to database", err)
		panic(err)
	}

	clients := &activeclients.ActiveClients{}

	// Create pgx listener
	listener := connectPgxListener(dbPool, clients, pgNotifyChannel)
	go func() {
		if err := listener.Listen(dbCtx); err != nil {
			slog.ErrorContext(dbCtx, "pgx listener error", slog.String("error", err.Error()))
			slog.Warn("pgx listener will not be available")
		}
	}()

	// Create SDK client
	sdk, err := initSdk(c)
	if err != nil {
		slog.Error("failed initialize sdk", slog.String("error", err.Error()))
		panic(err)
	}

	shutdownServer = func() {
		slog.Info("shutting down the server")
		dbCtx.Done()
		clients.Shutdown()
	}

	tdfServer := &TdfObjectServer{
		Config:        c,
		DBQueries:     db.New(dbPool),
		ActiveClients: clients,
		SDK:           sdk,
		// ristretto cache
		cache: cache,
	}

	// Inject window variables into index.html
	mfs, err := ui.InjectWindowVars(c, staticFs)
	if err != nil {
		panic(fmt.Sprintf("failed to inject env vars into index.html: %v", err))
	}

	return &CopServer{
		// config
		Config: c,
		// create http server for static files
		StaticServer: createStaticServer(c, mfs),
		// create http server for grpc
		GrpcServer: createGrpcServer(tdfServer),
		// database connection
		DBConn: dbPool,
		// active clients
		ActiveClients: clients,
		// sdk client
		SDK: sdk,
		// ristretto cache
		cache: cache,
	}
}

func (s *CopServer) Start() {
	if s.Config.Service.TLS.Enabled {
		slog.Info("TLS enabled, starting gRPC server with TLS",
			slog.String("host", s.GrpcServer.Addr),
			slog.String("cert", s.Config.Service.TLS.CertFile),
			slog.String("key", s.Config.Service.TLS.KeyFile),
		)
		slog.Info("TLS enabled, starting static server with TLS",
			slog.String("host", s.StaticServer.Addr),
			slog.String("cert", s.Config.Service.TLS.CertFile),
			slog.String("key", s.Config.Service.TLS.KeyFile),
		)

		go func() {
			if err := s.GrpcServer.ListenAndServeTLS(s.Config.Service.TLS.CertFile, s.Config.Service.TLS.KeyFile); err != nil {
				slog.Error("failed to start gRPC server with TLS", slog.String("error", err.Error()))
			}
		}()

		go func() {
			if err := s.StaticServer.ListenAndServeTLS(s.Config.Service.TLS.CertFile, s.Config.Service.TLS.KeyFile); err != nil {
				slog.Error("failed to start static server with TLS", slog.String("error", err.Error()))
			}
		}()
	} else {
		slog.Info("TLS disabled, starting gRPC server without TLS", slog.String("host", s.GrpcServer.Addr))
		slog.Info("TLS disabled, starting static server without TLS", slog.String("host", s.StaticServer.Addr))

		go func() {
			if err := s.GrpcServer.ListenAndServe(); err != nil {
				slog.Error("failed to start gRPC server without TLS", slog.String("error", err.Error()))
			}
		}()

		go func() {
			if err := s.StaticServer.ListenAndServe(); err != nil {
				slog.Error("failed to start static server without TLS", slog.String("error", err.Error()))
			}
		}()
	}

	setupGracefulShutdown()
}

func (s *CopServer) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s.DBConn.Close()
	s.StaticServer.Shutdown(ctx)
	s.GrpcServer.Shutdown(ctx)
}

func createStaticServer(c *config.Config, staticFs fs.FS) *http.Server {
	mux := http.NewServeMux()

	mux.Handle("GET /", staticFilesHandler(c, staticFs))

	var handler http.Handler = mux
	if c.BasicAuthUsername != "" && c.BasicAuthPassword != "" {
		slog.Info("basic auth enabled for static server")
		handler = basicAuthMiddleware(c.BasicAuthUsername, c.BasicAuthPassword, mux)
	}

	return &http.Server{
		Addr:         ":" + c.Service.StaticPort,
		Handler:      handler,
		WriteTimeout: time.Second * time.Duration(c.Service.StaticWriteTimeout),
		ReadTimeout:  time.Second * time.Duration(c.Service.StaticReadTimeout),
	}
}

func createGrpcServer(server *TdfObjectServer) *http.Server {
	mux := http.NewServeMux()

	// Register reflection service on gRPC server for TdfObjectService.
	reflector := grpcreflect.NewStaticReflector(
		"tdf_object.v1.TdfObjectService",
	)
	mux.Handle(grpcreflect.NewHandlerV1(reflector))
	mux.Handle(grpcreflect.NewHandlerV1Alpha(reflector))

	// Register TdfObjectService on gRPC server.
	path, handler := tdf_objectv1connect.NewTdfObjectServiceHandler(
		server,
		connect.WithInterceptors(getInterceptors()...),
	)
	mux.Handle(path, cors.New(cors.Options{
		AllowedOrigins: []string{server.Config.Service.CORSOrigin},
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: append(connectcors.AllowedHeaders(), "Authorization"),
		ExposedHeaders: connectcors.ExposedHeaders(),
		MaxAge:         7200, // 2 hours in seconds
	}).Handler(handler))

	// Register TdfNoteService on gRPC server.
	// Ensure you're using the correct handler generated for the TdfNoteService
	pathNote, handlerNote := tdf_notev1connect.NewTdfNoteServiceHandler(
		server, // your service implementation here
		connect.WithInterceptors(getInterceptors()...), // apply any interceptors you need
	)
	mux.Handle(pathNote, cors.New(cors.Options{
		AllowedOrigins: []string{server.Config.Service.CORSOrigin},
		AllowedMethods: connectcors.AllowedMethods(),
		AllowedHeaders: append(connectcors.AllowedHeaders(), "Authorization"),
		ExposedHeaders: connectcors.ExposedHeaders(),
		MaxAge:         7200, // 2 hours in seconds
	}).Handler(handlerNote))

	// Return the HTTP server with the mux
	return &http.Server{
		Addr:         ":" + server.Config.Service.GrpcPort,
		Handler:      h2c.NewHandler(mux, &http2.Server{}),
		WriteTimeout: time.Second * time.Duration(server.Config.Service.GrpcWriteTimeout),
		ReadTimeout:  time.Second * time.Duration(server.Config.Service.GrpcReadTimeout),
		IdleTimeout:  time.Second * time.Duration(server.Config.Service.GrpcIdleTimeout),
	}
}

func initSdk(c *config.Config) (*sdk.SDK, error) {
	maskedSecret := strings.Repeat("*", len(c.OIDCClientSecretForServer))
	slog.Info("initalizing SDK client and validating platform and IDP",
		slog.String("platform_endpoint", c.PlatformEndpoint),
		slog.String("client_id", c.OIDCClientIdForServer),
		slog.String("client_secret", maskedSecret),
	)

	// This process will validate the platform endpoint and authenticate the client with the IdP
	client, err := sdk.New(c.PlatformEndpoint, sdk.WithClientCredentials(c.OIDCClientIdForServer, c.OIDCClientSecretForServer, []string{}))
	if err != nil {
		return nil, err
	}

	// TODO need the ability to get the IdP URL from the platform wellknown

	return client, nil
}

// basicAuthMiddleware returns middleware that gates all requests behind HTTP Basic Auth.
// Uses constant-time comparison to prevent timing attacks.
func basicAuthMiddleware(username, password string, next http.Handler) http.Handler {
	expectedUser := sha256.Sum256([]byte(username))
	expectedPass := sha256.Sum256([]byte(password))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow CORS preflight requests through without auth
		if r.Method == http.MethodOptions {
			next.ServeHTTP(w, r)
			return
		}

		user, pass, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="DSP COP"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		userHash := sha256.Sum256([]byte(user))
		passHash := sha256.Sum256([]byte(pass))

		userMatch := subtle.ConstantTimeCompare(userHash[:], expectedUser[:]) == 1
		passMatch := subtle.ConstantTimeCompare(passHash[:], expectedPass[:]) == 1

		if !userMatch || !passMatch {
			w.Header().Set("WWW-Authenticate", `Basic realm="DSP COP"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func setupGracefulShutdown() {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	<-c
	shutdownServer()
}
