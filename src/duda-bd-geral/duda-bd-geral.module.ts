import { Module } from '@nestjs/common';
import { DudaBdGeralController } from './duda-bd-geral.controller';
import { DudaBdGeralService } from './duda-bd-geral.service';

@Module({
  controllers: [DudaBdGeralController],
  providers: [DudaBdGeralService],
})
export class DudaBdGeralModule {}
