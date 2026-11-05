import { HealthController } from "@modules/health/adapters/inbound/http/health.controller";
import { CheckReadinessUseCase } from "@modules/health/application/use-cases/check-readiness.use-case";
import { Module } from "@nestjs/common";

@Module({
  controllers: [HealthController],
  providers: [CheckReadinessUseCase],
  exports: [CheckReadinessUseCase],
})
export class HealthModule {}
