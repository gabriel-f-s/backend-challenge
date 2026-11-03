# Etapa 3 — Persistência, Schema SQL, Migrations e Adaptadores Outbound

## Objetivo

Implementar a camada de persistência com **MikroORM** e **PostgreSQL**, mantendo o domínio desacoplado via `EntitySchema` + Mappers (`toDomain` com `rehydrate` / `toPersistence`) e aplicando todas as invariantes no banco de dados (Seção 5, item 9).

## Escopo Previsto

1. **Schemas e Mappers MikroORM (`adapters/outbound/persistence/`):**
   - `WalletSchema`, `WalletLedgerEntrySchema`, `WagerTransactionSchema`, `InboxMessageSchema`, `OutboxMessageSchema`.
2. **Migrations Versionadas e Reversíveis (`up` / `down`):**
   - `UNIQUE (player_id, currency)` em `wallets` e `CHECK (balance_amount >= 0)` + `CHECK (version >= 1)`.
   - `UNIQUE (idempotency_key)` e `UNIQUE (provider_id, external_transaction_id)` em `wager_transactions`.
   - Índice único parcial em `wager_transactions` para impedir que uma mesma referência seja revertida duas vezes pelo mesmo `kind` (`REFUND` ou `ROLLBACK`) quando `status = 'PROCESSED'`.
   - `UNIQUE (wallet_id, transaction_id)` em `wallet_ledger_entries`, constraints aritméticas e trigger SQL no PostgreSQL impedindo `UPDATE` ou `DELETE` em `wallet_ledger_entries` (imutabilidade no banco).
   - `PRIMARY KEY (consumer_name, message_id)` em `inbox_messages`.
   - Índices otimizados para polling de `outbox_messages` (`published_at IS NULL, next_attempt_at`) e de `wager_transactions` em `PENDING_REFERENCE`.
3. **Repositórios e Unit of Work:**
   - Implementação de `UnitOfWorkPort` usando `EntityManager.transactional()`.
   - Suporte a `LockMode.PESSIMISTIC_WRITE` (`SELECT ... FOR UPDATE`) ao carregar `Wallet` para movimentação financeira.
