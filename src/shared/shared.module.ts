import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { DomainExceptionFilter } from "@shared/adapters/inbound/http/filters/domain-exception.filter";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import { NoopProviderIdentityAdapter } from "@shared/adapters/outbound/auth/noop-provider-identity.adapter";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { createMikroOrmOptions } from "@shared/adapters/outbound/persistence/mikro-orm.config";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { CLOCK_PORT } from "@shared/application/ports/outbound/clock.port";
import { ID_GENERATOR_PORT } from "@shared/application/ports/outbound/id-generator.port";
import { PROVIDER_IDENTITY_PORT } from "@shared/application/ports/outbound/provider-identity.port";
import { UNIT_OF_WORK_PORT } from "@shared/application/ports/outbound/unit-of-work.port";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadEnvironmentConfig],
    }),
    MikroOrmModule.forRootAsync({
      useFactory: () => createMikroOrmOptions(loadEnvironmentConfig()),
    }),
  ],
  providers: [
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: NoopProviderIdentityAdapter,
    },
    {
      provide: CLOCK_PORT,
      useClass: SystemClockAdapter,
    },
    {
      provide: ID_GENERATOR_PORT,
      useClass: UuidV7GeneratorAdapter,
    },
    {
      provide: UNIT_OF_WORK_PORT,
      useClass: MikroOrmUnitOfWorkAdapter,
    },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
    NoopAuthGuard,
  ],
  exports: [
    PROVIDER_IDENTITY_PORT,
    CLOCK_PORT,
    ID_GENERATOR_PORT,
    UNIT_OF_WORK_PORT,
    NoopAuthGuard,
  ],
})
export class SharedModule {}
