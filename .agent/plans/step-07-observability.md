# Etapa 7 — Observabilidade (Logs Estruturados e Métricas)

## Objetivo
Implementar observabilidade completa conforme a Seção 12 do `README.md`.

## Escopo Previsto
1. **Logs Estruturados (JSON):**
   - Contexto automático via `AsyncLocalStorage` propagando `correlationId`, `messageId`, `transactionId`, `walletId` e `providerId`.
   - Omissão garantida de dados sensíveis e payloads financeiros brutos.
2. **Métricas (`GET /metrics` / serviço de métricas):**
   - Contadores e histogramas para: transações por status/kind, duplicatas detectadas (replay idempotente e inbox dedup), retries (outbox e pending reference), mensagens enviadas para DLQ, conflitos/espera de lock, outbox lag e latência de processamento.

