import asyncio
import time
import json
import os
import psycopg2
import httpx
from shapely.geometry import Point

# --- Configs ---
DB_NAME = "postgres"
DB_USER = "postgres"
DB_PASSWORD = "changeme"
DB_HOST = "localhost"
DB_PORT = 15432
TABLE_NAME = "tdf_objects"

# --- Parameters ---
NUM_ENTITIES = 5
UPDATE_INTERVAL_SECONDS = 5  # Fast updates for authenticated users

# --- Credentials ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CREDS_FILE = os.path.join(BASE_DIR, "credentials.json")

CLIENT_ID = None
CLIENT_SECRET = None
ACCESS_TOKEN = None
TOKEN_EXPIRES_AT = 0

# OpenSky Endpoints
OPENSKY_API_URL = "https://opensky-network.org/api/states/all"
OPENSKY_AUTH_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"

# Bounding Box (US East Coast) - ONLY USED FOR INITIALIZATION
BOUNDING_BOX_PARAMS = {
    "lamin": 25.0,
    "lomin": -85.0,
    "lamax": 45.0,
    "lomax": -65.0
}

# --- Track UUID:ICAO24 Associations ---
UUID_TO_FLIGHT = {}

# --- Load Credentials ---
if os.path.exists(CREDS_FILE):
    try:
        with open(CREDS_FILE, 'r') as f:
            creds = json.load(f)
            # Check for API Client keys first
            CLIENT_ID = creds.get("clientId")
            CLIENT_SECRET = creds.get("clientSecret")

            if CLIENT_ID and CLIENT_SECRET:
                print(f"✅ Loaded API Client: {CLIENT_ID}")
            else:
                print("❌ Error: creds.json missing 'clientId' or 'clientSecret'")
                exit(1)
    except Exception as e:
        print(f"❌ Error reading creds.json: {e}")
        exit(1)
else:
    print(f"❌ Error: {CREDS_FILE} not found. Please create it.")
    exit(1)

# --- Helper Functions ---
def get_db_uuids(conn_params, num_entities):
    conn = None
    uuids = []
    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()
        cursor.execute(f"SELECT id FROM {TABLE_NAME} WHERE src_type = 'vehicles' LIMIT %s;", (num_entities,))
        uuids = [row[0] for row in cursor.fetchall()]
        print(f"Found {len(uuids)} UUIDs for tracking.")
    except Exception as e:
        print(f"Database error: {e}")
    finally:
        if conn: conn.close()
    return uuids

def lat_lon_to_wkb(latitude, longitude):
    if latitude is not None and longitude is not None:
        point = Point(longitude, latitude)
        return point.wkb
    return None

async def get_valid_token(client):
    """
    Ensures we have a valid OAuth2 Bearer token.
    Refreshes it if it's expired or missing.
    """
    global ACCESS_TOKEN, TOKEN_EXPIRES_AT

    # Buffer time (refresh 60s before expiry)
    if ACCESS_TOKEN and time.time() < (TOKEN_EXPIRES_AT - 60):
        return ACCESS_TOKEN

    print("🔄 Refreshing OpenSky OAuth Token...")
    try:
        payload = {
            "grant_type": "client_credentials",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET
        }

        response = await client.post(OPENSKY_AUTH_URL, data=payload)

        if response.status_code == 200:
            data = response.json()
            ACCESS_TOKEN = data["access_token"]
            expires_in = data["expires_in"]
            TOKEN_EXPIRES_AT = time.time() + expires_in
            print(f"✅ Token refreshed! Expires in {expires_in}s")
            return ACCESS_TOKEN
        else:
            print(f"❌ Auth Failed {response.status_code}: {response.text}")
            return None

    except Exception as e:
        print(f"❌ Auth Connection Error: {e}")
        return None

async def fetch_opensky_data(client, params):
    """
    Fetches raw state vectors using OAuth2 Bearer Token.
    Accepts dynamic params to switch between Box Search and ID Search.
    """
    token = await get_valid_token(client)
    if not token:
        return None

    headers = {
        "Authorization": f"Bearer {token}"
    }

    try:
        response = await client.get(
            OPENSKY_API_URL,
            params=params,
            headers=headers,
            timeout=10.0
        )

        if response.status_code == 200:
            return response.json().get("states", [])

        elif response.status_code == 429:
            print("⚠️  Rate Limited (429). Waiting 10s...")
            await asyncio.sleep(10)
            return None
        elif response.status_code == 401:
            print("❌ Error 401: Unauthorized. Token might be invalid.")
            global ACCESS_TOKEN
            ACCESS_TOKEN = None
            return None
        else:
            print(f"❌ OpenSky Error {response.status_code}: {response.text}")
            return None

    except Exception as e:
        print(f"❌ Connection Error: {e}")
        return None

