import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const ASPHALT_EQUIPMENT_RATE_CATEGORIES = [
  'VIBROACABADORA',
  'ROLO_LISO',
  'ROLO_PNEUS',
] as const;

export type AsphaltEquipmentRateCategory =
  (typeof ASPHALT_EQUIPMENT_RATE_CATEGORIES)[number];

export class SaveUsinaAsphaltEquipmentHourlyRateDto {
  @IsString()
  @IsNotEmpty()
  competence!: string;

  @IsIn(ASPHALT_EQUIPMENT_RATE_CATEGORIES)
  category!: AsphaltEquipmentRateCategory;

  productiveRate!: string | number;

  unproductiveRate!: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeleteUsinaAsphaltEquipmentHourlyRateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
