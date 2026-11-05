# Etapa 6 — Módulo `Wagering` Assíncrono (SQS Consumer & Pending Reference Worker)

## Objetivo
Implementar os adaptadores assíncronos do módulo `Wagering` para consumo da fila SQS FIFO (`wager-transactions.fifo`) e reprocessamento agendado de transações `PENDING_REFERENCE`.

## Escopo Vertical
1. **SQS Consumer (`src/modules/wagering/adapters/inbound/messaging/wager-transaction-sqs.consumer.ts`):**
   - Deduplicação via `InboxMessage` (`consumerName`, `messageId`) na mesma transação SQL do `ProcessWagerTransactionUseCase`.
   - `DeleteMessage` (`ack`) somente após o commit.
   - Tratamento distinto para erros de negócio (terminal -> `ack`), transitórios (retry com visibility/backoff) e permanentes (DLQ `wager-transactions-dlq.fifo`).
   - Graceful shutdown em `SIGTERM` (conclui mensagens em andamento ou libera visibilidade).
2. **Pending Reference Worker (`src/modules/wagering/adapters/inbound/workers/pending-reference.worker.ts`):**
   - Reprocessa periodicamente transações `PENDING_REFERENCE` com backoff exponencial; ao esgotar o limite/TTL, rejeita com `REFERENCE_NOT_FOUND_TIMEOUT` e enfileira `WagerTransactionRejected` na Outbox.
3. **Tests (`test/unit/wagering/`):**
   - Testes unitários do consumidor SQS, deduplicação Inbox, graceful shutdown e worker de referências pendentes.
