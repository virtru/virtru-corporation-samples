# DSP-Only Local Deployment

Runs the Virtru Data Security Platform (DSP) as a self-contained Docker Compose stack — no Kubernetes or bulk data ingestion.

## What's Included

| Service | Image | Port(s) | Role |
|---|---|---|---|
| `keycloak-db` | postgres:16 | 25434 | Keycloak's Postgres database |
| `keycloak` | keycloak/keycloak:25.0 | 18443 (HTTPS), 8888 (HTTP health) | Identity Provider (OIDC) |
| `dsp-keycloak-provisioning` | built from `dev.dsp.Dockerfile` | — | One-shot: provisions realm, clients, and users |
| `dsp-db` | postgres:16 | 35433 | DSP's Postgres database |
| `dsp` | built from `dev.dsp.Dockerfile` | 8080 | DSP services (KAS, policy, authz, entity resolution) |
| `dsp-provision-federal-policy` | built from `dev.dsp.Dockerfile` | — | One-shot: loads the federal attribute policy |

## Prerequisites

### 1. Docker

Docker Engine ≥ 24 with Docker Compose v2.
OrbStack, Rancher Desktop, Colima, or Docker Desktop all work.

### 2. /etc/hosts entry

DSP and Keycloak use TLS certificates issued for `local-dsp.virtru.com`.
Add this line to `/etc/hosts` (requires `sudo`):

```
127.0.0.1  local-dsp.virtru.com
```

### 3. Unpack the Bundle

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


### 4. TLS certificates in `dsp-keys/`

The `dsp-keys/` directory must exist under `DSP-standalone/` and contain:

```
dsp-keys/
├── local-dsp.virtru.com.pem         # TLS certificate for Keycloak and DSP
├── local-dsp.virtru.com.key.pem     # TLS private key
├── kas-cert.pem                     # KAS RSA certificate
├── kas-private.pem                  # KAS RSA private key
├── kas-ec-cert.pem                  # KAS EC certificate
├── kas-ec-private.pem               # KAS EC private key
├── encrypted-search.key             # Encrypted search key (hex string)
└── policyimportexport/
    ├── cosign.key                   # Policy signing private key
    ├── cosign.pub                   # Policy signing public key
    └── cosign.pass                  # Passphrase for cosign.key
```

Run the following from the `DSP-standalone/` directory to generate all keys:

```bash
# 1. Install mkcert if needed
brew install mkcert && mkcert -install

# 2. TLS certificate for Keycloak and DSP (port 18443 / 8080)
mkcert \
  -cert-file dsp-keys/local-dsp.virtru.com.pem \
  -key-file  dsp-keys/local-dsp.virtru.com.key.pem \
  local-dsp.virtru.com "*.local-dsp.virtru.com" localhost

# 3. KAS RSA key pair
openssl req -x509 -nodes -newkey RSA:2048 -subj "/CN=kas" \
  -keyout dsp-keys/kas-private.pem -out dsp-keys/kas-cert.pem -days 365

# 4. KAS EC key pair
openssl ecparam -name prime256v1 > dsp-keys/ecparams.tmp
openssl req -x509 -nodes -newkey ec:dsp-keys/ecparams.tmp -subj "/CN=kas" \
  -keyout dsp-keys/kas-ec-private.pem -out dsp-keys/kas-ec-cert.pem -days 365
rm dsp-keys/ecparams.tmp

# 5. Policy import/export signing keys (requires cosign CLI)
brew install cosign
mkdir -p dsp-keys/policyimportexport
COSIGN_PASSWORD=changeme cosign generate-key-pair \
  --output-key-prefix dsp-keys/policyimportexport/cosign
printf '%s' 'changeme' > dsp-keys/policyimportexport/cosign.pass

# 6. Encrypted search key (32-byte hex value used by the SharePoint PEP - this is a dummy placeholder file)
printf '%s' '49e9a28af998c2678e6651ad4e60a2dbba2f3d284f58b224b3382919c1de7d55' \
  > dsp-keys/encrypted-search.key
```

