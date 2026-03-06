import { IsArray, IsBoolean, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class CreateChecklistItemDto {
  @IsString()
  label: string;

  @IsBoolean()
  ok: boolean;
}

export class CreateChecklistDto {
  @IsString()
  title: string;

  @IsString()
  vehicleId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  items: CreateChecklistItemDto[];
}