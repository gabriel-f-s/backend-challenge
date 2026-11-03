# Etapa 4 — Casos de Uso Financeiros, Idempotência e Concorrência

## Objetivo

Implementar a camada `application/` com os casos de uso financeiros e de consulta, garantindo atomicidade transacional (Inbox + WagerTransaction + Wallet + Ledger + Outbox), idempotência persistente (`Idempotency-Key` + `payloadHash` canônico) e controle de concorrência por `walletId` via Pessimistic Locking + incremento de `version`.

## Escopo Previsto

1. **`OpenWalletUseCase`:**
   - Cria a `Wallet` e, caso `initialBalance > 0`, registra na mesma transação SQL uma `WagerTransaction` interna `OPENING`, um `WalletLedgerEntry` (`CREDIT`) e o evento `WalletBalanceChanged` na Outbox.
2. **`ProcessWagerTransactionUseCase` (reutilizado por HTTP e SQS):**
   - Verifica e resolve idempotência (`idempotentReplay: true` com o saldo observado originalmente, ou erro de conflito se `payloadHash` divergir).
   - Adquire lock pessimista (`SELECT ... FOR UPDATE`) sobre a `Wallet`.
   - Aplica regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK` (incluindo transição para `PENDING_REFERENCE` quando a referência ainda não chegou).
   - Persiste `WagerTransaction`, `Wallet`, `WalletLedgerEntry` (quando aplicável) e `OutboxMessage` atomicamente.
3. **`ReconcileWalletUseCase`:**
   - Recalcula o saldo a partir de todas as entradas do ledger da wallet, compara com `storedBalance`, loga e contabiliza métrica caso haja divergência sem sobrescrever silenciosamente.
4. **Casos de Uso de Consulta:**
   - `GetWalletUseCase`, `ListWalletLedgerUseCase` (com cursor opaco estável), `GetWagerTransactionUseCase` (por ID interno e por `providerId + externalTransactionId`).