### 5. DSP image in the local registry

The `dev.dsp.Dockerfile` builds on top of the proprietary DSP image.
It must be loaded into a local Docker registry on port 5000.

```bash
# Start the local registry (once)
docker run -d --restart=always -p 5000:5000 --name registry registry:2

# Load DSP images from the bundle (run from the bundle root)
./dsp copy-images --insecure localhost:5000/virtru

# Verify
curl -s http://localhost:5000/v2/virtru/data-security-platform/tags/list
```

---

## Running the Stack

All commands run from the `DSP-standalone/` directory.

### Start

```bash
docker compose up --build
```

To run detached (in the background):

```bash
docker compose up --build -d
```

### Stop

```bash
docker compose down
```

To also delete the Postgres volumes:

```bash
docker compose down -v
```

### View logs

```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f dsp
docker compose logs -f keycloak
```

---

## Startup Sequence

Docker Compose enforces this dependency order automatically:

```
keycloak-db (healthy)
    └─► keycloak (healthy)
            └─► dsp-keycloak-provisioning (completed)
                    └─► dsp (healthy)  ◄── dsp-db (healthy)
                                └─► dsp-provision-federal-policy (completed)
```

Allow ~3–5 minutes on first run for Keycloak to initialize.

---

## Validation

### 1. Check container status

```bash
docker compose ps
```

Expected output when fully running:

```
NAME                                         STATUS
virtru-dsp-only-keycloak-db-1               Up (healthy)
virtru-dsp-only-keycloak-1                  Up (healthy)
virtru-dsp-only-dsp-keycloak-provisioning-1 Exited (0)
virtru-dsp-only-dsp-db-1                    Up (healthy)
virtru-dsp-only-dsp-1                       Up (healthy)
virtru-dsp-only-dsp-provision-federal-policy-1 Exited (0)
```

> The two provisioning containers should show `Exited (0)` — a non-zero exit code means provisioning failed.

### 2. DSP health endpoint

```bash
curl -fks https://local-dsp.virtru.com:8080/healthz
```

Expected: HTTP 200 with a JSON body similar to:

```json
{"status":"SERVING"}
```

### 3. DSP well-known OpenID configuration

```bash
curl -fks https://local-dsp.virtru.com:8080/.well-known/openid-configuration | jq .
```

### 4. Keycloak realm reachable

```bash
curl -fks https://local-dsp.virtru.com:18443/auth/realms/opentdf | jq .realm
```

Expected: `"opentdf"`

### 5. DSP attributes were provisioned (federal policy)

The DSP exposes a ConnectRPC API. Obtain a token and query the attributes service:

```bash
TOKEN=$(curl -fks \
  -d "grant_type=client_credentials&client_id=opentdf&client_secret=secret" \
  https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token \
  | jq -r .access_token)

curl -ks -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "connect-protocol-version: 1" \
  -d '{"pagination":{}}' \
  "https://local-dsp.virtru.com:8080/policy.attributes.AttributesService/ListAttributes" \
  | jq '[.attributes[] | {name, rule, namespace: .namespace.name}]'
```

Expected output:

```json
[
  { "name": "needtoknow",     "rule": "ATTRIBUTE_RULE_TYPE_ENUM_ALL_OF",   "namespace": "demo.com" },
  { "name": "relto",          "rule": "ATTRIBUTE_RULE_TYPE_ENUM_ANY_OF",   "namespace": "demo.com" },
  { "name": "classification", "rule": "ATTRIBUTE_RULE_TYPE_ENUM_HIERARCHY","namespace": "demo.com" }
]
```

### 6. Database connectivity

