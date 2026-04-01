import { memo, useMemo } from 'react';
import { Polyline, CircleMarker, Tooltip, LayerGroup } from 'react-leaflet';
import type { VehicleTrail, TrailPoint } from '@/hooks/useVehicleTrails';

/** Number of opacity segments used to render each trail's gradient fade. */
const SEGMENT_COUNT = 8;

/** Opacity range: newest segment → oldest segment */
const OPACITY_MAX = 0.85;
const OPACITY_MIN = 0.15;

/** Stroke width range: newest → oldest */
const WEIGHT_MAX = 3.0;
const WEIGHT_MIN = 1.5;

interface TrailSegmentStyle {
  opacity: number;
  weight: number;
}

/** Pre-compute the style for each segment index so we don't recalculate per frame. */
const SEGMENT_STYLES: TrailSegmentStyle[] = Array.from({ length: SEGMENT_COUNT }, (_, i) => {
  const t = i / (SEGMENT_COUNT - 1);
  return {
    opacity: OPACITY_MIN + (OPACITY_MAX - OPACITY_MIN) * t,
    weight: WEIGHT_MIN + (WEIGHT_MAX - WEIGHT_MIN) * t,
  };
});

/** Split a trail's points into N roughly equal segments for the gradient effect. */
function splitIntoSegments(points: TrailPoint[], count: number): [number, number][][] {
  if (points.length < 2) return [];

  const segments: [number, number][][] = [];
  const totalPoints = points.length;
  const segmentSize = Math.max(2, Math.ceil(totalPoints / count));

  for (let i = 0; i < count; i++) {
    const start = Math.min(i * segmentSize, totalPoints - 1);
    // Overlap by 1 point so segments connect seamlessly
    const end = Math.min(start + segmentSize, totalPoints - 1);

    if (start >= end) continue;

    const segmentPoints: [number, number][] = [];
    for (let j = start; j <= end; j++) {
      segmentPoints.push([points[j].lat, points[j].lng]);
    }

    if (segmentPoints.length >= 2) {
      segments.push(segmentPoints);
    }
  }

  return segments;
}

/** Format a timestamp into a readable time string */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface SingleTrailProps {
  trail: VehicleTrail;
}

/** Renders a single vehicle's trail with a gradient fade and an origin marker. */
const SingleTrail = memo(function SingleTrail({ trail }: SingleTrailProps) {
  const { segments, color, origin } = useMemo(() => {
    const segs = splitIntoSegments(trail.points, SEGMENT_COUNT);
    const first = trail.points[0];
    return { segments: segs, color: trail.color, origin: first };
  }, [trail.points, trail.color]);

  if (segments.length === 0) return null;

  return (
    <>
      {/* Shadow / glow layer */}
      {segments.map((positions, i) => (
        <Polyline
          key={`shadow-${trail.vehicleId}-${i}`}
          positions={positions}
          pathOptions={{
            color,
            weight: SEGMENT_STYLES[Math.min(i, SEGMENT_STYLES.length - 1)].weight + 4,
            opacity: SEGMENT_STYLES[Math.min(i, SEGMENT_STYLES.length - 1)].opacity * 0.2,
            lineCap: 'round',
            lineJoin: 'round',
            interactive: false,
          }}
        />
      ))}
      {/* Primary trail line */}
      {segments.map((positions, i) => (
        <Polyline
          key={`trail-${trail.vehicleId}-${i}`}
          positions={positions}
          pathOptions={{
            color,
            weight: SEGMENT_STYLES[Math.min(i, SEGMENT_STYLES.length - 1)].weight,
            opacity: SEGMENT_STYLES[Math.min(i, SEGMENT_STYLES.length - 1)].opacity,
            lineCap: 'round',
            lineJoin: 'round',
            dashArray: i === 0 ? '4 6' : undefined,
            interactive: false,
          }}
        />
      ))}

      {/* Origin marker — outer ring */}
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={4}
        pathOptions={{
          color,
          weight: 2,
          opacity: 0.6,
          fillColor: color,
          fillOpacity: 0.1,
          interactive: true,
        }}
      >
        <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
          <span style={{ fontSize: '12px' }}>
            <strong>Origin</strong><br />
            {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}<br />
            <em>{formatTime(origin.timestamp)}</em>
          </span>
        </Tooltip>
      </CircleMarker>

      {/* Origin marker — inner dot */}
      <CircleMarker
        center={[origin.lat, origin.lng]}
        radius={2}
        pathOptions={{
          color,
          weight: 0,
          fillColor: color,
          fillOpacity: 0.9,
          interactive: false,
        }}
      />
    </>
  );
});

interface VehicleTrailLayerProps {
  /** Trail data from the useVehicleTrails hook. */
  trails: VehicleTrail[];
}

/**
 * Map layer that renders fading flight-path trails for all tracked vehicles.
 * Designed to sit underneath the VehicleLayer in the LayersControl.
 *
 * Trails fade from opaque (current position) to transparent (oldest recorded
 * position), with a subtle glow effect and dashed tail.
 */
export const VehicleTrailLayer = memo(function VehicleTrailLayer({
  trails,
}: VehicleTrailLayerProps) {
  return (
    <LayerGroup>
      {trails.map((trail) => (
        <SingleTrail key={trail.vehicleId} trail={trail} />
      ))}
    </LayerGroup>
  );
});