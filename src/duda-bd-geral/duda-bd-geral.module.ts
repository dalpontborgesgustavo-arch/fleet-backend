import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DudaBdGeralController } from './duda-bd-geral.controller';
import { DudaBdGeralService } from './duda-bd-geral.service';
import { DudaObservationsController } from './duda-observations.controller';
import { DudaObservationsService } from './duda-observations.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DudaBdGeralController, DudaObservationsController],
  providers: [DudaBdGeralService, DudaObservationsService],
})
export class DudaBdGeralModule {}
