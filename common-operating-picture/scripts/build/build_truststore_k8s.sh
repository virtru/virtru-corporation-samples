#!/usr/bin/env bash

# The input variables rely on unbound variables for input validation.
#
# $NAMESPACE must be set as an environment variables to run. 
# example env NAMESPACE="something" ./build_truststore_k8s.sh
[[ $NAMESPACE ]] || { echo >&2 "Must supply NAMESPACE environment variable.  Run 'env NAMESPACE=something ./build_truststore_k8s.sh' and retry."; exit 1; }

set -euo pipefail
shopt -s inherit_errexit

# The bash boilerplate above ensures the script exits immediately on errors, treats
# unset variables as errors, and propagates errors in pipelines and subshells. This 
# makes the script more robust and predictable, preventing it from continuing in an 
# inconsistent state.
#
# For more information, see:
#   https://vaneyckt.io/posts/safer_bash_scripts_with_set_euxo_pipefail/
#   https://dougrichardson.us/notes/fail-fast-bash-scripting

# Set namespace
TRUSTSTORE_PASSWORD=password

certDir="$(pwd)/k8s-truststore"
mkdir -p ${certDir}
echo "Removing existing truststore"
rm -rf ${certDir}/*

# Identify the appropriate secret
kubectl get secrets --field-selector type=kubernetes.io/tls -n ${NAMESPACE} -o json | jq '.items[].metadata.name'

# Prompt the user to select one of the printed options
echo "Please enter the name of the TLS secret from the list above, then press RETURN:"
read TLS_SECRET

CA_CERT=$(kubectl get secrets --field-selector type=kubernetes.io/tls -n "$NAMESPACE" -o json | jq --arg s "$TLS_SECRET" ' .items[] | select ( .metadata.name==$s )' | jq -r ' .data["ca.crt"]' )

echo "Writing CA PEM content to ${certDir}/ca.crt"
echo $CA_CERT | base64 -d > ${certDir}/ca.crt
echo "Finished writing CA PEM content to ${certDir}/ca.crt"

for filename in $certDir/*.crt; do
  echo "import $filename into truststore"
  filelocal=$(basename ${filename})
  docker run -v ${certDir}:/keys  \
      openjdk:latest keytool \
      -import -trustcacerts \
      -alias $filelocal \
      -file keys/$filelocal \
      -destkeystore keys/ca.jks \
      -noprompt \
      -deststorepass "$TRUSTSTORE_PASSWORD"
done

printf """



Finished importing certificates into truststore file.

To list truststore content, run the following command:

docker run -v ${certDir}:/keys openjdk:latest keytool -list -v -keystore keys/ca.jks -storepass ${TRUSTSTORE_PASSWORD}
"""