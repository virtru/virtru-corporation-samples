#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null && pwd)"

# Generate keys for all clients
function parse_yaml {
   local prefix=$2
   local s='[[:space:]]*' w='[a-zA-Z0-9_]*' fs=$(echo @|tr @ '\034')
   sed -ne "s|^\($s\):|\1|" \
        -e "s|^\($s\)\($w\)$s:$s[\"']\(.*\)[\"']$s\$|\1$fs\2$fs\3|p" \
        -e "s|^\($s\)\($w\)$s:$s\(.*\)$s\$|\1$fs\2$fs\3|p"  $1 |
   awk -F$fs '{
      indent = length($1)/2;
      vname[indent] = $2;
      for (i in vname) {if (i > indent) {delete vname[i]}}
      if (length($3) > 0) {
         vn=""; for (i=0; i<indent; i++) {vn=(vn)(vname[i])("_")}
         printf("%s%s%s=\"%s\"\n", "'$prefix'",vn, $2, $3);
      }
   }'
}

cd dsp-keys

# Generate encrypted search key: https://github.com/virtru-corp/data-security-platform/blob/v2.1.0/README.md?plain=1#L80-L93
openssl rand -hex 32 > encrypted-search.key

# Parse the yaml for user CNs
echo "🪪 CLIENT CERTS!"
cp -n "$(mkcert -CAROOT)"/* .

ROOT_CA="rootCA.pem"
ROOT_CA_KEY="rootCA-key.pem"
ROOT_CA_SRL="rootCA.srl"
KEYCLOAK_TRUSTSTORE="local-dsp.virtru.com.truststore.jks"
CLIENT_VALID_DAYS=365

# Create a truststore and add the CA certificate to it
printf "✨ Creating Keycloak truststore => [${KEYCLOAK_TRUSTSTORE}]\n"

# if docker compose is executed before generating the KEYCLOAK_TRUSTSTORE, docker creates an empty directory at the mounted path
# This is a fix to remove that empty directory if it exists
if [ -d "$KEYCLOAK_TRUSTSTORE" ]; then
  printf "❌ A directory exists at '$PWD/$KEYCLOAK_TRUSTSTORE'\n\n"
  printf "The file '$KEYCLOAK_TRUSTSTORE' should be a java keystore (.jks) file\n\n"
  printf "Delete the directory and re-run '$BASH_SOURCE' to continue.\n\n"
  printf " 'rm -rf $PWD/$KEYCLOAK_TRUSTSTORE'\n\n"
  exit 1
fi

printf "Adding '${ROOT_CA}' to truststore => [${KEYCLOAK_TRUSTSTORE}]\n"
keytool -import -alias dsp-cop-root-ca -file "${ROOT_CA}" -keystore "${KEYCLOAK_TRUSTSTORE}" -storepass password -noprompt

parse_yaml ../../config/samples/sample.keycloak.yaml | \
  grep "users__email" | \
  cut -d '"' -f 2 | \
  while read CLIENT;
  do 
    printf "✨ Creating Client Certificate => [${CLIENT}]\n"
    "$SCRIPT_DIR/genkey-client.sh" \
      --subj "/C=US/ST=DC/L=Washington/O=Virtru/OU=dsp-cop/CN=${CLIENT}/emailAddress=${CLIENT}" \
      --file-basename "$CLIENT" \
      --days "${CLIENT_VALID_DAYS}";

    printf "Verifying '${CLIENT}.crt' as client certificate...\n"
    /usr/bin/openssl verify -CAfile "${ROOT_CA}" -purpose sslclient "${CLIENT}.crt"
    
    printf "Adding '${CLIENT}.crt' to truststore => [${KEYCLOAK_TRUSTSTORE}]\n"
    keytool -import -trustcacerts -keystore "${KEYCLOAK_TRUSTSTORE}" -storepass password -noprompt -file "${CLIENT}.crt" -alias "${CLIENT}"
    
    printf "✅ Client certificate and P12 file created successfully => [${CLIENT}]\n"
  done
