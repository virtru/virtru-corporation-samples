import os
import uuid
import json
import random
import psycopg2
import argparse
import requests
import boto3
import base64
import urllib3
from faker import Faker
from datetime import datetime, timedelta

# --- Load env file if ENV_FILE is set or auto-detect ---
def _load_env_file():
    env_file = os.getenv("ENV_FILE")
    print(f"[config] ENV_FILE env var: {env_file!r}")
    if not env_file:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.normpath(os.path.join(script_dir, "..", "..", "env", "default.env"))
        print(f"[config] checking candidate path: {candidate}")
        print(f"[config] candidate exists: {os.path.exists(candidate)}")
        if os.path.exists(candidate):
            env_file = candidate
    if env_file and os.path.exists(env_file):
        print(f"[config] loading env file: {env_file}")
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    if k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip().strip('"')
        print(f"[config] env file loaded successfully")
    else:
        print(f"[config] no env file found, using environment defaults")

_load_env_file()

# --- Suppress SSL Warnings for local dev ---
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- User/Auth Configs ---
_hostname = os.getenv("PLATFORM_HOSTNAME", "local-dsp.virtru.com")
_https_port = os.getenv("PLATFORM_HTTPS_PORT", "8443")
_http_port = os.getenv("PLATFORM_HTTP_PORT", "8080")
print(f"[config] PLATFORM_HOSTNAME={_hostname} PLATFORM_HTTPS_PORT={_https_port} PLATFORM_HTTP_PORT={_http_port}")

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", f"https://{_hostname}:{_https_port}/auth")
REALM = os.getenv("REALM", "opentdf")
CLIENT_ID = 'secure-object-proxy-test'
CLIENT_SECRET = 'secret'
KC_USER = os.getenv("KC_USER", "top-secret-gbr-bbb")
KC_PASS = os.getenv("PASSWORD", "testuser123")
TOKEN_URL = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token"
print(f"[config] KEYCLOAK_URL={KEYCLOAK_URL}")
print(f"[config] TOKEN_URL={TOKEN_URL}")
print(f"[config] KC_USER={KC_USER}")

# --- DB Configs ---
DB_NAME, DB_USER, DB_PASSWORD = "postgres", "postgres", "changeme"
DB_HOST = os.getenv("DB_HOST", "cop-db")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
print(f"[config] DB_HOST={DB_HOST} DB_PORT={DB_PORT} DB_NAME={DB_NAME}")

# --- S4 / S3 Configs ---
_s4_port = os.getenv("S4_PORT", "7070")
_s4_base = os.getenv("S4_ENDPOINT", f"https://s4:{_s4_port}")
S4_STS_ENDPOINT = _s4_base
S4_S3_ENDPOINT = _s4_base
S4_BUCKET = "cop-demo"
S4_REGION = "us-east-1"
print(f"[config] S4_STS_ENDPOINT={S4_STS_ENDPOINT} S4_BUCKET={S4_BUCKET}")

# --- Fixed Need-to-Know attribute for all manifests ---
NEEDTOKNOW_ATTR = "https://demo.com/attr/needtoknow/value/bbb"
TOPSECRET_ATTR = "https://demo.com/attr/classification/value/topsecret"

