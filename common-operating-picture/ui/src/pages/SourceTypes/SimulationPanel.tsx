import { Box, Button, Typography } from '@mui/material';
import { PlayArrow, Stop } from '@mui/icons-material';

interface SimulationPanelProps {
  isStarting: boolean;
  isStopping: boolean;
  isRunning: boolean;
  isChecking: boolean;
  logs: string | null;
  onStart: () => void;
  onStop: () => void;
  onClearLogs: () => void;
}

export function SimulationPanel({
  isStarting,
  isStopping,
  isRunning,
  isChecking,
  logs,
  onStart,
  onStop,
  onClearLogs,
}: SimulationPanelProps) {
  
  const isDisabled = isStarting || isStopping || isChecking;

  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="h6" gutterBottom>
        Simulation Control
      </Typography>

      <Box display="flex" gap={1} mb={2}>
        {!isRunning ? (
          <Button
            variant="contained"
            color="primary"
            startIcon={<PlayArrow />}
            onClick={onStart}
            disabled={isDisabled}
            fullWidth
          >
            {isStarting ? 'Starting...' : 'Start Simulation'}
          </Button>
        ) : (
          <Button
            variant="contained"
            color="error"
            startIcon={<Stop />}
            onClick={onStop}
            disabled={isDisabled}
            fullWidth
          >
            {isStopping ? 'Stopping...' : 'Stop Simulation'}
          </Button>
        )}
      </Box>

      <Box 
        sx={{ 
          p: 1, 
          height: '150px', 
          overflowY: 'auto', 
          backgroundColor: '#fafafa',
          border: '1px solid #ddd',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: '0.75rem'
        }}
      >
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="caption" color="textSecondary">Logs</Typography>
          <Button size="small" onClick={onClearLogs} sx={{ fontSize: '0.6rem' }}>Clear</Button>
        </Box>
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {logs || 'No logs to display.'}
        </pre>
      </Box>
    </Box>
  );
}