#!/bin/bash

# Script to get JWT token from Keycloak using username/password authentication
# Default values can be overridden with environment variables
# Use --quiet flag to output only the token (for use in scripts)

QUIET_MODE=false
if [ "$1" = "--quiet" ]; then
    QUIET_MODE=true
fi

KEYCLOAK_URL="${KEYCLOAK_URL:-https://local-dsp.virtru.com:8443/auth}"
REALM="${REALM:-opentdf}"
CLIENT_ID="${CLIENT_ID:-secure-object-proxy-test}"
CLIENT_SECRET="${CLIENT_SECRET:-secret}"
USERNAME="${USERNAME:-top-secret-gbr-bbb}"
PASSWORD="${PASSWORD:-testuser123}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ "$QUIET_MODE" = false ]; then
    echo "Requesting JWT token from Keycloak..."
    echo "  URL: $KEYCLOAK_URL"
    echo "  Realm: $REALM"
    echo "  Client ID: $CLIENT_ID"
    echo "  Username: $USERNAME"
    echo ""
fi

# Make the token request
RESPONSE=$(curl -s -X POST \
  "${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "username=${USERNAME}" \
  -d "password=${PASSWORD}" \
  -d "grant_type=password")

# Check if request was successful
if [ $? -ne 0 ]; then
    if [ "$QUIET_MODE" = false ]; then
        echo -e "${RED}Error: Failed to connect to Keycloak${NC}" >&2
    fi
    exit 1
fi

# Extract access token
ACCESS_TOKEN=$(echo "$RESPONSE" | grep -o '"access_token":"[^"]*' | sed 's/"access_token":"//')

if [ -z "$ACCESS_TOKEN" ]; then
    if [ "$QUIET_MODE" = false ]; then
        echo -e "${RED}Error: Failed to obtain access token${NC}" >&2
        echo "Response: $RESPONSE" >&2
    fi
    exit 1
fi

echo "$ACCESS_TOKEN"

