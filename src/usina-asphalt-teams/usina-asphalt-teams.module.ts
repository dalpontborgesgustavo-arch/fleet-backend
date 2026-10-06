import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { UsinaAsphaltTeamsAccessGuard } from './usina-asphalt-teams-access.guard';
import { UsinaAsphaltTeamsController } from './usina-asphalt-teams.controller';
import { UsinaAsphaltTeamsService } from './usina-asphalt-teams.service';
import { TotvsEmployeeIntegrationService } from './totvs-employee-integration.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsinaAsphaltTeamsController],
  providers: [
    UsinaAsphaltTeamsService,
    TotvsEmployeeIntegrationService,
    UsinaAsphaltTeamsAccessGuard,
  ],
})
export class UsinaAsphaltTeamsModule {}
