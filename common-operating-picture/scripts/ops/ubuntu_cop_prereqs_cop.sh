#!/bin/bash
# Installs all prerequisite software for the Virtru DSP COP on Ubuntu 24.04 LTS

set -e

echo "=== Updating system packages ==="
sudo apt update -y && sudo apt upgrade -y

#echo "=== Installing packages for Virtualbox ==="
#sudo apt install -y \
#  open-vm-tools-desktop \
#  virtualbox-guest-additions-iso \
#  virtualbox-ext-pack

echo "=== Installing core dependencies ==="
sudo apt install -y \
  build-essential \
  curl \
  wget \
  git \
  make \
  ca-certificates \
  apt-transport-https \
  gnupg \
  lsb-release \
  software-properties-common \
  python3 \
  python3-pip

# ------------------------------------------------------------
# Docker (runtime + compose)
# ------------------------------------------------------------
echo "=== Installing Docker and Docker Compose ==="
if ! command -v docker &> /dev/null; then
  sudo apt remove -y docker docker-engine docker.io containerd runc || true
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update -y
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

# ------------------------------------------------------------
# Node.js (LTS) + npm + nvm
# ------------------------------------------------------------
echo "=== Installing Node.js (LTS) ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt install -y nodejs
fi

echo "=== Installing nvm (Node Version Manager) ==="
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install --lts
fi

# ------------------------------------------------------------
# Go (Golang)
# ------------------------------------------------------------
echo "=== Installing Go (Golang) ==="
GO_VERSION="1.23.2"
if ! command -v go &> /dev/null; then
  wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
  sudo rm -rf /usr/local/go
  sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
  echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
  rm go${GO_VERSION}.linux-amd64.tar.gz
fi

# ------------------------------------------------------------
# GEOS (Geometry Engine Open Source)
# ------------------------------------------------------------
echo "=== Installing GEOS ==="
sudo apt install -y libgeos-dev pkg-config

# ------------------------------------------------------------
# mkcert (Local TLS Certificates)
# ------------------------------------------------------------
echo "=== Installing mkcert ==="
sudo apt install -y libnss3-tools
if ! command -v mkcert &> /dev/null; then
  wget https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64
  sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
  sudo chmod +x /usr/local/bin/mkcert
fi

# ------------------------------------------------------------
# Add local-dsp.virtru.com to /etc/hosts if not already present
# ------------------------------------------------------------
echo "=== Ensuring local-dsp.virtru.com is mapped in /etc/hosts ==="
if ! grep -q "local-dsp\.virtru\.com" /etc/hosts; then
  echo "127.0.0.1    local-dsp.virtru.com" | sudo tee -a /etc/hosts > /dev/null
  echo "Added entry: 127.0.0.1 local-dsp.virtru.com"
else
  echo "Entry already exists — skipping."
fi

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
echo "=== Prerequisite Setup Complete! ==="
echo ""
echo "To Finalize COP Setup Follow:"
echo ""
echo "1. Reboot or log out/in for Docker group and ~/.bashrc changes to take effect."
echo "2. Continue to Step 1 in startupInstructions.md/README.md to start the COP services."
echo ""
echo "===================================="


