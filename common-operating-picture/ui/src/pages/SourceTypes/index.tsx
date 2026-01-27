import { useEffect, useState, useContext, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LayersControl, MapContainer, TileLayer } from 'react-leaflet';
import { LatLng, Map } from 'leaflet';
import { Box, Button, Grid, IconButton, Typography } from '@mui/material';
import { AddCircle } from '@mui/icons-material';
import { TdfObjectResponse, useRpcClient } from '@/hooks/useRpcClient';
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
import { TimestampSelector } from '@/proto/tdf_object/v1/tdf_object_pb.ts';
import { Timestamp } from '@bufbuild/protobuf';
import dayjs from 'dayjs';
import CloseIcon from '@mui/icons-material/Close';
import { TdfObjectResult } from './TdfObjectResult';
import { useEntitlements } from '@/hooks/useEntitlements';

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
  const [poppedOutVehicle, setPoppedOutVehicle] = useState<TdfObjectResponse | null>(null);

  const { getSrcType, queryTdfObjectsLight } = useRpcClient();
  const { tdfObjects, setTdfObjects, activeEntitlements } = useContext(BannerContext);
  const { categorizedData } = useEntitlements();

  const vehicleSourceTypeId = "vehicles";

  const filteredVehicleData = useMemo(() => {
    if (!activeEntitlements || activeEntitlements.size === 0 || activeEntitlements.has("NoAccess")) {
      return vehicleData;
    }

    return vehicleData.filter(vehicle => {
      const classification = vehicle.data?.attrClassification;
      if (!classification) return true;
      const classStr = Array.isArray(classification) ? classification[0] : classification;
      return classStr ? activeEntitlements.has(classStr) : true;
    });
  }, [vehicleData, activeEntitlements]);

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
    console.log("Selected vehicle:", vehicle);
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
            if (o.metadata && o.metadata !== "null") telemetry = JSON.parse(o.metadata);
          } catch (e) { console.error("Metadata parse error", e); }

          let attributes = {};
          try {
            if (o.search && o.search !== "null") attributes = JSON.parse(o.search);
          } catch (e) { console.error("Search field parse error", e); }

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

  useEffect(() => {
    if (vehicleSrcType) return;
    const getVehicleSchema = async () => {
      try {
        const { srcType } = await getSrcType({ srcType: vehicleSourceTypeId });
        setVehicleSrcType(srcType);
      } catch (err) {
        console.error("Failed to fetch vehicle source type schema", err);
      }
    };
    getVehicleSchema();
  }, [getSrcType, vehicleSrcType]);

  useEffect(() => {
    fetchVehicles(vehicleSourceTypeId);
  }, [fetchVehicles]);

  useEffect(() => {
    const REFRESH_INTERVAL_MS = 5000;
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
                    url={config.tileServerUrl || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
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
                  <LayersControl.Overlay name="Planes" checked>
                    {/* Vehicle Layer - key forces re-render when entitlements change */}
                    <VehicleLayer
                      key={`vehicles-${activeEntitlements.size}`}
                      vehicleData={filteredVehicleData}
                      onMarkerClick={handleVehicleClick}
                      onPopOut={setPoppedOutVehicle}
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
            width: 450,
            boxShadow: 3,
            borderRadius: 1,
            overflow: 'hidden'
          }}>
            <Box className="window-header" sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              p: 1,
              bgcolor: 'primary.main',
              color: 'white'
            }}>
              <Typography variant="subtitle2">Vehicle Details & Notes</Typography>
              <IconButton size="small" onClick={() => setPoppedOutVehicle(null)} sx={{ color: 'white' }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ p: 2, maxHeight: '60vh', overflowY: 'auto', bgcolor: 'background.paper' }}>
              <SourceTypeProvider srcType={vehicleSrcType}>
                <TdfObjectResult
                  key={poppedOutVehicle.tdfObject.id}
                  tdfObjectResponse={poppedOutVehicle}
                  categorizedData={categorizedData || {}}
                  onFlyToClick={handleFlyToClick}
                  onNotesUpdated={(objectId, notes) => console.log(objectId, notes)}
                />
              </SourceTypeProvider>
            </Box>
          </Box>
        )}
      </SourceTypeProvider>
    </>
  );
}