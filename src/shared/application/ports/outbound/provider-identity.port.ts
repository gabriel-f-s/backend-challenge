export const PROVIDER_IDENTITY_PORT = Symbol("PROVIDER_IDENTITY_PORT");

export interface AuthenticatedProviderPrincipal {
  readonly subject: string;
  readonly providerId?: string;
  readonly scopes: readonly string[];
}

export interface ProviderIdentityPort {
  verifyBearerToken(token: string | undefined): Promise<AuthenticatedProviderPrincipal>;
}

