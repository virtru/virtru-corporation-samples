import os
import json
import boto3
import requests
import base64
import urllib3
import logging
import psycopg2
from botocore.exceptions import ClientError

# --- Suppress SSL Warnings ---
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# --- Logging ---
logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

# --- Configuration (Matches your Seed Script) ---
KC_URL = os.getenv("KEYCLOAK_URL", "https://local-dsp.virtru.com:8443/auth")
KC_REALM = os.getenv("REALM", "opentdf")
KC_USER = os.getenv("KC_USER", "top-secret-gbr-bbb")
KC_PASS = os.getenv("PASSWORD", "testuser123")
CLIENT_ID = 'secure-object-proxy-test'
CLIENT_SECRET = 'secret'

S4_STS_URL = "http://virtru-dsp-cop-dev-s4-1:7070"
S4_S3_URL = "http://virtru-dsp-cop-dev-s4-1:7070" 
S4_BUCKET = "cop-demo"

# --- DB Configs ---
DB_NAME = "postgres"
DB_USER = "postgres"
DB_PASSWORD = "changeme"
DB_HOST = "localhost"
DB_PORT = 15432

# --- Authentication Logic ---

def get_jwt(username):
    """Fetches JWT using password grant."""
    token_url = f"{KC_URL}/realms/{KC_REALM}/protocol/openid-connect/token"
    auth = f"{CLIENT_ID}:{CLIENT_SECRET}"
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + base64.b64encode(auth.encode()).decode()
    }
    payload = {
        'grant_type': 'password',
        'username': username,
        'password': KC_PASS,
    }
    response = requests.post(token_url, headers=headers, data=payload, verify=False)
    response.raise_for_status()
    return response.json()["access_token"]


def get_s4_client(username):
    """Exchanges JWT for STS credentials and returns a Boto3 S3 client."""
    token = get_jwt(username)
    sts = boto3.client('sts', endpoint_url=S4_STS_URL, verify=False)
    
    # S4 STS Exchange
    response = sts.assume_role_with_web_identity(
        RoleArn='arn:aws:iam::xxxx:xxx/xxx',
        RoleSessionName='WebIdentitySession',
        WebIdentityToken=token,
        DurationSeconds=3600
    )
    
    creds = response['Credentials']
    return boto3.client(
        's3',
        endpoint_url=S4_S3_URL,
        aws_access_key_id=creds['AccessKeyId'],
        aws_secret_access_key=creds['SecretAccessKey'],
        aws_session_token=creds.get('SessionToken'),
        region_name='us-east-1',
        verify=False
    )


# --- Database Logic ---

def get_db_connection():
    """Creates a connection to the PostgreSQL database."""
    return psycopg2.connect(
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        host=DB_HOST,
        port=DB_PORT
    )


def query_tdf_objects(limit=10):
    """Queries tdf_objects table and returns records with manifest URIs."""
    conn = None
    records = []
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Query records that have a manifest in metadata
        query = """
            SELECT 
                id,
                ts,
                src_type,
                metadata,
                search
            FROM tdf_objects 
            WHERE src_type = 'vehicles'
            AND metadata->>'manifest' IS NOT NULL
            ORDER BY ts DESC
            LIMIT %s
        """
        
        cursor.execute(query, (limit,))
        rows = cursor.fetchall()
        
        for row in rows:
            records.append({
                'id': row[0],
                'ts': row[1],
                'src_type': row[2],
                'metadata': row[3] if isinstance(row[3], dict) else json.loads(row[3]),
                'search': row[4] if isinstance(row[4], dict) else json.loads(row[4])
            })
        
        logger.info(f"Found {len(records)} records with manifest URIs")
        
    except Exception as e:
        logger.error(f"Database error: {e}")
    finally:
        if conn:
            cursor.close()
            conn.close()
    
    return records


def parse_s3_uri(s3_uri):
    """Parses an S3 URI into bucket and key components."""
    # s3://bucket-name/path/to/object.json
    if not s3_uri or not s3_uri.startswith('s3://'):
        return None, None
    
    path = s3_uri[5:]  # Remove 's3://'
    parts = path.split('/', 1)
    
    if len(parts) == 2:
        return parts[0], parts[1]  # bucket, key
    return parts[0], None


# --- Read Logic ---

def fetch_manifest_from_s4(s3_client, s3_uri):
    """Fetches and decrypts a manifest from S4 given its S3 URI."""
    bucket, key = parse_s3_uri(s3_uri)
    
    if not bucket or not key:
        logger.error(f"Invalid S3 URI: {s3_uri}")
        return None
    
    try:
        # S4 intercepts this, retrieves keys from DSP, and decrypts the TDF
        result = s3_client.get_object(Bucket=bucket, Key=key)
        plaintext = result['Body'].read().decode('utf-8')
        
        # Parse JSON
        try:
            return json.loads(plaintext)
        except json.JSONDecodeError:
            return plaintext
            
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        logger.error(f"❌ Access Denied or Decryption Failed for {s3_uri}: {error_code}")
        return None


def read_manifests_from_db():
    """Main function: queries DB for records, then fetches manifests from S4."""
    logger.info(f"--- 🛡️  Initializing S4 Proxy Session for: {KC_USER} ---")
    
    # 1. Initialize S4 client
    try:
        s3 = get_s4_client(KC_USER)
        logger.info("✅ S4 client initialized successfully")
    except Exception as e:
        logger.error(f"❌ Failed to authenticate: {e}")
        return

    # 2. Query database for records with manifest URIs
    logger.info("\n--- 📊 Querying Database for Records ---")
    records = query_tdf_objects(limit=10)
    
    if not records:
        logger.info("No records found with manifest URIs. Run the seed script first!")
        return

    # 3. For each record, fetch the manifest from S4
    logger.info("\n--- 📄 Fetching Manifests from S4 ---")
    
    for record in records:
        record_id = record['id']
        metadata = record['metadata']
        manifest_uri = metadata.get('manifest')
        
        logger.info(f"\n{'='*60}")
        logger.info(f"📋 Record ID: {record_id}")
        logger.info(f"⏰ Timestamp: {record['ts']}")
        logger.info(f"🏷️  Callsign: {metadata.get('callsign', 'N/A')}")
        logger.info(f"🔗 Manifest URI: {manifest_uri}")
        
        if manifest_uri:
            manifest_data = fetch_manifest_from_s4(s3, manifest_uri)
            
            if manifest_data:
                logger.info(f"🔓 Decrypted Manifest:")
                logger.info(json.dumps(manifest_data, indent=2))
            else:
                logger.info("⚠️  Could not retrieve manifest (access denied or not found)")
        else:
            logger.info("⚠️  No manifest URI in metadata")

    logger.info(f"\n{'='*60}")
    logger.info(f"✅ Processed {len(records)} records")


if __name__ == "__main__":
    read_manifests_from_db()