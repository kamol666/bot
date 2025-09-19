import { Module } from '@nestjs/common';
import { PaymeSubsApiService } from './payme-subs-api.service';
import { PaymeSubsApiController } from './payme-subs-api.controller';

@Module({
  controllers: [PaymeSubsApiController],
  providers: [PaymeSubsApiService],
})
export class PaymeSubsApiModule {}
