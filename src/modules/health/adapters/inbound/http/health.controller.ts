import {
  CheckReadinessUseCase,
  type ReadinessCheckOutput,
} from "@modules/health/application/use-cases/check-readiness.use-case";
import { Controller, Get, HttpStatus, Inject, Res } from "@nestjs/common";
import {
  METRICS_PORT,
  type MetricsPort,
  type MetricsSnapshot,
} from "@shared/application/ports/outbound/metrics.port";
import type { Response } from "express";

export interface LivenessCheckOutput {
  readonly status: "ok";
  readonly timestamp: string;
}

@Controller()
export class HealthController {
  constructor(
    private readonly checkReadinessUseCase: CheckReadinessUseCase,
    @Inject(METRICS_PORT)
    private readonly metrics: MetricsPort,
  ) {}

  @Get("health/live")
  checkLiveness(): LivenessCheckOutput {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("health/ready")
  async checkReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessCheckOutput> {
    const readiness = await this.checkReadinessUseCase.execute();
    if (readiness.status === "ok") {
      response.status(HttpStatus.OK);
    } else {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return readiness;
  }

  @Get("metrics")
  getMetrics(): MetricsSnapshot {
    return this.metrics.getSnapshot();
  }
}

