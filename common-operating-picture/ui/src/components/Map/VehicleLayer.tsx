import { LayerGroup } from 'react-leaflet';
import { VehicleMarker, VehiclePopOutResponse } from './Vehicle';
import { VehicleData } from '@/types/vehicle';

interface VehicleLayerProps {
  vehicleData: VehicleData[];
  onMarkerClick: (vehicle: VehicleData) => void;
  onPopOut: (tdfResponse: VehiclePopOutResponse) => void;
}

export function VehicleLayer({ vehicleData, onMarkerClick, onPopOut }: VehicleLayerProps) {
  return (
    <LayerGroup>
      {vehicleData.map((vehicle) => (
        <VehicleMarker
          key={vehicle.id}
          markerId={vehicle.id}
          Position={vehicle.pos}
          rawObject={vehicle.rawObject}
          data={vehicle.data}
          onClick={() => onMarkerClick(vehicle)}
          onPopOut={onPopOut}
        />
      ))}
    </LayerGroup>
  );
}
