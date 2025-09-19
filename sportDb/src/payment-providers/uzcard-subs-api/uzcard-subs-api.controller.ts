import {Body, Controller, Get, Header, Post, Query, Render} from '@nestjs/common';
import {UzcardSubsApiService} from './uzcard-subs-api.service';
import {UzcardPaymentConfirm, UzcardPaymentDto} from "./dtos/uzcard-payment.dto";
import logger from "../../utils/logger";

@Controller('uzcard-subs-api')
export class UzcardSubsApiController {
    constructor(private readonly uzcardSubsApiService: UzcardSubsApiService) {
    }

    @Get('/uzcard-one-time-payment')
    @Header('Content-Type', 'text/html')
    @Render('uzcard-onetime/payment-card-insert')
    renderPaymentPage(
        @Query('userId') userId: string,
        @Query('telegramId') telegramId: number,
        @Query('selectedSport') selectedSport: string
    ) {
        logger.warn(`Selected sport: ${selectedSport}`);
        return {
            userId,
            telegramId,
            selectedSport
        };
    }

    @Get('/uzcard-confirm-payment')
    @Render('uzcard-onetime/sms-code-confirm')
    renderSmsVerificationPage(
        @Query('session') session: string,
        @Query('phone') phone: string,
        @Query('userId') userId: string,
        @Query('telegramId') telegramId: number,
        @Query('selectedSport') selectedSport: string
    ) {
        return {
            session,
            phone,
            userId,
            telegramId,
            selectedSport
        };
    }

    @Post('/uzcard-payment')
    async paymentWithoutRegistration(@Body() requestBody: UzcardPaymentDto) {
        try {
            return await this.uzcardSubsApiService.paymentWithoutRegistration(requestBody);
        } catch (error) {
            // @ts-ignore
            return {
                success: false,
                // @ts-ignore
                errorCode: error.code || 'unknown_error',
                // @ts-ignore
                message: error.message || 'Kutilmagan xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }

    @Post('/uzcard-confirm')
    async confirmPaymentWithoutRegistration(@Body() requestBody: UzcardPaymentConfirm) {
        try {
            logger.warn(`Selected sport in confirmPaymentWithoutRegistration in UzcardSubsApiController : ${requestBody.selectedSport}`);
            return await this.uzcardSubsApiService.confirmPaymentWithoutRegistration(requestBody);
        } catch (error) {
            // @ts-ignore
            return {
                success: false,
                // @ts-ignore
                errorCode: error.code || 'unknown_error',
                // @ts-ignore
                message: error.message || 'Kutilmagan xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }

    @Get('resend-otp')
    async resendCode(
        @Query('session') session: string,
        @Query('userId') userId: string,
    ) {
        return await this.uzcardSubsApiService.resendCode(session, userId);
    }
}
