import { AuthUser } from '@/contexts/AuthContext';
import { config } from '@/config';
import { useAuth } from './useAuth';
import { AuthProviders, DSP } from '@virtru/dsp-sdk';

type BufferSource = {
  type: 'buffer';
  location: Uint8Array;
};

/** Creates a new instance of an OIDC Auth Provider consumed by the TDF Clients */
async function createAuthProvider(user: AuthUser | null) {
  if (!user) {
    throw new Error('TDF Clients require an authenticated user');
  }

  const { refreshToken } = user;

  if (!refreshToken) {
    throw new Error('TDF AuthProvider creation failed, no refresh token found for user');
  }

  return await AuthProviders.refreshAuthProvider({
    clientId: config.dsp.keycloak.clientId,
    exchange: 'refresh',
    refreshToken,
    oidcOrigin: config.dsp.keycloak.serverUrl,
  });
}

function stringToSource(input: string): BufferSource {
  return {
    type: 'buffer',
    location: new TextEncoder().encode(input),
  };
}

/**
 * This hook exposes two functions:
 * - encrypt: Encrypts a plaintext string as either a ZTDF (TDF3) by default or a NanoTDF if configured.
 * - decrypt: Decrypts an encrypted TDF payload (handles both TDF3 and NanoTDF automatically).
 */
export function useTDF() {
  const { user } = useAuth();
  const platformUrl = config.dsp.baseUrl;

  // Initialize unified DSP/OpenTDF client
  const initializeClient = async () => {
    const authProvider = await createAuthProvider(user);
    // New DSP client instance
    const dsp = new DSP({
        authProvider,
        platformUrl: platformUrl,
        disableDPoP: true,
    });

    return dsp;
  };

  const encryptNano = async (plaintext: string, attrs: string[]): Promise<ArrayBuffer> => {
    const dsp = await initializeClient();
    const tdfPayload = await dsp.createTDF({
      source: stringToSource(plaintext),
      attributes: attrs,
    });
    return new Response(tdfPayload).arrayBuffer();
  };

  const encryptZTDF = async (plaintext: string, attrs: string[]): Promise<ArrayBuffer> => {
    const dsp = await initializeClient();
    const tdfPayload = await dsp.createTDF({
      source: stringToSource(plaintext),
      attributes: attrs,
    });

    return new Response(tdfPayload).arrayBuffer();
  };

  const encrypt = async (plaintext: string, attrs: string[]): Promise<ArrayBuffer> => {
    // environment variables end up strings even when defined as boolean in TS
    if (config.formSubmitNanoTdf === 'false' || !config.formSubmitNanoTdf) {
      console.debug('Encrypting as TDF3 using DSP SDK...');
      return encryptZTDF(plaintext, attrs);
    } else {
      console.debug('Encrypting as NanoTDF using DSP SDK...');
      return encryptNano(plaintext, attrs);
    }
  };

  const decrypt = async (ciphertext: ArrayBuffer): Promise<string> => {
    const dsp = await initializeClient();
    const bufferedSource: BufferSource = {
      type: 'buffer',
      location: new Uint8Array(ciphertext),
    };

    console.debug('Decrypting TDF/NanoTDF using DSP SDK...');

    const stream = await dsp.read({
      source: bufferedSource,
    });

    return new Response(stream).text();
  };

  return {
    decrypt,
    encrypt,
  };
}