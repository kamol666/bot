import {ClickSubsApiService} from "../payment-providers/click-subs-api/click-subs-api.service";
import {Injectable} from "@nestjs/common";
import {PaymeSubsApiService} from "../payment-providers/payme-subs-api/payme-subs-api.service";
import {UzcardSubsApiService} from "../payment-providers/uzcard-subs-api/uzcard-subs-api.service";
import {PaymentCardTokenDto} from "../payment-providers/click-subs-api/dto/request/payment-card-token.dto";
import {UzCardApiService} from "../payment-providers/uzcard/uzcard.service";

@Injectable()
export class PaymentService {

    private readonly clickSubsApiService = new ClickSubsApiService();
    private readonly paymeSubsApiService = new PaymeSubsApiService();
    private readonly uzCardApiService = new UzCardApiService();


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

    async paymentWithUzcardSubsApi(requestBody: PaymentCardTokenDto) {
        const result = await this.uzCardApiService.performPayment(requestBody.telegramId, requestBody.planId);

        if (!result.success) {
            return { success: false };
        }

        return {
            success: true,
            qrCodeUrl: result.qrCodeUrl
        };
    }
}