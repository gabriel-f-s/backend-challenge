import {
  GetWagerTransactionUseCase,
  type WagerTransactionViewOutput,
} from "@modules/wagering/application/use-cases/get-wager-transaction.use-case";
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionOutput,
} from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { WagerTransactionStatus } from "@modules/wagering/domain/enums/wager-transaction-status.enum";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { NoopAuthGuard } from "@shared/adapters/inbound/http/guards/noop-auth.guard";
import type { Response } from "express";
import { SubmitWagerTransactionRequestDto } from "./dtos/submit-wager-transaction.dto";

@Controller()
@UseGuards(NoopAuthGuard)
export class WageringController {
  constructor(
    private readonly processWagerTransactionUseCase: ProcessWagerTransactionUseCase,
    private readonly getWagerTransactionUseCase: GetWagerTransactionUseCase,
  ) {}

  @Post("wagering/transactions")
  async submitTransaction(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Body() body: SubmitWagerTransactionRequestDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProcessWagerTransactionOutput> {
    const result = await this.processWagerTransactionUseCase.execute({
      idempotencyKey: idempotencyKey ?? "",
      providerId: body.providerId,
      externalTransactionId: body.externalTransactionId,
      playerId: body.playerId,
      walletId: body.walletId,
      roundId: body.roundId,
      gameId: body.gameId,
      kind: body.kind,
      money: body.money,
      referenceExternalTransactionId: body.referenceExternalTransactionId,
      correlationId,
    });

    if (result.status === WagerTransactionStatus.PendingReference) {
      response.status(HttpStatus.ACCEPTED);
    } else if (result.status === WagerTransactionStatus.Rejected) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY);
    } else {
      response.status(HttpStatus.OK);
    }

    return result;
  }

  @Get("wagering/transactions/:transactionId")
  async getTransactionById(
    @Param("transactionId") transactionId: string,
  ): Promise<WagerTransactionViewOutput> {
    return this.getWagerTransactionUseCase.executeById(transactionId);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  async getTransactionByProviderAndExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<WagerTransactionViewOutput> {
    return this.getWagerTransactionUseCase.executeByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
  }
}

