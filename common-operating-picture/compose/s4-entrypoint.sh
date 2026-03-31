#!/bin/sh
PROVIDER_NAME=$(echo "$PLATFORM_HOSTNAME" | cut -d'.' -f1)
cat > /tmp/config.yaml <<EOF
logging:
  level: debug

auth:
  sts:
    enabled: true
  bearer:
    enabled: true

server:
  port: 7070
  tls:
    certFile: /app/certs/${PLATFORM_HOSTNAME}.pem
    keyFile: /app/certs/${PLATFORM_HOSTNAME}.key.pem

backend:
  platformUrl: https://${PLATFORM_HOSTNAME}:${PLATFORM_HTTP_PORT:-8080}/
  oidcUrl: https://${PLATFORM_HOSTNAME}:${PLATFORM_HTTPS_PORT:-8443}/auth/realms/opentdf/protocol/openid-connect/token
  defaultAttrs: []
  insecure: true
  provider:
    ${PROVIDER_NAME}:
      type: s3
      vendorType: minio
      endpoint: http://minio:9000
      usePathStyle: true
      region: us-east-1
      credentials:
        type: static
        config:
          accessKey: minioAccessKey
          secretKey: minioSecretKey
    s4-test2:
      type: s3
      endpoint: http://localstack:4566
      region: us-east-1
      credentials:
        type: static
        config:
          accessKey: test
          secretKey: test
      usePathStyle: true
    s4-test:
      type: s3
      vendorType: minio
      endpoint: http://minio:9000
      usePathStyle: true
      region: us-east-1
      credentials:
        type: static
        config:
          accessKey: minioAccessKey
          secretKey: minioSecretKey
  default: s4-test
  multipartUploadMaxPartitionSizeMB: 25
  maxConcurrentWorkers: 20
  metadataCache:
    expirationMins: 0
    maxElements: 1048576
EOF

exec s4proxy start -f /tmp/config.yaml