```bash
# DSP database — policy tables live in the dsp_policy schema
docker exec virtru-dsp-only-dsp-db-1 psql -U postgres -d opentdf -c "\dt dsp_policy.*"

# Keycloak database
docker exec virtru-dsp-only-keycloak-db-1 psql -U postgres -d keycloak -c "\dt"
```

---

## Credentials Reference

| Service | Username / Client ID | Password / Secret |
|---|---|---|
| Keycloak admin console | `admin` | `changeme` |
| DSP Postgres | `postgres` | `changeme` |
| Keycloak Postgres | `postgres` | `changeme` |
| Keycloak `opentdf` client | `opentdf` | `secret` |
| Keycloak `opentdf-sdk` client | `opentdf-sdk` | `secret` |
| Test user: Alice (Secret/USA) | `aaa@secret.usa` | `testuser123` |
| Test user: Bob (TS/GBR) | `bbb@topsecret.gbr` | `testuser123` |
| Test user: Jane (Confidential/FRA) | `int@classified.fra` | `testuser123` |
| Test user: James (Unclassified/MEX) | `user@unclassified.mex` | `testuser123` |

Keycloak Admin Console: `https://local-dsp.virtru.com:18443/auth`

---

## Troubleshooting

### Keycloak fails to start

- Verify `dsp-keys/local-dsp.virtru.com.pem` and `.key.pem` exist and are readable.
- Check Keycloak-DB is healthy: `docker compose ps keycloak-db`

### DSP fails to start or stays unhealthy

- Confirm `local-dsp.virtru.com` resolves to `127.0.0.1`: `ping local-dsp.virtru.com`
- Confirm all KAS key files exist in `dsp-keys/`.
- Check DSP logs: `docker compose logs dsp`

### Provisioning container exits non-zero

- Check logs: `docker compose logs dsp-keycloak-provisioning`
- Re-run provisioning manually after DSP is healthy:
  ```bash
  docker compose run --rm dsp-keycloak-provisioning
  ```

### Port conflicts

If any port is already in use, either stop the conflicting process or override the published port:

```bash
# Example: change keycloak-db external port from 25434 to 25435
DSP_KEYCLOAK_DB_PORT=25435 docker compose up
```

(Requires adding environment variable substitution to the compose file for your specific port.)

---

## Users and Attributes

### How Access Control Works

DSP uses **Attribute-Based Access Control (ABAC)**. The flow from a user identity to data access is:

```
Keycloak user
  └─ has IdP attributes (clearance, needToKnow, nationality)
        └─ matched by Subject Condition Sets  (in sample.federal_policy.yaml)
              └─ linked via Subject Mappings to DSP Attribute Values
                    └─ applied to TDF-protected data at encrypt time
```

When a user attempts to decrypt data, DSP checks whether their Keycloak attributes satisfy every attribute value that was applied to that data at encryption time.

---

### Existing Users

Users are defined in `sample.keycloak.yaml` under `realms[].users`. Each user has:

- **Keycloak identity** — username, email, password, realm role
- **IdP attributes** — `clearance`, `needToKnow`, `nationality` — these are the values DSP's subject condition sets evaluate

| Username | Email | Clearance | Need-to-Know | Nationality | Realm Role |
|---|---|---|---|---|---|
| `secret-usa-aaa` | aaa@secret.usa | `S` (Secret) | AAA, BBB, INT, OPS | USA | opentdf-org-admin |
| `top-secret-gbr-bbb` | bbb@topsecret.gbr | `TS` (Top Secret) | BBB | GBR | opentdf-standard |
| `classified-fra-int` | int@classified.fra | `C` (Confidential) | INT | FRA | opentdf-standard |
| `unclassified-mex-user` | user@unclassified.mex | `U` (Unclassified) | *(none)* | MEX | opentdf-standard |

All test users have password: `testuser123`

**DSP attributes each user is entitled to access** (derived from subject mappings):

