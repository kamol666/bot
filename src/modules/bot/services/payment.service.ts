import { PaymeSubsApiService } from "src/modules/payment-providers/payme-subs-api/payme-subs-api.service";
import { Injectable } from "@nestjs/common";
import { UzCardApiService } from "src/modules/payment-providers/uzcard/uzcard.service";
import { PaymentCardTokenDto } from "src/shared/utils/types/interfaces/payme-types";
import { ClickSubsApiService } from "src/modules/payment-providers/click-subs-api/click-subs-api.service";
import { ConfigService } from "@nestjs/config";


@Injectable()
export class PaymentService {

    private readonly clickSubsApiService: ClickSubsApiService;
    private readonly paymeSubsApiService: PaymeSubsApiService;
    // private readonly uzCardApiService = new UzCardApiService();

    constructor(private readonly configService: ConfigService) {
        this.clickSubsApiService = new ClickSubsApiService(this.configService);
        this.paymeSubsApiService = new PaymeSubsApiService();
    }


    async paymentWithClickSubsApi(requestBody: PaymentCardTokenDto) {
        const result = await this.clickSubsApiService.paymentWithToken(requestBody);
        return result.success;
    }


    async paymentWithPaymeSubsApi(requestBody: PaymentCardTokenDto) {
        const result = await this.paymeSubsApiService.createReceipt(requestBody.userId, requestBody.planId);

        if (!result) {
            throw new Error('Failed to create receipt');
        }

        if (result.success) {
            const paymentResult = await this.paymeSubsApiService.payReceipt(result.receiptId, requestBody.userId, requestBody.planId);
            return paymentResult?.success;
        } else {
            return false;
        }
    }

    // async paymentWithUzcardSubsApi(requestBody: PaymentCardTokenDto) {
    //     const result = await this.uzCardApiService.performPayment(requestBody.telegramId, requestBody.planId);

    //     if (!result.success) {
    //         return { success: false };
    //     }

    //     return {
    //         success: true,
    //         qrCodeUrl: result.qrCodeUrl
    //     };
    // }
}