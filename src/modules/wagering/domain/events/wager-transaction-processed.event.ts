import {
  type EventContext,
  IntegrationEvent,
} from "@shared/domain/events/integration-event.base";
import type { MoneyProps } from "@shared/domain/value-objects/money.vo";
import type { WagerTransaction } from "../entities/wager-transaction.entity";
import type { WagerTransactionKind } from "../enums/wager-transaction-kind.enum";

export interface WagerTransactionProcessedData {
  readonly transactionId: string;
  readonly providerId: string;
  readonly externalTransactionId: string;
  readonly walletId: string;
  readonly playerId: string;
  readonly roundId: string;
  readonly gameId: string;
  readonly kind: WagerTransactionKind;
  readonly money: MoneyProps;
  readonly balance: MoneyProps;
  readonly referenceTransactionId?: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    balance: MoneyProps,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: ctx.eventId,
      aggregateId: transaction.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: ctx.occurredAt,
      data: {
        transactionId: transaction.id,
        providerId: transaction.providerId,
        externalTransactionId: transaction.externalTransactionId,
        walletId: transaction.walletId,
        playerId: transaction.playerId,
        roundId: transaction.roundId,
        gameId: transaction.gameId,
        kind: transaction.kind,
        money: transaction.money.toJSON(),
        balance,
        ...(transaction.referenceTransactionId
          ? { referenceTransactionId: transaction.referenceTransactionId }
          : {}),
      },
    });
  }
}