async def initialize_flight_associations(client, uuids):
    if not uuids:
        return

    print("Fetching initial flights from OpenSky (Area Scan)...")

    # 1. EXPENSIVE CALL: Only done once to find planes
    while True:
        states = await fetch_opensky_data(client, BOUNDING_BOX_PARAMS)

        if states:
            available_flights = [s[0] for s in states if s[5] is not None and s[6] is not None]

            if available_flights:
                break
            else:
                print("API worked, but no flights found in box. Retrying in 5s...")

        else:
            print("Retrying initialization in 5s...")

        await asyncio.sleep(5)

    for i, uuid_obj in enumerate(uuids):
        icao24 = available_flights[i % len(available_flights)]
        UUID_TO_FLIGHT[uuid_obj] = icao24

    print(f"Successfully associated {len(UUID_TO_FLIGHT)} UUIDs with ICAO24 addresses.")

async def update_flight_data(client, conn_params):
    if not UUID_TO_FLIGHT:
        return

    tracked_ids = list(set(UUID_TO_FLIGHT.values()))

    # 2. CHEAP CALL: Query ONLY the specific planes we are tracking
    # usage: ?icao24=abc&icao24=xyz
    target_params = {"icao24": tracked_ids}

    states = await fetch_opensky_data(client, target_params)

    if not states:
        # If empty, our planes might have landed or moved out of coverage
        # We don't error out, just wait for next tick
        return

    flight_data_map = {s[0]: s for s in states}

    updates = []

    for uuid_obj, icao24 in UUID_TO_FLIGHT.items():
        flight = flight_data_map.get(icao24)

        if flight:
            lng = flight[5]
            lat = flight[6]

            if lat is not None and lng is not None:
                geos_wkb = lat_lon_to_wkb(lat, lng)

                # --- HYBRID MODEL MAPPING ---
                # Static Data (Callsign, Origin) -> LEFT in the Encrypted Blob (ignored here)
                # Dynamic Data (Speed, Alt) -> PUT in the Plaintext Metadata Field

                velocity = flight[9] # m/s
                altitude = flight[13] if flight[13] is not None else flight[7] # meters
                heading = flight[10] # degrees

                metadata = json.dumps({
                    "speed": f"{round(velocity * 3.6)} km/h" if velocity is not None else "N/A",
                    "altitude": f"{round(altitude)} m" if altitude is not None else "N/A",
                    "heading": f"{round(heading)}" if heading is not None else "N/A"
                })

                updates.append((geos_wkb, uuid_obj, metadata))

    if not updates:
        print(f"No updates found for our {len(tracked_ids)} tracked planes.")
        return

    conn = None
    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()

        # Update geo and MERGE new metadata into metadata JSONB
        update_query = f"""
        UPDATE {TABLE_NAME} AS t
        SET
            geo = ST_SetSRID(ST_GeomFromWKB(src.wkb_geos), 4326),
            metadata = t.metadata || src.metadata::jsonb
        FROM
            (SELECT unnest(%s) as wkb_geos, unnest(%s) as entity_uuid, unnest(%s) as metadata) AS src
        WHERE
            t.id = src.entity_uuid::uuid;
        """

        wkb_list = [item[0] for item in updates]
        uuid_list = [item[1] for item in updates]
        meta_list = [item[2] for item in updates]

        cursor.execute(update_query, (wkb_list, uuid_list, meta_list))
        conn.commit()
        # print(f"Updated {cursor.rowcount} records.")

    except Exception as e:
        print(f"Database update failed: {e}")
        if conn: conn.rollback()
    finally:
        if conn: conn.close()

async def main():
    print(f"Starting Live Data Updater (Optimized Token Usage)...")

    conn_params = {
        "dbname": DB_NAME,
        "user": DB_USER,
        "password": DB_PASSWORD,
        "host": DB_HOST,
        "port": DB_PORT
    }

    async with httpx.AsyncClient() as client:
        uuids_to_track = get_db_uuids(conn_params, NUM_ENTITIES)

        await initialize_flight_associations(client, uuids_to_track)

        if not UUID_TO_FLIGHT:
            print("Initial association failed. Cannot start update loop.")
            return

        print("\n--- Starting Live Update Loop ---")
        try:
            while True:
                start_time = time.time()
                await update_flight_data(client, conn_params)

                elapsed = time.time() - start_time
                wait_time = max(0, UPDATE_INTERVAL_SECONDS - elapsed)

                await asyncio.sleep(wait_time)

        except KeyboardInterrupt:
            print("\nStopped.")
        except Exception as e:
            print(f"\nFatal error: {e}")

if __name__ == "__main__":
    asyncio.run(main())