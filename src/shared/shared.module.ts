import { MikroORM } from "@mikro-orm/core";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { Global, Module, type OnModuleInit } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { DomainExceptionFilter } from "@shared/adapters/inbound/http/filters/domain-exception.filter";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import { CorrelationInterceptor } from "@shared/adapters/inbound/http/interceptors/correlation.interceptor";
import { NoopProviderIdentityAdapter } from "@shared/adapters/outbound/auth/noop-provider-identity.adapter";
import { loadEnvironmentConfig } from "@shared/adapters/outbound/config/env.config";
import { AsyncLocalCorrelationContextAdapter } from "@shared/adapters/outbound/observability/async-local-correlation-context.adapter";
import { InMemoryMetricsAdapter } from "@shared/adapters/outbound/observability/in-memory-metrics.adapter";
import { JsonStructuredLoggerAdapter } from "@shared/adapters/outbound/observability/json-structured-logger.adapter";
import { createMikroOrmOptions } from "@shared/adapters/outbound/persistence/mikro-orm.config";
import { MikroOrmUnitOfWorkAdapter } from "@shared/adapters/outbound/persistence/mikro-orm-unit-of-work.adapter";
import {
  createSqsClient,
  ensureSqsQueuesProvisioned,
  SQS_CLIENT,
} from "@shared/adapters/outbound/sqs/sqs-client.factory";
import { SystemClockAdapter } from "@shared/adapters/outbound/system/system-clock.adapter";
import { UuidV7GeneratorAdapter } from "@shared/adapters/outbound/system/uuid-v7-generator.adapter";
import { CLOCK_PORT } from "@shared/application/ports/outbound/clock.port";
import { CORRELATION_CONTEXT_PORT } from "@shared/application/ports/outbound/correlation-context.port";
import { ID_GENERATOR_PORT } from "@shared/application/ports/outbound/id-generator.port";
import { METRICS_PORT } from "@shared/application/ports/outbound/metrics.port";
import { PROVIDER_IDENTITY_PORT } from "@shared/application/ports/outbound/provider-identity.port";
import { STRUCTURED_LOGGER_PORT } from "@shared/application/ports/outbound/structured-logger.port";
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
      provide: CORRELATION_CONTEXT_PORT,
      useClass: AsyncLocalCorrelationContextAdapter,
    },
    {
      provide: STRUCTURED_LOGGER_PORT,
      useClass: JsonStructuredLoggerAdapter,
    },
    {
      provide: METRICS_PORT,
      useClass: InMemoryMetricsAdapter,
    },
    {
      provide: SQS_CLIENT,
      useFactory: () => createSqsClient(loadEnvironmentConfig()),
    },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationInterceptor,
    },
    NoopAuthGuard,
  ],
  exports: [
    PROVIDER_IDENTITY_PORT,
    CLOCK_PORT,
    ID_GENERATOR_PORT,
    UNIT_OF_WORK_PORT,
    CORRELATION_CONTEXT_PORT,
    STRUCTURED_LOGGER_PORT,
    METRICS_PORT,
    SQS_CLIENT,
    NoopAuthGuard,
  ],
})
export class SharedModule implements OnModuleInit {
  constructor(private readonly mikroOrm: MikroORM) {}

  async onModuleInit(): Promise<void> {
    if (process.env.AUTO_RUN_MIGRATIONS === "false" || process.env.NODE_ENV === "test") {
      return;
    }
    await this.mikroOrm.getMigrator().up();
    try {
      await ensureSqsQueuesProvisioned();
    } catch {
      // Readiness probe reports degraded if SQS is temporarily unavailable at startup
    }
  }
}
