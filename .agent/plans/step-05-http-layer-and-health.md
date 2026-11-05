# Etapa 5 — Módulo `Wagering` Core & HTTP (Domain → Application → Adapters → Tests)

## Objetivo
Implementar de ponta a ponta o núcleo do módulo `Wagering` e sua interface HTTP, cobrindo `WagerTransaction`, máquina de estados estrita, regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`, idempotência por `Idempotency-Key` + `payloadHash` e transações fora de ordem (`PENDING_REFERENCE`).

## Escopo Vertical
1. **Domain (`src/modules/wagering/domain/`):**
   - `WagerTransaction`: `create`, `rehydrate`, `markProcessed`, `markPendingReference`, `reject`, `fail`, `isTerminal`, `affectsBalance`, `requiresReference`, `matchesPayload`, `ledgerDirectionFor`.
   - Enums: `WagerTransactionKind`, `WagerTransactionStatus`.
   - Eventos de Integração: `WagerTransactionProcessed`, `WagerTransactionRejected`, `WagerTransactionPendingReference`.
2. **Application (`src/modules/wagering/application/`):**
   - Port: `WagerTransactionRepositoryPort`.
   - Use Cases: `ProcessWagerTransactionUseCase`, `GetWagerTransactionUseCase` (por ID interno e por `providerId + externalTransactionId`), `RetryPendingReferenceTransactionsUseCase`.
3. **Adapters (`src/modules/wagering/adapters/`):**
   - Outbound Persistence: `WagerTransactionSchema`, Mapper, Repositório MikroORM e Migration SQL (`UNIQUE(idempotency_key)`, `UNIQUE(provider_id, external_transaction_id)` e índice único parcial impedindo dupla reversão).
   - Inbound HTTP: `WageringController` (`POST /wagering/transactions`, `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId`) e DTOs.
4. **Tests (`test/unit/wagering/`):**
   - Testes unitários completos de `WagerTransaction`, regras de negócio (`BET`, `WIN`, `LOSS`, `REFUND`, `ROLLBACK`), idempotência, conflito de payload e `PENDING_REFERENCE`.
