import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChecklistItemDto)
  items!: CreateChecklistItemDto[];
}
