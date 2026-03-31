import { TdfObject } from '@/proto/tdf_object/v1/tdf_object_pb';

export interface VehicleData {
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