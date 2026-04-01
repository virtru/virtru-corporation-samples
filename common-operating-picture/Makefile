PROJECT_VERSION := 0.8.0
OTDF-NIFI_VERSION?=0.4.0
DSP_KEYS_DIR=dsp-keys

toolcheck:
	@echo "Checking for required tools..."
	@which buf > /dev/null || (echo "buf not found, please install it from https://docs.buf.build/installation" && exit 1)
	@which protoc-gen-go > /dev/null || (echo "protoc-gen-go not found, run 'go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.1'" && exit 1)
	@which protoc-gen-connect-go > /dev/null || (echo "protoc-gen-connect-go not found, run 'go install go install connectrpc.com/connect/cmd/protoc-gen-connect-go@v1.16.2'" && exit 1)
	@which protoc-gen-es > /dev/null || (echo "protoc-gen-es not found, run 'npm i -g @bufbuild/protoc-gen-es@v1.9.0'" && exit 1)
	@which protoc-gen-connect-es > /dev/null || (echo "protoc-gen-connect-es not found, run 'npm i -g @connectrpc/protoc-gen-connect-es@v1.4.0'" && exit 1)
	@echo "All tools found"

proto-gen:
	@echo "Generating proto files"
	buf generate

PLATFORM_HOSTNAME ?= local-dsp.virtru.com

signingpassphrase = "changeme"
dev-certs:
	@which mkcert > /dev/null || { echo "mkcert not found, please install it: https://github.com/FiloSottile/mkcert"; exit 1; }
	@mkdir -p $(DSP_KEYS_DIR)
	@mkcert -cert-file $(DSP_KEYS_DIR)/$(PLATFORM_HOSTNAME).pem -key-file $(DSP_KEYS_DIR)/$(PLATFORM_HOSTNAME).key.pem $(PLATFORM_HOSTNAME) "*.$(PLATFORM_HOSTNAME)" localhost
	@./.github/scripts/init-temp-keys.sh
	@./.github/scripts/x509-temp-keys.sh
	@./scripts/build/build_truststore_local.sh
	@cp ./dsp-keys/$(PLATFORM_HOSTNAME).pem ./nifi/truststore


download-otdf-nifi:
	@echo "Downloading opentdf nifi bundles"
	curl -L https://maven.pkg.github.com/opentdf/nifi/io/opentdf/nifi/nifi-tdf-nar/0.1.0/nifi-tdf-nar-$(OTDF-NIFI_VERSION).nar -H "Authorization: Bearer ${GITHUB_TOKEN}" -o nifi/extensions/nifi-tdf-nar-$(OTDF-NIFI_VERSION).nar -v
	curl -L https://maven.pkg.github.com/opentdf/nifi/io/opentdf/nifi/nifi-tdf-controller-services-nar/$(OTDF-NIFI_VERSION)/nifi-tdf-controller-services-nar-$(OTDF-NIFI_VERSION).nar -H "Authorization: Bearer ${GITHUB_TOKEN}" -o nifi/extensions/nifi-tdf-controller-services-nar-$(OTDF-NIFI_VERSION).nar -v

.PHONY: launch-dsp-shell
launch-dsp-shell:
	@echo "NOTE: The following is most useful after launching the COP stack"
	@docker-compose -f docker-compose.dev.yaml exec dsp-cli-user /bin/sh

.PHONY: version
version:
	@echo $(PROJECT_VERSION)
