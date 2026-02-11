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
from io import BytesIO
from faker import Faker
from datetime import datetime, timedelta
from psycopg2.extras import execute_batch
from otdf_python.sdk_builder import SDKBuilder
from otdf_python.config import NanoTDFConfig, KASInfo
from botocore.config import Config

# --- Suppress SSL Warnings for local dev ---
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- User/Auth Configs ---
KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "https://local-dsp.virtru.com:8443/auth")
REALM = os.getenv("REALM", "opentdf")
CLIENT_ID = 'secure-object-proxy-test'
CLIENT_SECRET = 'secret'
KC_USER = os.getenv("KC_USER", "top-secret-gbr-bbb") 
KC_PASS = os.getenv("PASSWORD", "testuser123")
TOKEN_URL = f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token"

# --- DB Configs ---
DB_NAME, DB_USER, DB_PASSWORD = "postgres", "postgres", "changeme"
DB_HOST, DB_PORT = "localhost", 15432
NUM_RECORDS = 50
BATCH_SIZE = 5

# --- S4 / S3 Configs ---
S4_STS_ENDPOINT = "http://localhost:7070"
S4_S3_ENDPOINT = "http://localhost:7070" 
S4_BUCKET = "cop-demo"
S4_REGION = "us-east-1"

# --- Fixed Data for TdfObjects ---
FIXED_SRC_TYPE = 'vehicles'
FIXED_TDF_URI = None
FIXED_CREATED_BY = KC_USER

# --- DSP Configs ---
PLATFORM_ENDPOINT = "https://local-dsp.virtru.com:8080"
CA_CERT_PATH = "./dsp-keys/rootCA.pem"
ISSUER_ENDPOINT = "https://local-dsp.virtru.com:8443/auth/realms/opentdf"

CLASSIFICATIONS = ["unclassified", "confidential", "secret", "topsecret"]

# --- Fixed Need-to-Know attribute for all manifests ---
NEEDTOKNOW_ATTR = "https://demo.com/attr/needtoknow/value/bbb"

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

