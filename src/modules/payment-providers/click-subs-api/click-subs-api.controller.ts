import { Controller, Get, Post, Body, Patch, Param, Delete, Header, Render, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ClickSubsApiService } from './click-subs-api.service';
import { CreateCardTokenResponseDto } from 'src/shared/utils/types/interfaces/click-types-interface';
import { CreateCardTokenDto } from './dto/create-card-dto';
import { VerifyCardTokenDto } from './dto/verif-card-dto';
import { ClickPrepareDto, ClickCompleteDto } from './dto/click-callback.dto';
import { ClickError } from 'src/shared/utils/types/enums/click-errors.enum';
import logger from 'src/shared/utils/logger';

@Controller('click-subs-api')
export class ClickSubsApiController {
  constructor(private readonly clickSubsApiService: ClickSubsApiService) { }



  @Get('/payment')
  @Header('Content-Type', 'text/html')
  @Render('click/payment-card-insert')
  renderPaymentPage(
    @Query('userId') userId: string,
    @Query('planId') planId: string,
    @Query('selectedService') selectedService: string
    // @Query('telegramId') telegramId: number
  ) {
    return {
      userId,
      planId,
      selectedService
    };
  }
  @Get('/verify-sms')
  @Render('click/sms-code-confirm')
  renderSmsVerificationPage(
    @Query('token') token: string,
    @Query('phone') phone: string,
    @Query('userId') userId: string,
    @Query('planId') planId: string,
    @Query('selectedService') selectedService: string
  ) {
    return {
      token,
      phone,
      userId,
      planId,
      selectedService
    };
  }


  @Post('/create-card-token')
  async createCardToken(@Body() requestBody: CreateCardTokenDto): Promise<CreateCardTokenResponseDto> {
    try {
      logger.info('🔄 Card token creation request received', {
        card_number_masked: requestBody.card_number?.replace(/(\d{4})(\d{4})(\d{4})(\d{4})/, '$1****$3$4'),
        expire_date: requestBody.expire_date,
        temporary: requestBody.temporary
      });

      const result = await this.clickSubsApiService.createCardtoken(requestBody);

      logger.info('✅ Card token created successfully');
      return result;

    } catch (error: any) {
      logger.error('❌ Card token creation failed:', error.message);

      // Click API specific errors - return as 400 Bad Request with clear message
      if (error.message.includes('Click') || error.message.includes('Karta') || error.message.includes('server')) {
        throw new HttpException({
          success: false,
          error: 'CLICK_API_ERROR',
          message: error.message,
          timestamp: new Date().toISOString()
        }, HttpStatus.BAD_REQUEST);
      }

      // Network or validation errors
      if (error.message.includes('raqami') || error.message.includes('muddati') || error.message.includes('formatda')) {
        throw new HttpException({
          success: false,
          error: 'VALIDATION_ERROR',
          message: error.message,
          timestamp: new Date().toISOString()
        }, HttpStatus.UNPROCESSABLE_ENTITY);
      }

      // Generic error
      throw new HttpException({
        success: false,
        error: 'INTERNAL_ERROR',
        message: 'Karta token yaratishda noma\'lum xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.',
        timestamp: new Date().toISOString()
      }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('/resend-sms-code')
  async resendSmsCode(@Body() requestBody: { card_token: string }) {
    try {
      logger.info('🔄 SMS resend request received', { card_token_masked: requestBody.card_token?.substring(0, 8) + '***' });

      const result = await this.clickSubsApiService.resendSmsCode(requestBody.card_token);

      logger.info('✅ SMS resent successfully');
      return {
        success: true,
        message: 'SMS kod qayta yuborildi',
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      logger.error('❌ SMS resend failed:', error.message);

      throw new HttpException({
        success: false,
        error: 'SMS_RESEND_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      }, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('/verify-card-token/')
  async verifyCardToken(@Body() requestBody: VerifyCardTokenDto) {
    try {
      logger.info('🔄 Card token verification request received', {
        card_token_masked: requestBody.card_token?.substring(0, 8) + '***',
        sms_code_length: requestBody.sms_code?.length
      });

      const result = await this.clickSubsApiService.verifyCardToken(requestBody);

      logger.info('✅ Card token verified successfully');
      return {
        success: true,
        message: 'Karta muvaffaqiyatli tasdiqlandi',
        data: result,
        timestamp: new Date().toISOString()
      };

    } catch (error: any) {
      logger.error('❌ Card token verification failed:', error.message);

      throw new HttpException({
        success: false,
        error: 'VERIFICATION_ERROR',
        message: error.message,
        timestamp: new Date().toISOString()
      }, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('/payment/prepare')
  async prepare(@Body() body: ClickPrepareDto) {
    const result = await this.clickSubsApiService.prepareTransaction(body);
    if (result.error !== 0) {
      return result;
    }
    return result;
  }

  @Post('/payment/complete')
  async complete(@Body() body: ClickCompleteDto) {
    const result = await this.clickSubsApiService.completeTransaction(body);
    if (result.error !== 0) {
      return result;
    }
    return result;
  }
}
