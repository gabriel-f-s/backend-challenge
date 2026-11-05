import type { WalletLedgerEntry } from "@modules/wallet/domain/entities/wallet-ledger-entry.entity";
import { DomainValidationError } from "@shared/domain/errors/domain.error";

export const WALLET_LEDGER_REPOSITORY_PORT = Symbol("WALLET_LEDGER_REPOSITORY_PORT");

export interface DecodedLedgerCursor {
  readonly createdAtIso: string;
  readonly id: string;
}

export interface ListWalletLedgerQuery {
  readonly walletId: string;
  readonly cursor?: DecodedLedgerCursor;
  readonly limit: number;
}

export interface PaginatedWalletLedgerResult {
  readonly items: readonly WalletLedgerEntry[];
  readonly nextCursor: string | null;
}

export interface RecordOpeningLedgerParams {
  readonly entry: WalletLedgerEntry;
  readonly playerId: string;
  readonly payloadHash: string;
}

export interface WalletLedgerRepositoryPort {
  insert(entry: WalletLedgerEntry): Promise<void>;
  insertOpeningTransactionAndLedgerEntry(params: RecordOpeningLedgerParams): Promise<void>;
  findByWalletAndTransactionId(
    walletId: string,
    transactionId: string,
  ): Promise<WalletLedgerEntry | null>;
  listByWalletId(query: ListWalletLedgerQuery): Promise<PaginatedWalletLedgerResult>;
  findAllByWalletIdOrdered(walletId: string): Promise<WalletLedgerEntry[]>;
}

export function encodeLedgerCursor(cursor: DecodedLedgerCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeLedgerCursor(rawCursor: string): DecodedLedgerCursor {
  try {
    const json = Buffer.from(rawCursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<DecodedLedgerCursor>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.createdAtIso !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAtIso)) ||
      typeof parsed.id !== "string" ||
      parsed.id.trim() === ""
    ) {
      throw new Error("Invalid cursor structure");
    }
    return {
      createdAtIso: parsed.createdAtIso,
      id: parsed.id,
    };
  } catch {
    throw new DomainValidationError("Invalid pagination cursor", "INVALID_LEDGER_CURSOR");
  }
}

