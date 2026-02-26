import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography } from '@mui/material';
import { useEffect, useState } from 'react';

type InactivityWarningDialogProps = {
  open: boolean;
  secondsRemaining: number;
  onStaySignedIn: () => void;
  onSignOut: () => void;
};

export function InactivityWarningDialog({ open, secondsRemaining, onStaySignedIn, onSignOut }: InactivityWarningDialogProps) {
  const [countdown, setCountdown] = useState(secondsRemaining);

  useEffect(() => {
    setCountdown(secondsRemaining);
  }, [secondsRemaining, open]);

  useEffect(() => {
    if (!open) return;

    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [open]);

  return (
    <Dialog open={open} disableEscapeKeyDown>
      <DialogTitle>Session Timeout Warning</DialogTitle>
      <DialogContent>
        <Typography>
          You've been inactive. Your session will expire in{' '}
          <strong>{countdown} second{countdown !== 1 ? 's' : ''}</strong>.
        </Typography>
        <Typography sx={{ mt: 1 }} variant="body2">
          Click "Stay Signed In" to continue your session.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onSignOut} color="inherit">
          Sign Out Now
        </Button>
        <Button onClick={onStaySignedIn} variant="contained" autoFocus>
          Stay Signed In
        </Button>
      </DialogActions>
    </Dialog>
  );
}