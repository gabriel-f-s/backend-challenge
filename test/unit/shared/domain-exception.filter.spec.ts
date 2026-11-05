import { describe, expect, it } from "bun:test";
import { BadRequestException, HttpStatus } from "@nestjs/common";
import { DomainExceptionFilter } from "@shared/adapters/inbound/http/filters/domain-exception.filter";
import {
  BusinessRuleViolationError,
  ConflictError,
  DomainValidationError,
  IdempotencyConflictError,
  InvalidTransactionStateError,
  ResourceNotFoundError,
  TransientInfrastructureError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";

describe("DomainExceptionFilter", () => {
  const filter = new DomainExceptionFilter();

  it("maps DomainValidationError and BadRequestException to 400 Bad Request", () => {
    const validationRes = filter.mapExceptionToResponse(
      new DomainValidationError("Invalid decimal amount", "INVALID_MONEY_AMOUNT_FORMAT"),
      "/wagering/transactions",
    );
    expect(validationRes.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(validationRes.errorCode).toBe("INVALID_MONEY_AMOUNT_FORMAT");

    const nestBadRequest = filter.mapExceptionToResponse(
      new BadRequestException(["playerId must be a UUID"]),
      "/wallets",
    );
    expect(nestBadRequest.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(nestBadRequest.errorCode).toBe("INVALID_PAYLOAD");
  });

  it("maps IdempotencyConflictError and ConflictError to 409 Conflict", () => {
    const idempotencyRes = filter.mapExceptionToResponse(
      new IdempotencyConflictError("provider-a:tx-1"),
      "/wagering/transactions",
    );
    expect(idempotencyRes.statusCode).toBe(HttpStatus.CONFLICT);
    expect(idempotencyRes.errorCode).toBe("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT");

    const duplicateWalletRes = filter.mapExceptionToResponse(
      new ConflictError("Wallet already exists", "WALLET_ALREADY_EXISTS"),
      "/wallets",
    );
    expect(duplicateWalletRes.statusCode).toBe(HttpStatus.CONFLICT);
    expect(duplicateWalletRes.errorCode).toBe("WALLET_ALREADY_EXISTS");
  });

  it("maps BusinessRuleViolationError to 422 Unprocessable Entity with machine-readable failureCode", () => {
    const rejectedBet = filter.mapExceptionToResponse(
      new BusinessRuleViolationError(
        FailureCode.InsufficientFundsBet,
        "Insufficient wallet balance for BET",
      ),
      "/wagering/transactions",
    );

    expect(rejectedBet.statusCode).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(rejectedBet.failureCode).toBe(FailureCode.InsufficientFundsBet);
    expect(rejectedBet.errorCode).toBe(FailureCode.InsufficientFundsBet);
  });

  it("maps ResourceNotFoundError to 404 and TransientInfrastructureError to 503", () => {
    const notFound = filter.mapExceptionToResponse(
      new ResourceNotFoundError("Wallet not found", "WALLET_NOT_FOUND"),
    );
    expect(notFound.statusCode).toBe(HttpStatus.NOT_FOUND);

    const transient = filter.mapExceptionToResponse(
      new TransientInfrastructureError("PostgreSQL connection timeout"),
    );
    expect(transient.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);

    const invalidState = filter.mapExceptionToResponse(
      new InvalidTransactionStateError("PROCESSED", "reject"),
    );
    expect(invalidState.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});

