import { useState, useCallback, useEffect, useMemo, useContext } from 'react';
import { useRpcClient } from '@/hooks/useRpcClient';
import { BannerContext } from '@/contexts/BannerContext';
import { SrcType, TimestampSelector } from '@/proto/tdf_object/v1/tdf_object_pb';
import { Timestamp } from '@bufbuild/protobuf';
import { VehicleData } from '@/types/vehicle';
import dayjs from 'dayjs';

const VEHICLE_SRC_TYPE_ID = 'vehicles';
const POLL_INTERVAL_MS = 1000;

export type VehicleDateFilter = {
  startDate?: string;
  endDate?: string;
};

export function useVehicleData(dateFilter?: VehicleDateFilter, pollingEnabled = true) {
  const { getSrcType, queryTdfObjectsLight } = useRpcClient();
  const { activeEntitlements } = useContext(BannerContext);

  const [vehicleData, setVehicleData] = useState<VehicleData[]>([]);
  const [vehicleSrcType, setVehicleSrcType] = useState<SrcType>();

  const filteredVehicleData = useMemo(() => {
    if (!activeEntitlements || activeEntitlements.size === 0 || activeEntitlements.has('NoAccess')) {
      return vehicleData;
    }

    return vehicleData.filter((vehicle) => {
      // Classification check (all-of)
      const classification = vehicle.data?.attrClassification;
      if (classification) {
        const classStr = Array.isArray(classification) ? classification[0] : classification;
        if (classStr && !activeEntitlements.has(classStr)) return false;
      }

      // NeedToKnow check (all-of — user must have every attribute)
      const needToKnow = vehicle.data?.attrNeedToKnow || [];
      for (const ntk of needToKnow) {
        if (ntk && !activeEntitlements.has(ntk)) return false;
      }

      // RelTo check (any-of — user must have at least one)
      const relTo = vehicle.data?.attrRelTo || [];
      if (relTo.length > 0 && !relTo.some(rel => activeEntitlements.has(rel))) {
        return false;
      }

      return true;
    });
  }, [vehicleData, activeEntitlements]);

  const fetchVehicles = useCallback(async () => {
    try {
      const tsRange = new TimestampSelector();
      tsRange.greaterOrEqualTo = dateFilter?.startDate
        ? Timestamp.fromDate(dayjs(dateFilter.startDate).toDate())
        : Timestamp.fromDate(new Date(0));
      if (dateFilter?.endDate) {
        tsRange.lesserOrEqualTo = Timestamp.fromDate(dayjs(dateFilter.endDate).toDate());
      }

      const response = await queryTdfObjectsLight({
        srcType: VEHICLE_SRC_TYPE_ID,
        tsRange,
      });

      const transformed: VehicleData[] = response
        .filter((o) => o.geo)
        .map((o) => {
          const geoJson = JSON.parse(o.geo);
          const [lng, lat] = geoJson.coordinates;

          let telemetry = {};
          try {
            if (o.metadata && o.metadata !== 'null') telemetry = JSON.parse(o.metadata);
          } catch (e) {
            console.error('Metadata parse error', e);
          }

          let attributes = {};
          try {
            if (o.search && o.search !== 'null') attributes = JSON.parse(o.search);
          } catch (e) {
            console.error('Search field parse error', e);
          }

          return {
            id: o.id,
            pos: { lat, lng },
            rawObject: o,
            data: { ...telemetry, ...attributes },
          };
        });

      setVehicleData(transformed);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      setVehicleData([]);
    }
  }, [queryTdfObjectsLight, dateFilter?.startDate, dateFilter?.endDate]);

  // Fetch vehicle source type schema once
  useEffect(() => {
    if (vehicleSrcType) return;

    const fetchSchema = async () => {
      try {
        const { srcType } = await getSrcType({ srcType: VEHICLE_SRC_TYPE_ID });
        setVehicleSrcType(srcType);
      } catch (err) {
        console.error('Failed to fetch vehicle source type schema', err);
      }
    };

    fetchSchema();
  }, [getSrcType, vehicleSrcType]);

  // Initial fetch
  useEffect(() => {
    fetchVehicles();
  }, [fetchVehicles]);

  // Poll for updates
  useEffect(() => {
    if (!pollingEnabled) return;
    const intervalId = setInterval(fetchVehicles, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchVehicles, pollingEnabled]);

  return {
    filteredVehicleData,
    vehicleSrcType,
    fetchVehicles,
  };
}