# --- SQL Queries ---
DELETE_SQL = "DELETE FROM tdf_objects"
INSERT_SQL = """
INSERT INTO tdf_objects (
    id,
    ts,
    src_type,
    geo,
    search,
    metadata,
    tdf_blob,
    tdf_uri,
    _created_at,
    _created_by
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""


def get_auth_token():
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
    if response.status_code != 200:
        print(f"Auth Error: {response.text}")
        response.raise_for_status()
    return response.json()['access_token']


def get_s4_s3_client():
    token = get_auth_token()
    sts_client = boto3.client('sts', endpoint_url=S4_STS_ENDPOINT, verify=False)
    
    response = sts_client.assume_role_with_web_identity(
        RoleArn='arn:aws:iam::xxxx:xxx/xxx',
        RoleSessionName='WebIdentitySession',
        WebIdentityToken=token,
        DurationSeconds=3600 
    )
    
    creds = response['Credentials']
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


def get_sdk_instance(platform_endpoint, client_id, client_secret, ca_cert_path, issuer_endpoint):
    builder = SDKBuilder()
    builder.set_platform_endpoint(platform_endpoint)
    builder.client_secret(client_id, client_secret)
    builder.cert_paths = ca_cert_path
    builder.use_insecure_skip_verify(True)
    return builder.build()


def encrypt_data(sdk, plaintext: str, attributes: list[str]) -> bytes:
    target_kas_url = "https://local-dsp.virtru.com:8080/kas"
    kas_info = KASInfo(url=target_kas_url)

    config = NanoTDFConfig(
        attributes=attributes,
        ecc_mode="secp256r1",
        kas_info_list=[kas_info]
    )

    input_data_stream = BytesIO(plaintext.encode('utf-8'))
    output_stream = BytesIO()

    sdk.create_nano_tdf(
        input_data_stream,
        output_stream,
        config
    )

    return output_stream.getvalue()


def generate_random_point_wkb():
    lat = random.uniform(25, 45)
    lon = random.uniform(-85, -65)
    return f'POINT({lon} {lat})'


def generate_military_manifest(fake, record_id, classification):
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
            "caveats": random.sample(SECURITY_CAVEATS, k=random.randint(1, 3)),
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


def generate_tdf_records(count, sdk):
    records = []
    fake = Faker()

    try:
        print("Initializing S4 S3 client...")
        s3_client = get_s4_s3_client()
        print("S4 S3 client initialized successfully.")
    except Exception as e:
        print(f"Failed to initialize S4 client: {e}")
        return []

    print(f"Generating {count} records with IC/Military manifests...")

    for i in range(count):
        cls_type = CLASSIFICATIONS[i % len(CLASSIFICATIONS)]
        classification_attr = f"https://demo.com/attr/classification/value/{cls_type}"
        random_id = str(uuid.uuid4())
        platform = random.choice(AIRCRAFT_PLATFORMS)
        
        vehicle_data = {
            "vehicleName": f"{platform['designation']} {platform['name']}",
            "origin": f"{fake.city().upper()} {'AFB' if platform['service'] == 'USAF' else 'NAS'}",
            "destination": f"AO-{fake.lexify('???').upper()}",
            "aircraft_type": f"{platform['designation']} ({platform['type']})"
        }

        tdf_blob = encrypt_data(sdk, json.dumps(vehicle_data), [classification_attr])

        search_jsonb = json.dumps({
            "attrRelTo": [],
            "attrNeedToKnow": [],
            "attrClassification": [classification_attr]
        })

        manifest_data = generate_military_manifest(fake, random_id, cls_type)
        manifest_key = f"manifests/{random_id}.json.tdf"
        
        manifest_attributes = [
            f"https://demo.com/attr/classification/value/topsecret", #adding this to make all topsecret
            NEEDTOKNOW_ATTR
        ]
        
        try:
            manifest_uri = upload_to_s4(s3_client, manifest_key, manifest_data, manifest_attributes)
            print(f"  [{i+1}/{count}] {platform['designation']} | {cls_type.upper()} + NTK/BBB")
        except Exception as e:
            print(f"  [{i+1}/{count}] Manifest upload FAILED: {e}")
            manifest_uri = None

        metadata_jsonb = json.dumps({
            "callsign": f"{fake.lexify('??').upper()}{fake.numerify('##')}",
            "speed": f"{random.randint(200, 600)} kts",
            "altitude": f"FL{random.randint(150, 450)}",
            "heading": str(random.randint(0, 359)),
            "manifest": manifest_uri
        })

        random_ts = datetime.now()
        random_geo = generate_random_point_wkb()
        random_created_at = random_ts + timedelta(seconds=random.uniform(0.01, 0.1))

        record = (
            random_id,
            random_ts,
            FIXED_SRC_TYPE,
            random_geo,
            search_jsonb,
            metadata_jsonb,
            tdf_blob,
            FIXED_TDF_URI,
            random_created_at,
            FIXED_CREATED_BY
        )
        records.append(record)

    return records


def insert_seed_data(sdk, should_delete: bool):
    conn = None
    records = generate_tdf_records(NUM_RECORDS, sdk)

    if not records:
        print("No records generated. Exiting.")
        return

    print(f"Attempting to insert {NUM_RECORDS} records in batches of {BATCH_SIZE}...")

    try:
        conn = psycopg2.connect(
            dbname=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            host=DB_HOST,
            port=DB_PORT
        )
        cursor = conn.cursor()

        if should_delete:
            print(f"Flag --delete detected. Cleaning up records for src_type: {FIXED_SRC_TYPE}")
            cursor.execute(DELETE_SQL, (FIXED_SRC_TYPE,))
            print(f"Successfully deleted {cursor.rowcount} records.")

        execute_batch(cursor, INSERT_SQL, records, page_size=BATCH_SIZE)
        conn.commit()
        print(f"Successfully inserted {NUM_RECORDS} records into the tdf_objects table.")

    except psycopg2.OperationalError as e:
        print(f"CONNECTION ERROR: Could not connect to the database.")
        print(f"Details: {e}")
        if conn: conn.rollback()

    except Exception as e:
        print(f"An error occurred during insertion: {e}")
        if conn: conn.rollback()

    finally:
        if conn:
            cursor.close()
            conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed script for TDF objects with IC/Military manifests.")
    parser.add_argument("--delete", action="store_true", help="Delete existing records before inserting.")
    args = parser.parse_args()

    try:
        print("Initializing TDF SDK...")
        sdk_instance = get_sdk_instance(PLATFORM_ENDPOINT, CLIENT_ID, CLIENT_SECRET, CA_CERT_PATH, ISSUER_ENDPOINT)
        insert_seed_data(sdk_instance, args.delete)
    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()