# Installation Guide

Follow these steps to set up the Data Security Platform (DSP) COP environment.

### Prerequisites

Before beginning, ensure your environment meets the following requirements.

1. **Run the Setup Script**
To install necessary dependencies automatically, run the provided script:

```bash
./scripts/ops/ubuntu_cop_prereqs_cop.sh

# Reboot after running script for some changes to take effect
reboot
```

   <details>
   <summary><strong>Manual Installation Details (Optional)</strong></summary>

   If you prefer to install manually or need to debug, the script handles the following:

   - **Container Runtime:** Installs Docker + Docker Compose.
     - _Alternatives supported:_ [Colima (recommended)](https://github.com/abiosoft/colima), [Rancher Desktop](https://rancherdesktop.io), or [Podman Desktop](https://podman-desktop.io).
   - **Languages & Tools:**
     - [Node.js (via nvm)](https://nodejs.org/en/download/package-manager)
     - [Go (Golang)](https://go.dev/doc/install)
     - [GEOS](https://libgeos.org/usage/install/)
     - [Make](https://formulae.brew.sh/formula/make)
     </details>
   - **Local DNS Configuration**
     - Add an entry to /etc/hosts for your domain:
     - ```text
       127.0.0.1    your-domain.com
       ```

---

### Step 1: Generate Certificates

For **self-signed certs** (local dev or testing), run the key generation script with your domain:

```bash
# Defaults to local-dsp.virtru.com if no argument given
./scripts/ops/ubuntu_cop_keys.sh

# Custom domain
./scripts/ops/ubuntu_cop_keys.sh your-domain.com
```

For **real certs** (e.g. production/GCP), skip this step and place your cert files in `dsp-keys/` named as:
- `dsp-keys/<your-domain>.pem`
- `dsp-keys/<your-domain>.key.pem`
- `dsp-keys/rootCA.pem`

### Step 2: Unpack the Bundle

Unzip the main bundle and unpack the specific DSP tools. Replace `X.X.X`, `<os>`, and `<arch>` with your specific version and system details.

```bash
# 1. Untar the main bundle
mkdir virtru-dsp-bundle && tar -xvf virtru-dsp-bundle-* -C virtru-dsp-bundle/ && cd virtru-dsp-bundle/

# 2. Unpack DSP Tools
tar -xvf tools/dsp/data-security-platform_X.X.X_<os>_<arch>.tar.gz
  #Example - AMD linux:
  tar -xvf tools/dsp/data-security-platform_2.7.1_linux_amd64.tar.gz

# 3. Unpack and setup Helm
tar -xvf tools/helm/helm-vX.X.X-<os>-<arch>.tar.gz
  #Example - AMD linux:
  tar -xvf tools/helm/helm-v3.15.4-linux-amd64.tar.gz
# Then move command into working directory
mv <os>-<arch>/helm ./helm

# 4. Unpack and setup grpcurl
tar -xvf tools/grpcurl/grpcurl_X.X.X_<os>_<arch>.tar.gz
  #Example - AMD linux:
  tar -xvf tools/grpcurl/grpcurl_1.9.1_linux_x86_64.tar.gz

# Make Executable
chmod +x ./grpcurl
```

### Step 3: Setup Local Docker Registry

The DSP images are stored in the bundle as OCI artifacts. You must spin up a local registry and copy the images into it.

```bash
# 1. Start a local registry instance
docker run -d --restart=always -p 5000:5000 --name registry registry:2

# 2. Copy DSP images into local registry
# (Run this from the virtru-dsp-bundle root directory)
./dsp copy-images --insecure localhost:5000/virtru

# 3. Verify images were copied successfully
curl -X GET http://localhost:5000/v2/_catalog
curl -X GET http://localhost:5000/v2/virtru/data-security-platform/tags/list
```

### Step 4: Configure Your Domain

There are only **2 files** to configure. All other URLs (KAS, IDP, Keycloak, TLS cert paths, S4 provider) are derived automatically.

**`env/default.env`** — set `PLATFORM_HOSTNAME` to your domain:

```bash
cp env/default.env.example env/default.env
```

Then edit `PLATFORM_HOSTNAME`:
```
PLATFORM_HOSTNAME=your-domain.com
```

**`config.yaml`** — set `platform_endpoint` to match:

```bash
cp config.yaml.example config.yaml
```

Then edit `platform_endpoint`:
```yaml
platform_endpoint: https://your-domain.com:8080
```

### Step 5: Build and Run

```bash
# Build (first time or after code changes)
docker compose --env-file env/default.env -f docker-compose.dev.yaml --profile nifi --profile s4 up -d --build

# Start (without rebuilding)
docker compose --env-file env/default.env -f docker-compose.dev.yaml --profile nifi --profile s4 up -d

# Restart with rebuild
docker compose --env-file env/default.env -f docker-compose.dev.yaml --profile nifi --profile s4 down && \
docker compose --env-file env/default.env -f docker-compose.dev.yaml --profile nifi --profile s4 up -d --build

# Stop
docker compose --env-file env/default.env -f docker-compose.dev.yaml --profile nifi --profile s4 down
```

**Application URLs:**
- **UI:** `https://<your-domain>:5001/`
- **Keycloak Admin:** `https://<your-domain>:8443/auth/admin/`

### Step 6: Seeding Vehicle Data and Live Data Flow Simulation

You can seed data from the UI by clicking **Start Simulation**, or manually:

```bash
# Install the venv module
sudo apt install python3-venv -y

# Create a virtual environment named 'COP_venv' in the current directory
python3 -m venv COP_venv
```

```bash
# Activate the virtual environment.
source COP_venv/bin/activate
```

```bash
# Install required packages
pip install -r requirements.txt
```

```bash
# Run seeding script to populate database
python3 scripts/seed/seed_data.py
```

```bash
# Start simulation
# NUM_ENTITIES will determine how many moving entities the script will query the database for and apply movement logic to
# UPDATE_INTERVAL_SECONDS determines the frequency of movement for each object

# For live data from OpenSky Network login to https://opensky-network.org/, download credentials file (credentials.json),
# place the file in the base directory and then run:
python3 scripts/seed/sim_data.py

# For a fake simulation that does not require the credentials file or use account credits with OpenSky:
python3 scripts/seed/sim_data_fake_opensky.py
```

### Troubleshooting & Verification Checklist

If you encounter issues, double-check the following:

- **Config:** Ensure `config.yaml` exists with the correct `platform_endpoint`. All other URLs are derived automatically.
- **Env file:** Ensure `env/default.env` exists with the correct `PLATFORM_HOSTNAME`. Copy from `env/default.env.example` if missing.
- **S4 config:** The S4 proxy config is generated automatically at container startup from `PLATFORM_HOSTNAME` — no separate S4 config files needed.
- **Certs:** Ensure `dsp-keys/<your-domain>.pem`, `dsp-keys/<your-domain>.key.pem`, and `dsp-keys/rootCA.pem` exist.
- **Permissions:** Verify that the certificates in `dsp-keys` have `chmod 644` permissions.
- **Firewall:** Ensure ports 5001, 5002, 7070, 8080, and 8443 are open for your VM.
- **DNS:** Ensure your domain resolves to the VM's IP (via DNS A record or `/etc/hosts`).
