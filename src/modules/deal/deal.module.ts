import { Module } from '@nestjs/common';
import { DealService } from './deal.service';

@Module({
  providers: [DealService],
  exports: [DealService],
})
export class DealModule {}
