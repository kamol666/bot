import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './modules/bot/bot.module';
import { ClickModule } from './modules/payment-providers/click/click.module';
import { PaymeModule } from './modules/payment-providers/payme/payme.module';
import { UzCardApiModule } from './modules/payment-providers/uzcard/uzcard.module';
import { UzcardOnetimeApiModule } from './modules/payment-providers/uzcard-onetime-api/uzcard-onetime-api.module';
import { ClickSubsApiModule } from './modules/payment-providers/click-subs-api/click-subs-api.module';
import { PaymeSubsApiModule } from './modules/payment-providers/payme-subs-api/payme-subs-api.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ClickModule,
    PaymeModule,
    UzCardApiModule,
    UzcardOnetimeApiModule,
    ClickSubsApiModule,
    PaymeSubsApiModule,
    BotModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
