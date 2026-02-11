import { LayerGroup } from 'react-leaflet';
import { VehicleMarker, VehiclePopOutResponse } from './Vehicle';
import { TdfObject } from '@/proto/tdf_object/v1/tdf_object_pb';

interface VehicleDataItem {
  id: string;
  pos: { lat: number; lng: number };
  rawObject: TdfObject;
  data?: {
    vehicleName?: string | undefined;
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

interface VehicleLayerProps {
  vehicleData: VehicleDataItem[];
  onMarkerClick: (vehicle: VehicleDataItem) => void;
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
