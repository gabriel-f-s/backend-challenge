# Etapa 7 — Módulo `Health` & `Observability` (Domain/Ports → Adapters → Tests)

## Objetivo
Implementar de ponta a ponta os recursos de Observabilidade (Logs Estruturados e Métricas) e os Health Checks (`/health/live` e `/health/ready`) conforme as Seções 9 e 12 do `README.md`.

## Escopo Vertical
1. **Ports & Contexto (`src/shared/application/ports/outbound/`):**
   - `CorrelationContextPort` (`AsyncLocalStorage` propagando `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`).
   - `StructuredLoggerPort` (JSON sem dados sensíveis ou payloads financeiros brutos).
   - `MetricsPort` (contadores e histogramas para transações por status, duplicatas, retries, DLQ, conflitos de lock, outbox lag e latência).
2. **Adapters (`src/shared/adapters/` e `src/modules/health/`):**
   - `JsonStructuredLoggerAdapter`, `InMemoryMetricsAdapter`, `CorrelationInterceptor`.
   - `HealthController` (`GET /health/live` e `GET /health/ready` verificando conectividade real com PostgreSQL e MiniStack SQS, sem exigir autenticação) e `GET /metrics`.
3. **Tests (`test/unit/observability/`):**
   - Testes unitários do logger estruturado, coletor de métricas e endpoints de health check.
