#!/bin/bash

TRUSTSTORE_PASSWORD=password

dspCert="$(pwd)/dsp-keys/local-dsp.virtru.com.pem"
trustStoreDir="$(pwd)/truststore"

rm -rf $trustStoreDir

echo "import $dspCert into $trustStoreDir"
filelocal=$(basename ${dspCert})
mkdir -p $trustStoreDir
cp $dspCert $trustStoreDir
docker run -v $(pwd)/truststore:/keys  \
     eclipse-temurin:17-jdk keytool \
    -import -trustcacerts \
    -alias $filelocal \
    -file keys/$filelocal \
    -destkeystore keys/ca.jks \
    -noprompt \
    -deststorepass "$TRUSTSTORE_PASSWORD"
