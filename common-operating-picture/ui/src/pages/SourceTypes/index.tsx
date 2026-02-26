import { useEffect, useState, useContext, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayersControl, MapContainer, TileLayer } from 'react-leaflet';
import { LatLng, Map } from 'leaflet';
import { Box, Button, Grid, IconButton, Typography, Divider } from '@mui/material';
import { AddCircle } from '@mui/icons-material';
import {  useRpcClient } from '@/hooks/useRpcClient';
import { PageTitle } from '@/components/PageTitle';
import { SourceTypeProvider } from './SourceTypeProvider';
import { CreateDialog } from './CreateDialog';
import { SourceTypeSelector } from './SourceTypeSelector';
import { SearchFilter } from './SearchFilter';
import { SearchResults } from './SearchResults';
import { SrcType, TdfObject } from '@/proto/tdf_object/v1/tdf_object_pb.ts';
import { config } from '@/config';
import { TdfObjectsMapLayer } from '@/components/Map/TdfObjectsMapLayer';
import { BannerContext } from '@/contexts/BannerContext';
import { VehicleLayer } from '@/components/Map/VehicleLayer';
import { VehicleTrailLayer } from '@/components/Map/VehicleTrailLayer';
import { VehiclePopOutResponse } from '@/components/Map/Vehicle';
import { useVehicleTrails } from '@/hooks/useVehicleTrails';
import { mapStringToColor } from '@/pages/SourceTypes/helpers/markers';
import { TimestampSelector } from '@/proto/tdf_object/v1/tdf_object_pb.ts';
import { Timestamp } from '@bufbuild/protobuf';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/Close';
import FlightIcon from '@mui/icons-material/Flight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SecurityIcon from '@mui/icons-material/Security';
import { TdfObjectResult } from './TdfObjectResult';
import { useEntitlements } from '@/hooks/useEntitlements';
import { ObjectBanner } from '@/components/ObjectBanner';
import { extractValues } from '@/contexts/BannerContext';
import { ManifestDisplay, ManifestLoader } from '@/components/ManifestDisplay';
import { MilitaryManifest } from '@/services/s4Service';

export interface VehicleDataItem {
  id: string;
  pos: { lat: number; lng: number };
  rawObject: TdfObject;
  data?: {
    vehicleName?: string;
    callsign?: string;
    origin?: string;
    destination?: string;
    speed?: string;
    altitude?: string;
    heading?: string;
    aircraft_type?: string;
    attrClassification?: string | string[];
    attrNeedToKnow?: string[];
    attrRelTo?: string[];
  };
}

