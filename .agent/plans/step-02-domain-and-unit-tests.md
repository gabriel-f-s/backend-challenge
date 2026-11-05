# Etapa 2 — Módulo `Shared` (Domain → Application → Adapters → Tests)

## Objetivo
Implementar de ponta a ponta o módulo transversal `Shared`, fornecendo as primitivas financeiras (`Money`), contrato de eventos (`IntegrationEvent<T>`), taxonomia de erros (`DomainError` / `FailureCode`), hash canônico de idempotência (`CanonicalPayloadHash`), portas base (`UnitOfWorkPort`, `ClockPort`, `IdGeneratorPort`), adaptadores de sistema/persistência (`MikroOrmUnitOfWork`, `SystemClockAdapter`, `UuidV7GeneratorAdapter`) e o filtro global de exceções HTTP (`DomainExceptionFilter`).

## Entregáveis da Etapa 2
1. **Domain (`src/shared/domain/`):**
   - `value-objects/money.vo.ts`: `Money` e `MoneyProps` baseados em `Decimal` (escala fixa de 2 casas, imutável, validações rigorosas de formato e moeda).
   - `errors/failure-code.enum.ts` & `errors/domain.error.ts`: `FailureCode` e classes semânticas (`DomainValidationError`, `ResourceNotFoundError`, `ConflictError`, `IdempotencyConflictError`, `BusinessRuleViolationError`, `InvalidTransactionStateError`, `TransientInfrastructureError`).
   - `events/integration-event.base.ts`: `IntegrationEvent<T>`, `IntegrationEventProps<T>`, `EventContext`.
   - `services/canonical-payload-hash.service.ts`: serialização JSON canônica recursiva e hash `SHA-256`.
2. **Application Ports (`src/shared/application/ports/outbound/`):**
   - `unit-of-work.port.ts` (`UNIT_OF_WORK_PORT`, `UnitOfWorkPort`).
   - `clock.port.ts` (`CLOCK_PORT`, `ClockPort`).
   - `id-generator.port.ts` (`ID_GENERATOR_PORT`, `IdGeneratorPort`).
3. **Adapters (`src/shared/adapters/`):**
   - `outbound/system/system-clock.adapter.ts` & `uuid-v7-generator.adapter.ts`.
   - `outbound/persistence/mikro-orm.config.ts` & `mikro-orm-unit-of-work.adapter.ts`.
   - `inbound/http/filters/domain-exception.filter.ts`.
4. **Testes Unitários (`test/unit/shared/`):**
   - `money.vo.spec.ts`
   - `canonical-payload-hash.service.spec.ts`
   - `integration-event.spec.ts`
   - `domain-exception.filter.spec.ts`
   - `system-adapters.spec.ts`
