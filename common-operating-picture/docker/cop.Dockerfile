# check=skip=SecretsUsedInArgOrEnv
# syntax=docker/dockerfile:1

# --- STAGE 1: Frontend Build ---
FROM node:22-alpine AS ui-builder
ARG VITE_S4_ENDPOINT
ARG VITE_TILE_SERVER_URL
ARG VITE_GRPC_SERVER_URL
ARG VITE_DSP_BASE_URL
ARG VITE_DSP_KAS_URL
ARG VITE_DSP_KC_SERVER_URL
ARG VITE_DSP_KC_CLIENT_ID
ARG VITE_DSP_KC_DIRECT_AUTH

ENV VITE_S4_ENDPOINT=$VITE_S4_ENDPOINT
ENV VITE_TILE_SERVER_URL=$VITE_TILE_SERVER_URL
ENV VITE_GRPC_SERVER_URL=$VITE_GRPC_SERVER_URL
ENV VITE_DSP_BASE_URL=$VITE_DSP_BASE_URL
ENV VITE_DSP_KAS_URL=$VITE_DSP_KAS_URL
ENV VITE_DSP_KC_SERVER_URL=$VITE_DSP_KC_SERVER_URL
ENV VITE_DSP_KC_CLIENT_ID=$VITE_DSP_KC_CLIENT_ID
ENV VITE_DSP_KC_DIRECT_AUTH=$VITE_DSP_KC_DIRECT_AUTH

WORKDIR /app
COPY ui/package.json ui/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --cache /root/.npm
COPY ui/ .
COPY config/samples/sample.federal_policy.yaml /config/samples/sample.federal_policy.yaml
RUN npm run build

# --- STAGE 2: GEOS Libs Build ---
# Using Wolfi-base to ensure we have a standard /etc/ssl/certs structure to copy
FROM cgr.dev/chainguard/wolfi-base@sha256:c519d1c81a18a5c752f701bc59ceddfa4bf1a44e9bb605c73856cef216f69f7b AS geos-builder
RUN apk add --no-cache geos geos-dev ca-certificates

# --- STAGE 3: Python Dependencies Build ---
FROM cgr.dev/chainguard/python:latest-dev AS python-builder
WORKDIR /app
RUN python -m venv /app/venv
# Ensure we use the venv's pip
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    /app/venv/bin/pip install -r requirements.txt

# --- STAGE 4: Go Build ---
FROM cgr.dev/chainguard/go@sha256:dc53da3597aa89079c0bd3f402738bf910f2aa635f23d42f29b7e534a61e8149 AS builder
ARG TARGETOS TARGETARCH

COPY --from=geos-builder /usr/lib/libgeos* /usr/lib/
COPY --from=geos-builder /usr/include/geos/ /usr/include/geos/
COPY --from=geos-builder /usr/include/geos_c.h /usr/include/
COPY --from=geos-builder /usr/include/geos.h /usr/include/
COPY --from=geos-builder /usr/lib/pkgconfig/geos.pc /usr/lib/pkgconfig/geos.pc

WORKDIR /app
# Copy dependency manifests first so module download is cached independently of source changes
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download && go mod verify

# Now copy remaining source and build
COPY --from=ui-builder /app/dist /app/ui/dist
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -tags embedfiles -o dsp-cop .

# --- STAGE 5: Final Runtime ---
FROM cgr.dev/chainguard/glibc-dynamic@sha256:ef35f036cfe4d7ee20107ab358e038da0be69e93304c8c62dc8e5c0787d9a9c5

# 1. Bring in CA certificates properly
# We copy from geos-builder which has the 'ca-certificates' package installed
COPY --from=geos-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# 2. Bring in Python Runtime & ALL shared libraries
COPY --from=cgr.dev/chainguard/python:latest /usr/bin/python3 /usr/bin/python3
COPY --from=cgr.dev/chainguard/python:latest /usr/lib/ /usr/lib/
COPY --from=geos-builder /usr/lib/libgeos* /usr/lib/

# 3. Bring in Python Virtual Environment
COPY --from=python-builder /app/venv /app/venv

# 4. Bring in Go Binary and Python Scripts
COPY --from=builder /app/dsp-cop /usr/bin/
COPY scripts/seed/seed_data.py scripts/seed/read_s4.py scripts/seed/sim_data_fake_opensky.py scripts/seed/sim_data.py scripts/seed/sim_nifi_seed.py scripts/seed/add_manifests.py /app/scripts/seed/

# 5. Environment
ENV PATH="/app/venv/bin:/usr/bin:${PATH}"
# Ensure this matches the version found in your builder logs
ENV PYTHONPATH="/app/venv/lib/python3.14/site-packages"

# 6. CRITICAL: Tell Go exactly where to find the certs
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_DIR=/etc/ssl/certs

WORKDIR /app
ENTRYPOINT ["/usr/bin/dsp-cop", "serve"]