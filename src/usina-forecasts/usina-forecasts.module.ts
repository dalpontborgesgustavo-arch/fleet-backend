import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsinaForecastsController } from './usina-forecasts.controller';
import { UsinaForecastsService } from './usina-forecasts.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsinaForecastsController],
  providers: [UsinaForecastsService],
})
export class UsinaForecastsModule {}
