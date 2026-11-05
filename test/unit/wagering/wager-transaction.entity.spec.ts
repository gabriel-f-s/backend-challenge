import { describe, expect, it } from "bun:test";
import { WagerTransactionMapper } from "@modules/wagering/adapters/outbound/persistence/mappers/wager-transaction.mapper";
import { WagerTransaction } from "@modules/wagering/domain/entities/wager-transaction.entity";
import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import { LedgerDirection } from "@modules/wallet/domain/enums/ledger-direction.enum";
import {
  DomainValidationError,
  InvalidTransactionStateError,
} from "@shared/domain/errors/domain.error";
import { FailureCode } from "@shared/domain/errors/failure-code.enum";
import { Money } from "@shared/domain/value-objects/money.vo";

describe("WagerTransaction Entity & State Machine", () => {
  const createdAt = new Date("2026-07-29T15:00:00.000Z");

  it("creates transaction in PENDING state and enforces terminal state immutability", () => {
    const bet = WagerTransaction.create({
      id: "tx-bet-1",
      providerId: "provider-a",
      externalTransactionId: "ext-bet-1",
      idempotencyKey: "provider-a:ext-bet-1",
      payloadHash: "hash-1",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "fortune-chimp",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      createdAt,
    });

    expect(bet.status).toBe(WagerTransactionStatus.Pending);
    expect(bet.isTerminal()).toBe(false);
    expect(bet.affectsBalance()).toBe(true);
    expect(bet.requiresReference()).toBe(false);
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);

    const processedAt = new Date("2026-07-29T15:00:01.000Z");
    bet.markProcessed(undefined, processedAt, Money.from({ amount: "75.00", currency: "BRL" }));

    expect(bet.status).toBe(WagerTransactionStatus.Processed);
    expect(bet.isTerminal()).toBe(true);
    expect(bet.processedAt).toEqual(processedAt);
    expect(bet.observedBalance?.amount).toBe("75.00");

    expect(() => bet.reject(FailureCode.InsufficientFundsBet)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => bet.markPendingReference()).toThrow(InvalidTransactionStateError);
    expect(() => bet.fail(FailureCode.PermanentInfrastructureFailure)).toThrow(
      InvalidTransactionStateError,
    );

    const record = WagerTransactionMapper.toPersistence(bet);
    const rehydrated = WagerTransactionMapper.toDomain(record);
    expect(rehydrated.id).toBe(bet.id);
    expect(rehydrated.status).toBe(WagerTransactionStatus.Processed);
    expect(rehydrated.observedBalance?.amount).toBe("75.00");
  });

  it("forbids external OPENING kind and enforces reference requirement for REFUND and ROLLBACK", () => {
    expect(() =>
      WagerTransaction.create({
        id: "tx-open",
        providerId: "provider-a",
        externalTransactionId: "ext-open",
        idempotencyKey: "provider-a:ext-open",
        payloadHash: "hash",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Opening,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      WagerTransaction.create({
        id: "tx-refund-no-ref",
        providerId: "provider-a",
        externalTransactionId: "ext-ref",
        idempotencyKey: "provider-a:ext-ref",
        payloadHash: "hash",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Refund,
        money: Money.from({ amount: "25.00", currency: "BRL" }),
      }),
    ).toThrow(DomainValidationError);

    expect(() =>
      WagerTransaction.create({
        id: "tx-rollback-no-ref",
        providerId: "provider-a",
        externalTransactionId: "ext-rb",
        idempotencyKey: "provider-a:ext-rb",
        payloadHash: "hash",
        walletId: "wallet-1",
        playerId: "player-1",
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Rollback,
        money: Money.from({ amount: "25.00", currency: "BRL" }),
      }),
    ).toThrow(DomainValidationError);
  });

  it("computes inverted ledger direction for ROLLBACK and marks LOSS as not affecting balance", () => {
    const bet = WagerTransaction.create({
      id: "tx-bet",
      providerId: "provider-a",
      externalTransactionId: "ext-bet",
      idempotencyKey: "provider-a:ext-bet",
      payloadHash: "hash",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Bet,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
    });

    const win = WagerTransaction.create({
      id: "tx-win",
      providerId: "provider-a",
      externalTransactionId: "ext-win",
      idempotencyKey: "provider-a:ext-win",
      payloadHash: "hash",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Win,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
    });

    const rollbackBet = WagerTransaction.create({
      id: "tx-rb-bet",
      providerId: "provider-a",
      externalTransactionId: "ext-rb-bet",
      idempotencyKey: "provider-a:ext-rb-bet",
      payloadHash: "hash",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Rollback,
      money: Money.from({ amount: "25.00", currency: "BRL" }),
      referenceExternalTransactionId: "ext-bet",
    });

    expect(rollbackBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expect(rollbackBet.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);

    const loss = WagerTransaction.create({
      id: "tx-loss",
      providerId: "provider-a",
      externalTransactionId: "ext-loss",
      idempotencyKey: "provider-a:ext-loss",
      payloadHash: "hash",
      walletId: "wallet-1",
      playerId: "player-1",
      roundId: "round-1",
      gameId: "game-1",
      kind: WagerTransactionKind.Loss,
      money: Money.zero("BRL"),
    });

    expect(loss.affectsBalance()).toBe(false);
    expect(() => loss.ledgerDirectionFor()).toThrow(DomainValidationError);
  });
});

