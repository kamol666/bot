import { Module } from '@nestjs/common';
import { UzcardSubsApiService } from './uzcard-subs-api.service';
import { UzcardSubsApiController } from './uzcard-subs-api.controller';

@Module({
  controllers: [UzcardSubsApiController],
  providers: [UzcardSubsApiService],
  exports: [UzcardSubsApiService]
})
export class UzcardSubsApiModule {}
