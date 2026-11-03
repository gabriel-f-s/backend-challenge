# Roadmap de Implementação — Distributed Wagering Processor

Visão geral das 9 etapas planejadas para o desafio técnico. Cada etapa possui seu arquivo próprio neste diretório e é executada uma por vez, com validação de build/testes e revisão antes do commit.

| Etapa | Arquivo | Escopo Principal | Status |
|---|---|---|---|
| **Etapa 1** | [step-01-setup-and-infra.md](./step-01-setup-and-infra.md) | Setup Bun + NestJS Strict, estrutura Clean Arch + Ports & Adapters e Docker Compose (PostgreSQL + MiniStack SQS FIFO/DLQ) | Concluída |
| **Etapa 2** | [step-02-domain-and-unit-tests.md](./step-02-domain-and-unit-tests.md) | Modelo de Domínio completo (`Money`, `Wallet`, `WagerTransaction`, `WalletLedgerEntry`, `InboxMessage`, `OutboxMessage`, `IntegrationEvent`, `FailureCode`) + Testes Unitários | Pendente |
| **Etapa 3** | [step-03-persistence-and-migrations.md](./step-03-persistence-and-migrations.md) | Persistência MikroORM (`EntitySchema`, Mappers, Unit of Work), Migrations versionadas/reversíveis, Constraints SQL/Triggers e Repositórios | Pendente |
| **Etapa 4** | [step-04-use-cases-and-concurrency.md](./step-04-use-cases-and-concurrency.md) | Casos de Uso (`OpenWallet`, `ProcessWagerTransaction`, `ReconcileWallet`, Queries), Idempotência Canônica e Pessimistic Locking por `walletId` | Pendente |
| **Etapa 5** | [step-05-http-layer-and-health.md](./step-05-http-layer-and-health.md) | Adaptadores Inbound HTTP (Controllers, DTOs, Exception Filter com mapeamento determinístico de Status HTTP, Cursor Pagination e Health Checks) | Pendente |
| **Etapa 6** | [step-06-messaging-and-workers.md](./step-06-messaging-and-workers.md) | Adaptadores de Mensageria: SQS Consumer (Inbox + Graceful Shutdown `SIGTERM`), Outbox Publisher Worker (`SKIP LOCKED`) e Pending Reference Worker | Pendente |
| **Etapa 7** | [step-07-observability.md](./step-07-observability.md) | Logs estruturados JSON (`correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`) e Métricas obrigatórias | Pendente |
| **Etapa 8** | [step-08-integration-and-concurrency-tests.md](./step-08-integration-and-concurrency-tests.md) | Testes reais de Integração e Concorrência (PostgreSQL + MiniStack) cobrindo os 8 cenários obrigatórios de race condition e falhas | Pendente |
| **Etapa 9** | [step-09-documentation.md](./step-09-documentation.md) | Elaboração do `ARCHITECTURE.md` (decisões, trade-offs, garantias) e instruções finais de execução no `README.md` | Pendente |

