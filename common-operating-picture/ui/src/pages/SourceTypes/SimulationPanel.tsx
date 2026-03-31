import { useState } from 'react';
import { Box, Button, Collapse, IconButton, Typography } from '@mui/material';
import { PlayArrow, Stop, ExpandMore, ExpandLess } from '@mui/icons-material';

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
  const [consoleOpen, setConsoleOpen] = useState(false);

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

      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box display="flex" alignItems="center">
          <IconButton size="small" onClick={() => setConsoleOpen(!consoleOpen)}>
            {consoleOpen ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
          <Typography variant="caption" color="textSecondary">Console</Typography>
        </Box>
        {consoleOpen && (
          <Button size="small" onClick={onClearLogs} sx={{ fontSize: '0.6rem' }}>Clear</Button>
        )}
      </Box>

      <Collapse in={consoleOpen}>
        <Box
          sx={{
            p: 1,
            height: '150px',
            overflowY: 'auto',
            backgroundColor: '#121212',
            border: '1px solid #333',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: '0.75rem',
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: '#4caf50' }}>
            {logs || 'No logs to display.'}
          </pre>
        </Box>
      </Collapse>
    </Box>
  );
}