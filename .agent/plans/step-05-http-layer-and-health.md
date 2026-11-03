# Etapa 5 — Camada HTTP (Controllers, Validação, Status Codes e Health Checks)

## Objetivo

Implementar os adaptadores inbound HTTP REST conforme a Seção 9 do `README.md`, garantindo distinção clara e consistente de códigos HTTP e paginação por cursor opaco.

## Escopo Previsto

1. **Endpoints de Wallet (`POST /wallets`, `GET /wallets/:walletId`, `GET /wallets/:walletId/ledger`, `POST /wallets/:walletId/reconciliation`).**
2. **Endpoints de Wagering (`POST /wagering/transactions`, `GET /wagering/transactions/:transactionId`, `GET /providers/:providerId/wagering/transactions/:externalTransactionId`).**
3. **Endpoints de Health Check abertos (`GET /health/live` e `GET /health/ready` verificando PostgreSQL e MiniStack SQS).**
4. **Global Domain Exception Filter:**
   - Mapeamento consistente distinguindo: Payload inválido (`400`), Recurso não encontrado (`404`), Conflito de Idempotência / Duplicidade de Wallet (`409`), Rejeição por Regra de Negócio com `failureCode` (`422`), Aceite com Processamento Pendente `PENDING_REFERENCE` (`202`) e Falha Transitória de Infraestrutura (`503`).
