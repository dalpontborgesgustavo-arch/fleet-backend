import { Module } from '@nestjs/common';
import { OccurrencesController } from './occurrences.controller';
import { OccurrencesService } from './occurrences.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OccurrencesController],
  providers: [OccurrencesService, PrismaService],
})
export class OccurrencesModule {}