# --- IC/Military Reference Data ---
MILITARY_BRANCHES = ["USAF", "USN", "USA", "USMC", "USSF", "USCG"]
COALITION_COUNTRIES = ["USA", "GBR", "CAN", "AUS", "NZL", "DEU", "FRA", "ITA", "NOR", "DNK"]
AIRCRAFT_PLATFORMS = [
    {"designation": "F-35A", "name": "Lightning II", "type": "FIGHTER", "service": "USAF"},
    {"designation": "F-22A", "name": "Raptor", "type": "FIGHTER", "service": "USAF"},
    {"designation": "F/A-18E", "name": "Super Hornet", "type": "FIGHTER", "service": "USN"},
    {"designation": "B-2A", "name": "Spirit", "type": "BOMBER", "service": "USAF"},
    {"designation": "KC-135R", "name": "Stratotanker", "type": "TANKER", "service": "USAF"},
    {"designation": "E-3G", "name": "Sentry", "type": "AWACS", "service": "USAF"},
    {"designation": "MQ-9A", "name": "Reaper", "type": "UAV", "service": "USAF"},
    {"designation": "RQ-4B", "name": "Global Hawk", "type": "UAV", "service": "USAF"},
    {"designation": "P-8A", "name": "Poseidon", "type": "MPA", "service": "USN"},
    {"designation": "C-17A", "name": "Globemaster III", "type": "TRANSPORT", "service": "USAF"},
    {"designation": "RC-135V", "name": "Rivet Joint", "type": "ISR", "service": "USAF"},
    {"designation": "EP-3E", "name": "Aries II", "type": "SIGINT", "service": "USN"},
]
MISSION_TYPES = ["ISR", "CAP", "CAS", "SEAD", "STRIKE", "RECON", "TANKER", "AIRLIFT", "SAR", "ELINT", "SIGINT"]
OPERATIONAL_STATUS = ["ACTIVE", "RTB", "ON_STATION", "TRANSITING", "HOLDING", "REFUELING", "MAINTENANCE"]
INTEL_SOURCES = ["SIGINT", "IMINT", "MASINT", "HUMINT", "OSINT", "GEOINT", "ELINT", "COMINT"]
COMMAND_ELEMENTS = ["CENTCOM", "EUCOM", "INDOPACOM", "AFRICOM", "NORTHCOM", "SOUTHCOM", "SPACECOM", "CYBERCOM"]
SECURITY_CAVEATS = ["NOFORN", "FVEY", "REL TO USA", "ORCON", "PROPIN", "REL TO NATO"]
SENSOR_TYPES = ["SAR", "EO/IR", "MTI", "GMTI", "ESM", "COMMS", "RADAR", "LIDAR"]
EMISSION_CONTROL = ["EMCON ALPHA", "EMCON BRAVO", "EMCON CHARLIE", "EMCON DELTA"]


def get_auth_token():
    print(f"[auth] requesting token from {TOKEN_URL} as {KC_USER}")
    auth = f"{CLIENT_ID}:{CLIENT_SECRET}"
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + base64.b64encode(auth.encode()).decode()
    }
    payload = {
        'grant_type': 'password',
        'username': KC_USER,
        'password': KC_PASS,
    }
    response = requests.post(TOKEN_URL, headers=headers, data=payload, verify=False)
    print(f"[auth] token response status: {response.status_code}")
    if response.status_code != 200:
        print(f"[auth] error body: {response.text}")
        response.raise_for_status()
    print(f"[auth] token acquired successfully")
    return response.json()['access_token']


def get_s4_s3_client():
    print(f"[s4] getting auth token for STS...")
    token = get_auth_token()
    print(f"[s4] assuming role via STS at {S4_STS_ENDPOINT}")
    sts_client = boto3.client('sts', endpoint_url=S4_STS_ENDPOINT, verify=False)

    response = sts_client.assume_role_with_web_identity(
        RoleArn='arn:aws:iam::xxxx:xxx/xxx',
        RoleSessionName='WebIdentitySession',
        WebIdentityToken=token,
        DurationSeconds=3600
    )
    print(f"[s4] STS assume_role succeeded")

    creds = response['Credentials']
    print(f"[s4] building S3 client at {S4_S3_ENDPOINT}")
    return boto3.client(
        's3',
        endpoint_url=S4_S3_ENDPOINT,
        aws_access_key_id=creds['AccessKeyId'],
        aws_secret_access_key=creds['SecretAccessKey'],
        aws_session_token=creds.get('SessionToken'),
        region_name=S4_REGION,
        verify=False
    )


def upload_to_s4(s3_client, filename, data_dict, attributes: list[str]):
    payload = json.dumps(data_dict).encode('utf-8')
    metadata = {}
    for i, attr in enumerate(attributes):
        metadata[f'tdf-data-attribute-{i}'] = attr

    s3_client.put_object(
        Bucket=S4_BUCKET,
        Key=filename,
        Body=payload,
        Metadata=metadata
    )
    return f"s3://{S4_BUCKET}/{filename}"


