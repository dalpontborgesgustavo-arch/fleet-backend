import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsinaBomAccessGuard } from './usina-bom-access.guard';
import { UsinaBomController } from './usina-bom.controller';
import { UsinaBomService } from './usina-bom.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsinaBomController],
  providers: [UsinaBomService, UsinaBomAccessGuard],
  exports: [UsinaBomService],
})
export class UsinaBomModule {}
