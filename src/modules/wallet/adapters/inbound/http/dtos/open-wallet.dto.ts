import { Type } from "class-transformer";
import { IsNotEmpty, IsObject, IsString, ValidateNested } from "class-validator";

export class MoneyInputDto {
  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  currency!: string;
}

export class OpenWalletRequestDto {
  @IsString()
  @IsNotEmpty()
  playerId!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  initialBalance!: MoneyInputDto;
}

