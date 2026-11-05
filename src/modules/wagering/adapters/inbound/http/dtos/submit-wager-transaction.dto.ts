import { WagerTransactionKind } from "@modules/wagering/domain/enums/wager-transaction-kind.enum";
import { MoneyInputDto } from "@modules/wallet/adapters/inbound/http/dtos/open-wallet.dto";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class SubmitWagerTransactionRequestDto {
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsString()
  @IsNotEmpty()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @IsObject()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  money!: MoneyInputDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}

