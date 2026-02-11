#!/bin/bash

# Use unique internal names to avoid conflicts with system variables like $USERNAME
QUIET_MODE=false
if [ "$1" = "--quiet" ]; then
    QUIET_MODE=true
fi

# Configuration - Renamed internal vars to avoid $USERNAME conflict
KC_URL="${KEYCLOAK_URL:-https://local-dsp.virtru.com:8443/auth}"
KC_REALM="${REALM:-opentdf}"
KC_CLIENT_ID="${CLIENT_ID:-secure-object-proxy-test}"
KC_CLIENT_SECRET="${CLIENT_SECRET:-secret}"
KC_USER="${K_USER:-secret-usa-aaa}" 
KC_PASS="${PASSWORD:-testuser123}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

if [ "$QUIET_MODE" = false ]; then
    echo "Requesting JWT token from Keycloak..."
    echo "  URL: $KC_URL"
    echo "  Username: $KC_USER"
    echo ""
fi

# Make the token request (-k ignores SSL errors for local dev)
RESPONSE=$(curl -k -s -X POST \
  "${KC_URL}/realms/${KC_REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${KC_CLIENT_ID}" \
  -d "client_secret=${KC_CLIENT_SECRET}" \
  -d "username=${KC_USER}" \
  -d "password=${KC_PASS}" \
  -d "grant_type=password")

# Extract access token using a slightly more robust regex
ACCESS_TOKEN=$(echo "$RESPONSE" | grep -oP '(?<="access_token":")[^"]*')

if [ -z "$ACCESS_TOKEN" ]; then
    if [ "$QUIET_MODE" = false ]; then
        echo -e "${RED}Error: Failed to obtain access token${NC}" >&2
        echo "Response: $RESPONSE" >&2
    else
        # In quiet mode, still send error to stderr so the variable doesn't fill with garbage
        echo "Error: Keycloak returned: $RESPONSE" >&2
    fi
    exit 1
fi

echo "$ACCESS_TOKEN"