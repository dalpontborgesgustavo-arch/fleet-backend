import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TaxForecastsController } from './tax-forecasts.controller';
import { TaxForecastsService } from './tax-forecasts.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TaxForecastsController],
  providers: [TaxForecastsService],
})
export class TaxForecastsModule {}
