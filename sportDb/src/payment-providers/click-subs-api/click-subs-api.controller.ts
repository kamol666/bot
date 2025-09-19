import {Body, Controller, Get, Header, Post, Query, Render} from '@nestjs/common';
import {ClickSubsApiService} from "./click-subs-api.service";
import {CreateCardTokenDto} from "./dto/create-card-token.dto";
import {CreateCardTokenResponseDto} from "./dto/response/create-card-token-response.dto";
import {VerifyCardTokenDto} from "./dto/request/verify-card-token.dto";

@Controller('click-subs-api')
export class ClickSubsApiController {

    constructor(private readonly clickSubsApiService: ClickSubsApiService) {
    }


    @Get('/payment')
    @Header('Content-Type', 'text/html')
    @Render('click/payment-card-insert')
    renderPaymentPage(
        @Query('userId') userId: string,
        @Query('planId') planId: string,
        @Query('selectedSport') selectedSport: string
        // @Query('telegramId') telegramId: number
    ) {
        return {
            userId,
            planId,
            selectedSport
        };
    }
    @Get('/verify-sms')
    @Render('click/sms-code-confirm')
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


    @Post('/create-card-token')
    async createCardToken(@Body() requestBody: CreateCardTokenDto): Promise<CreateCardTokenResponseDto> {
        return await this.clickSubsApiService.createCardToken(requestBody);
    }

    @Post('/verify-card-token/')
    async verifyCardToken(@Body() requestBody: VerifyCardTokenDto) {
        return await this.clickSubsApiService.verifyCardToken(requestBody);
    }
}