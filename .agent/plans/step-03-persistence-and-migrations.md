# Etapa 3 — Módulo `Messaging` (Domain → Application → Adapters → Tests)

## Objetivo
Implementar de ponta a ponta o módulo de Mensageria Transacional (`Inbox` e `Outbox`), garantindo deduplicação persistente de mensagens de entrada e publicação assíncrona segura por múltiplos workers concorrentes.

## Escopo Vertical
1. **Domain (`src/modules/messaging/domain/`):**
   - `InboxMessage`: `receive`, `rehydrate`, `isProcessed`, `markProcessed`.
   - `OutboxMessage`: `enqueue`, `rehydrate`, `isPending`, `isDue`, `markPublished`, `scheduleRetry` (backoff exponencial).
2. **Application (`src/modules/messaging/application/`):**
   - Ports: `InboxRepositoryPort`, `OutboxRepositoryPort` (`claimPendingBatch` com lock `SKIP LOCKED`), `EventPublisherPort`.
   - Use Case: `PublishPendingOutboxUseCase`.
3. **Adapters (`src/modules/messaging/adapters/`):**
   - Outbound Persistence: `InboxMessageSchema`, `OutboxMessageSchema`, Mappers, `MikroOrmInboxRepository`, `MikroOrmOutboxRepository` e Migration SQL de `inbox_messages` e `outbox_messages`.
   - Outbound SQS: `SqsEventPublisherAdapter`.
   - Inbound Worker: `OutboxPublisherWorker`.
4. **Tests (`test/unit/messaging/`):**
   - Testes unitários das entidades `InboxMessage`, `OutboxMessage` e do caso de uso `PublishPendingOutboxUseCase`.
