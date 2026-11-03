# Etapa 1 — Setup Base, Arquitetura (Clean Arch + Ports & Adapters) e Infraestrutura Local

## Objetivo

Inicializar o projeto Bun 1.x + TypeScript (`strict: true`) + NestJS, estabelecer a organização modular combinando **Clean Architecture + Ports & Adapters (Hexagonal) + DDD**, configurar o ponto de extensão de autenticação (`ProviderIdentityPort` / `NoopAuthGuard`) e subir o ambiente local via Docker Compose com **PostgreSQL 16** e **MiniStack** (com provisionamento automático das filas `wager-transactions.fifo` e `wager-transactions-dlq.fifo`).

## Estrutura de Camadas (Clean Arch + Ports & Adapters)

```text
src/
├── shared/
│   ├── domain/
│   ├── application/
│   │   └── ports/
│   │       ├── inbound/
│   │       └── outbound/
│   └── adapters/
│       ├── inbound/
│       └── outbound/
├── modules/
│   ├── wallet/
│   │   ├── domain/
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   └── use-cases/
│   │   └── adapters/
│   │       ├── inbound/
│   │       └── outbound/
│   ├── wagering/
│   │   ├── domain/
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   └── use-cases/
│   │   └── adapters/
│   │       ├── inbound/
│   │       └── outbound/
│   ├── messaging/
│   │   ├── domain/
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   └── use-cases/
│   │   └── adapters/
│   │       ├── inbound/
│   │       └── outbound/
│   └── health/
│       └── adapters/
│           └── inbound/
├── app.module.ts
└── main.ts
```

## Entregáveis da Etapa 1

1. Governança em `.agent/rules/` e `.agent/plans/`.
2. `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.gitignore` e `.env.example`.
3. Configuração de variáveis de ambiente tipadas (`src/shared/adapters/outbound/config/env.config.ts`).
4. Porta e Guard de autenticação extensível (`src/shared/application/ports/outbound/provider-identity.port.ts` e `src/shared/adapters/inbound/http/guards/noop-auth.guard.ts`).
5. Bootstrap NestJS com `enableShutdownHooks()` em `src/main.ts` e `src/app.module.ts`.
6. `docker-compose.yml` com PostgreSQL 16 + MiniStack + `infra/ministack/init-sqs.sh` criando `wager-transactions.fifo` e `wager-transactions-dlq.fifo`.
7. Teste inicial de validação da configuração de ambiente (`test/unit/env.config.spec.ts`).

## Critérios de Aceite / Validação

- `bun install` concluído sem erros.
- `bun run typecheck` e `bun run build` executando sem erros.
- `bun test` passando.
- `docker compose up -d` subindo PostgreSQL e MiniStack saudáveis com as duas filas FIFO criadas.
