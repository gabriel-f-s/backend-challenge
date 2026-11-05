import { WageringController } from "@modules/wagering/adapters/inbound/http/wagering.controller";
import { MikroOrmWagerTransactionRepository } from "@modules/wagering/adapters/outbound/persistence/repositories/mikro-orm-wager-transaction.repository";
import { WAGER_TRANSACTION_REPOSITORY_PORT } from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { GetWagerTransactionUseCase } from "@modules/wagering/application/use-cases/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  controllers: [WageringController],
  providers: [
    {
      provide: WAGER_TRANSACTION_REPOSITORY_PORT,
      useClass: MikroOrmWagerTransactionRepository,
    },
    ProcessWagerTransactionUseCase,
    GetWagerTransactionUseCase,
  ],
  exports: [
    WAGER_TRANSACTION_REPOSITORY_PORT,
    ProcessWagerTransactionUseCase,
    GetWagerTransactionUseCase,
  ],
})
export class WageringModule {}
