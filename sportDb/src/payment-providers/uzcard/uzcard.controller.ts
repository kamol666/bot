import {Body, Controller, Get, Header, Post, Query, Render} from '@nestjs/common';
import {join} from "path";
import {AddCardDto} from "./dto/add-card.dto";
import {AddCardResponseDto} from "./dto/response/add-card-response.dto";
import {ConfirmCardDto} from "./dto/request/confirm-card.dto";
import {ErrorResponse, UzCardApiService} from "./uzcard.service";

@Controller('uzcard-api')
export class UzCardApiController {

    constructor(private readonly uzCardApiService: UzCardApiService) {
    }

    @Get('/payment')
    @Header('Content-Type', 'text/html')
    @Render('uzcard/payment-card-insert')
    renderPaymentPage(
        @Query('userId') userId: string,
        @Query('telegramId') telegramId: number,
        @Query('selectedSport') selectedSport: string
    ) {
        return {
            userId,
            telegramId,
            selectedSport
        };
    }

    @Get('/uzcard-verify-sms')
    @Render('uzcard/sms-code-confirm')
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

    @Post('/add-card')
    async addCard(@Body() requestBody: AddCardDto): Promise<AddCardResponseDto | ErrorResponse> {

        return await this.uzCardApiService.addCard({
            userId: requestBody.userId,
            cardNumber: requestBody.cardNumber,
            expireDate: requestBody.expireDate,
            userPhone: requestBody.userPhone
        });
    }

    @Post('/confirm-card')
    async confirmCard(@Body() requestBody: ConfirmCardDto) {
        try {
            return await this.uzCardApiService.confirmCard(requestBody);
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
        return await this.uzCardApiService.resendCode(session, userId);
    }
}