def generate_military_manifest(fake, record_id, classification, rel_to: list[str] = None, ntk: list[str] = None):
    """Generates realistic IC/Military manifest data for a tracked asset."""

    platform = random.choice(AIRCRAFT_PLATFORMS)
    mission_type = random.choice(MISSION_TYPES)
    mission_start = datetime.now() - timedelta(hours=random.randint(1, 8))
    mission_end = mission_start + timedelta(hours=random.randint(2, 12))

    manifest = {
        "documentControl": {
            "manifestId": str(uuid.uuid4()),
            "recordId": record_id,
            "version": "2.1",
            "classification": classification.upper(),
            "caveats": (rel_to or []) + (ntk or []),
            "declassifyOn": (datetime.now() + timedelta(days=365*25)).strftime("%Y-%m-%d"),
            "createdAt": datetime.now().isoformat() + "Z",
            "createdBy": f"{fake.last_name().upper()}, {fake.first_name().upper()[0]}",
            "originatingAgency": random.choice(["DIA", "NGA", "NSA", "CIA", "NRO", "NASIC"]),
        },

        "vehicle": {
            "registration": f"{platform['service']}-{fake.numerify('####')}",
            "tailNumber": fake.bothify('##-####').upper(),
            "operator": f"{random.choice(MILITARY_BRANCHES)} {fake.numerify('###')} {'SQN' if platform['type'] in ['FIGHTER', 'BOMBER'] else 'WG'}",
            "platform": {
                "designation": platform["designation"],
                "name": platform["name"],
                "type": platform["type"],
                "service": platform["service"],
            },
            "homeStation": f"{fake.city().upper()} {'AFB' if platform['service'] == 'USAF' else 'NAS'}",
            "icaoHex": fake.hexify('^^^^^^').lower(),
            "mode5Interrogator": fake.bothify('M5-####-??').upper(),
        },

        "mission": {
            "missionId": f"MSN-{datetime.now().strftime('%Y%m%d')}-{fake.numerify('####')}",
            "operationName": f"OP {fake.word().upper()} {fake.word().upper()}",
            "missionType": mission_type,
            "priority": random.choice(["ROUTINE", "PRIORITY", "IMMEDIATE", "FLASH"]),
            "commandAuthority": random.choice(COMMAND_ELEMENTS),
            "taskingOrder": f"ATO-{datetime.now().strftime('%Y%j')}-{fake.numerify('###')}",
            "missionStatus": random.choice(OPERATIONAL_STATUS),
            "timeline": {
                "scheduled": mission_start.isoformat() + "Z",
                "takeoff": (mission_start + timedelta(minutes=random.randint(0, 30))).isoformat() + "Z",
                "onStation": (mission_start + timedelta(hours=random.randint(1, 3))).isoformat() + "Z",
                "offStation": (mission_end - timedelta(hours=1)).isoformat() + "Z",
                "expectedRecovery": mission_end.isoformat() + "Z",
            },
            "airspace": {
                "operatingArea": f"AO-{fake.lexify('???').upper()}-{fake.numerify('##')}",
                "altitudeBlock": f"FL{random.randint(20, 45)}0-FL{random.randint(46, 60)}0",
                "restrictedAreas": [f"R-{fake.numerify('####')}" for _ in range(random.randint(0, 3))],
            },
        },

        "intelligence": {
            "collectionDiscipline": random.sample(INTEL_SOURCES, k=random.randint(1, 3)),
            "targetDeck": [
                {
                    "targetId": f"TGT-{fake.hexify('######').upper()}",
                    "targetName": f"{fake.word().upper()} {random.randint(1, 99)}",
                    "targetType": random.choice(["FACILITY", "VEHICLE", "PERSONNEL", "COMMS", "RADAR"]),
                    "priority": random.randint(1, 5),
                }
                for _ in range(random.randint(1, 4))
            ],
            "collectionRequirements": [f"CR-{fake.numerify('####')}" for _ in range(random.randint(1, 3))],
            "reportingInstructions": f"RPTG-{fake.lexify('???').upper()}-{fake.numerify('##')}",
        },

        "sensors": {
            "primarySensor": random.choice(SENSOR_TYPES),
            "activeSensors": random.sample(SENSOR_TYPES, k=random.randint(1, 4)),
            "emissionControl": random.choice(EMISSION_CONTROL),
            "datalinks": random.sample(["LINK-16", "SADL", "CDL", "TTNT", "MADL"], k=random.randint(1, 3)),
        },

        "coordination": {
            "supportingUnits": [
                f"{random.choice(MILITARY_BRANCHES)} {fake.numerify('###')} {random.choice(['SQN', 'WG', 'GP'])}"
                for _ in range(random.randint(1, 3))
            ],
            "coalitionPartners": random.sample(COALITION_COUNTRIES, k=random.randint(0, 3)),
            "frequencyPlan": {
                "primary": f"{random.randint(225, 400)}.{random.randint(0, 99):02d} MHz",
                "secondary": f"{random.randint(225, 400)}.{random.randint(0, 99):02d} MHz",
                "guard": "243.00 MHz",
            },
            "checkInPoint": f"CP-{fake.lexify('???').upper()}",
        },

        "trackQuality": {
            "source": random.choice(["ADS-B", "MODE-S", "PRIMARY", "LINK-16", "SATELLITE"]),
            "reliability": round(random.uniform(0.85, 0.99), 3),
            "positionAccuracy_m": round(random.uniform(5, 50), 1),
            "velocityAccuracy_mps": round(random.uniform(0.5, 5), 2),
            "lastUpdate": datetime.now().isoformat() + "Z",
            "updateRate_sec": random.choice([1, 2, 5, 10, 30]),
        },

        "processing": {
            "ingestPipeline": f"v{random.randint(2, 4)}.{random.randint(0, 9)}.{random.randint(0, 99)}",
            "processingNode": f"NODE-{fake.lexify('???').upper()}-{fake.numerify('##')}",
            "processingTime_ms": round(random.uniform(10, 500), 1),
            "correlationId": str(uuid.uuid4()),
            "validated": random.choice([True, True, True, False]),
            "fusedSources": random.randint(1, 5),
        },
    }
    return manifest


