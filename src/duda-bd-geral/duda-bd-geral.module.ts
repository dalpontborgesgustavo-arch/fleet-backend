import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DudaBdGeralController } from './duda-bd-geral.controller';
import { DudaBdGeralService } from './duda-bd-geral.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DudaBdGeralController],
  providers: [DudaBdGeralService],
})
export class DudaBdGeralModule {}
