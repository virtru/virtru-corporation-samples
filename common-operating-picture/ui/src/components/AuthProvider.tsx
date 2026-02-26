import { ReactNode, useEffect, useReducer, useRef, useCallback, useState } from 'react';
import { jwtDecode } from 'jwt-decode';
import { Login } from '@/pages/Login';
import { crpcClient } from '@/api/connectRpcClient';
import { Context, AuthUser, LoginCredentials, AuthContext } from '@/contexts/AuthContext';
import { InactivityWarningDialog } from './InactivityDialog';

import { OidcAuthContext } from '@/contexts/OidcAuthContext';
import { KeycloakAuthContext } from '@/contexts/KeycloakAuthContext';

// Inactivity timeout configuration (in seconds)
const INACTIVITY_WARNING_SEC = 120;  // Show warning after 2 minute of inactivity
const INACTIVITY_SIGNOUT_SEC = 180; // Sign out after 3 minutes of inactivity
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove', 'pointerdown'] as const;

type AuthState = {
  isAuthenticated: boolean;
  user: AuthUser | null;
  error: string | null;
};

type AuthStateAction = {
  type: 'SIGNIN' | 'SIGNOUT' | 'SET_ENTITLEMENTS';
  payload: {
    user: AuthUser | null;
    error: string | null;
  };
};

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  error: null,
};

const userStorageKey = 'dsp:cop:user';
const authTypeStorageKey = 'dsp:cop:authType';

const authReducer = (state: AuthState = initialState, action: AuthStateAction) => {
  const { user, error } = action.payload;

  switch (action.type) {
    case 'SIGNIN':
      sessionStorage.setItem(userStorageKey, JSON.stringify(user));
      return {
        ...state,
        isAuthenticated: true,
        user,
        error: null,
      };
    case 'SIGNOUT':
      sessionStorage.removeItem(userStorageKey);
      // TODO: invalidate token.
      return {
        isAuthenticated: false,
        user: null,
        error,
      };
    // todo: Temporary action for allowing entitlements to be loaded in the background after sign in.
    case 'SET_ENTITLEMENTS':
      sessionStorage.setItem(userStorageKey, JSON.stringify(user));
      return {
        ...state,
        user,
        error,
      };
    default:
      return state;
  }
};

let AuthContextImpl: AuthContext | undefined;

