import { Injectable } from "@nestjs/common";
import type {
  AuthenticatedProviderPrincipal,
  ProviderIdentityPort,
} from "@shared/application/ports/outbound/provider-identity.port";

@Injectable()
export class NoopProviderIdentityAdapter implements ProviderIdentityPort {
  async verifyBearerToken(_token: string | undefined): Promise<AuthenticatedProviderPrincipal> {
    return {
      subject: "anonymous-provider",
      scopes: ["wagering:write", "wagering:read", "wallet:write", "wallet:read"],
    };
  }
}

