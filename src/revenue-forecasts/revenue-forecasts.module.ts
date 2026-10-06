import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RevenueForecastsController } from './revenue-forecasts.controller';
import { RevenueForecastsService } from './revenue-forecasts.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RevenueForecastsController],
  providers: [RevenueForecastsService],
})
export class RevenueForecastsModule {}
