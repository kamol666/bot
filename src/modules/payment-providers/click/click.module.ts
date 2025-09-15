import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClickController } from './click.controller';
import { ClickService } from './click.service';
import { BotModule } from '../../bot/bot.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => BotModule),  // ✅ Circular dependency hal qilish
  ],
  controllers: [ClickController],
  providers: [ClickService],
  exports: [ClickService],  // ✅ Export qilish
})
export class ClickModule { }
