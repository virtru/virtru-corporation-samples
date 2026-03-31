package dspClient

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/opentdf/platform/protocol/go/authorization"
	"google.golang.org/protobuf/encoding/protojson"
)

type Entitlements map[string]bool

func GetEntitlements(endpoint string, token string) (Entitlements, error) {
	body := []byte(`{
		"token": "` + token + `"
	}`)

	// Create a new request using http
	req, err := http.NewRequest("POST", endpoint, bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}

	// add authorization header and content-type to the req
	authHeaderString := "Bearer " + token
	req.Header.Add("Authorization", authHeaderString)
	req.Header.Add("Content-Type", "application/json")

	slog.Debug("GetEntitlements request", slog.String("endpoint", endpoint))

	//send request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		slog.Error("GetEntitlements HTTP error", slog.String("endpoint", endpoint), slog.String("error", err.Error()))
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusOK {
		data := &authorization.GetEntitlementsResponse{}
		if err := protojson.Unmarshal(bodyBytes, data); err != nil {
			return nil, err
		}
		entitlements := make(Entitlements)
		for _, e := range data.GetEntitlements() {
			for _, a := range e.GetAttributeValueFqns() {
				entitlements[a] = true
			}
		}
		return entitlements, nil
	}
	slog.Error("GetEntitlements non-OK response",
		slog.String("endpoint", endpoint),
		slog.Int("status", resp.StatusCode),
		slog.String("body", string(bodyBytes)),
	)
	return nil, fmt.Errorf("error getting entitlements: %d", resp.StatusCode)
}
