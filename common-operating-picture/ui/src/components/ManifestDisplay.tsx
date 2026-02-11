import { useEffect, useState } from 'react';
import {
  Typography, Box, CircularProgress, Button,
  Accordion, AccordionSummary, AccordionDetails, Chip, Divider,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SecurityIcon from '@mui/icons-material/Security';
import AssignmentIcon from '@mui/icons-material/Assignment';
import RadarIcon from '@mui/icons-material/Radar';
import GroupsIcon from '@mui/icons-material/Groups';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import VerifiedIcon from '@mui/icons-material/Verified';
import MemoryIcon from '@mui/icons-material/Memory';
import FlightIcon from '@mui/icons-material/Flight';
import SyncIcon from '@mui/icons-material/Sync';
import LockIcon from '@mui/icons-material/Lock';
import { MilitaryManifest, fetchManifestFromS4 } from '@/services/s4Service';
import { useAuth } from '@/hooks/useAuth';

// Helper functions
export const getClassificationBgColor = (classification: string): string => {
  const cl = classification.toLowerCase();
  if (cl.includes('topsecret') || cl.includes('top secret')) return '#ff6600';
  if (cl.includes('secret')) return '#c8102e';
  if (cl.includes('confidential')) return '#003f87';
  return '#007a33';
};

export const getPriorityColor = (priority: string): string => {
  switch (priority?.toUpperCase()) {
    case 'FLASH': return '#d32f2f';
    case 'IMMEDIATE': return '#f57c00';
    case 'PRIORITY': return '#fbc02d';
    default: return '#4caf50';
  }
};

export const getStatusColor = (status: string): string => {
  switch (status?.toUpperCase()) {
    case 'ACTIVE': return '#4caf50';
    case 'ON_STATION': return '#2196f3';
    case 'RTB': return '#ff9800';
    case 'MAINTENANCE': return '#9e9e9e';
    default: return '#607d8b';
  }
};

export const formatDateTime = (isoString: string | undefined): string => {
  if (!isoString) return 'N/A';
  try {
    return new Date(isoString).toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit', 
      hour12: false, 
    });
  } catch { 
    return isoString; 
  }
};

// Reusable components
export const ManifestField = ({ 
  label, 
  value, 
  mono = false, 
}: { 
  label: string; 
  value: string | number | boolean | undefined | null; 
  mono?: boolean 
}) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
    <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{label}</Typography>
    <Typography variant="body2" sx={{ 
      fontFamily: mono ? 'monospace' : 'inherit', 
      fontWeight: mono ? 600 : 400, 
      maxWidth: '60%', 
      textAlign: 'right', 
      wordBreak: 'break-word',
      color: 'white',
    }}>
      {value === true ? '✓ Yes' : value === false ? '✗ No' : value || 'N/A'}
    </Typography>
  </Box>
);

export const ChipList = ({ 
  items, 
  color = 'default', 
}: { 
  items: string[]; 
  color?: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success' 
}) => (
  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
    {items.map((item, i) => (
      <Chip key={i} label={item} size="small" color={color} variant="outlined" sx={{ fontSize: '0.75rem', height: '24px', color: 'white', borderColor: 'rgba(255,255,255,0.5)' }} />
    ))}
  </Box>
);

export const ManifestSection = ({ 
  title, 
  icon: Icon, 
  children, 
  defaultExpanded = false, 
}: { 
  title: string; 
  icon: React.ElementType; 
  children: React.ReactNode; 
  defaultExpanded?: boolean 
}) => (
  <Accordion 
    defaultExpanded={defaultExpanded} 
    disableGutters 
    sx={{ 
      '&:before': { display: 'none' }, 
      boxShadow: 'none', 
      border: '1px solid rgba(255,255,255,0.2)', 
      borderRadius: '4px !important', 
      mb: 1, 
      bgcolor: 'rgba(255,255,255,0.05)',
      '&.Mui-expanded': { mb: 1 }, 
    }}
  >
    <AccordionSummary 
      expandIcon={<ExpandMoreIcon sx={{ fontSize: '1.2rem', color: 'white' }} />} 
      sx={{ minHeight: '44px !important', '& .MuiAccordionSummary-content': { my: '8px !important' } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Icon sx={{ fontSize: '1.2rem', color: 'primary.main' }} />
        <Typography variant="body1" sx={{ fontWeight: 600, color: 'white' }}>{title}</Typography>
      </Box>
    </AccordionSummary>
    <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 2 }}>{children}</AccordionDetails>
  </Accordion>
);

// Props for ManifestDisplay
interface ManifestDisplayProps {
  manifest: MilitaryManifest;
  compact?: boolean;
}

