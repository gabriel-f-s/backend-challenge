# Etapa 6 — Mensageria (SQS Consumer, Outbox Publisher e Pending Reference Worker)

## Objetivo

Implementar os adaptadores de processamento assíncrono em background com segurança para múltiplas instâncias concorrentes e recuperação após falhas (Seções 7.1, 10 e 11 do `README.md`).

## Escopo Previsto

1. **SQS Consumer (`wager-transactions.fifo`):**
   - Deduplicação via `InboxMessage` (`consumerName`, `messageId`) na mesma transação SQL do `ProcessWagerTransactionUseCase`.
   - `DeleteMessage` (`ack`) executado estritamente **após** o commit do banco.
   - Tratamento distinto para erros de negócio (terminal -> `ack`), transitórios (visibility timeout / backoff) e permanentes (DLQ `wager-transactions-dlq.fifo`).
   - Graceful shutdown em `SIGTERM`: encerra o loop de polling, aguarda mensagens em voo ou libera visibilidade (`ChangeMessageVisibility(0)`).
2. **Transactional Outbox Publisher Worker:**
   - Seleciona lotes pendentes vencidos usando `SELECT ... FOR UPDATE SKIP LOCKED` para permitir múltiplos publishers concorrentes sem contenção.
   - Publica o envelope `IntegrationEvent.toJSON()`, marca `publishedAt` ou agenda retry com backoff exponencial (`scheduleRetry`).
3. **Pending Reference Retry Worker:**
   - Reprocessa transações em `PENDING_REFERENCE` com backoff exponencial até o limite máximo de tentativas/TTL; ao esgotar, transiciona para `REJECTED` com `failureCode` específico (`REFERENCE_NOT_FOUND_TIMEOUT`) e enfileira `WagerTransactionRejected` na Outbox.
