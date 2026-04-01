import { useRef, useCallback, useState } from 'react';

export interface TrailPoint {
  lat: number;
  lng: number;
  timestamp: number;
}

export interface VehicleTrail {
  vehicleId: string;
  points: TrailPoint[];
  color: string;
}

interface TrailConfig {
  /** Maximum number of trail points to retain per vehicle. Default: 5000 */
  maxPoints?: number;
  /** Minimum time (ms) between recording points for the same vehicle. Default: 2000 */
  minInterval?: number;
}

const DEFAULT_CONFIG: Required<TrailConfig> = {
  maxPoints: 5000,
  minInterval: 2000,
};

/**
 * Accumulates position history for a set of vehicles across data refreshes.
 * Trails persist for the entire session — they are never pruned by age.
 *
 * Usage:
 *   const { trails, updateTrails } = useVehicleTrails();
 *   // On each vehicle data refresh:
 *   updateTrails(vehicleData);
 */
export function useVehicleTrails(config?: TrailConfig) {
  const { maxPoints, minInterval } = { ...DEFAULT_CONFIG, ...config };

  const historyRef = useRef<Map<string, { points: TrailPoint[]; color: string; lastRecorded: number }>>(new Map());

  const [trails, setTrails] = useState<VehicleTrail[]>([]);

  const updateTrails = useCallback(
    (
      vehicles: {
        id: string;
        pos: { lat: number; lng: number };
        color: string;
      }[],
    ) => {
      const now = Date.now();
      const activeIds = new Set<string>();
      let changed = false;

      for (const vehicle of vehicles) {
        activeIds.add(vehicle.id);

        let entry = historyRef.current.get(vehicle.id);
        if (!entry) {
          entry = { points: [], color: vehicle.color, lastRecorded: 0 };
          historyRef.current.set(vehicle.id, entry);
        }

        entry.color = vehicle.color;

        // Throttle: only record a new point if enough time has passed
        if (now - entry.lastRecorded < minInterval) {
          continue;
        }

        const lastPoint = entry.points[entry.points.length - 1];
        const newPos = vehicle.pos;

        // Skip if position is exactly identical (stationary)
        if (lastPoint && lastPoint.lat === newPos.lat && lastPoint.lng === newPos.lng) {
          continue;
        }

        entry.points.push({ lat: newPos.lat, lng: newPos.lng, timestamp: now });
        entry.lastRecorded = now;
        changed = true;

        // Cap the total count (keep most recent points)
        if (entry.points.length > maxPoints) {
          entry.points = entry.points.slice(entry.points.length - maxPoints);
        }
      }

      // Remove vehicles that are no longer in the data set
      for (const id of historyRef.current.keys()) {
        if (!activeIds.has(id)) {
          historyRef.current.delete(id);
          changed = true;
        }
      }

      if (changed) {
        const snapshot: VehicleTrail[] = [];
        historyRef.current.forEach((entry, vehicleId) => {
          if (entry.points.length >= 2) {
            snapshot.push({
              vehicleId,
              points: [...entry.points],
              color: entry.color,
            });
          }
        });
        setTrails(snapshot);
      }
    },
    [maxPoints, minInterval],
  );

  return { trails, updateTrails };
}