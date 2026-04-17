import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { ChecklistModule } from './checklist/checklist.module';
import { ChecklistTemplateModule } from './checklist-template/checklist-template.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { OccurrencesModule } from './occurrences/occurrences.module';
import { UploadController } from './upload.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ChecklistTemplateModule,
    AuthModule,
    VehiclesModule,
    ChecklistModule,
    UsersModule,
    OccurrencesModule,
  ],
  controllers: [
    AppController,
    HealthController,
    UploadController, // ✅ AQUI
  ],
  providers: [AppService],
})
export class AppModule {}
