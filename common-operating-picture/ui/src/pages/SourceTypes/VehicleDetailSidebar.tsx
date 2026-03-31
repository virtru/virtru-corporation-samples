import { useState } from 'react';
import { Box, IconButton, Typography, Divider } from '@mui/material';
import { LatLng } from 'leaflet';
import CloseIcon from '@mui/icons-material/Close';
import FlightIcon from '@mui/icons-material/Flight';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import AltRouteIcon from '@mui/icons-material/AltRoute';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import SecurityIcon from '@mui/icons-material/Security';
import { SrcType } from '@/proto/tdf_object/v1/tdf_object_pb';
import { VehiclePopOutResponse } from '@/components/Map/Vehicle';
import { ObjectBanner } from '@/components/ObjectBanner';
import { extractValues } from '@/contexts/BannerContext';
import { ManifestDisplay, ManifestLoader } from '@/components/ManifestDisplay';
import { MilitaryManifest } from '@/services/s4Service';
import { SourceTypeProvider } from './SourceTypeProvider';
import { TdfObjectResult } from './TdfObjectResult';

interface VehicleDetailSidebarProps {
  vehicle: VehiclePopOutResponse;
  vehicleSrcType: SrcType | undefined;
  categorizedData: Record<string, string[]>;
  onClose: () => void;
  onFlyToClick: (latlng: LatLng) => void;
}

function formatCoordinates(geoJson: string | undefined): string {
  if (!geoJson) return 'N/A';
  try {
    const geo = JSON.parse(geoJson);
    return `${geo.coordinates[1].toFixed(4)}, ${geo.coordinates[0].toFixed(4)}`;
  } catch {
    return 'N/A';
  }
}

export function VehicleDetailSidebar({
  vehicle,
  vehicleSrcType,
  categorizedData,
  onClose,
  onFlyToClick,
}: VehicleDetailSidebarProps) {
  const [manifest, setManifest] = useState<MilitaryManifest | null>(
    vehicle.manifest || null,
  );

  const data = vehicle.decryptedData;

  const classification = extractValues(data?.attrClassification || [])
    .split(', ')
    .filter(Boolean);

  return (
    <Box
      className="popped-out-window"
      sx={{
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
      }}
    >
      {/* Header */}
      <Box
        className="window-header"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          p: 2,
          bgcolor: 'primary.main',
          color: 'white',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FlightIcon />
          <Typography variant="h6" fontWeight={600}>
            Vehicle Details & Notes
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'white' }}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Scrollable Content */}
      <Box sx={{ p: 2, overflowY: 'auto', flex: 1, bgcolor: 'background.paper' }}>
        {/* Classification Banner */}
        <ObjectBanner
          objClassification={classification.length > 0 ? classification : ['N/A']}
          objNTK={extractValues(data?.attrNeedToKnow || []).split(', ').filter(Boolean)}
          objRel={extractValues(data?.attrRelTo || []).split(', ').filter(Boolean)}
          notes={[]}
        />

        {/* Vehicle Header */}
        <Box sx={{ mt: 2, mb: 2 }}>
          <Typography variant="h5" fontWeight={600} sx={{ color: 'white' }}>
            {data?.vehicleName || `ID: ${vehicle.tdfObject.id.substring(0, 8)}`}
          </Typography>
          <Typography variant="h6" sx={{ color: 'rgba(255,255,255,0.7)' }}>
            Callsign: {data?.callsign || 'N/A'}
          </Typography>
        </Box>

        <Divider sx={{ mb: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

        {/* Telemetry */}
        <SectionHeader>Telemetry</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 2 }}>
          <DetailCard icon={<TrendingUpIcon />} label="Speed" value={data?.speed} />
          <DetailCard icon={<TrendingUpIcon />} label="Altitude" value={data?.altitude} />
          <DetailCard icon={<GpsFixedIcon />} label="Heading" value={data?.heading} />
          <DetailCard icon={<FlightIcon />} label="Aircraft Type" value={data?.aircraft_type} />
        </Box>

        {/* Flight Details */}
        <SectionHeader>Flight Details</SectionHeader>
        <Box sx={{ mb: 2 }}>
          <DetailCard icon={<AltRouteIcon />} label="Origin" value={data?.origin} sx={{ mb: 1 }} />
          <DetailCard icon={<AltRouteIcon />} label="Destination" value={data?.destination} sx={{ mb: 1 }} />
          <DetailCard
            icon={<MyLocationIcon />}
            label="Coordinates"
            value={formatCoordinates(vehicle.tdfObject.geo)}
            monospace
          />
        </Box>

        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

        {/* Intelligence Manifest */}
        <Typography
          variant="h6"
          fontWeight={600}
          sx={{
            mb: 1.5,
            borderBottom: '2px solid',
            borderColor: 'primary.main',
            pb: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'white',
          }}
        >
          <SecurityIcon />
          Classified Information
        </Typography>

        {vehicle.manifest ? (
          <ManifestDisplay manifest={vehicle.manifest} />
        ) : manifest ? (
          <ManifestDisplay manifest={manifest} />
        ) : (
          <ManifestLoader
            manifestUri={vehicle.manifestUri}
            manifest={manifest}
            onManifestLoaded={setManifest}
          />
        )}

        <Divider sx={{ my: 2, borderColor: 'rgba(255,255,255,0.2)' }} />

        {/* Notes */}
        <SectionHeader>Notes & Annotations</SectionHeader>
        <SourceTypeProvider srcType={vehicleSrcType}>
          <TdfObjectResult
            key={vehicle.tdfObject.id}
            tdfObjectResponse={vehicle}
            categorizedData={categorizedData || {}}
            onFlyToClick={onFlyToClick}
            onNotesUpdated={(objectId, notes) => console.log(objectId, notes)}
            notesOnly={true}
          />
        </SourceTypeProvider>
      </Box>
    </Box>
  );
}

// ── Small sub-components (private to this file) ─────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="h6"
      fontWeight={600}
      sx={{
        mb: 1.5,
        borderBottom: '2px solid',
        borderColor: 'primary.main',
        pb: 0.5,
        color: 'white',
      }}
    >
      {children}
    </Typography>
  );
}

interface DetailCardProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  monospace?: boolean;
  sx?: Record<string, unknown>;
}

function DetailCard({ icon, label, value, monospace, sx }: DetailCardProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
        ...sx,
      }}
    >
      <Box sx={{ color: 'white' }}>{icon}</Box>
      <Box>
        <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)' }}>
          {label}
        </Typography>
        <Typography
          variant="h6"
          fontWeight={600}
          fontFamily={monospace ? 'monospace' : undefined}
          sx={{ color: 'white' }}
        >
          {value || 'N/A'}
        </Typography>
      </Box>
    </Box>
  );
}