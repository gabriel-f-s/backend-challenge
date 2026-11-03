# Etapa 9 — Documentação Final (`ARCHITECTURE.md` e `README.md`)

## Objetivo

Elaborar a documentação técnica exigida na Seção 14 do `README.md`.

## Escopo Previsto

1. **`ARCHITECTURE.md`:**
   - Justificativa da escolha do **MikroORM**, mapeamento do `Money` e separação via `EntitySchema` + Mappers.
   - Estratégia transacional e justificativa do **Pessimistic Locking (`SELECT ... FOR UPDATE`) combinado com incremento da coluna `version`**.
   - Desenho do schema SQL, constraints e triggers de imutabilidade.
   - Algoritmo de `payloadHash` canônico e garantia de idempotência.
   - Fluxo de Inbox, Outbox (`SKIP LOCKED`), `PENDING_REFERENCE` (backoff e TTL) e taxonomia de `FailureCode` + Status HTTP.
   - Desenho de Autenticação via Identity Provider externo (OIDC) e explicação do ponto de extensão (`ProviderIdentityPort` / `NoopAuthGuard`).
   - Trade-offs e limitações conhecidas.
2. **Atualização do `README.md` (ou seção de Setup & Execução):**
   - Comandos claros para subir a infraestrutura, rodar migrations, iniciar a aplicação e executar as suítes de testes (`unit`, `integration`, `concurrency`).