export function SourceTypes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [srcTypeId, setSrcTypeId] = useState<string | null>(null);
  const [selectable, setSelectable] = useState<boolean | null>();
  const [map, setMap] = useState<Map | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [srcType, setSrcType] = useState<SrcType>();
  const [vehicleData, setVehicleData] = useState<VehicleDataItem[]>([]);
  const [vehicleSrcType, setVehicleSrcType] = useState<SrcType>();
  const [poppedOutVehicle, setPoppedOutVehicle] = useState<VehiclePopOutResponse | null>(null);
  const [sidebarManifest, setSidebarManifest] = useState<MilitaryManifest | null>(null);

  // Script execution state
  const [isStartingSimulation, setIsStartingSimulation] = useState(false);
  const [isStoppingSimulation, setIsStoppingSimulation] = useState(false);
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const [scriptLogs, setScriptLogs] = useState<string | null>(null);

  const { getSrcType, queryTdfObjectsLight, runPythonScript } = useRpcClient();
  const { tdfObjects, setTdfObjects, activeEntitlements } = useContext(BannerContext);
  const { categorizedData } = useEntitlements();

  const vehicleSourceTypeId = 'vehicles';

  const filteredVehicleData = useMemo(() => {
    if (!activeEntitlements || activeEntitlements.size === 0 || activeEntitlements.has('NoAccess')) {
      return vehicleData;
    }

    return vehicleData.filter(vehicle => {
      const classification = vehicle.data?.attrClassification;
      if (!classification) return true;
      const classStr = Array.isArray(classification) ? classification[0] : classification;
      return classStr ? activeEntitlements.has(classStr) : true;
    });
  }, [vehicleData, activeEntitlements]);

  // ── Vehicle Flight Path Trails ──────────────────────────────────────
  const { trails, updateTrails } = useVehicleTrails({
    maxPoints: 5000,
    minInterval: 2000,  // Record a point every 2 seconds
  });

  // Feed filtered vehicle positions into the trail accumulator on each refresh
  useEffect(() => {
    if (filteredVehicleData.length === 0) return;

    const trailInput = filteredVehicleData.map((v) => {
      const classification = v.data?.attrClassification;
      const classStr = Array.isArray(classification) ? classification[0] : classification;
      return {
        id: v.id,
        pos: v.pos,
        color: mapStringToColor(classStr || 'default'),
      };
    });

    updateTrails(trailInput);
  }, [filteredVehicleData, updateTrails]);
  // ── End Vehicle Flight Path Trails ──────────────────────────────────

  const fetchSrcType = useCallback(async (id: string) => {
    try {
      const { srcType } = await getSrcType({ srcType: id });
      setSrcType(srcType);
    } catch (err) {
      console.warn(`'${id}' is not a valid source type.`);
      setSrcType(undefined);
      setSearchParams(new URLSearchParams());
    }
  }, [getSrcType, setSearchParams]);

  const handleSrcTypeIdChange = useCallback((id: string) => {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('type', id);
    if (id !== srcTypeId) {
      newSearchParams.delete('q');
    }
    setSearchParams(newSearchParams);
  }, [searchParams, srcTypeId, setSearchParams]);

  const handleDialogOpen = () => {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('mode', 'create');
    setSearchParams(newSearchParams);
    setDialogOpen(true);
  };

  const handleDialogClose = () => {
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.delete('mode');
    setSearchParams(newSearchParams);
    setDialogOpen(false);
  };

  const handleFlyToClick = useCallback(({ lat, lng }: LatLng) => {
    if (map) map.flyTo({ lat, lng }, map.getZoom());
  }, [map]);

  const handleVehicleClick = useCallback((vehicle: VehicleDataItem) => {
    console.log('Selected vehicle:', vehicle);
  }, []);

  const handlePopOut = useCallback((response: VehiclePopOutResponse) => {
    setPoppedOutVehicle(response);
    // Reset sidebar manifest - will use manifest from response if available, otherwise allow loading
    setSidebarManifest(response.manifest || null);
  }, []);

  const fetchVehicles = useCallback(async (id: string) => {
    try {
      const tsRange = new TimestampSelector();
      const dayjsStart = dayjs().subtract(24, 'hour');
      tsRange.greaterOrEqualTo = Timestamp.fromDate(dayjsStart.toDate());

      const response = await queryTdfObjectsLight({
        srcType: id,
        tsRange: tsRange,
      });

      const transformedData: VehicleDataItem[] = response
        .filter(o => o.geo)
        .map(o => {
          const geoJson = JSON.parse(o.geo);
          const [lng, lat] = geoJson.coordinates;

          let telemetry = {};
          try {
            if (o.metadata && o.metadata !== 'null') telemetry = JSON.parse(o.metadata);
          } catch (e) { console.error('Metadata parse error', e); }

          let attributes = {};
          try {
            if (o.search && o.search !== 'null') attributes = JSON.parse(o.search);
          } catch (e) { console.error('Search field parse error', e); }

          return {
            id: o.id,
            pos: { lat, lng },
            rawObject: o,
            data: { ...telemetry, ...attributes },
          };
        });

      setVehicleData(transformedData);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      setVehicleData([]);
    }
  }, [queryTdfObjectsLight]);

  const handleStartSimulation = useCallback(async () => {
    setIsStartingSimulation(true);
    setScriptLogs("Executing sequence: seed_data -> launch simulation...");

    try {
      const response = await runPythonScript({
        scriptId: "simulation_start",
        args: []
      });

      setScriptLogs(response.output);

      if (response.exitCode === 0) {
        setIsSimulationRunning(true);
        fetchVehicles(vehicleSourceTypeId);
      }
    } catch (err) {
      console.error("Start simulation failed:", err);
      setScriptLogs("Network error: Failed to start simulation.");
    } finally {
      setIsStartingSimulation(false);
    }
  }, [runPythonScript, fetchVehicles, vehicleSourceTypeId]);

  const handleStopSimulation = useCallback(async () => {
    setIsStoppingSimulation(true);
    setScriptLogs("Stopping simulation...");

    try {
      const response = await runPythonScript({
        scriptId: "simulation_stop",
        args: []
      });

      setScriptLogs(response.output);
      setIsSimulationRunning(false);
    } catch (err) {
      console.error("Stop simulation failed:", err);
      setScriptLogs("Network error: Failed to stop simulation.");
    } finally {
      setIsStoppingSimulation(false);
    }
  }, [runPythonScript]);

  useEffect(() => {
    if (vehicleSrcType) return;
    const getVehicleSchema = async () => {
      try {
        const { srcType } = await getSrcType({ srcType: vehicleSourceTypeId });
        setVehicleSrcType(srcType);
      } catch (err) {
        console.error('Failed to fetch vehicle source type schema', err);
      }
    };
    getVehicleSchema();
  }, [getSrcType, vehicleSrcType]);

  useEffect(() => {
    fetchVehicles(vehicleSourceTypeId);
  }, [fetchVehicles]);

  // Close sidebar when classification level changes to prevent showing data above current clearance
  useEffect(() => {
    if (poppedOutVehicle) {
      setPoppedOutVehicle(null);
      setSidebarManifest(null);
    }
  }, [activeEntitlements]);

  useEffect(() => {
    const REFRESH_INTERVAL_MS = 1000;
    const intervalId = setInterval(() => {
      fetchVehicles(vehicleSourceTypeId);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchVehicles]);

  useEffect(() => {
    const type = searchParams.get('type');
    const select = searchParams.get('select');
    const mode = searchParams.get('mode');

    setSelectable(select !== 'false');

    if (!type) {
      setSrcType(undefined);
      setSrcTypeId(null);
      return;
    }

    if (type !== srcTypeId) {
      setSrcTypeId(type);
      setTdfObjects([]);
      fetchSrcType(type);
    }

    if (mode === 'create') {
      setDialogOpen(true);
    }
  }, [searchParams, fetchSrcType, srcTypeId, setTdfObjects]);

  const searchResultsTdfObjects = srcTypeId === vehicleSourceTypeId
  ? [] // If the selected type is 'vehicles', show an empty list in SearchResults.
  : tdfObjects; // Otherwise, show the actual tdfObjects (from BannerContext).

  return (
    <>
      <PageTitle
        title="Source Types"
        subContent={selectable ? <SourceTypeSelector value={srcTypeId} onChange={handleSrcTypeIdChange} /> : null} />
      <SourceTypeProvider srcType={srcType}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <MapContainer style={{ width: '100%', height: '80vh' }} center={[0, 0]} zoom={3} ref={setMap}>
              <LayersControl position="topright">
                {/* Base Layers */}
                <LayersControl.BaseLayer checked name="Street">
                  <TileLayer
                    url={config.tileServerUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'}
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite">
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution='&copy; <a href="https://www.esri.com/">Esri</a> | Earthstar Geographics'
                  />
                </LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Dark">
                  <TileLayer
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>'
                  />
                </LayersControl.BaseLayer>

                {/* Overlay Layers */}
                {filteredVehicleData.length > 0 && (
                  <LayersControl.Overlay name="Flight Paths" checked>
                    <VehicleTrailLayer
                      key={`trails-${activeEntitlements.size}`}
                      trails={trails}
                    />
                  </LayersControl.Overlay>
                )}
                {filteredVehicleData.length > 0 && (
                  <LayersControl.Overlay name="Planes" checked>
                    {/* Vehicle Layer - key forces re-render when entitlements change */}
                    <VehicleLayer
                      key={`vehicles-${activeEntitlements.size}`}
                      vehicleData={filteredVehicleData}
                      onMarkerClick={handleVehicleClick}
                      onPopOut={handlePopOut}
                    />
                  </LayersControl.Overlay>
                )}
                {/* TDF Object Layer */}
                {tdfObjects.length > 0 && (
                  <LayersControl.Overlay name="TDF Objects" checked>
                    <TdfObjectsMapLayer tdfObjects={tdfObjects} />
                  </LayersControl.Overlay>
                )}
              </LayersControl>
            </MapContainer>
          </Grid>
          <Grid item xs={12} md={5}>
            {/* Python Sequence Orchestration */}
            <Box sx={{
              mb: 3,
              p: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper'
            }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TrendingUpIcon fontSize="small" color="primary" />
                Data Orchestration
              </Typography>

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  fullWidth
                  variant="contained"
                  color="success"     
                  onClick={handleStartSimulation}
                  disabled={isStartingSimulation || isSimulationRunning}
                  startIcon={isStartingSimulation ? undefined : <PlayArrowIcon />}
                  sx={{ 
                    mb: scriptLogs ? 1 : 0,
                    fontWeight: 700,
                    textTransform: 'none' 
                  }}
                >
                  {isStartingSimulation ? 'Starting...' : isSimulationRunning ? 'Running' : 'Start Simulation'}
                </Button>

                <Button
                  fullWidth
                  variant="contained"
                  color="error"     
                  onClick={handleStopSimulation}
                  disabled={isStoppingSimulation || !isSimulationRunning}
                  startIcon={isStoppingSimulation ? undefined : <StopCircleIcon />}
                  sx={{ 
                    mb: scriptLogs ? 1 : 0,
                    fontWeight: 700,
                    textTransform: 'none' 
                  }}
                >
                  {isStoppingSimulation ? 'Stopping...' : 'Stop Simulation'}
                </Button>
              </Box>

              {scriptLogs && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">Execution Logs:</Typography>
                  <Box sx={{
                    p: 1,
                    bgcolor: '#121212',
                    borderRadius: 1,
                    maxHeight: '150px',
                    overflowY: 'auto',
                    border: '1px solid #333'
                  }}>
                    <pre style={{ margin: 0, fontSize: '10px', color: '#4caf50', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {scriptLogs}
                    </pre>
                  </Box>
                  <Button size="small" sx={{ mt: 0.5, textTransform: 'none' }} onClick={() => setScriptLogs(null)}>Clear Logs</Button>
                </Box>
              )}
            </Box>

            <Box display="flex" gap={1} mb={2}>
              <SearchFilter map={map} />
              <Button variant="contained" color="primary" onClick={handleDialogOpen} startIcon={<AddCircle />}>New</Button>
            </Box>
            <SearchResults tdfObjects={searchResultsTdfObjects} onFlyToClick={handleFlyToClick} />
          </Grid>
        </Grid>
        <CreateDialog open={dialogOpen} onClose={handleDialogClose} />
        {poppedOutVehicle && (
          <Box className="popped-out-window" sx={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            zIndex: 1000,
            width: 520,
            maxHeight: '85vh',
            boxShadow: 3,
            borderRadius: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <Box className="window-header" sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              p: 2,
              bgcolor: 'primary.main',
              color: 'white',
              flexShrink: 0,
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FlightIcon />
                <Typography variant="h6" fontWeight={600}>Vehicle Details & Notes</Typography>
              </Box>
              <IconButton size="small" onClick={() => { setPoppedOutVehicle(null); setSidebarManifest(null); }} sx={{ color: 'white' }}>
                <CloseIcon />
              </IconButton>
            </Box>

            {/* Scrollable Content */}
            <Box sx={{ p: 2, overflowY: 'auto', flex: 1, bgcolor: 'background.paper' }}>
              {/* Classification Banner */}
              <ObjectBanner 
                objClassification={extractValues(poppedOutVehicle.decryptedData?.attrClassification || []).split(', ').filter(Boolean).length > 0 
                  ? extractValues(poppedOutVehicle.decryptedData?.attrClassification || []).split(', ').filter(Boolean) 
                  : ['N/A']} 
                objNTK={extractValues(poppedOutVehicle.decryptedData?.attrNeedToKnow || []).split(', ').filter(Boolean)}
                objRel={extractValues(poppedOutVehicle.decryptedData?.attrRelTo || []).split(', ').filter(Boolean)}
                notes={[]}
              />

              {/* Vehicle Header */}
              <Box sx={{ mt: 2, mb: 2 }}>
                <Typography variant="h5" fontWeight={600} sx={{ color: 'white' }}>
                  {poppedOutVehicle.decryptedData?.vehicleName || `ID: ${poppedOutVehicle.tdfObject.id.substring(0, 8)}`}
                </Typography>
                <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>
                  Callsign: {poppedOutVehicle.decryptedData?.callsign || 'N/A'}
                </Typography>
              </Box>

              <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

              {/* Telemetry Section */}
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5, borderBottom: '2px solid', borderColor: 'primary.main', pb: 0.5, color: 'white' }}>Telemetry</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <TrendingUpIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Speed</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.speed || 'N/A'}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <TrendingUpIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Altitude</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.altitude || 'N/A'}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <GpsFixedIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Heading</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.heading || 'N/A'}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <FlightIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Aircraft Type</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.aircraft_type || 'N/A'}</Typography>
                  </Box>
                </Box>
              </Box>

              {/* Flight Details Section */}
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5, borderBottom: '2px solid', borderColor: 'primary.main', pb: 0.5, color: 'white' }}>Flight Details</Typography>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
                  <AltRouteIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Origin</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.origin || 'N/A'}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
                  <AltRouteIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Destination</Typography>
                    <Typography variant="h6" fontWeight={600} sx={{ color: 'white' }}>{poppedOutVehicle.decryptedData?.destination || 'N/A'}</Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <MyLocationIcon sx={{ color: 'white' }} />
                  <Box>
                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>Coordinates</Typography>
                    <Typography variant="h6" fontWeight={600} fontFamily="monospace" sx={{ color: 'white' }}>
                      {poppedOutVehicle.tdfObject.geo 
                        ? (() => {
                            try {
                              const geo = JSON.parse(poppedOutVehicle.tdfObject.geo);
                              return `${geo.coordinates[1].toFixed(4)}, ${geo.coordinates[0].toFixed(4)}`;
                            } catch { return 'N/A'; }
                          })()
                        : 'N/A'}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

              {/* Intelligence Manifest Section */}
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5, borderBottom: '2px solid', borderColor: 'primary.main', pb: 0.5, display: 'flex', alignItems: 'center', gap: 1, color: 'white' }}>
                <SecurityIcon />
                Classified Information
              </Typography>

              {/* Use manifest from popup if available, otherwise allow loading */}
              {poppedOutVehicle.manifest ? (
                <ManifestDisplay manifest={poppedOutVehicle.manifest} />
              ) : sidebarManifest ? (
                <ManifestDisplay manifest={sidebarManifest} />
              ) : (
                <ManifestLoader 
                  manifestUri={poppedOutVehicle.manifestUri}
                  manifest={sidebarManifest}
                  onManifestLoaded={(m) => setSidebarManifest(m)}
                />
              )}

              <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

              {/* Notes Section - using TdfObjectResult */}
              <Typography variant="h6" fontWeight={600} sx={{ mb: 1.5, borderBottom: '2px solid', borderColor: 'primary.main', pb: 0.5, color: 'white' }}>Notes & Annotations</Typography>
              <SourceTypeProvider srcType={vehicleSrcType}>
                <TdfObjectResult
                  key={poppedOutVehicle.tdfObject.id}
                  tdfObjectResponse={poppedOutVehicle}
                  categorizedData={categorizedData || {}}
                  onFlyToClick={handleFlyToClick}
                  onNotesUpdated={(objectId, notes) => console.log(objectId, notes)}
                  notesOnly={true}
                />
              </SourceTypeProvider>
            </Box>
          </Box>
        )}
      </SourceTypeProvider>
    </>
  );
}