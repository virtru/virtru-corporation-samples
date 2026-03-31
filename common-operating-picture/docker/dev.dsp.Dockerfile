# syntax=docker/dockerfile:1.6
# Set your runtime image (override with --build-arg)
ARG DSP_IMAGE=localhost:5000/virtru/data-security-platform:v2.7.1
ARG PLATFORM_HOSTNAME=local-dsp.virtru.com

# ---------- prep stage: build CA bundle & stage files ----------
FROM alpine:latest AS prep
ARG PLATFORM_HOSTNAME=local-dsp.virtru.com
WORKDIR /work

# CA tools and trust store
RUN apk add --no-cache ca-certificates && update-ca-certificates

# TLS materials
# (Only certificates belong in /usr/local/share/ca-certificates; keep private keys elsewhere.)
COPY ./dsp-keys/${PLATFORM_HOSTNAME}.pem      /usr/local/share/ca-certificates/${PLATFORM_HOSTNAME}.crt
COPY ./dsp-keys/${PLATFORM_HOSTNAME}.key.pem  /work/dsp-keys/${PLATFORM_HOSTNAME}.key.pem

# Merge our cert into the system bundle and stash it to copy later
RUN update-ca-certificates && cp /etc/ssl/certs/ca-certificates.crt /work/ca-certificates.crt

# KAS keys & app configs the runtime needs
COPY ./dsp-keys/kas-ec-cert.pem     /work/dsp-keys/kas-ec-cert.pem
COPY ./dsp-keys/kas-ec-private.pem  /work/dsp-keys/kas-ec-private.pem
COPY ./dsp-keys/kas-cert.pem        /work/dsp-keys/kas-cert.pem
COPY ./dsp-keys/kas-private.pem     /work/dsp-keys/kas-private.pem

COPY ./config/samples/sample.keycloak.yaml         /work/samples/defaults/keycloak_data.yaml
COPY ./config/samples/sample.federal_policy.yaml   /work/samples/defaults/federal_policy.yaml
COPY ./dsp.yaml                     /work/dsp.yaml

# Substitute PLATFORM_HOSTNAME into configs (baseline file uses local-dsp.virtru.com)
RUN sed -i "s|local-dsp\.virtru\.com|${PLATFORM_HOSTNAME}|g" /work/samples/defaults/keycloak_data.yaml \
 && sed -i "s|local-dsp\.virtru\.com|${PLATFORM_HOSTNAME}|g" /work/dsp.yaml

# quick checks (runs in prep stage which has /bin/sh)
RUN test -f /work/samples/defaults/keycloak_data.yaml \
 && test -f /work/samples/defaults/federal_policy.yaml \
 && test -f /work/dsp.yaml \
 && test -f /work/dsp-keys/kas-ec-cert.pem \
 && test -f /work/dsp-keys/kas-ec-private.pem \
 && test -f /work/dsp-keys/kas-cert.pem \
 && test -f /work/dsp-keys/kas-private.pem \
 && test -f /work/ca-certificates.crt

# ---------- final stage ----------
FROM ${DSP_IMAGE} AS dsp

# Copy only what's needed; avoid copying the entire prep filesystem.
COPY --from=prep /work/dsp-keys/           /dsp-keys/
COPY --from=prep /work/samples/            /samples/
COPY --from=prep /work/dsp.yaml            /dsp.yaml

# Provide CA bundle and point clients at it
COPY --from=prep /work/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

ENTRYPOINT ["/usr/bin/dsp"]
