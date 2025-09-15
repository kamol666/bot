import { Module, Global, forwardRef } from '@nestjs/common';
import { BotService } from './bot.service';
import { ClickModule } from '../payment-providers/click/click.module';
import { PaymeModule } from '../payment-providers/payme/payme.module';

@Global()
@Module({
  imports: [
    forwardRef(() => ClickModule),  // ✅ Circular dependency hal qilish
    PaymeModule,
  ],
  providers: [BotService],
  exports: [BotService],
})
export class BotModule { }
