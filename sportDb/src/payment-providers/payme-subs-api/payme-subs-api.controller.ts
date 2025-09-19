import {Body, Controller, Get, Header, Post, Query, Render} from '@nestjs/common';
import {PaymeSubsApiService} from './payme-subs-api.service';
import {join} from "path";
import {CreateCardTokenPaymeDto} from "./dto/create-card-token.dto";
import {VerifyCardTokenPaymeDtoDto} from "./verify-card-token.payme.dto";
import logger from "../../utils/logger";

@Controller('payme-subs-api')
export class PaymeSubsApiController {

  constructor(private readonly paymeSubsApiService: PaymeSubsApiService) {}



  @Get('/payment')
  @Header('Content-Type', 'text/html')
  @Render('payme/payment-card-insert')
  renderPaymentPage(
      @Query('userId') userId: string,
      @Query('planId') planId: string,
      @Query('selectedSport') selectedSport: string
  ) {
    console.log('Rendering payment page, view path:', join(process.cwd(), 'view/payme/payment-card-insert.ejs'));
    return {
      userId,
      planId,
      selectedSport
    };
  }

  @Get('/verify-sms')
  @Render('payme/sms-code-confirm')
  renderSmsVerificationPage(
      @Query('token') token: string,
      @Query('phone') phone: string,
      @Query('userId') userId: string,
      @Query('planId') planId: string,
      @Query('selectedSport') selectedSport: string
  ) {
    return {
      token,
      phone,
      userId,
      planId,
      selectedSport
    };
  }

  @Post('/card-token')
  async createCardToken(@Body() requestBody: CreateCardTokenPaymeDto): Promise<any> {
    return await this.paymeSubsApiService.createCardToken(requestBody);
  }

  @Post('/verify-token-payme')
  async verifyCardToken(@Body() requestBody: VerifyCardTokenPaymeDtoDto) {
    logger.warn(`Request body in PaymeSubsApiController: ${JSON.stringify(requestBody)}`);
    return await this.paymeSubsApiService.verifyCardToken(requestBody);
  }

  @Post('/resend-code')
  async resendCode(@Body() requestBody: any) {
    return await this.paymeSubsApiService.resendCode(requestBody);
  }

}