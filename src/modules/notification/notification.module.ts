import { Module, forwardRef } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { BotModule } from '../bot/bot.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => BotModule),
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}