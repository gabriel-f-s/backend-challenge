import {
  OUTBOX_REPOSITORY_PORT,
  type OutboxRepositoryPort,
} from "@modules/messaging/application/ports/outbound/outbox.repository.port";
import { OutboxMessage } from "@modules/messaging/domain/entities/outbox-message.entity";
import {
  WALLET_REPOSITORY_PORT,
  type WalletRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import {
  WALLET_LEDGER_REPOSITORY_PORT,
  type WalletLedgerRepositoryPort,
} from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { Wallet } from "@modules/wallet/domain/entities/wallet.entity";
import { WalletBalanceChanged } from "@modules/wallet/domain/events/wallet-balance-changed.event";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK_PORT, type ClockPort } from "@shared/application/ports/outbound/clock.port";
import {
  ID_GENERATOR_PORT,
  type IdGeneratorPort,
} from "@shared/application/ports/outbound/id-generator.port";
import {
  UNIT_OF_WORK_PORT,
  type UnitOfWorkPort,
} from "@shared/application/ports/outbound/unit-of-work.port";
import { ConflictError } from "@shared/domain/errors/domain.error";
import { CanonicalPayloadHash } from "@shared/domain/services/canonical-payload-hash.service";
import { Money, type MoneyProps } from "@shared/domain/value-objects/money.vo";

export interface OpenWalletCommand {
  readonly playerId: string;
  readonly initialBalance: MoneyProps;
  readonly correlationId?: string;
}

export interface OpenWalletOutput {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

@Injectable()
export class OpenWalletUseCase {
  constructor(
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(WALLET_REPOSITORY_PORT)
    private readonly walletRepository: WalletRepositoryPort,
    @Inject(WALLET_LEDGER_REPOSITORY_PORT)
    private readonly walletLedgerRepository: WalletLedgerRepositoryPort,
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly outboxRepository: OutboxRepositoryPort,
    @Inject(ID_GENERATOR_PORT)
    private readonly idGenerator: IdGeneratorPort,
    @Inject(CLOCK_PORT)
    private readonly clock: ClockPort,
  ) {}

  async execute(command: OpenWalletCommand): Promise<OpenWalletOutput> {
    const initialMoney = Money.from(command.initialBalance);

    return this.unitOfWork.runInTransaction(async () => {
      const existing = await this.walletRepository.findByPlayerAndCurrency(
        command.playerId,
        initialMoney.currency,
      );

      if (existing) {
        throw new ConflictError(
          `Wallet already exists for player "${command.playerId}" and currency "${initialMoney.currency}"`,
          "WALLET_ALREADY_EXISTS",
        );
      }

      const now = this.clock.now();
      const wallet = Wallet.open({
        id: this.idGenerator.generate(),
        playerId: command.playerId,
        initialBalance: initialMoney,
        createdAt: now,
      });

      await this.walletRepository.insert(wallet);

      if (initialMoney.isPositive()) {
        const openingTransactionId = this.idGenerator.generate();
        const openingEntry = wallet.createOpeningLedgerEntry({
          entryId: this.idGenerator.generate(),
          transactionId: openingTransactionId,
          at: now,
        });

        const payloadHash = CanonicalPayloadHash.compute({
          kind: "OPENING",
          walletId: wallet.id,
          playerId: wallet.playerId,
          money: initialMoney.toJSON(),
        });

        await this.walletLedgerRepository.insertOpeningTransactionAndLedgerEntry({
          entry: openingEntry,
          playerId: wallet.playerId,
          payloadHash,
        });

        const balanceChangedEvent = WalletBalanceChanged.from(wallet, openingEntry, {
          eventId: this.idGenerator.generate(),
          correlationId: command.correlationId ?? openingTransactionId,
          causationId: openingTransactionId,
          occurredAt: now,
        });

        await this.outboxRepository.enqueue(OutboxMessage.enqueue(balanceChangedEvent));
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}

