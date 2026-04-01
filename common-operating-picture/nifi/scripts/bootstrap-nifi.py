#!/usr/bin/env python3
"""
Bootstrap script for NiFi.

Runs once after NiFi starts to:
  1. Upload the flow template
  2. Instantiate it on the root process group
  3. Configure controller services with env var credentials
  4. Enable controller services
  5. Configure processor relationships
  6. Start the process group

Idempotent: exits early if the flow is already loaded.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin

# ---------------------------------------------------------------------------
# Config from environment
# ---------------------------------------------------------------------------
NIFI_URL = os.environ.get("NIFI_URL", "http://nifi:8080")
TEMPLATE_FILE = os.environ.get("TEMPLATE_FILE", "/flows/working_flow.xml")
PLATFORM_HOSTNAME = os.environ.get("PLATFORM_HOSTNAME", "")
FLOW_HOSTNAME_PLACEHOLDER = os.environ.get("FLOW_HOSTNAME_PLACEHOLDER", "local-dsp.virtru.com")

CLIENT_SECRET = os.environ.get("TDF_FLOW_CLIENT_SECRET", "")
DB_PASSWORD = os.environ.get("TDFDB_DATABASE_PASSWORD", "")
TRUSTSTORE_PASSWORD = os.environ.get("NIFI_TRUSTSTORE_PASSWORD", "password")

# Controller service display names → sensitive properties to configure
# Keys must match the NiFi internal property names (shown in the XML)
CONTROLLER_SERVICE_CONFIG = {
    "Example DSP ControllerService": {
        "clientSecret": CLIENT_SECRET,
    },
    "Example DSP SSLContextService": {
        "Truststore Password": TRUSTSTORE_PASSWORD,
    },
    "Example PostGIS DBCPConnectionPool": {
        "Password": DB_PASSWORD,
    },
}

# Services that only need to be enabled (no property updates)
ENABLE_ONLY_SERVICES = ["Mission JsonRecordSetWriter", "Sample JsonTreeReader"]

# Processor name → relationships to auto-terminate
AUTO_TERMINATE_RELATIONSHIPS = {
    "TDF - GetTags": ["assertion_incomplete"],
}

# Processor name → scheduling period override
PROCESSOR_SCHEDULING = {
    "Example List Sample Data File": "5 sec",
}


# ---------------------------------------------------------------------------
# REST helpers
# ---------------------------------------------------------------------------

def _request(method, path, data=None, content_type="application/json"):
    url = urljoin(NIFI_URL, f"/nifi-api/{path}")
    body = None
    if data is not None:
        body = json.dumps(data).encode() if isinstance(data, dict) else data
    req = urllib.request.Request(url, data=body, method=method)
    if content_type and body is not None:
        req.add_header("Content-Type", content_type)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def api_get(path):
    return _request("GET", path)


def api_post(path, data=None, content_type="application/json"):
    return _request("POST", path, data, content_type)


def api_put(path, data):
    return _request("PUT", path, data)


def upload_template_multipart(filepath):
    """Upload template XML using multipart/form-data."""
    boundary = "NiFiBootstrapBoundary"
    with open(filepath, "rb") as f:
        file_data = f.read()

    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="template"; filename="flow.xml"\r\n'
        f"Content-Type: application/xml\r\n\r\n"
    ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

    url = urljoin(NIFI_URL, "/nifi-api/process-groups/root/templates/upload")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 409:
            # Template already exists — find and return the existing one
            print("  Template already uploaded, fetching existing...", flush=True)
            return None
        raise


# ---------------------------------------------------------------------------
# Bootstrap steps
# ---------------------------------------------------------------------------

def wait_for_nifi():
    print("Waiting for NiFi to be ready...", flush=True)
    while True:
        try:
            api_get("system-diagnostics")
            print("NiFi is ready.", flush=True)
            return
        except Exception:
            print("  Not ready yet, retrying in 5s...", flush=True)
            time.sleep(5)


def is_already_bootstrapped():
    root = api_get("flow/process-groups/root")
    pgs = root["processGroupFlow"]["flow"]["processGroups"]
    if pgs:
        print(f"Flow already loaded ({len(pgs)} process group(s) found). Skipping bootstrap.", flush=True)
        return True
    return False


def get_existing_template_id():
    """Return the ID of the first template already loaded in NiFi, or None."""
    result = api_get("flow/templates")
    templates = result.get("templates", [])
    if templates:
        return templates[0]["template"]["id"]
    return None


def prepare_template():
    """Substitute PLATFORM_HOSTNAME into the flow XML if provided, return path to use."""
    if not PLATFORM_HOSTNAME or PLATFORM_HOSTNAME == FLOW_HOSTNAME_PLACEHOLDER:
        return TEMPLATE_FILE

    with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
        content = f.read()

    modified = content.replace(FLOW_HOSTNAME_PLACEHOLDER, PLATFORM_HOSTNAME)

    tmp_path = "/tmp/working_flow_substituted.xml"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(modified)

    print(f"  Substituted '{FLOW_HOSTNAME_PLACEHOLDER}' -> '{PLATFORM_HOSTNAME}' in flow XML.", flush=True)
    return tmp_path


def upload_template():
    template_path = prepare_template()
    print(f"Uploading template: {template_path}", flush=True)
    result = upload_template_multipart(template_path)
    if result is None:
        template_id = get_existing_template_id()
        print(f"  Using existing template ID: {template_id}", flush=True)
    else:
        template_id = result["template"]["id"]
        print(f"  Template ID: {template_id}", flush=True)
    return template_id


def instantiate_template(template_id):
    print("Instantiating template...", flush=True)
    result = api_post("process-groups/root/template-instance", {
        "templateId": template_id,
        "originX": 100,
        "originY": 100,
        "disconnectedNodeAcknowledged": False,
    })
    pg_id = result["flow"]["processGroups"][0]["id"]
    print(f"  Process group ID: {pg_id}", flush=True)
    return pg_id


def get_all_controller_services(pg_id):
    """Return a dict of service name → service object, searching recursively."""
    result = api_get(
        f"flow/process-groups/{pg_id}/controller-services"
        "?includeAncestorGroups=false&includeDescendantGroups=true"
    )
    return {svc["component"]["name"]: svc for svc in result.get("controllerServices", [])}


def configure_service(svc, props):
    svc_id = svc["id"]
    version = svc["revision"]["version"]
    api_put(f"controller-services/{svc_id}", {
        "revision": {"version": version},
        "component": {"id": svc_id, "properties": props},
    })
    # Re-fetch to get updated revision after the property update
    return api_get(f"controller-services/{svc_id}")


def enable_service(name, svc_id):
    # Always re-fetch right before enabling to get the latest revision
    svc = api_get(f"controller-services/{svc_id}")
    version = svc["revision"]["version"]
    api_put(f"controller-services/{svc_id}/run-status", {
        "revision": {"version": version},
        "state": "ENABLED",
        "disconnectedNodeAcknowledged": False,
    })
    # Poll until fully ENABLED (timeout 30s)
    for _ in range(30):
        time.sleep(1)
        svc = api_get(f"controller-services/{svc_id}")
        state = svc["component"].get("state", "")
        if state == "ENABLED":
            print(f"  Enabled: {name}", flush=True)
            return
    print(f"  WARNING: '{name}' did not reach ENABLED state (state={state})", flush=True)


def configure_and_enable_services(pg_id):
    print("Fetching controller services...", flush=True)
    services = get_all_controller_services(pg_id)

    # Configure sensitive properties first
    for name, props in CONTROLLER_SERVICE_CONFIG.items():
        if name not in services:
            print(f"  WARNING: service '{name}' not found, skipping", flush=True)
            continue
        print(f"  Configuring '{name}'...", flush=True)
        configure_service(services[name], props)

    # Enable in dependency order: SSL first, then DSP, then DB, then writer
    enable_order = [
        "Example DSP SSLContextService",
        "Example DSP ControllerService",
        "Example PostGIS DBCPConnectionPool",
        "Sample JsonTreeReader",
        "Mission JsonRecordSetWriter",
    ]
    for name in enable_order:
        if name not in services:
            print(f"  WARNING: service '{name}' not found, skipping", flush=True)
            continue
        enable_service(name, services[name]["id"])


def get_all_processors(pg_id):
    """Return a dict of processor name → processor object, recursively."""
    result = api_get(f"process-groups/{pg_id}/processors")
    processors = {p["component"]["name"]: p for p in result.get("processors", [])}

    # Recurse into child process groups
    child_pgs = api_get(f"process-groups/{pg_id}/process-groups")
    for child in child_pgs.get("processGroups", []):
        processors.update(get_all_processors(child["id"]))

    return processors


def configure_processor_relationships(pg_id):
    if not AUTO_TERMINATE_RELATIONSHIPS:
        return

    print("Configuring processor relationships...", flush=True)
    processors = get_all_processors(pg_id)

    for proc_name, relationships in AUTO_TERMINATE_RELATIONSHIPS.items():
        if proc_name not in processors:
            print(f"  WARNING: processor '{proc_name}' not found, skipping", flush=True)
            continue

        proc = processors[proc_name]
        proc_id = proc["id"]
        version = proc["revision"]["version"]

        # Build auto-terminated set: existing + new ones
        existing = set(proc["component"].get("autoTerminatedRelationships", []))
        updated = existing | set(relationships)

        api_put(f"processors/{proc_id}", {
            "revision": {"version": version},
            "component": {
                "id": proc_id,
                "autoTerminatedRelationships": list(updated),
            },
        })
        print(f"  Set auto-terminate on '{proc_name}': {sorted(updated)}", flush=True)


def configure_processor_scheduling(pg_id):
    if not PROCESSOR_SCHEDULING:
        return

    print("Configuring processor scheduling...", flush=True)
    processors = get_all_processors(pg_id)

    for proc_name, schedule in PROCESSOR_SCHEDULING.items():
        if proc_name not in processors:
            print(f"  WARNING: processor '{proc_name}' not found, skipping", flush=True)
            continue

        proc = processors[proc_name]
        proc_id = proc["id"]
        version = proc["revision"]["version"]

        api_put(f"processors/{proc_id}", {
            "revision": {"version": version},
            "component": {
                "id": proc_id,
                "config": {"schedulingPeriod": schedule},
            },
        })
        print(f"  Set '{proc_name}' schedule to {schedule}", flush=True)


def start_process_group(pg_id):
    print(f"Starting process group {pg_id}...", flush=True)
    api_put(f"flow/process-groups/{pg_id}", {
        "id": pg_id,
        "state": "RUNNING",
        "disconnectedNodeAcknowledged": False,
    })
    print("  Process group started.", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    wait_for_nifi()

    if is_already_bootstrapped():
        return

    template_id = upload_template()
    pg_id = instantiate_template(template_id)
    configure_and_enable_services(pg_id)
    configure_processor_relationships(pg_id)
    configure_processor_scheduling(pg_id)
    start_process_group(pg_id)

    print("\nBootstrap complete! NiFi flow is running.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Bootstrap failed: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
