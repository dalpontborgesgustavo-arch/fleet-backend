import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TopographyInventoryController } from './topography-inventory.controller';
import { TopographyInventoryService } from './topography-inventory.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TopographyInventoryController],
  providers: [TopographyInventoryService],
})
export class TopographyInventoryModule {}
