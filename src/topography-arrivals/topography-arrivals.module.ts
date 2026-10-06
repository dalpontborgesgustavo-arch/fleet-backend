import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TopographyArrivalsController } from './topography-arrivals.controller';
import { TopographyArrivalsService } from './topography-arrivals.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TopographyArrivalsController],
  providers: [TopographyArrivalsService],
})
export class TopographyArrivalsModule {}
