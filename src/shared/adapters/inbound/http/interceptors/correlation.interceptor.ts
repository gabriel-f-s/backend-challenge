import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import {
  CORRELATION_CONTEXT_PORT,
  type CorrelationContextPort,
} from "@shared/application/ports/outbound/correlation-context.port";
import {
  ID_GENERATOR_PORT,
  type IdGeneratorPort,
} from "@shared/application/ports/outbound/id-generator.port";
import { METRICS_PORT, type MetricsPort } from "@shared/application/ports/outbound/metrics.port";
import type { Request, Response } from "express";
import { finalize, type Observable } from "rxjs";

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  constructor(
    @Inject(CORRELATION_CONTEXT_PORT)
    private readonly correlationContext: CorrelationContextPort,
    @Inject(ID_GENERATOR_PORT)
    private readonly idGenerator: IdGeneratorPort,
    @Inject(METRICS_PORT)
    private readonly metrics: MetricsPort,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const rawCorrelationId = request.headers?.["x-correlation-id"];
    const correlationId =
      typeof rawCorrelationId === "string" && rawCorrelationId.trim() !== ""
        ? rawCorrelationId.trim()
        : this.idGenerator.generate();

    if (typeof response?.setHeader === "function") {
      response.setHeader("x-correlation-id", correlationId);
    }

    const bodyRecord =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : undefined;

    const paramWalletId =
      typeof request.params?.walletId === "string" ? request.params.walletId : undefined;
    const paramProviderId =
      typeof request.params?.providerId === "string" ? request.params.providerId : undefined;
    const transactionId =
      typeof request.params?.transactionId === "string" ? request.params.transactionId : undefined;

    const walletId =
      paramWalletId ??
      (typeof bodyRecord?.walletId === "string" ? bodyRecord.walletId : undefined);
    const providerId =
      paramProviderId ??
      (typeof bodyRecord?.providerId === "string" ? bodyRecord.providerId : undefined);

    const startedAt = performance.now();

    return this.correlationContext.run(
      {
        correlationId,
        walletId,
        providerId,
        transactionId,
      },
      () =>
        next.handle().pipe(
          finalize(() => {
            const durationMs = performance.now() - startedAt;
            this.metrics.observeProcessingLatencyMs("http_request", durationMs);
          }),
        ),
    );
  }
}
