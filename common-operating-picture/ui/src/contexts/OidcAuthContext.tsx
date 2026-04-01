import { jwtDecode } from 'jwt-decode';
import { AuthContext, LoginCredentials } from './AuthContext';
import { config } from '@/config';

export const OidcAuthContext: AuthContext = {
  isAuthenticated: false,
  user: null,
  error: null,
  signIn: async (creds: LoginCredentials) => {
    const token_endpoint = sessionStorage.getItem('dsp:cop:keycloak:token_endpoint') || '';
    
    const urlParams = new URLSearchParams();
    urlParams.append('grant_type', 'password');
    urlParams.append('client_id', config.dsp.keycloak.clientId);
    urlParams.append('username', creds.email || '');
    urlParams.append('password', creds.password || '');
    urlParams.append('scope', 'openid');

    const tokenResponse = await fetch(token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: urlParams,
    });
    const { access_token, refresh_token } = await tokenResponse.json();
    const { name } = jwtDecode<{name: string}>(access_token);

    return {
      email: creds.email || '',
      name,
      // todo: Hack to enable a loading state for the entitlements retrieval after sign in
      entitlements: ['loading'],
      accessToken: access_token as string,
      refreshToken: refresh_token as string,
    };
  },
  // todo: call revocation endpoint from well-known config
  //       see: sessionStorage.kcRevokeEndpoint
  signOut: async () => Promise.resolve(),
  refreshTokens: async (currentUser) => {
    const token_endpoint = sessionStorage.getItem('dsp:cop:keycloak:token_endpoint') || '';

    const urlParams = new URLSearchParams();
    urlParams.append('grant_type', 'refresh_token');
    urlParams.append('client_id', config.dsp.keycloak.clientId);
    urlParams.append('refresh_token', currentUser.refreshToken);

    const tokenResponse = await fetch(token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: urlParams,
    });

    if (!tokenResponse.ok) {
      throw new Error('Token refresh failed');
    }

    const { access_token, refresh_token } = await tokenResponse.json();
    return {
      accessToken: access_token as string,
      refreshToken: refresh_token as string,
    };
  },
};