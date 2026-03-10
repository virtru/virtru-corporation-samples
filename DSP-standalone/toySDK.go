package main

import (
	"bytes"
	"strings"

	// This SDK imports and builds upon the OpenTDF SDK
	otdf "github.com/opentdf/platform/sdk"

	// Our DSP SDK offers built-in defaults and access to extended DSP services
	"github.com/virtru-corp/data-security-platform/sdk/v2"
)

func main() {
	// Create SDK as Alex (TS/USA) using password flow via the opentdf-public client
	dspClient, err := sdk.New(
		sdk.WithPlatformEndpoint("https://local-dsp.virtru.com:8080"),
		sdk.WithCoreSDKOptions(
			otdf.WithInsecureSkipVerifyConn(),
			otdf.WithTokenEndpoint("https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token"),
			otdf.WithClientCredentials("opentdf-public", "", nil),
			otdf.WithUsername("aaa@topsecret.usa"),
			otdf.WithPassword("testuser123"),
		),
	)
	if err != nil {
		panic(err)
	}

	// CreateTDF automatically includes v4.2.2 target mode
	plaintext := strings.NewReader("SECRET DATA")
	encrypted := &bytes.Buffer{}

	// Encrypt with classification=topsecret and relto=usa,fvey
	// Alex (TS/USA) is entitled to all three values via subject mappings
	tdf, err := dspClient.CreateTDF(encrypted, plaintext,
		otdf.WithKasInformation(otdf.KASInfo{
			URL: "https://local-dsp.virtru.com:8080/kas",
		}),
		otdf.WithDataAttributes([]otdf.AttributeValueFQN{
			{Fqn: "https://demo.com/attr/classification/value/topsecret"},
			{Fqn: "https://demo.com/attr/relto/value/usa"},
			{Fqn: "https://demo.com/attr/relto/value/fvey"},
		}...),
	)
	if err != nil {
		panic(err)
	}

	// All existing SDK functionality is preserved
	decrypted := &bytes.Buffer{}
	err = dspClient.ReadTDF(decrypted, bytes.NewReader(encrypted.Bytes()))
	if err != nil {
		panic(err)
	}

	// DSP-specific services are still available
	// tags, err := dspClient.Tag.GetTags(ctx, request)
	// version, err := dspClient.Version.GetVersion(ctx, request)
}
