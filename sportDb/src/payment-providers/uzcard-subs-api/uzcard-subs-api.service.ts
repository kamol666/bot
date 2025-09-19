import {Injectable} from '@nestjs/common';
import {FiscalDto, UzcardPaymentConfirm, UzcardPaymentDto, UzcardPaymentResponseDto} from "./dtos/uzcard-payment.dto";
import logger from "../../utils/logger";
import {SubscriptionBot} from "../../bot/bot";
import axios from "axios";
import {UserModel} from "../../database/models/user.model";
import {CardType, UserCardsModel} from "../../database/models/user-cards.model";
import {PaymentProvider, PaymentTypes, Transaction, TransactionStatus} from "../../database/models/transactions.model";
import {getFiscal} from "../../utils/get-fiscal";
import {Plan} from "../../database/models/plans.model";
import {UserSubscription} from "../../database/models/user-subscription.model";

export interface ErrorResponse {
    success: false;
    errorCode: string;
    message: string;
}

@Injectable()
export class UzcardSubsApiService {

    private botService: SubscriptionBot;
    private baseUrl = process.env.UZCARD_BASE_URL;


    getBotService(): SubscriptionBot {
        if (!this.botService) {
            this.botService = new SubscriptionBot();
        }
        return this.botService;
    }


    async paymentWithoutRegistration(dto: UzcardPaymentDto): Promise<UzcardPaymentResponseDto | ErrorResponse> {
        try {
            const user = await UserModel.findOne({telegramId: dto.telegramId, _id: dto.userId})

            if (!user) {
                throw new Error("User not found or unauthorized");
            }

            const extraId = this.generateExtraId(dto.userId);

            logger.info(`Generated extraId: ${extraId}`);

            const payload = {
                cardNumber: dto.cardNumber,
                expireDate: dto.expireDate,
                amount: '7777',
                extraId: extraId
            }

            const headers = this.getHeaders();

            const apiResponse = await axios.post(
                `${this.baseUrl}/Payment/paymentWithoutRegistration`,
                payload,
                {headers}
            )

            if (apiResponse.data.error) {
                const errorCode = apiResponse.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    message: apiResponse.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            const response: UzcardPaymentResponseDto = {
                session: apiResponse.data.result.session,
                otpSentPhone: apiResponse.data.result.otpSentPhone,
                success: true
            };

            return response;

        } catch (error) {
            // @ts-ignore

            // @ts-ignore
            if (error.response && error.response.data && error.response.data.error) {
                // @ts-ignore
                const errorCode = error.response.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    // @ts-ignore
                    message: error.response.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            // Handle network or other errors
            return {
                success: false,
                errorCode: 'api_error',
                message: 'Serverda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }

    async confirmPaymentWithoutRegistration(dto: UzcardPaymentConfirm): Promise<{ success: boolean } | ErrorResponse> {
        try {
            const user = await UserModel.findOne({telegramId: dto.telegramId, _id: dto.userId})

            if (!user) {
                throw new Error("User not found or unauthorized");
            }
            let plan: any;

            if (dto.selectedSport === 'wrestling') {
                plan = await Plan.findOne({name: 'Yakka kurash'});
            } else if (dto.selectedSport === 'football') {
                plan = await Plan.findOne({name: 'Futbol'});
            }

            if (!plan) {
                return {
                    success: false,
                    errorCode: 'plan_not_found',
                    message: 'Plan not found'
                };
            }


            const payload = {
                session: dto.session,
                otp: dto.otp
            }

            const headers = this.getHeaders();

            const apiResponse = await axios.post(
                `${this.baseUrl}/Payment/confirmPayment`,
                payload,
                {headers}
            )

            // Check for error response in the standard UzCard format
            if (apiResponse.data.error) {
                const errorCode = apiResponse.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    message: apiResponse.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            const cardDetails = apiResponse.data.result;

            const fiscalPayload: FiscalDto = {
                transactionId: cardDetails.transactionId,
                receiptId: cardDetails.utrno,
            }


            const transaction = await Transaction.create(
                {
                    provider: PaymentProvider.UZCARD,
                    paymentType: PaymentTypes.ONETIME,
                    transId: cardDetails.transactionId.toString(),
                    amount: cardDetails.amount,
                    status: TransactionStatus.PAID,
                    userId: dto.userId,
                    planId: plan?._id,
                    uzcard: {
                        transactionId: cardDetails.transactionId,
                        terminalId: cardDetails.terminalId,
                        merchantId: cardDetails.merchantId,
                        extraId: cardDetails.extraId,
                        cardNumber: cardDetails.cardNumber,
                        cardId: cardDetails.cardId,
                        statusComment: cardDetails.statusComment
                    }
                }
            )

            logger.info(`New user transaction created: ${JSON.stringify(transaction)}`);

            logger.info(`getFiscal arguments: ${JSON.stringify(fiscalPayload)}`);
            const fiscalResult = await getFiscal(fiscalPayload);

            if (!fiscalResult.success) {
                logger.error(`There is error with fiscalization in confirmPaymentWithoutRegistration method`)
            }

            logger.info(`Card details: ${JSON.stringify(cardDetails)}`);

            user.subscriptionType = 'onetime';
            await user.save();

            const endDate = new Date();
            endDate.setMonth(endDate.getMonth() + 30);

            await UserSubscription.create({
                user: transaction.userId,
                plan: transaction.planId,
                telegramId: dto.telegramId,
                planName: plan.name,
                subscriptionType: 'onetime',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: false,
                status: 'active',
                paidBy: CardType.UZCARD,
                hasReceivedFreeBonus: false,
            });


            if (user) {
                await this.getBotService().handlePaymentSuccessForUzcard(
                    transaction.userId.toString(),
                    user.telegramId,
                    user.username,
                    // @ts-ignore
                    fiscalResult.QRCodeURL,
                    dto.selectedSport
                );
            }

            return {
                success: true
            }

        } catch (error) {
            // @ts-ignore
            if (error.response && error.response.data && error.response.data.error) {
                // @ts-ignore
                const errorCode = error.response.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    // @ts-ignore
                    message: error.response.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            // @ts-ignore
            if (error.message && error.message.includes('OTP')) {
                return {
                    success: false,
                    errorCode: '-137',
                    message: this.getErrorMessage('-137')
                };
            }

            // Handle network or other errors
            return {
                success: false,
                errorCode: 'api_error',
                message: 'Serverda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }


    async resendCode(session: string, userId: string): Promise<{
        success: boolean,
        session: string,
        message: string
    } | ErrorResponse> {
        try {
            const headers = this.getHeaders();

            const response = await axios.get(
                `${this.baseUrl}/Payment/resendOtp?session=${encodeURIComponent(session)}`,
                {headers}
            );

            if (response.data.error) {
                const errorCode = response.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    message: response.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            return {
                success: true,
                session: session,
                message: 'Otp resent successfully'
            };

        } catch (error) {
            // @ts-ignore

            // @ts-ignore
            if (error.response && error.response.data && error.response.data.error) {
                // @ts-ignore
                const errorCode = error.response.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    // @ts-ignore
                    message: error.response.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            // @ts-ignore
            if (error.message && error.message.includes('OTP')) {
                return {
                    success: false,
                    errorCode: '-137',
                    message: this.getErrorMessage('-137')
                };
            }

            return {
                success: false,
                errorCode: 'api_error',
                message: 'Serverda xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }

    async deleteCard(id: string): Promise<boolean> {
        const headers = this.getHeaders();

        const userCard = await UserCardsModel.findOne({userId: id, cardType: CardType.UZCARD});

        if (!userCard || !userCard.UzcardIdForDeleteCard) {
            logger.error(`Failed to delete card: Card not found or missing UzcardIdForDeleteCard for user ${id}`);
            return false;
        }

        const uzcardIdForDelete = userCard?.UzcardIdForDeleteCard;

        try {
            const response = await axios.delete(`${this.baseUrl}/UserCard/deleteUserCard`, {
                headers,
                params: {userCardId: uzcardIdForDelete}
            });

            // Optional logging
            console.log('Delete response:', response.data);

            return response.data?.result?.success === true;
        } catch (error) {
            console.error('Failed to delete card:', error);
            return false; // or throw if you want to handle it higher up
        }
    }


    private getHeaders() {
        return {
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json',
            'Authorization': `Basic ${process.env.UZCARD_AUTH}`,
            'Language': 'uz',
        };
    }

    private generateExtraId(userId: string): string {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `${userId}-${timestamp}-${random}`;
    }

    private getErrorMessage(errorCode: string): string {
        const errorMessages = {
            // card errors
            '-101': `Karta malumotlari noto'g'ri. Iltimos tekshirib qaytadan kiriting.`,
            '-103': `Amal qilish muddati noto'g'ri. Iltimos tekshirib qaytadan kiriting.`,
            '-104': 'Karta aktive emas. Bankga murojaat qiling.',
            '-108': 'Karta tizimga ulangan. Bizga murojaat qiling.',

            // sms errors
            '-113': `Tasdiqlash kodi muddati o'tgan. Qayta yuborish tugmasidan foydalaning.`,
            '-137': `Tasdiqlash kodi noto'g'ri.`,

            // additional common errors
            '-110': 'Kartada yetarli mablag\' mavjud emas.',
            '-120': 'Kartangiz bloklangan. Bankga murojaat qiling.',
            '-130': 'Xavfsizlik chegaralaridan oshib ketdi. Keyinroq qayta urinib ko\'ring.',
        };

        //@ts-ignore
        return errorMessages[errorCode] || 'Kutilmagan xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.';
    }


}