import asyncio
import time
import uuid
import psycopg2
import random
from shapely.geometry import Point

# --- Configs ---
DB_NAME = "postgres"
DB_USER = "postgres"
DB_PASSWORD = "changeme"
DB_HOST = "virtru-dsp-cop-dev-cop-db-1"
DB_PORT = 5432
TABLE_NAME = "tdf_objects"

# Script parameters
NUM_ENTITIES = 400
UPDATE_INTERVAL_SECONDS = 1  # How often to push updates to the DB

# Bounding box for movement simulation
BOUNDING_BOX = {
    'lamin': -55.0,
    'lomin': -160.0,
    'lamax': 55.0,
    'lomax': 160.0
}

# --- State Management ---
# This dictionary tracks the current lat/lon/heading for each flight
FLIGHT_SIMULATION_DATA = {}

def get_db_uuids(conn_params, num_entities):
    """Fetches existing vehicle UUIDs from the database."""
    conn = None
    uuids = []
    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()
        cursor.execute(f"SELECT id FROM {TABLE_NAME} WHERE src_type = 'vehicles' LIMIT %s;", (num_entities,))
        uuids = [row[0] for row in cursor.fetchall()]
        print(f"Found {len(uuids)} UUIDs in database.")
    except Exception as e:
        print(f"Database error while fetching UUIDs: {e}")
    finally:
        if conn:
            conn.close()
    return uuids

def lat_lon_to_wkb(latitude, longitude):
    """Converts a latitude and longitude into WKB format for PostGIS."""
    point = Point(longitude, latitude)
    return point.wkb

async def update_simulated_positions(conn_params, uuids):
    """
    Calculates new flight positions and updates the DB in a single batch.
    """
    updates = []
    
    for entity_id in uuids:
        # If we haven't seen this flight yet, initialize it
        if entity_id not in FLIGHT_SIMULATION_DATA:
            FLIGHT_SIMULATION_DATA[entity_id] = {
                "lat": random.uniform(BOUNDING_BOX['lamin'], BOUNDING_BOX['lamax']),
                "lon": random.uniform(BOUNDING_BOX['lomin'], BOUNDING_BOX['lomax']),
                "v_lat": random.uniform(-0.05, 0.05), # Velocity Latitude
                "v_lon": random.uniform(-0.05, 0.05)  # Velocity Longitude
            }
        
        state = FLIGHT_SIMULATION_DATA[entity_id]
        
        # Move the flight
        state["lat"] += state["v_lat"]
        state["lon"] += state["v_lon"]
        
        # Bounce off the bounding box edges to keep them in view
        if not (BOUNDING_BOX['lamin'] < state["lat"] < BOUNDING_BOX['lamax']):
            state["v_lat"] *= -1
        if not (BOUNDING_BOX['lomin'] < state["lon"] < BOUNDING_BOX['lomax']):
            state["v_lon"] *= -1
            
        # Prepare WKB
        wkb_geo = lat_lon_to_wkb(state["lat"], state["lon"])
        updates.append((wkb_geo, entity_id))

    # Push to Database
    if updates:
        conn = None
        try:
            conn = psycopg2.connect(**conn_params)
            cursor = conn.cursor()

            # Optimized bulk update query
            update_query = f"""
            UPDATE {TABLE_NAME} AS t
            SET
                geo = ST_SetSRID(ST_GeomFromWKB(src.wkb_geos), 4326)
            FROM
                (SELECT unnest(%s) as wkb_geos, unnest(%s) as entity_uuid) AS src
            WHERE
                t.id = src.entity_uuid::uuid;
            """
            
            wkb_list = [u[0] for u in updates]
            uuid_list = [u[1] for u in updates]
            
            cursor.execute(update_query, (wkb_list, uuid_list))
            conn.commit()
            print(f"[{time.strftime('%H:%M:%S')}] Updated {cursor.rowcount} flights.")
            
        except Exception as e:
            print(f"DB Update Failed: {e}")
            if conn: conn.rollback()
        finally:
            if conn: conn.close()

async def main():
    print("--- Starting Internal Mock Flight Generator ---")
    
    conn_params = {
        "dbname": DB_NAME,
        "user": DB_USER,
        "password": DB_PASSWORD,
        "host": DB_HOST,
        "port": DB_PORT
    }

    # Step 1: Get the entities we need to move
    uuids_to_move = get_db_uuids(conn_params, NUM_ENTITIES)
    
    if not uuids_to_move:
        print("No 'vehicles' records found in DB. Seed the DB first!")
        return

    # Step 2: Loop forever updating positions
    try:
        while True:
            start_time = time.time()
            
            await update_simulated_positions(conn_params, uuids_to_move)
            
            # Control the frequency
            elapsed = time.time() - start_time
            sleep_duration = max(0, UPDATE_INTERVAL_SECONDS - elapsed)
            await asyncio.sleep(sleep_duration)
            
    except KeyboardInterrupt:
        print("\nStopping simulated updates.")

if __name__ == "__main__":
    asyncio.run(main())