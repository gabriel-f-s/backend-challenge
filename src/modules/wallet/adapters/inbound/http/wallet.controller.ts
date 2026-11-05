import {
  GetWalletUseCase,
  type GetWalletOutput,
} from "@modules/wallet/application/use-cases/get-wallet.use-case";
import {
  ListWalletLedgerUseCase,
  type ListWalletLedgerOutput,
} from "@modules/wallet/application/use-cases/list-wallet-ledger.use-case";
import {
  OpenWalletUseCase,
  type OpenWalletOutput,
} from "@modules/wallet/application/use-cases/open-wallet.use-case";
import {
  ReconcileWalletUseCase,
  type ReconcileWalletOutput,
} from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import { DomainValidationError } from "@shared/domain/errors/domain.error";
import { OpenWalletRequestDto } from "./dtos/open-wallet.dto";

@Controller("wallets")
@UseGuards(NoopAuthGuard)
export class WalletController {
  constructor(
    private readonly openWalletUseCase: OpenWalletUseCase,
    private readonly getWalletUseCase: GetWalletUseCase,
    private readonly listWalletLedgerUseCase: ListWalletLedgerUseCase,
    private readonly reconcileWalletUseCase: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async openWallet(
    @Body() body: OpenWalletRequestDto,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<OpenWalletOutput> {
    return this.openWalletUseCase.execute({
      playerId: body.playerId,
      initialBalance: body.initialBalance,
      correlationId,
    });
  }

  @Get(":walletId")
  async getWallet(@Param("walletId") walletId: string): Promise<GetWalletOutput> {
    return this.getWalletUseCase.execute(walletId);
  }

  @Get(":walletId/ledger")
  async listLedger(
    @Param("walletId") walletId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<ListWalletLedgerOutput> {
    let parsedLimit: number | undefined;
    if (rawLimit !== undefined && rawLimit.trim() !== "") {
      parsedLimit = Number.parseInt(rawLimit, 10);
      if (Number.isNaN(parsedLimit)) {
        throw new DomainValidationError("Ledger limit must be an integer", "INVALID_LEDGER_LIMIT");
      }
    }

    return this.listWalletLedgerUseCase.execute({
      walletId,
      cursor,
      limit: parsedLimit,
    });
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  async reconcileWallet(@Param("walletId") walletId: string): Promise<ReconcileWalletOutput> {
    return this.reconcileWalletUseCase.execute(walletId);
  }
}

