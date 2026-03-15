import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [BotModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
