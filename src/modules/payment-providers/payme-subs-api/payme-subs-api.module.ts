import { Module, forwardRef } from '@nestjs/common';
import { PaymeSubsApiService } from './payme-subs-api.service';
import { PaymeSubsApiController } from './payme-subs-api.controller';
import { BotModule } from 'src/modules/bot/bot.module';

@Module({
  imports: [forwardRef(() => BotModule)],
  controllers: [PaymeSubsApiController],
  providers: [PaymeSubsApiService],
  exports: [PaymeSubsApiService],
})
export class PaymeSubsApiModule { }
