import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {PaymeModule} from "../payment-providers/payme/payme.module";
import {ClickModule} from "../payment-providers/click/click.module";
import {ClickSubsApiModule} from "../payment-providers/click-subs-api/click-subs-api.module";
import {UzCardApiModule} from "../payment-providers/uzcard/uzcard.module";
import {PaymeSubsApiModule} from "../payment-providers/payme-subs-api/payme-subs-api.module";
import {UzcardSubsApiModule} from "../payment-providers/uzcard-subs-api/uzcard-subs-api.module";

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        PaymeModule,
        ClickModule,
        ClickSubsApiModule,
        UzCardApiModule,
        PaymeSubsApiModule,
        UzcardSubsApiModule
    ],
})
export class AppModule {}