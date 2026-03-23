import { useState, useCallback, useEffect, useRef } from 'react';
import { useRpcClient } from '@/hooks/useRpcClient';
import { useAuth } from '@/hooks/useAuth';

interface UseSimulationProps {
  onStartSuccess?: () => void;
}

export function useSimulation({ onStartSuccess }: UseSimulationProps = {}) {
  const { runPythonScript } = useRpcClient();
  const { user } = useAuth();

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [logs, setLogs] = useState<string | null>(null);

  // Use a ref to ensure the auto-check only triggers once per mount
  const hasChecked = useRef(false);

  
  // Checks the current status of the simulation process on the server.
  // Expects the backend to return ExitCode: 0 and "STATUS:true" in the output if running. 
  const checkStatus = useCallback(async () => {
    // Only attempt the RPC call if we have an active session/token
    if (!user?.accessToken) return;

    setIsChecking(true);
    try {
      const response = await runPythonScript({
        scriptId: 'simulation_status',
        args: [],
      });

      // Parse the custom status string from the Go backend
      const active = response?.output?.includes('STATUS:true') ?? false;
      
      setIsRunning(active);

      if (active && onStartSuccess) {
        onStartSuccess();
      }
    } catch (err) {
      console.error("SIMULATION: Status check failed", err);
      setIsRunning(false);
    } finally {
      setIsChecking(false);
    }
  }, [runPythonScript, onStartSuccess, user?.accessToken]);

  
  // Effect: Trigger the initial status check on mount or page reload.
  // It waits specifically for the user/token to be available to avoid 401 errors.
  useEffect(() => {
    if (!hasChecked.current && user?.accessToken) {
      hasChecked.current = true;
      checkStatus();
    }
  }, [user?.accessToken, checkStatus]);

  // Starts the simulation and seeding process.   
  const start = useCallback(async () => {
    setIsStarting(true);
    setLogs('Starting simulation...');
    try {
      const response = await runPythonScript({ scriptId: 'simulation_start', args: [] });
      if (response.exitCode === 0) {
        setIsRunning(true);
        onStartSuccess?.();
      }
      setLogs(response.output);
    } catch (err) {
      console.error("SIMULATION: Start request failed", err);
      setLogs(`Error starting simulation: ${err}`);
    } finally {
      setIsStarting(false);
    }
  }, [runPythonScript, onStartSuccess]);

  // Stops the running simulation process.
  const stop = useCallback(async () => {
    setIsStopping(true);
    try {
      const response = await runPythonScript({ scriptId: 'simulation_stop', args: [] });
      // Logic assumes backend kills the process and returns exit 0
      if (response.exitCode === 0) {
        setIsRunning(false);
      }
      setLogs(response.output);
    } catch (err) {
      console.error("SIMULATION: Stop request failed", err);
      setLogs(`Error stopping simulation: ${err}`);
    } finally {
      setIsStopping(false);
    }
  }, [runPythonScript]);

  
  //Clears the simulation log output. 
  const clearLogs = useCallback(() => setLogs(null), []);

  return {
    isStarting,
    isStopping,
    isRunning,
    isChecking,
    logs,
    start,
    stop,
    clearLogs,
    checkStatus,
  };
}