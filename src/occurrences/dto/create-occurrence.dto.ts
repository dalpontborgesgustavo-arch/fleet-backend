import { IsArray, IsOptional, IsString, IsEnum } from 'class-validator';

export enum OccurrenceSeverityDto {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export class CreateOccurrenceDto {
  @IsString()
  vehicleId: string;

  @IsOptional()
  @IsString()
  checklistId?: string;

  @IsOptional()
  @IsString()
  questionId?: string;

  @IsString()
  questionLabel: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsEnum(OccurrenceSeverityDto)
  severity?: OccurrenceSeverityDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photos?: string[];
}