function resolveAuthImpl(): AuthContext | undefined {
  const storedType = sessionStorage.getItem(authTypeStorageKey);
  if (storedType === 'keycloak') return KeycloakAuthContext;
  if (storedType === 'oidc') return OidcAuthContext;
  return undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const currentUser = sessionStorage.getItem(userStorageKey);

  // Restore the auth implementation on page load if a session exists
  if (currentUser && !AuthContextImpl) {
    AuthContextImpl = resolveAuthImpl();
  }

  const [state, dispatch] = useReducer(authReducer, { 
    ...initialState,
    isAuthenticated: !!currentUser,
    user: currentUser ? JSON.parse(currentUser) : null,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAccessToken = useCallback(async () => {
    if (!AuthContextImpl || !state.user) return;

    try {
      const { accessToken, refreshToken } = await AuthContextImpl.refreshTokens(state.user);
      const updatedUser = { ...state.user, accessToken, refreshToken };
      dispatch({ type: 'SIGNIN', payload: { user: updatedUser, error: null } });
      console.log('Token refreshed successfully.');
    } catch (err) {
      console.error('Token refresh failed, signing out:', err);
      sessionStorage.removeItem(authTypeStorageKey);
      dispatch({ type: 'SIGNOUT', payload: { user: null, error: 'Your session has expired. Please sign in again.' } });
    }
  }, [state.user]);

  // Schedule a token refresh ~60 seconds before the access token expires
  const scheduleTokenRefresh = useCallback((accessToken: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    try {
      const { exp } = jwtDecode<{ exp: number }>(accessToken);
      const now = Math.floor(Date.now() / 1000);
      // Refresh 60 seconds before expiry, minimum 10 seconds from now
      const refreshInSec = Math.max((exp - now) - 60, 10);
      console.log(`Token expires in ${exp - now}s, scheduling refresh in ${refreshInSec}s.`);
      refreshTimerRef.current = setTimeout(() => {
        refreshAccessToken();
      }, refreshInSec * 1000);
    } catch (err) {
      console.warn('Could not decode token for refresh scheduling:', err);
    }
  }, [refreshAccessToken]);

  // Schedule refresh whenever the user's access token changes
  useEffect(() => {
    if (state.user?.accessToken) {
      scheduleTokenRefresh(state.user.accessToken);
    }
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [state.user?.accessToken, scheduleTokenRefresh]);

  // ── Inactivity Timeout ──────────────────────────────────────────────
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const [idleSecondsRemaining, setIdleSecondsRemaining] = useState(INACTIVITY_SIGNOUT_SEC - INACTIVITY_WARNING_SEC);
  const idleWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleSignoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWarningVisibleRef = useRef(false);

  const clearIdleTimers = useCallback(() => {
    if (idleWarningTimerRef.current) {
      clearTimeout(idleWarningTimerRef.current);
      idleWarningTimerRef.current = null;
    }
    if (idleSignoutTimerRef.current) {
      clearTimeout(idleSignoutTimerRef.current);
      idleSignoutTimerRef.current = null;
    }
  }, []);

  const handleIdleSignOut = useCallback(async () => {
    clearIdleTimers();
    isWarningVisibleRef.current = false;
    setShowIdleWarning(false);
    if (AuthContextImpl) {
      await AuthContextImpl.signOut();
    }
    sessionStorage.removeItem(authTypeStorageKey);
    dispatch({ type: 'SIGNOUT', payload: { user: null, error: 'You were signed out due to inactivity.' } });
  }, [clearIdleTimers]);

  const startIdleTimers = useCallback(() => {
    clearIdleTimers();
    isWarningVisibleRef.current = false;
    setShowIdleWarning(false);

    // First timer: show warning
    idleWarningTimerRef.current = setTimeout(() => {
      isWarningVisibleRef.current = true;
      setIdleSecondsRemaining(INACTIVITY_SIGNOUT_SEC - INACTIVITY_WARNING_SEC);
      setShowIdleWarning(true);

      // Second timer: sign out
      idleSignoutTimerRef.current = setTimeout(() => {
        handleIdleSignOut();
      }, (INACTIVITY_SIGNOUT_SEC - INACTIVITY_WARNING_SEC) * 1000);
    }, INACTIVITY_WARNING_SEC * 1000);
  }, [clearIdleTimers, handleIdleSignOut]);

  const handleStaySignedIn = useCallback(() => {
    isWarningVisibleRef.current = false;
    setShowIdleWarning(false);
    startIdleTimers();
  }, [startIdleTimers]);

  useEffect(() => {
    if (!state.isAuthenticated) {
      clearIdleTimers();
      return;
    }

    startIdleTimers();

    // Use the ref (not state) to check if warning is visible —
    // this avoids recreating the handler on state changes.
    const handler = () => {
      if (!isWarningVisibleRef.current) {
        startIdleTimers();
      }
    };

    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, handler));
      clearIdleTimers();
    };
  }, [state.isAuthenticated, startIdleTimers, clearIdleTimers]);

  // ── End Inactivity Timeout ────────────────────────────────────────

  const signIn = async (creds: LoginCredentials) => {
    // TODO: this is a hack for AuthContext implementation
    if (Object.keys(creds).length === 0) {
      AuthContextImpl = KeycloakAuthContext;
      sessionStorage.setItem(authTypeStorageKey, 'keycloak');
    } else {
      AuthContextImpl = OidcAuthContext;
      sessionStorage.setItem(authTypeStorageKey, 'oidc');
    }
    const user = await AuthContextImpl.signIn(creds);
    dispatch({ type: 'SIGNIN', payload: { user, error: null } });
    /** 
     * todo: Temporarily loads entitlements in the background immediately after sign in without 
     * blocking the UI. This is an attempt to mask the slow request time from the user. 
     * 
     * In the future, there should be initialization steps that happen before the app is fully 
     * loaded and the user is redirected to the dashboard. Additionally, more thought needs to 
     * be given into how the entitlements should be kept in sync on the client/server.
     */
    loadEntitlements(user);
    return user;
  };

  const signOut = async () => {
    if (AuthContextImpl) {
      await AuthContextImpl.signOut();
    }
    sessionStorage.removeItem(authTypeStorageKey);
    dispatch({ type: 'SIGNOUT', payload: { user: null, error: null } });
  };

  const loadEntitlements = async (user: AuthUser) => {
    try {
      const { entitlements } = await crpcClient.getEntitlements({}, { headers: { 'Authorization': user.accessToken } });
      dispatch({ type: 'SET_ENTITLEMENTS', payload: { user: { ...user, entitlements: Object.keys(entitlements) }, error: null } });
    } catch (err) {
      console.error('error fetching entitlements:', err);
      dispatch({ type: 'SET_ENTITLEMENTS', payload: { user: { ...user, entitlements: [] }, error: 'entitlements fetch error' } });
    }
  };

  /**
   * COP Browser Fetch API interceptor
   * 
   * This interceptor patches existing Fetch API functionality to catch errors thrown by Keycloak
   * when attempting TDF encrypt/decrypt operations with an expired refresh token.
   */
  const fetchInterceptor = () => {
    const { fetch: originalFetch } = window;

    const interceptor = async (...args: Parameters<typeof window.fetch>) => {
      const [url, config] = args;
      const response = await originalFetch(url, config);
      if (response.status === 400 && response.url.endsWith('token')) {
        // Keycloak error response: { error: 'invalid_grant', error_description: 'Token is not active' }
        const body = await response.json();
        if (body.error === 'invalid_grant') {
          dispatch({ type: 'SIGNOUT', payload: { user: null, error: 'Your session has expired. Please sign in again.' } });
        }
      }

      // Handle 401 from API calls — attempt a token refresh
      if (response.status === 401 && !response.url.endsWith('token')) {
        console.warn('Received 401, attempting token refresh...');
        try {
          await refreshAccessToken();
        } catch {
          // refreshAccessToken already handles sign-out on failure
        }
      }

      return response;
    };

    return { interceptor, originalFetch };
  };

  useEffect(() => {
    const { interceptor, originalFetch } = fetchInterceptor();
    window.fetch = interceptor;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <Context.Provider value={{ ...state, signIn, signOut, refreshTokens: AuthContextImpl?.refreshTokens ?? (async () => { throw new Error('No auth impl'); }) }}>
      {!state.isAuthenticated && <Login />}
      {state.isAuthenticated && children}
      <InactivityWarningDialog
        open={showIdleWarning}
        secondsRemaining={idleSecondsRemaining}
        onStaySignedIn={handleStaySignedIn}
        onSignOut={handleIdleSignOut}
      />
    </Context.Provider>
  );
}