---
trigger: always_on
description: Regras permanentes de arquitetura, código, fluxo de trabalho e commits do projeto Distributed Wagering Processor.
---

# Regras do Projeto — Distributed Wagering Processor

## 1. Arquitetura (Clean Architecture + Ports & Adapters + DDD)

- **Mesclagem de Clean Architecture + Hexagonal (Ports & Adapters) + DDD:**
  - `domain/`: Entidades, Aggregate Roots, Value Objects, Domain/Integration Events, Enums e Domain Errors. **100% TypeScript puro**, sem dependência de NestJS, MikroORM ou bibliotecas de infraestrutura.
  - `application/`: Casos de Uso (`use-cases/`), DTOs de aplicação e **Ports** (`ports/inbound/` e `ports/outbound/`).
  - `adapters/`:
    - `inbound/`: Adaptadores primários/driving (Controllers HTTP REST, Consumidores SQS, Scheduled Workers).
    - `outbound/`: Adaptadores secundários/driven (Repositórios MikroORM, `EntitySchema`, Mappers, Publishers SQS).
- **Modelagem de Domínio Estrita:**
  - Construtores `private` ou `protected` em todas as entidades e Value Objects.
  - Criação via factories estáticas (`create`, `from`, `open`) e reconstrução do banco exclusivamente via `rehydrate` (sem revalidar regras de transição).
  - Nunca usar `number`, `float` ou `double` para valores monetários. Sempre utilizar `Money` (baseado em `Decimal` com escala fixa de 2 casas decimais).

## 2. Stack e Decisões Técnicas Inegociáveis

- **Runtime / Package Manager / Test Runner:** Bun 1.x.
- **Linguagem:** TypeScript em modo estrito (`strict: true`).
- **Framework:** NestJS.
- **Banco de Dados e ORM:** PostgreSQL 16 + **MikroORM** (usando `EntitySchema` e Mappers explícitos para não acoplar o domínio).
- **Controle de Concorrência:** **Pessimistic Locking** (`SELECT ... FOR UPDATE` por `walletId`) combinado com incremento da coluna `version` somente quando o saldo muda.
- **Mensageria Local:** AWS SQS via **MiniStack** no Docker Compose (`wager-transactions.fifo` e `wager-transactions-dlq.fifo`).
- **Autenticação:** Foco 100% nos critérios pontuados da avaliação, mantendo ponto de extensão explícito (`ProviderIdentityPort` e `NoopAuthGuard`) desacoplado para futura integração OIDC.

## 3. Qualidade de Código e Política de Comentários

- **Zero Comentários Desnecessários:** Evite comentários no código da aplicação. O código deve ser autoexplicativo por meio de nomes claros de classes, métodos e variáveis.
- **KISS, DRY e SOLID:** Soluções diretas, sem superengenharia, com responsabilidade única e alta coesão.

## 4. Fluxo de Execução e Validação

- **Uma Etapa por Vez:** Seguir rigorosamente o plano das 9 etapas em `.agent/plans/`. Antes de iniciar uma nova etapa, detalhar/revisar seu plano (`/plan`) e aguardar aprovação.
- **Validação Obrigatória Pós-Edição:** Sempre executar build/typecheck (`bun run build` / `bun run typecheck`) e testes (`bun test`) ao concluir qualquer bloco de código.

## 5. Política de Commits

- **Somente Após Revisão:** **NUNCA** executar `git commit` automaticamente. Os commits só devem ser realizados após revisão e autorização explícita do desenvolvedor.
- **Padrão Atômico em Inglês:** Formato Conventional Commits `action(feature): message` (ex.: `chore(setup): ...`, `feat(wallet): ...`, `build(infra): ...`, `test(wagering): ...`).
