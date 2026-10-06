import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class CreateChecklistItemDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsBoolean()
  ok?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['OK', 'NC', 'NA'])
  answer?: 'OK' | 'NC' | 'NA';
}

class CreateChecklistFleetPhotoDto {
  @IsString()
  slot!: string;

  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class CreateChecklistDto {
  @IsString()
  title!: string;

  @IsString()
  vehicleId!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistFleetPhotoDto)
  fleetPhotos?: CreateChecklistFleetPhotoDto[];

  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['OWN', 'ASSISTANCE'])
  executionMode?: 'OWN' | 'ASSISTANCE';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(2020)
  periodYear?: number;

  @IsOptional()
  @IsString()
  capturedAt?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsOptional()
  @IsString()
  driverEmployeeKey?: string;

  @IsOptional()
  @IsString()
  responsibleName?: string;

  @IsOptional()
  @IsString()
  responsibleEmployeeKey?: string;

  @IsOptional()
  @IsArray()
  laborAssignments?: Array<{ role: string; employeeKey: string }>;

  @IsOptional()
  @IsBoolean()
  vehicleStopped?: boolean;

  @IsOptional()
  @IsBoolean()
  inMaintenance?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  items!: CreateChecklistItemDto[];
}
