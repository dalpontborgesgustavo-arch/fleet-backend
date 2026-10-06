import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { EnvironmentalController } from './environmental.controller';
import { EnvironmentalService } from './environmental.service';

@Module({
  imports: [PrismaModule, StorageModule, AuthModule],
  controllers: [EnvironmentalController],
  providers: [EnvironmentalService],
})
export class EnvironmentalModule {}
