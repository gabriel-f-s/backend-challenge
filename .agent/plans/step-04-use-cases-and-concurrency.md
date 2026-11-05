# Etapa 4 — Módulo `Wallet` & `Ledger` (Domain → Application → Adapters → Tests)

## Objetivo
Implementar de ponta a ponta o módulo de Carteiras (`Wallet`) e Razão Contábil (`WalletLedgerEntry`), garantindo imutabilidade do ledger, saldo nunca negativo, controle de concorrência por `walletId` (`SELECT ... FOR UPDATE` + incremento de `version`), paginação por cursor opaco e reconciliação.

## Escopo Vertical
1. **Domain (`src/modules/wallet/domain/`):**
   - `Wallet` (Aggregate Root): `open`, `rehydrate`, `debit`, `credit`, invariante de moeda única e saldo >= 0, `version` iniciando em 1 e incrementando exclusivamente quando o saldo muda.
   - `WalletLedgerEntry` (imutável): `create`, `rehydrate`, `isBalanced()`, `LedgerDirection`.
   - Evento de Integração: `WalletBalanceChanged`.
2. **Application (`src/modules/wallet/application/`):**
   - Ports: `WalletRepositoryPort` (incluindo `findByIdForUpdate`), `WalletLedgerRepositoryPort` (cursor opaco estável).
   - Use Cases: `OpenWalletUseCase` (gerando transação `OPENING` + `CREDIT` no ledger + `WalletBalanceChanged` na Outbox quando `initialBalance > 0`), `GetWalletUseCase`, `ListWalletLedgerUseCase`, `ReconcileWalletUseCase`.
3. **Adapters (`src/modules/wallet/adapters/`):**
   - Outbound Persistence: `WalletSchema`, `WalletLedgerEntrySchema`, Mappers, Repositórios MikroORM e Migration SQL (`UNIQUE(player_id, currency)`, `CHECK(balance_amount >= 0)`, `UNIQUE(wallet_id, transaction_id)` e trigger SQL bloqueando `UPDATE`/`DELETE` em `wallet_ledger_entries`).
   - Inbound HTTP: `WalletController` (`POST /wallets`, `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger`, `POST /wallets/:walletId/reconciliation`) e DTOs.
4. **Tests (`test/unit/wallet/`):**
   - Testes unitários de `Wallet`, `WalletLedgerEntry`, `OpenWalletUseCase`, `ReconcileWalletUseCase` e cursor pagination.