| User | classification | needtoknow | relto |
|---|---|---|---|
| Alice (S/USA) | secret, confidential, unclassified | aaa, bbb, int, ops | usa, fvey, nato, pink |
| Bob (TS/GBR) | topsecret, secret, confidential, unclassified | bbb | gbr, fvey, nato, pink |
| Jane (C/FRA) | confidential, unclassified | int | fra, nato, pink |
| James (U/MEX) | unclassified | *(none)* | mex |

---

### Existing Attributes

Attributes are defined in `sample.federal_policy.yaml` under `attributes`. All attributes belong to the `demo.com` namespace.

#### `classification` — HIERARCHY rule

Values are ordered from highest to lowest. A user entitled to a higher level is automatically entitled to all lower levels.

| Value | Meaning |
|---|---|
| `topsecret` | Top Secret |
| `secret` | Secret |
| `confidential` | Confidential |
| `unclassified` | Unclassified |

**Mapped from Keycloak `clearance` attribute:**

| Keycloak `clearance` value(s) | Entitled to |
|---|---|
| `TS`, `Top Secret`, `topsecret`, `DV`, `PV`, `NV2` | topsecret (and all below) |
| `S`, `SC`, `Secret`, `NV1` | secret (and all below) |
| `C`, `Confidential` | confidential (and below) |
| `U`, `Unclassified` | unclassified |

#### `needtoknow` — ALL_OF rule

A user must hold **all** needtoknow values applied to a piece of data to decrypt it.

| Value | Mapped from Keycloak `needToKnow` |
|---|---|
| `aaa` | `AAA` |
| `bbb` | `BBB` |
| `int` | `INT` |
| `ops` | `OPS` |

#### `relto` — ANY_OF rule

A user needs **at least one** matching relto value. Includes coalition groups and individual ISO 3166-1 alpha-3 country codes.

| Value | Members |
|---|---|
| `fvey` | USA, GBR, AUS, CAN, NZL |
| `nato` | 32 NATO member nations |
| `pink` | 21 nations (USA, GBR, FRA, DEU, + 17 others) |
| `USA`, `GBR`, `FRA`, … | Individual nations — mapped from Keycloak `nationality` |

---

### Adding a New User

New users are added to `sample.keycloak.yaml`. They take effect the next time the stack is started fresh (the `dsp-keycloak-provisioning` one-shot container re-runs).

**Step 1 — Add the user to `sample.keycloak.yaml`**

**Option A — Interactive script (recommended)**

Run `add_user.py` from the `DSP-standalone/` directory. It prompts for each field, validates input, applies defaults, and appends the correctly formatted YAML block automatically:

```bash
python3 add_user.py
```

The script prompts for: username, first/last name, email, password, clearance level, need-to-know compartments, nationality (ISO 3166-1 alpha-3), realm role, and optional group membership. It validates each input and shows defaults where applicable. On confirmation it writes the entry directly to `sample.keycloak.yaml`.

**Option B — Edit manually**

Find the `users:` list under `realms[0]` and append a new entry. The minimum required fields are `username`, `email`, `credentials`, `realmRoles`, and `attributes`.

```yaml
# sample.keycloak.yaml
realms:
  - ...
    users:
      # ... existing users ...

      - username: secret-aus-ops         # unique login name
        enabled: true
        firstName: Carol
        lastName: SecretAUS
        email: ops@secret.aus
        credentials:
          - value: testuser123
            type: password
        realmRoles:
          - opentdf-standard             # use opentdf-org-admin for admin users
        attributes:
          clearance:
            - S                          # S | TS | C | U  (or full words)
          needToKnow:
            - OPS                        # any combination of AAA, BBB, INT, OPS
          nationality:
            - AUS                        # ISO 3166-1 alpha-3 country code
```

**Step 2 — Apply the change**

If the stack is already running, restart just the provisioning container:

```bash
docker compose run --rm dsp-keycloak-provisioning
```

Or do a full restart:

```bash
docker compose down
docker compose up --build
```

