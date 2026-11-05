import { WageringController } from "@modules/wagering/adapters/inbound/http/wagering.controller";
import { WagerTransactionSqsConsumer } from "@modules/wagering/adapters/inbound/messaging/wager-transaction-sqs.consumer";
import { PendingReferenceWorker } from "@modules/wagering/adapters/inbound/workers/pending-reference.worker";
import { MikroOrmWagerTransactionRepository } from "@modules/wagering/adapters/outbound/persistence/repositories/mikro-orm-wager-transaction.repository";
import { WAGER_TRANSACTION_REPOSITORY_PORT } from "@modules/wagering/application/ports/outbound/wager-transaction.repository.port";
import { GetWagerTransactionUseCase } from "@modules/wagering/application/use-cases/get-wager-transaction.use-case";
import { ProcessWagerTransactionUseCase } from "@modules/wagering/application/use-cases/process-wager-transaction.use-case";
import { RetryPendingReferenceTransactionsUseCase } from "@modules/wagering/application/use-cases/retry-pending-reference-transactions.use-case";
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
    RetryPendingReferenceTransactionsUseCase,
    PendingReferenceWorker,
    WagerTransactionSqsConsumer,
  ],
  exports: [
    WAGER_TRANSACTION_REPOSITORY_PORT,
    ProcessWagerTransactionUseCase,
    GetWagerTransactionUseCase,
    RetryPendingReferenceTransactionsUseCase,
    WagerTransactionSqsConsumer,
  ],
})
export class WageringModule {}
