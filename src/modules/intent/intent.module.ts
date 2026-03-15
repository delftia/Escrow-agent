import { Module } from '@nestjs/common';
import { IntentService } from './intent.service';

@Module({
  providers: [IntentService],
  exports: [IntentService],
})
export class IntentModule {}
