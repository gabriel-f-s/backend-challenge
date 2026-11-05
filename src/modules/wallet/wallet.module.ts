import { WalletController } from "@modules/wallet/adapters/inbound/http/wallet.controller";
import { MikroOrmWalletRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet.repository";
import { MikroOrmWalletLedgerRepository } from "@modules/wallet/adapters/outbound/persistence/repositories/mikro-orm-wallet-ledger.repository";
import { WALLET_REPOSITORY_PORT } from "@modules/wallet/application/ports/outbound/wallet.repository.port";
import { WALLET_LEDGER_REPOSITORY_PORT } from "@modules/wallet/application/ports/outbound/wallet-ledger.repository.port";
import { GetWalletUseCase } from "@modules/wallet/application/use-cases/get-wallet.use-case";
import { ListWalletLedgerUseCase } from "@modules/wallet/application/use-cases/list-wallet-ledger.use-case";
import { OpenWalletUseCase } from "@modules/wallet/application/use-cases/open-wallet.use-case";
import { ReconcileWalletUseCase } from "@modules/wallet/application/use-cases/reconcile-wallet.use-case";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  controllers: [WalletController],
  providers: [
    {
      provide: WALLET_REPOSITORY_PORT,
      useClass: MikroOrmWalletRepository,
    },
    {
      provide: WALLET_LEDGER_REPOSITORY_PORT,
      useClass: MikroOrmWalletLedgerRepository,
    },
    OpenWalletUseCase,
    GetWalletUseCase,
    ListWalletLedgerUseCase,
    ReconcileWalletUseCase,
  ],
  exports: [
    WALLET_REPOSITORY_PORT,
    WALLET_LEDGER_REPOSITORY_PORT,
    OpenWalletUseCase,
    GetWalletUseCase,
    ListWalletLedgerUseCase,
    ReconcileWalletUseCase,
  ],
})
export class WalletModule {}