**Step 3 — Verify the user was created**

Obtain an admin token and query Keycloak's user API:

```bash
ADMIN_TOKEN=$(curl -fks \
  -d "grant_type=client_credentials&client_id=opentdf&client_secret=secret" \
  https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token \
  | jq -r .access_token)

curl -fks \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://local-dsp.virtru.com:18443/auth/admin/realms/opentdf/users?username=secret-aus-ops" \
  | jq '.[0] | {username, email, attributes}'
```

**Step 4 — Verify entitlements (optional)**

Confirm the user's Keycloak IdP attributes are set correctly — these are what DSP subject condition sets evaluate to determine entitlements:

```bash
ADMIN_TOKEN=$(curl -fks \
  -d "grant_type=client_credentials&client_id=opentdf&client_secret=secret" \
  https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token \
  | jq -r .access_token)

curl -fks \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://local-dsp.virtru.com:18443/auth/admin/realms/opentdf/users?username=secret-aus-ops" \
  | jq '.[0] | {username, email, attributes}'
```

Expected output confirms the user carries the correct IdP attributes:

```json
{
  "username": "secret-aus-ops",
  "email": "ops@secret.aus",
  "attributes": {
    "clearance": ["S"],
    "needToKnow": ["OPS"],
    "nationality": ["AUS"]
  }
}
```

> DSP maps these Keycloak attributes to DSP attribute values via the subject condition sets in `sample.federal_policy.yaml`. A user with `clearance: S` and `nationality: AUS` will be entitled to `classification/secret` (and below) and `relto/fvey` (since AUS is a Five Eyes member).

---

### Adding a New Attribute Value to an Existing Attribute

This covers adding a new value (e.g. a new clearance level, needtoknow compartment, or country group) to an already-defined attribute definition.

**Example: add a new needtoknow compartment `sci`**

**Step 1 — Add the value to `sample.federal_policy.yaml`**

```yaml
# sample.federal_policy.yaml
attributes:
  - namespace: demo.com
    attributes:
      - name: needtoknow
        rule: ALL_OF
        values:
          - value: aaa
          - value: bbb
          - value: int
          - value: ops
          - value: sci          # <-- add new value here
```

**Step 2 — Add a Subject Condition Set** that maps a Keycloak attribute value to this DSP value:

```yaml
subject_condition_sets:
  # ... existing sets ...

  scs_needtoknow_sci:
    subject_sets:
      - condition_groups:
          - boolean_operator: CONDITION_BOOLEAN_TYPE_ENUM_OR
            conditions:
              - subject_external_selector_value: '.attributes.needToKnow[]'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values:
                  - SCI                  # the value stored in Keycloak
              - subject_external_selector_value: '.clientId'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values: *approved_clients
```

**Step 3 — Add a Subject Mapping** linking the attribute value to the condition set:

```yaml
subject_mappings:
  # ... existing mappings ...

  sm_needtoknow_sci:
    attribute_value: demo.com/attr/needtoknow/value/sci
    subject_condition_set_name: scs_needtoknow_sci
    actions:
      - DECRYPT
      - READ
```

**Step 4 — Reprovision the DSP policy:**

```bash
docker compose run --rm dsp-provision-federal-policy
```

**Step 5 — Verify the new value exists:**

```bash
TOKEN=$(curl -fks \
  -d "grant_type=client_credentials&client_id=opentdf&client_secret=secret" \
  https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token \
  | jq -r .access_token)

curl -ks -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "connect-protocol-version: 1" \
  -d '{"pagination":{}}' \
  "https://local-dsp.virtru.com:8080/policy.attributes.AttributesService/ListAttributes" \
  | jq '[.attributes[] | select(.name == "sci")]'
```

---

### Adding a New Attribute Definition

This covers adding an entirely new attribute (new name, new rule type) under the `demo.com` namespace.

**Example: add a `program` attribute with values `alpha` and `bravo`**

