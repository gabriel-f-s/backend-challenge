# Etapa 8 — Testes de Integração e Concorrência Real

## Objetivo

Implementar e validar a suíte de testes de integração e concorrência usando containers reais de **PostgreSQL** e **MiniStack SQS** (Seção 13 do `README.md`).

## Escopo Previsto

1. **Testes de Integração (`test/integration/`):**
   - Validação de migrations e constraints SQL (saldo negativo bloqueado no banco, imutabilidade do ledger bloqueando `UPDATE`/`DELETE`, unicidade de wallet e idempotência).
   - Atomicidade transacional (rollback completo de wallet, ledger, inbox e outbox em caso de falha).
   - Redelivery de mensagens SQS via Inbox e fluxo de retry/DLQ.
2. **Testes de Concorrência (`test/concurrency/`):**
   - Cenário 1: Mesma aposta enviada **50 vezes em paralelo** -> exatamente 1 débito.
   - Cenário 2: Saldo `100.00 BRL` com 2 apostas simultâneas de `80.00 BRL` -> 1 `PROCESSED`, 1 `REJECTED`, saldo `20.00 BRL`, 1 entrada no ledger.
   - Cenário 3: Wallets distintas processadas em paralelo sem bloqueio mútuo.
   - Cenário 4: **>= 3 instâncias** simultâneas da aplicação processando operações concorrentes.
   - Cenário 5: Worker interrompido após commit e antes do ack (redelivery seguro).
   - Cenário 6: Dois publishers concorrentes sobre a mesma Outbox.
   - Cenário 7: `ROLLBACK` / `REFUND` entregue antes da `BET` referenciada (`PENDING_REFERENCE` -> `PROCESSED`).
   - Cenário 8: Reinício do serviço comprovando consistência final (`wallet.balance == saldo reconstruído pelo ledger`).
