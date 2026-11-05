import { FailureCode } from "./failure-code.enum";

export abstract class DomainError extends Error {
  abstract readonly errorCode: string;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class DomainValidationError extends DomainError {
  readonly errorCode: string;

  constructor(message: string, errorCode = "DOMAIN_VALIDATION_ERROR") {
    super(message);
    this.errorCode = errorCode;
  }
}

export class ResourceNotFoundError extends DomainError {
  readonly errorCode: string;

  constructor(message: string, errorCode = "RESOURCE_NOT_FOUND") {
    super(message);
    this.errorCode = errorCode;
  }
}

export class ConflictError extends DomainError {
  readonly errorCode: string;

  constructor(message: string, errorCode = "RESOURCE_CONFLICT") {
    super(message);
    this.errorCode = errorCode;
  }
}

export class IdempotencyConflictError extends ConflictError {
  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" was already used with a different request payload`,
      "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT",
    );
  }
}

export class BusinessRuleViolationError extends DomainError {
  readonly errorCode: FailureCode;
  readonly failureCode: FailureCode;

  constructor(failureCode: FailureCode, message: string) {
    super(message);
    this.failureCode = failureCode;
    this.errorCode = failureCode;
  }
}

export class CurrencyMismatchError extends BusinessRuleViolationError {
  constructor(expectedCurrency: string, actualCurrency: string) {
    super(
      FailureCode.CurrencyMismatch,
      `Currency mismatch: expected "${expectedCurrency}", received "${actualCurrency}"`,
    );
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly errorCode = "INVALID_TRANSACTION_STATE_TRANSITION";

  constructor(currentStatus: string, targetAction: string) {
    super(`Cannot execute "${targetAction}" from terminal or invalid status "${currentStatus}"`);
  }
}

export class TransientInfrastructureError extends DomainError {
  readonly errorCode = "TRANSIENT_INFRASTRUCTURE_ERROR";

  constructor(message: string) {
    super(message);
  }
}

