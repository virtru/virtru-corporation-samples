
# COP Deployment: Helm
_version <release_tag>_

This deployment assumes that the Virtru Platform has been installed to a Kubernetes cluster.

To deploy the COP application to your cluster, follow this guide:

1. Install the Virtru Data Security Platform (DSP), version 2.1.x or greater.
1. Establish [Application Pre-requisites](#pre-requisites)
1. [Platform Configuration](#platform-configuration)
1. [Prepare TLS Certificates](#prepare-tls-certificates).
1. [Deploy the application-specific Keycloak client](#keycloak-clients) (a server-side NPE account).
1. [Entitle the PEP Client](#entitle-the-pep-client)
1. [Helm Deployment](#helm-deployment)
1. [Deploy NiFi Ingest](#deploy-nifi-ingest)


## Pre-requisites

1. We'll refer to your DSP instance using the FQDN `platform.example.com`.
1. We'll refer to your Application instance using the FQDN `cop.example.com`.

You'll be instructed later to update these placeholder values as appropriate.

Obtain the following assets:

1. The DSP COP Helm chart (`.tar.gz`) file
1. The `keycloak-client.json` file

## Platform Configuration

Update your DSP platform `values.yaml` (or the appropriate `ConfigMap`), to include 
the following elements, inserted into the `platform.server` block (shown as `server:` below):

```yaml
  server:
    cors:
      enabled: true
      allowedorigins:
        # Note that the protocol/scheme (e.g. http:// versus https://) matters
        # when configuring CORS.
        #
        # Be sure to configure the following appropriately
        - "https://cop.example.com"
        - "https://cop-api.example.com"
        # Specifying a port may or may not work, depending on your container platform
        # - "http://cop.example.com:5001"
        # - "http://cop.example.com:5002"
        # Alternatively, use an asterisk to allow all CORS origins
        # - "*"
      allowedmethods:
        - GET
        - POST
        - PATCH
        - PUT
        - DELETE
        - OPTIONS
      # List of headers that are allowed in a request
      allowedheaders:
        - ACCEPT
        - Authorization
        - Content-Type
        - X-CSRF-Token
        - virtru-ntdf-version
      # List of response headers that browsers are allowed to access
      exposedheaders:
        - Link
      # Sets whether credentials are included in the CORS request
      allowcredentials: true
      # Sets the maximum age (in seconds) of a specific CORS preflight request
      maxage: 3600
```

## Prepare TLS Certificates

This application requires specific TLS trust configuration.

### Kubernetes TLS configuration

COP functionality depends on proper trust of the DSP platform.  In other words,
the Certificate Authority (CA) or self-signed certificates used to deploy
the DSP platform, must be trusted (implicitly or explicitly) by the COP deployment.

>\*The following is not best practice, however it is the required configuration
until we address https://virtru.atlassian.net/browse/FED-2278 .

>\*Prerequisite: Familiarity with [x509 SANs (Subject Alternative Names)](https://support.dnsimple.com/articles/what-is-ssl-san/)

To configure TLS trust, we will update the DSP x509 certificate to ensure that the certificate includes SANs for `cop.example.com`, `cop-api.example.com` and `*.example.com`.  Then, 
we will re-use the TLS secret to protect COP, either:
* By deploying COP to the same Kubernetes namespace as DSP, or
* By deploying COP to a distinct Kubernetes namespace and importing the identical TLS secret
(DSP x509 certificate) to both namespaces.


### Other Kubernetes TLS configuration

***TBD***


## Keycloak Clients

1. Prepare the `keycloak-client.json` file
    1. This file will be used to configure the Keycloak client
    1. Open the file in a text editor, and replace the placeholder `https://platform.example.com`, used
    in the `"included.client.audience"` field.
1. Import the Keycloak Client.  
    1. Authenticate as the Keycloak admin to the Keycloak UI.
    1. Navigate into the `opentdf` realm, and click `"Clients"` in the left-side menu.
    1. Click `"Import client"` in the center of the UI.
    1. Select `keycloak-client.json` that you've modified above.
    1. The current web origins configuration is permissive.  Tighten as needed.


## Entitle the PEP Client

***TBD***

Is there any server-side NPE entitlement required?


## Helm Deployment

1. Obtain the appropriate Helm release artifact
  * Externally, customer engagement staff can provide these files
  * Internally, you can find assets at https://github.com/virtru-corp/dsp-cop/releases
1. Unpack the Helm artifact, and copy the `values.yaml` to the working directory
    ```
    tar -xzvf dspcop-helm-*.tgz
    cp dspcop-helm/values.yaml .
    ```
1. Update the `values.yaml` file, as appropriate for all fields between
    sections that start and end with the following comments:
    ```
    ############################################
    # BEGIN required inputs
    ############################################
    ```

    and

    ```
    ############################################
    # END required inputs
    ############################################
    ```
1. Be sure to update the `dsp_cop_secret` property in the `values.yaml` file, to point to the Kubernetes secret containing the combined DSP/COP x509 (referenced in [Prepare TLS Certificates](#prepare-tls-certificates)).    
1. Use helm to install the chart by running the following.
    ```sh
    RELEASE_NAME=cop
    NAMESPACE=virtru
    helm upgrade --install -n  "$NAMESPACE" "$RELEASE_NAME" ./dspcop-helm-*.tgz -f ./values.yaml 
    ```


## Deploy NiFi Ingest

1. Helm install NiFi as appropriate
1. Fetch the appropriate trusted CA `.pem` file from Kubernetes (TLS secret), and use it to create 
a Java Key Store (`.jks`) for NiFi. 
    ```bash
    # Set namespace
    env NAMESPACE="changeme" ./scripts/build/build_truststore_k8s.sh
    ```
1. After running the above script, a file named `k8s-truststore/ca.jks` will be created. Copy it
into the NiFi pod with the following command.  NOTE: The destination path matches the
path set by the `TDF_TRUSTSTORE_FILENAME` in `values.yaml`:
    ```bash
    kubectl cp k8s-truststore/ca.jks dspcop-helm-0:/opt/nifi/nifi-current/truststore/ca.jks
    ```
1. Deploy the `.nar` files:
    ```
    kubectl cp ./nifi/extensions/nifi-tdf-nar-0.1.0.nar dspcop-helm-0:/opt/nifi/nifi-current/extensions/
    kubectl cp ./nifi/extensions/nifi-tdf-controller-services-nar-0.1.0.nar dspcop-helm-0:/opt/nifi/nifi-current/extensions/
    kubectl cp ./nifi/extensions/nifi-tagging-nar-2.0.0-SNAPSHOT.nar dspcop-helm-0:/opt/nifi/nifi-current/extensions/
    ```
1. Navigate to the NiFi UI, and deploy `example_flow.xml` 
1. Configure processors according to [nifi/README.md](../nifi/README.md)
    * Jump to the "`CHANGEME`" section.
1. To be safe, destroy the Tagging PDP pod before continuing


### NiFi Kubernetes Shell 

If needed, obtain a `bash` shell in the NiFi bod using the following command:

```bash
kubectl exec -i -t dspcop-helm-0 -- /bin/bash
```