// Full manifest display component
export function ManifestDisplay({ manifest, compact = false }: ManifestDisplayProps) {
  return (
    <Box sx={{ mt: compact ? 0 : 1 }}>
      {/* Classification Banner */}
      <Box sx={{ 
        bgcolor: getClassificationBgColor(manifest.documentControl.classification), 
        color: '#fff', 
        p: 1.5, 
        borderRadius: 1, 
        mb: 1.5, 
        textAlign: 'center', 
      }}>
        <Typography variant="body1" sx={{ fontWeight: 700, letterSpacing: 1 }}>
          {manifest.documentControl.classification}
          {/* {manifest.documentControl.caveats.length > 0 && ` // ${manifest.documentControl.caveats.join(' / ')}`} */}
        </Typography>
      </Box>

      {/* Document Control */}
      <ManifestSection title="Document Control" icon={SecurityIcon} defaultExpanded>
        <ManifestField label="Manifest ID" value={manifest.documentControl.manifestId.substring(0, 8) + '...'} mono />
        <ManifestField label="Originating Agency" value={manifest.documentControl.originatingAgency} />
        <ManifestField label="Created By" value={manifest.documentControl.createdBy} />
        <ManifestField label="Created At" value={formatDateTime(manifest.documentControl.createdAt)} />
        <ManifestField label="Declassify On" value={manifest.documentControl.declassifyOn} />
      </ManifestSection>

      {/* Vehicle / Platform */}
      <ManifestSection title="Platform" icon={FlightIcon} defaultExpanded>
        <ManifestField label="Designation" value={`${manifest.vehicle.platform.designation} ${manifest.vehicle.platform.name}`} />
        <ManifestField label="Type" value={manifest.vehicle.platform.type} />
        <ManifestField label="Service" value={manifest.vehicle.platform.service} />
        <ManifestField label="Registration" value={manifest.vehicle.registration} mono />
        <ManifestField label="Tail Number" value={manifest.vehicle.tailNumber} mono />
        <ManifestField label="Operator" value={manifest.vehicle.operator} />
        <ManifestField label="Home Station" value={manifest.vehicle.homeStation} />
        <ManifestField label="ICAO Hex" value={manifest.vehicle.icaoHex} mono />
        <ManifestField label="Mode 5" value={manifest.vehicle.mode5Interrogator} mono />
      </ManifestSection>

      {/* Mission */}
      <ManifestSection title="Mission" icon={AssignmentIcon}>
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
          <Chip label={manifest.mission.missionType} size="small" color="primary" sx={{ fontSize: '0.8rem' }} />
          <Chip label={manifest.mission.priority} size="small" sx={{ fontSize: '0.8rem', bgcolor: getPriorityColor(manifest.mission.priority), color: '#fff' }} />
          <Chip label={manifest.mission.missionStatus} size="small" sx={{ fontSize: '0.8rem', bgcolor: getStatusColor(manifest.mission.missionStatus), color: '#fff' }} />
        </Box>
        <ManifestField label="Mission ID" value={manifest.mission.missionId} mono />
        <ManifestField label="Operation" value={manifest.mission.operationName} />
        <ManifestField label="Command" value={manifest.mission.commandAuthority} />
        <ManifestField label="ATO" value={manifest.mission.taskingOrder} mono />
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>Timeline</Typography>
        <ManifestField label="Takeoff" value={formatDateTime(manifest.mission.timeline.takeoff)} />
        <ManifestField label="On Station" value={formatDateTime(manifest.mission.timeline.onStation)} />
        <ManifestField label="Off Station" value={formatDateTime(manifest.mission.timeline.offStation)} />
        <ManifestField label="Recovery" value={formatDateTime(manifest.mission.timeline.expectedRecovery)} />
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <ManifestField label="Operating Area" value={manifest.mission.airspace.operatingArea} mono />
        <ManifestField label="Altitude Block" value={manifest.mission.airspace.altitudeBlock} />
        {manifest.mission.airspace.restrictedAreas.length > 0 && (
          <>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>Restricted Areas:</Typography>
            <ChipList items={manifest.mission.airspace.restrictedAreas} color="warning" />
          </>
        )}
      </ManifestSection>

      {/* Intelligence */}
      <ManifestSection title="Intelligence" icon={RadarIcon}>
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>Collection Discipline:</Typography>
        <ChipList items={manifest.intelligence.collectionDiscipline} color="info" />
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>Target Deck ({manifest.intelligence.targetDeck.length})</Typography>
        {manifest.intelligence.targetDeck.map((target, i) => (
          <Box key={i} sx={{ bgcolor: 'rgba(255,255,255,0.1)', p: 0.75, borderRadius: 1, mt: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>{target.targetName}</Typography>
              <Chip label={`P${target.priority}`} size="small" color={target.priority <= 2 ? 'error' : 'default'} sx={{ fontSize: '0.7rem', height: '20px' }} />
            </Box>
            <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>{target.targetId} • {target.targetType}</Typography>
          </Box>
        ))}
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <ManifestField label="Reporting" value={manifest.intelligence.reportingInstructions} mono />
      </ManifestSection>

      {/* Sensors */}
      <ManifestSection title="Sensors & Datalinks" icon={SettingsInputAntennaIcon}>
        <ManifestField label="Primary Sensor" value={manifest.sensors.primarySensor} />
        <ManifestField label="EMCON" value={manifest.sensors.emissionControl} />
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>Active Sensors:</Typography>
        <ChipList items={manifest.sensors.activeSensors} />
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', mt: 0.5, display: 'block' }}>Datalinks:</Typography>
        <ChipList items={manifest.sensors.datalinks} color="primary" />
      </ManifestSection>

      {/* Coordination */}
      <ManifestSection title="Coordination" icon={GroupsIcon}>
        <ManifestField label="Check-In Point" value={manifest.coordination.checkInPoint} mono />
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'white' }}>Frequency Plan</Typography>
        <ManifestField label="Primary" value={manifest.coordination.frequencyPlan.primary} mono />
        <ManifestField label="Secondary" value={manifest.coordination.frequencyPlan.secondary} mono />
        <ManifestField label="Guard" value={manifest.coordination.frequencyPlan.guard} mono />
        <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)' }}>Supporting Units:</Typography>
        <ChipList items={manifest.coordination.supportingUnits} />
        {manifest.coordination.coalitionPartners.length > 0 && (
          <>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', mt: 0.5, display: 'block' }}>Coalition Partners:</Typography>
            <ChipList items={manifest.coordination.coalitionPartners} color="success" />
          </>
        )}
      </ManifestSection>

      {/* Track Quality */}
      <ManifestSection title="Track Quality" icon={VerifiedIcon}>
        <ManifestField label="Source" value={manifest.trackQuality.source} />
        <ManifestField label="Reliability" value={`${(manifest.trackQuality.reliability * 100).toFixed(1)}%`} />
        <ManifestField label="Position Accuracy" value={`${manifest.trackQuality.positionAccuracy_m} m`} />
        <ManifestField label="Velocity Accuracy" value={`${manifest.trackQuality.velocityAccuracy_mps} m/s`} />
        <ManifestField label="Update Rate" value={`${manifest.trackQuality.updateRate_sec} sec`} />
        <ManifestField label="Last Update" value={formatDateTime(manifest.trackQuality.lastUpdate)} />
      </ManifestSection>

      {/* Processing */}
      <ManifestSection title="Processing" icon={MemoryIcon}>
        <ManifestField label="Pipeline" value={manifest.processing.ingestPipeline} mono />
        <ManifestField label="Node" value={manifest.processing.processingNode} mono />
        <ManifestField label="Processing Time" value={`${manifest.processing.processingTime_ms} ms`} />
        <ManifestField label="Fused Sources" value={manifest.processing.fusedSources} />
        <ManifestField label="Validated" value={manifest.processing.validated} />
        <ManifestField label="Correlation ID" value={manifest.processing.correlationId.substring(0, 8) + '...'} mono />
      </ManifestSection>

      {/* Bottom Classification Banner */}

    </Box>
  );
}

