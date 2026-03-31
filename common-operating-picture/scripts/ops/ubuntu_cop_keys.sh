#!/bin/bash
# Installs all keys for the Virtru DSP COP on Ubuntu 24.04 LTS

set -e

PLATFORM_HOSTNAME="${1:-local-dsp.virtru.com}"
echo "=== Generating keys for: ${PLATFORM_HOSTNAME} ==="

echo "=== Making dsp-keys/ Directory ==="
mkdir -p dsp-keys 2> /dev/null

echo "=== Installing CA Authority ==="
if ! command -v mkcert &> /dev/null
then
    echo "ERROR: mkcert is not installed."
    echo "Please ensure all prerequisites are installed. Run the ./scripts/ops/ubuntu_cop_prereqs_cop.sh script."
    exit 1
fi
mkcert -install

echo "=== Generating Certs ==="
mkcert -cert-file dsp-keys/${PLATFORM_HOSTNAME}.pem \
-key-file dsp-keys/${PLATFORM_HOSTNAME}.key.pem ${PLATFORM_HOSTNAME} "*.${PLATFORM_HOSTNAME}" localhost

# Check for OpenJDK 17
echo "=== Installing OpenJDK 17 ==="

if command -v java >/dev/null 2>&1 && java -version 2>&1 | grep -q 'version "17\.' ; then
    echo "OpenJDK 17 is already installed."
else
    echo "Installing OpenJDK 17..."
    sudo apt update
    sudo apt install openjdk-17-jdk -y
fi

# Generate keys for KAS and PolicyImportExport artifact signing
echo "=== Generating keys for KAS and PolicyImportExport artifact signing ==="
./.github/scripts/init-temp-keys.sh

# Generate temporary x509 certificates
echo "=== Generating Temporary x509 Certificates ==="
bash ./.github/scripts/x509-temp-keys.sh

# Set permissions for key files
chmod 644 dsp-keys/${PLATFORM_HOSTNAME}.key.pem \
dsp-keys/${PLATFORM_HOSTNAME}.pem \
dsp-keys/kas-ec-cert.pem \
dsp-keys/kas-ec-private.pem \
dsp-keys/kas-cert.pem \
dsp-keys/kas-private.pem

# ------------------------------------------------------------
# Post-install instructions
# ------------------------------------------------------------
echo "===================================="
echo -e "
  \033[1;32m\033[1m   CCCCCC\033[0m    \033[1;32m\033[1m OOOO\033[0m \033[1;32m\033[1m   PPPPPP\033[0m
  \033[1;32m\033[1m  CCC   CC\033[0m   \033[1;32m\033[1mOO  OO\033[0m \033[1;32m\033[1m  PP   PP\033[0m
  \033[1;32m\033[1m CC\033[0m       \033[1;32m\033[1m OO      OO\033[0m \033[1;32m\033[1mPP   PP\033[0m
  \033[1;32m\033[1m CC\033[0m       \033[1;32m\033[1m O        O\033[0m \033[1;32m\033[1mPPPPPP\033[0m
  \033[1;32m\033[1m CC\033[0m       \033[1;32m\033[1m OO      OO\033[0m \033[1;32m\033[1mPP\033[0m
  \033[1;32m\033[1m  CCC   CC\033[0m   \033[1;32m\033[1mOO  OO\033[0m \033[1;32m\033[1m  PP\033[0m
  \033[1;32m\033[1m   CCCCCC\033[0m    \033[1;32m\033[1m OOOO\033[0m \033[1;32m\033[1m   PP\033[0m

\033[1;33m***\033[0m \033[1;4m\033[1;32mCOMMON OPERATING PICTURE\033[0m \033[1;33m***\033[0m
"
echo "===================================="
echo "=== Key Setup Complete for ${PLATFORM_HOSTNAME}! ==="
echo "===================================="
