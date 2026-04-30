import { useEffect, useState, useContext, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LatLng, Map } from 'leaflet';
import { Box, Button, Grid } from '@mui/material';
import { AddCircle } from '@mui/icons-material';
import { useRpcClient } from '@/hooks/useRpcClient';
import { checkObjectEntitlements } from '@/utils/attributes';
import { useSimulation } from '@/hooks/useSimulation';
import { useVehicleData, VehicleDateFilter } from '@/hooks/useVehicleData';
import { useEntitlements } from '@/hooks/useEntitlements';
import { PageTitle } from '@/components/PageTitle';
import { CopMap } from '@/components/Map/CopMap';
import { BannerContext } from '@/contexts/BannerContext';
import { SrcType, TimestampSelector } from '@/proto/tdf_object/v1/tdf_object_pb';
import { Timestamp } from '@bufbuild/protobuf';
import { VehicleData } from '@/types/vehicle';
import { VehiclePopOutResponse } from '@/components/Map/Vehicle';
import { SourceTypeProvider } from './SourceTypeProvider';
import { CreateDialog } from './CreateDialog';
import { SourceTypeSelector } from './SourceTypeSelector';
import { SearchFilter } from './SearchFilter';
import { SearchResults } from './SearchResults';
import { SimulationPanel } from './SimulationPanel';
import { VehicleDetailSidebar } from './VehicleDetailSidebar';

export function SourceTypes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [srcTypeId, setSrcTypeId] = useState<string | null>(null);
  const [selectable, setSelectable] = useState<boolean | null>();
  const [map, setMap] = useState<Map | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [srcType, setSrcType] = useState<SrcType>();
  const [poppedOutVehicle, setPoppedOutVehicle] = useState<VehiclePopOutResponse | null>(null);
  const [vehicleDateFilter, setVehicleDateFilter] = useState<VehicleDateFilter>();
  const { getSrcType, queryTdfObjects } = useRpcClient();
  const { tdfObjects, setTdfObjects, activeEntitlements } = useContext(BannerContext);
  const { categorizedData } = useEntitlements();
  const isVehicleView = !srcTypeId || srcTypeId === 'vehicles';
  const { filteredVehicleData, vehicleSrcType, fetchVehicles } = useVehicleData(vehicleDateFilter, isVehicleView);

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

  const handleVehicleClick = useCallback((vehicle: VehicleData) => {
    console.log('Selected vehicle:', vehicle);
  }, []);

  const handlePopOut = useCallback((response: VehiclePopOutResponse) => {
    setPoppedOutVehicle(response);
  }, []);

  // Inside SourceTypes.tsx
  const stableFetch = useCallback(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  const simulation = useSimulation({
    onStartSuccess: stableFetch,
  });

  // Trigger initial status check on mount/reload
  useEffect(() => {
    if (simulation.checkStatus) {
      simulation.checkStatus();
    }
  }, []);

  // Close sidebar when classification level changes to prevent showing data above current clearance
  useEffect(() => {
    if (poppedOutVehicle) {
      setPoppedOutVehicle(null);
    }
  }, [activeEntitlements]);

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

  // Load all objects when a non-vehicle source type is selected
  useEffect(() => {
    if (!srcTypeId || srcTypeId === 'vehicles') return;

    const tsRange = new TimestampSelector();
    tsRange.greaterOrEqualTo = Timestamp.fromDate(new Date(0));

    queryTdfObjects({ srcType: srcTypeId, tsRange })
      .then(results => setTdfObjects(results.filter(obj => !checkObjectEntitlements(obj, activeEntitlements))))
      .catch(err => console.error('Error fetching initial TDF objects:', err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcTypeId]);

  // Only show TDF objects in search results when not viewing vehicles
  const searchResultsTdfObjects = srcTypeId === 'vehicles' ? [] : tdfObjects;

  // Only show vehicles on the map when 'vehicles' or no type is selected
  const mapVehicleData = (!srcTypeId || srcTypeId === 'vehicles') ? filteredVehicleData : [];

  return (
    <>
      <PageTitle
        title="Source Types"
        subContent={selectable ? <SourceTypeSelector value={srcTypeId} onChange={handleSrcTypeIdChange} /> : null} />
      <SourceTypeProvider srcType={srcType}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <CopMap
              filteredVehicleData={mapVehicleData}
              tdfObjects={tdfObjects}
              activeEntitlements={activeEntitlements}
              onMapReady={setMap}
              onVehicleClick={handleVehicleClick}
              onPopOut={handlePopOut}
            />
          </Grid>
          <Grid item xs={12} md={5}>
            <SimulationPanel
              isStarting={simulation.isStarting}
              isStopping={simulation.isStopping}
              isRunning={simulation.isRunning}
              isChecking={simulation.isChecking}
              logs={simulation.logs}
              onStart={simulation.start}
              onStop={simulation.stop}
              onClearLogs={simulation.clearLogs}
            />

            {srcType && (
              <Box display="flex" gap={1} mb={2}>
                <SearchFilter map={map} onDateFilter={setVehicleDateFilter} />
                <Button variant="contained" color="primary" onClick={handleDialogOpen} startIcon={<AddCircle />}>New</Button>
              </Box>
            )}
            <SearchResults tdfObjects={searchResultsTdfObjects} onFlyToClick={handleFlyToClick} />
          </Grid>
        </Grid>
        {srcType && <CreateDialog open={dialogOpen} onClose={handleDialogClose} />}
        {poppedOutVehicle && (
          <VehicleDetailSidebar
            key={poppedOutVehicle.tdfObject.id}
            vehicle={poppedOutVehicle}
            vehicleSrcType={vehicleSrcType}
            categorizedData={categorizedData || {}}
            onClose={() => setPoppedOutVehicle(null)}
            onFlyToClick={handleFlyToClick}
          />
        )}
      </SourceTypeProvider>
    </>
  );
}