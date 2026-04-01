import { config } from '@/config';
import Keycloak from 'keycloak-js';
import { AuthContext, AuthUser } from './AuthContext';

const getKeycloakClient = () => {
  let client: Keycloak;

  function _getKeycloakClient() {
    if (!client) { 
      client = new Keycloak({
        url: config.dsp.keycloak.serverUrl.split('/realms/').shift() || '',
        realm: config.dsp.keycloak.serverUrl.split('/realms/').pop() || '',
        clientId: config.dsp.keycloak.clientId,
      });
    }

    return client;
  }
  return _getKeycloakClient();
};

export const KeycloakAuthContext: AuthContext = {
  isAuthenticated: false,
  user: null,
  error: null,
  signIn: async () => {
    const client = getKeycloakClient();

    if (!client.authenticated) {
      const success = await client.init({
        onLoad: 'login-required',
        checkLoginIframe: false, // this resolves an error about unable to load iframe
      });
      if (success) {
        // We do not reach this line of code after the intial client.init
        console.log('Keycloak Auth Successful!');
      }
      if (!success) {
        throw new Error('Keycloak Auth Failed');
      }
    }

    return {
      'email': client.idTokenParsed?.email as string,
      'name': client.idTokenParsed?.name as string,
      'entitlements': ['loading'],
      'accessToken': client.token as string,
      'refreshToken': client.refreshToken as string,
    } as AuthUser;

  },
  signOut: async () => {
    const client = getKeycloakClient();
    client.clearToken();
  },
  refreshTokens: async () => {
    const client = getKeycloakClient();
    // updateToken(30) refreshes if token expires within 30 seconds
    await client.updateToken(30);
    return {
      accessToken: client.token as string,
      refreshToken: client.refreshToken as string,
    };
  },
};