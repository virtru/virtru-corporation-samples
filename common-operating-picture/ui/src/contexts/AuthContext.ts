import { createContext } from 'react';

export type EntityAttribute = {
  attribute: string;
  displayName: string;
};

export type AuthUser = {
  email: string;
  name: string;
  entitlements: string[];
  accessToken: string;
  refreshToken: string;
};

export type LoginCredentials = {
  // password grant
  email?: string;
  password?: string;
  // authorization_code grant
  authorizationCode?: string;
  // keycloak direct authorization
  keycloakAuthTokens?: AuthUser; // FIXME: this is just a json stringfied AuthUser.
}

export interface AuthContext {
  isAuthenticated: boolean;
  user: AuthUser | null;
  error: string | null;
  signIn: (creds: LoginCredentials) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  refreshTokens: (currentUser: AuthUser) => Promise<{ accessToken: string; refreshToken: string }>;
}

export const Context = createContext<AuthContext | null>(null);