import { HealthModule } from "@modules/health/health.module";
import { MessagingModule } from "@modules/messaging/messaging.module";
import { WageringModule } from "@modules/wagering/wagering.module";
import { WalletModule } from "@modules/wallet/wallet.module";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { SharedModule } from "@shared/shared.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SharedModule,
    WalletModule,
    WageringModule,
    MessagingModule,
    HealthModule,
  ],
})
export class AppModule {}

