import { Module } from '@nestjs/common';
import { ArbitrationService } from './arbitration.service';

@Module({
  providers: [ArbitrationService],
  exports: [ArbitrationService],
})
export class ArbitrationModule {}