// Manifest loader component with sync button
interface ManifestLoaderProps {
  manifestUri?: string;
  manifest: MilitaryManifest | null;
  onManifestLoaded: (manifest: MilitaryManifest) => void;
  compact?: boolean;
}

export function ManifestLoader({ manifestUri, manifest, onManifestLoaded, compact = false }: ManifestLoaderProps) {
  const { user } = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    setSyncError(null);
  }, [manifestUri, manifest]);

  const handleSyncWithS3 = async () => {
    if (!manifestUri) {
      setSyncError('No manifest URI available');
      return;
    }
    if (!user?.accessToken) {
      setSyncError('Not authenticated');
      return;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      const data = await fetchManifestFromS4(user.accessToken, manifestUri);
      onManifestLoaded(data);
      setSyncError(null);
    } catch (err: any) {
      console.error('Failed to sync with S3:', err);
      if (err.message === 'ENTITLEMENT_DENIED') {
        setSyncError('Access Denied: Insufficient entitlements');
      } else {
        setSyncError(err instanceof Error ? err.message : 'Sync failed');
      }
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Box>
      {/* Sync Button */}
      <Box sx={{ mt: 1, mb: 1 }}>
        <Button
          size="small"
          variant={manifest ? 'outlined' : 'contained'}
          startIcon={isSyncing ? <CircularProgress size={14} /> : manifest ? <SyncIcon /> : <LockIcon />}
          onClick={handleSyncWithS3}
          disabled={isSyncing || !manifestUri}
          fullWidth
          sx={{ fontSize: '0.75rem', py: 0.5 }}
        >
          {isSyncing ? 'Syncing...' : manifest ? 'Refresh Infomation' : 'Load Classified Information'}
        </Button>
        {syncError && (
          <Box sx={{ mt: 0.5, p: 0.5, bgcolor: syncError.includes('Access Denied') ? 'error.light' : 'warning.light', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ color: syncError.includes('Access Denied') ? 'error.dark' : 'warning.dark', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LockIcon sx={{ fontSize: '0.9rem' }} /> {syncError}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Manifest Display */}
      {manifest && <ManifestDisplay manifest={manifest} compact={compact} />}

      {/* Loading indicator */}
      {isSyncing && !manifest && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
          <CircularProgress size={20} />
        </Box>
      )}
    </Box>
  );
}