def get_vehicles_without_manifests(conn, include_existing: bool):
    cursor = conn.cursor()
    if include_existing:
        print("[db] querying all vehicle rows (--all flag set)...")
        cursor.execute(
            "SELECT id, search, metadata FROM tdf_objects WHERE src_type = 'vehicles'"
        )
    else:
        print("[db] querying vehicle rows missing manifest...")
        cursor.execute(
            "SELECT id, search, metadata FROM tdf_objects "
            "WHERE src_type = 'vehicles' AND (metadata->>'manifest') IS NULL"
        )
    rows = cursor.fetchall()
    cursor.close()
    print(f"[db] found {len(rows)} vehicle row(s) to process")
    return rows


def update_manifest_uri(conn, row_id, manifest_uri):
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE tdf_objects "
        "SET metadata = metadata || jsonb_build_object('manifest', %s::text) "
        "WHERE id = %s",
        (manifest_uri, row_id)
    )
    conn.commit()
    cursor.close()


def extract_classification(search_jsonb):
    """Pull the short classification label (e.g. 'secret') from the search JSONB."""
    attrs = search_jsonb.get("attrClassification", [])
    if not attrs:
        return "unclassified"
    # attr format: "https://demo.com/attr/classification/value/<label>"
    return attrs[0].rstrip("/").split("/")[-1]


def add_manifests(include_existing: bool):
    conn = None
    try:
        print(f"[db] connecting to {DB_HOST}:{DB_PORT}/{DB_NAME}...")
        conn = psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        print("[db] connected successfully")

        rows = get_vehicles_without_manifests(conn, include_existing)
        if not rows:
            print("[main] no vehicles to process, exiting")
            return

        print("[s4] initializing S4 S3 client...")
        s3_client = get_s4_s3_client()
        print("[s4] S4 S3 client initialized successfully")

        fake = Faker()

        for i, (row_id, search_jsonb, metadata_jsonb) in enumerate(rows):
            manifest_data = generate_military_manifest(
                fake, str(row_id), "topsecret",
                rel_to=search_jsonb.get("attrRelTo", []),
                ntk=search_jsonb.get("attrNeedToKnow", []),
            )
            manifest_key = f"manifests/{row_id}.json.tdf"

            # Manifest is always TS — gate and document label must match.
            # relTo and needToKnow match the vehicle exactly.
            manifest_attributes = (
                [TOPSECRET_ATTR]
                + search_jsonb.get("attrRelTo", [])
                + search_jsonb.get("attrNeedToKnow", [])
            )

            try:
                manifest_uri = upload_to_s4(s3_client, manifest_key, manifest_data, manifest_attributes)
                print(f"  [{i+1}/{len(rows)}] {row_id} | TOPSECRET | manifest uploaded -> {manifest_uri}")
            except Exception as e:
                print(f"  [{i+1}/{len(rows)}] {row_id} | manifest upload FAILED: {e}")
                continue

            update_manifest_uri(conn, row_id, manifest_uri)
            print(f"  [{i+1}/{len(rows)}] {row_id} | metadata updated")

    except psycopg2.OperationalError as e:
        print(f"[db] CONNECTION ERROR: {e}")
        if conn:
            conn.rollback()

    except Exception as e:
        print(f"[main] error: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()

    finally:
        if conn:
            conn.close()
            print("[db] connection closed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Add S4 classified manifests to NiFi-seeded vehicle records."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Re-process all vehicle rows, even those that already have a manifest."
    )
    args = parser.parse_args()

    add_manifests(include_existing=args.all)
