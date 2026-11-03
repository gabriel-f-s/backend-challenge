import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import {
  PROVIDER_IDENTITY_PORT,
  type ProviderIdentityPort,
} from "@shared/application/ports/outbound/provider-identity.port";

@Injectable()
export class NoopAuthGuard implements CanActivate {
  constructor(
    @Inject(PROVIDER_IDENTITY_PORT)
    private readonly providerIdentityPort: ProviderIdentityPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers?: Record<string, string | undefined>; principal?: unknown }>();
    const authorization = request.headers?.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    request.principal = await this.providerIdentityPort.verifyBearerToken(token);
    return true;
  }
}

