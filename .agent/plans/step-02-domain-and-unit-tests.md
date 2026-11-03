# Etapa 2 — Modelo de Domínio & Testes Unitários

## Objetivo

Implementar o núcleo de domínio 100% em TypeScript puro (sem dependências de NestJS ou MikroORM), com construtores privados, factories estáticas (`create`, `from`, `open`, `receive`, `enqueue`) e reidratação (`rehydrate`), acompanhado de bateria exaustiva de testes unitários.

## Escopo Previsto

1. **Shared Domain:**
   - `Money` (`decimal.js`, escala fixa de 2 casas, imutável, validação rigorosa contra `NaN`, `Infinity`, notação científica, mais de 2 casas decimais e conflito de moedas).
   - `IntegrationEvent<T>` (classe abstrata base) e subclasses concretas: `WagerTransactionProcessed`, `WagerTransactionRejected`, `WalletBalanceChanged`, `WagerTransactionPendingReference`.
   - `DomainError`, `FailureCode` (taxonomia determinística distinguindo saldo insuficiente em aposta, saldo insuficiente em reversão, referência inválida/duplicada, conflito de moeda, etc.) e `CanonicalPayloadHash`.
2. **Wallet Domain:**
   - `Wallet` (Aggregate Root): `open`, `rehydrate`, `debit`, `credit`, controle de `version` (inicia em 1, incrementa apenas quando o saldo muda) e invariante de saldo não-negativo.
   - `WalletLedgerEntry` (imutável): `create`, `rehydrate`, `isBalanced()`.
3. **Wagering Domain:**
   - `WagerTransaction`: `create`, `rehydrate`, máquina de estados estrita (`PENDING`, `PENDING_REFERENCE`, `PROCESSED`, `REJECTED`, `FAILED`), regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`.
4. **Messaging Domain:**
   - `InboxMessage` (`receive`, `rehydrate`, `markProcessed`) e `OutboxMessage` (`enqueue`, `rehydrate`, `markPublished`, `scheduleRetry` com backoff exponencial).
5. **Testes Unitários (`test/unit/`):**
   - Cobertura completa de todas as invariantes exigidas na Seção 13 do `README.md`.