**Step 1 — Add the attribute definition to `sample.federal_policy.yaml`:**

```yaml
attributes:
  - namespace: demo.com
    attributes:
      - name: classification
        # ... existing ...
      - name: needtoknow
        # ... existing ...
      - name: relto
        # ... existing ...

      - name: program              # <-- new attribute
        rule: ANY_OF               # ANY_OF | ALL_OF | HIERARCHY
        values:
          - value: alpha
          - value: bravo
```

**Available rule types:**

| Rule | Behavior |
|---|---|
| `HIERARCHY` | Values are ordered; higher entitlement implies lower ones. Use for clearance levels. |
| `ALL_OF` | User must hold every value applied to the data. Use for compartments. |
| `ANY_OF` | User needs at least one matching value. Use for group membership. |

**Step 2 — Add Subject Condition Sets** for each new value.

For `ANY_OF` / `ALL_OF` — one condition set per value:

```yaml
subject_condition_sets:
  scs_program_alpha:
    subject_sets:
      - condition_groups:
          - boolean_operator: CONDITION_BOOLEAN_TYPE_ENUM_OR
            conditions:
              - subject_external_selector_value: '.attributes.program[]'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values:
                  - alpha              # Keycloak user attribute value
              - subject_external_selector_value: '.clientId'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values: *approved_clients

  scs_program_bravo:
    subject_sets:
      - condition_groups:
          - boolean_operator: CONDITION_BOOLEAN_TYPE_ENUM_OR
            conditions:
              - subject_external_selector_value: '.attributes.program[]'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values:
                  - bravo
              - subject_external_selector_value: '.clientId'
                operator: SUBJECT_MAPPING_OPERATOR_ENUM_IN
                subject_external_values: *approved_clients
```

**Step 3 — Add Subject Mappings** for each value:

```yaml
subject_mappings:
  sm_program_alpha:
    attribute_value: demo.com/attr/program/value/alpha
    subject_condition_set_name: scs_program_alpha
    actions:
      - DECRYPT
      - READ

  sm_program_bravo:
    attribute_value: demo.com/attr/program/value/bravo
    subject_condition_set_name: scs_program_bravo
    actions:
      - DECRYPT
      - READ
```

**Step 4 — Update users in `sample.keycloak.yaml`** to carry the new IdP attribute:

```yaml
users:
  - username: secret-usa-aaa
    # ... existing fields ...
    attributes:
      clearance:
        - S
      needToKnow:
        - AAA
      nationality:
        - USA
      program:              # <-- add the new attribute
        - alpha
```

**Step 5 — Reprovision everything:**

```bash
# Reprovision Keycloak users
docker compose run --rm dsp-keycloak-provisioning

# Reprovision DSP policy
docker compose run --rm dsp-provision-federal-policy
```

**Step 6 — Verify the new attribute exists in DSP:**

```bash
TOKEN=$(curl -fks \
  -d "grant_type=client_credentials&client_id=opentdf&client_secret=secret" \
  https://local-dsp.virtru.com:18443/auth/realms/opentdf/protocol/openid-connect/token \
  | jq -r .access_token)

# List all attributes — new one should appear
curl -ks -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "connect-protocol-version: 1" \
  -d '{"pagination":{}}' \
  "https://local-dsp.virtru.com:8080/policy.attributes.AttributesService/ListAttributes" \
  | jq '[.attributes[] | select(.name == "program")]'
```

---

### Configuration File Reference

| File | Purpose |
|---|---|
| `sample.keycloak.yaml` | Defines Keycloak realm, clients, and users. Consumed by `dsp-keycloak-provisioning`. |
| `sample.federal_policy.yaml` | Defines DSP attribute namespaces, definitions, values, subject mappings, and subject condition sets. Consumed by `dsp-provision-federal-policy`. |

Changes to either file require re-running the corresponding provisioning container (or a full stack restart) to take effect.
