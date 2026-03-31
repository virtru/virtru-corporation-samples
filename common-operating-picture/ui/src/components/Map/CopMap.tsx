import { useEffect } from 'react';
import { LayersControl, MapContainer, TileLayer } from 'react-leaflet';
import { Map } from 'leaflet';
import { config } from '@/config';
import { TdfObjectResponse } from '@/hooks/useRpcClient';
import { VehicleData } from '@/types/vehicle';
import { VehicleLayer } from '@/components/Map/VehicleLayer';
import { VehicleTrailLayer } from '@/components/Map/VehicleTrailLayer';
import { VehiclePopOutResponse } from '@/components/Map/Vehicle';
import { TdfObjectsMapLayer } from '@/components/Map/TdfObjectsMapLayer';
import { useVehicleTrails } from '@/hooks/useVehicleTrails';
import { mapStringToColor } from '@/pages/SourceTypes/helpers/markers';

interface CopMapProps {
  filteredVehicleData: VehicleData[];
  tdfObjects: TdfObjectResponse[];
  activeEntitlements: Set<string>;
  onMapReady: (map: Map) => void;
  onVehicleClick: (vehicle: VehicleData) => void;
  onPopOut: (response: VehiclePopOutResponse) => void;
}

export function CopMap({
  filteredVehicleData,
  tdfObjects,
  activeEntitlements,
  onMapReady,
  onVehicleClick,
  onPopOut,
}: CopMapProps) {
  const { trails, updateTrails } = useVehicleTrails({
    maxPoints: 5000,
    minInterval: 2000,
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

  return (
    <MapContainer
      style={{ width: '100%', height: '80vh' }}
      center={[0, 0]}
      zoom={3}
      ref={(mapInstance) => { if (mapInstance) onMapReady(mapInstance); }}
    >
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
            <VehicleLayer
              key={`vehicles-${activeEntitlements.size}`}
              vehicleData={filteredVehicleData}
              onMarkerClick={onVehicleClick}
              onPopOut={onPopOut}
            />
          </LayersControl.Overlay>
        )}
        {tdfObjects.length > 0 && (
          <LayersControl.Overlay name="TDF Objects" checked>
            <TdfObjectsMapLayer tdfObjects={tdfObjects} />
          </LayersControl.Overlay>
        )}
      </LayersControl>
    </MapContainer>
  );
}