#!/usr/bin/env python3
"""
NiFi-based simulation seeder.

Steps:
  1. Delete existing vehicle records from the DB (fresh start).
  2. Copy vehicles-seed.json into the NiFi watch folder (mission_example/).
  3. Poll the DB until NiFi has ingested the vehicles (or timeout).

This replaces seed_data.py --delete for the NiFi-based simulation flow.
"""

import os
import sys
import time
import shutil
import psycopg2

# --- Load env file (same pattern as other scripts) ---
def _load_env_file():
    env_file = os.getenv("ENV_FILE")
    if not env_file:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        candidate = os.path.normpath(os.path.join(script_dir, "..", "..", "env", "default.env"))
        if os.path.exists(candidate):
            env_file = candidate
    if env_file and os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    if k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip().strip('"')

_load_env_file()

# --- DB config ---
DB_NAME     = "postgres"
DB_USER     = "postgres"
DB_PASSWORD = "changeme"
DB_HOST     = os.getenv("DB_HOST", "cop-db")
DB_PORT     = int(os.getenv("DB_PORT", "5432"))
TABLE_NAME  = "tdf_objects"

# --- Paths ---
SCRIPT_DIR        = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT         = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".."))
SAMPLE_FILES_DIR  = os.path.join(REPO_ROOT, "nifi", "sample_data", "sample_files")
MISSION_EXAMPLE_DIR = os.path.join(REPO_ROOT, "nifi", "sample_data", "mission_example")

# Discover seed files (all .json files in sample_files directory)
SEED_FILES = [f for f in os.listdir(SAMPLE_FILES_DIR) if f.endswith(".json")]

# Polling config
POLL_INTERVAL_SECONDS = 3
POLL_TIMEOUT_SECONDS  = 120


def get_conn():
    return psycopg2.connect(
        dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD,
        host=DB_HOST, port=DB_PORT,
    )


def clear_existing_records():
    print(f"[db] connecting to {DB_HOST}:{DB_PORT}/{DB_NAME}...")
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute(f"DELETE FROM {TABLE_NAME}")
    deleted = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    print(f"[db] deleted {deleted} existing record(s)")


def copy_seed_files():
    os.makedirs(MISSION_EXAMPLE_DIR, exist_ok=True)
    try:
        os.chmod(MISSION_EXAMPLE_DIR, 0o777)
    except OSError:
        pass  # container may lack permission; rely on host/volume mount perms
    for fname in SEED_FILES:
        src = os.path.join(SAMPLE_FILES_DIR, fname)
        dst = os.path.join(MISSION_EXAMPLE_DIR, fname)
        if not os.path.exists(src):
            raise FileNotFoundError(f"Seed file not found: {src}")
        shutil.copyfile(src, dst)
        print(f"[nifi] copied {fname} -> {MISSION_EXAMPLE_DIR}/")
    print(f"[nifi] NiFi will pick up the files within its next poll cycle (~5s)")


def wait_for_ingestion():
    print(f"[nifi] waiting for NiFi ingestion (timeout: {POLL_TIMEOUT_SECONDS}s)...")
    deadline = time.time() + POLL_TIMEOUT_SECONDS

    while time.time() < deadline:
        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute(f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE src_type = 'vehicles'")
        count = cursor.fetchone()[0]
        cursor.close()
        conn.close()

        print(f"[nifi] vehicle count: {count}")
        if count > 0:
            print(f"[nifi] ingestion complete — {count} vehicle(s) in DB")
            return count

        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(
        f"[nifi] timed out after {POLL_TIMEOUT_SECONDS}s — "
        f"no vehicles found. Is NiFi running and the flow active?"
    )


if __name__ == "__main__":
    try:
        clear_existing_records()
        copy_seed_files()
        count = wait_for_ingestion()
        print(f"[done] NiFi seed complete: {count} vehicle(s) ready")
        sys.exit(0)
    except Exception as e:
        print(f"[error] {e}", file=sys.stderr)
        sys.exit(1)
