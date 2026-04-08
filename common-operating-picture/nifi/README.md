Contains a sample NiFi deployment:
- [custom-libs](./custom-libs) libraries in addition to NiFi libs; e.g. postgres db driver.
- [extensions](./extensions) Custom NiFi NAR Archives to be mounted into NiFi
- [flows](./flows): Saved NiFi flows and template files.
- [processors](./processors): NiFi script processors used in some of the example flows (reference)
- [sample_data](./sample_data): Sample data files for testing ingestion
- [scripts](./scripts): Bootstrap and utility scripts

The processor supports using the SSLContextService in NiFi to manage self-signed certs.

Example adding all certs in the truststore directory to a jks truststore:

``` shell
./scripts/build/build_truststore_local.sh
```

List trusted certs
```shell
keytool -list -v -keystore truststore/ca.jks
keytool -list  -keystore truststore/ca.jks
```

# Startup

> Important Note: See the main [README](../README.md#start-required-services) for more details on running the application with nifi enabled.

Start the docker stack with the following command:
```shell
docker compose --profile nifi --env-file env/default.env -f docker-compose.dev.yaml up
```

The flow template is loaded and started automatically via the `nifi-bootstrap` service — no manual UI setup is required. You can monitor bootstrap progress with:
```shell
docker logs -f virtru-dsp-cop-dev-nifi-bootstrap-1
```

Once you see `Bootstrap complete! NiFi flow is running.` the flow is ready. On subsequent restarts, NiFi loads the flow from its persisted configuration volume and the bootstrap exits immediately.

To fully tear down including the persisted NiFi configuration volume:
```shell
docker compose --profile nifi --env-file env/default.env -f docker-compose.dev.yaml down -v
```

# Sample Data

The `sample_data` directory has the following structure:

```
sample_data/
  sample_files/       # pre-built sample files for each source type (originals, never modified)
  mission_example/    # NiFi watches this folder — drop files here to trigger ingestion
  misc/               # miscellaneous reference files
```

## Ingesting data

The NiFi flow watches the `mission_example/` directory every **5 seconds**. To trigger ingestion, copy one or more sample files from `sample_files/` into `mission_example/`:

```shell
# Ingest all sample types at once
cp nifi/sample_data/sample_files/*.json nifi/sample_data/mission_example/

# Or ingest a specific type
cp nifi/sample_data/sample_files/vehicle-sample.json nifi/sample_data/mission_example/
cp nifi/sample_data/sample_files/employee-sample.json nifi/sample_data/mission_example/
cp nifi/sample_data/sample_files/facility-sample.json nifi/sample_data/mission_example/
cp nifi/sample_data/sample_files/sitrep-sample.json nifi/sample_data/mission_example/
```

NiFi will pick up and process the files automatically. Records will appear in the `tdf_objects` table and on the UI map.

> **Note:** NiFi moves files out of `mission_example/` after processing. The originals in `sample_files/` are never modified.

> **Note:** NiFi tracks which files it has already processed. To re-ingest the same file, rename it or update its timestamp with `touch <filename>`.

> **Note:** Vehicle records only appear on the map if their `ProducerDateTimeLastChg` timestamp is within the last 24 hours. Update timestamps if records aren't showing up.

## Sample file source types

### Employees (`employee-sample.json`)
4 records — one per classification level.

| Name | Rank | Role | Classification |
|---|---|---|---|
| James Harrington | COL | J3 Operations Officer | UNCLASSIFIED |
| Sarah Mitchell | LTC | ISR Operations Officer | CONFIDENTIAL |
| Robert Calloway | MG | Deputy Commander | SECRET |
| Diana Reeves | GS-15 | Senior Intelligence Analyst | TOP SECRET |

### Facilities (`facility-sample.json`)
4 records — one per classification level.

| Facility | Type | Location | Classification |
|---|---|---|---|
| Nellis Air Force Base | AIRBASE | Nevada, USA | UNCLASSIFIED |
| RAF Lakenheath | AIRBASE | United Kingdom | CONFIDENTIAL |
| Al Udeid Air Base | AIRBASE | Qatar | SECRET |
| FOB Eagle | FORWARD OPERATING BASE | Saudi Arabia | TOP SECRET |

### Vehicles (`vehicle-sample.json`)
4 records — one per classification level. Uses `tdfFormat: nano` for the first three and `ztdf` for TOP SECRET.

| Callsign | Aircraft | Classification |
|---|---|---|
| VPR01 | F-35A Lightning II | UNCLASSIFIED |
| IRON21 | B-52H Stratofortress | CONFIDENTIAL |
| TEXCO61 | KC-135R Stratotanker | SECRET |
| HAWK03 | MQ-9A Reaper | TOP SECRET |

### SITREPs (`sitrep-sample.json`)
3 records — one per report type.

| Operation | Report Type | Classification |
|---|---|---|
| OP IRON SENTINEL | REGULAR/INCIDENT | SECRET |
| OP SHADOW GAZE | SAR | TOP SECRET |
| OP STEEL ANVIL | CONSOLIDATED | SECRET |

# NiFi UI

The NiFi UI is available at [http://127.0.0.1:18080/nifi](http://127.0.0.1:18080/nifi) after the stack is up. You can use it to monitor processor activity and flow file counts, but manual configuration is no longer required.
