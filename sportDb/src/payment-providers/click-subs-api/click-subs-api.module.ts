import { Module } from '@nestjs/common';
import { ClickSubsApiController } from './click-subs-api.controller';
import { ClickSubsApiService } from './click-subs-api.service';
import {ConfigModule} from "@nestjs/config";

@Module({
  imports: [ConfigModule],
  controllers: [ClickSubsApiController],
  providers: [ClickSubsApiService],
  exports: [ClickSubsApiService]
})
export class ClickSubsApiModule {}
