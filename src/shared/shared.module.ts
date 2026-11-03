import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import { NoopProviderIdentityAdapter } from "@shared/adapters/outbound/auth/noop-provider-identity.adapter";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { PROVIDER_IDENTITY_PORT } from "@shared/application/ports/outbound/provider-identity.port";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadEnvironmentConfig],
    }),
  ],
  providers: [
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: NoopProviderIdentityAdapter,
    },
    NoopAuthGuard,
  ],
  exports: [PROVIDER_IDENTITY_PORT, NoopAuthGuard],
})
export class SharedModule {}

