import {Injectable} from '@nestjs/common';
import {ExternalAddCardDto} from './dto/request/external-add-card.dto';
import {AddCardResponseDto} from './dto/response/add-card-response.dto';
import {ConfirmCardResponseDto} from './dto/response/confirm-card-response.dto';
import {SubscriptionBot} from "../../bot/bot";
import {ConfirmCardDto} from "./dto/request/confirm-card.dto";
import logger from "../../utils/logger";
import {UserModel} from "../../database/models/user.model";
import axios from "axios";
import {CardType, UserCardsModel} from "../../database/models/user-cards.model";
import {PaymentProvider, PaymentTypes, Transaction, TransactionStatus} from "../../database/models/transactions.model";
import {IPlanDocument, Plan} from "../../database/models/plans.model";
import {UserSubscription} from "../../database/models/user-subscription.model";
import {FiscalDto} from "../uzcard-subs-api/dtos/uzcard-payment.dto";
import {getFiscal} from "../../utils/get-fiscal";


export interface ErrorResponse {
    success: false;
    errorCode: string;
    message: string;
}

@Injectable()
export class UzCardApiService {
    private botService: SubscriptionBot;
    private baseUrl = process.env.UZCARD_BASE_URL;

    constructor() {
    }

    getBotService(): SubscriptionBot {
        if (!this.botService) {
            this.botService = new SubscriptionBot();
        }
        return this.botService;
    }

    async addCard(payload: ExternalAddCardDto): Promise<AddCardResponseDto | ErrorResponse> {
        const headers = this.getHeaders();

        try {
            const apiResponse = await axios.post(
                `${this.baseUrl}/UserCard/createUserCard`,
                payload,
                {headers}
            );

            if (apiResponse.data.error) {
                const errorCode = apiResponse.data.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    message: apiResponse.data.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }

            return {
                session: apiResponse.data.result.session,
                otpSentPhone: apiResponse.data.result.otpSentPhone,
                success: true
            };

        } catch (error) {
            // @ts-ignore
            logger.error(`Error in addCard: ${error?.message}`, error);

            // Handle axios error responses from the API
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

    /**
     * Confirm a card with OTP
     */
    async confirmCard(request: ConfirmCardDto): Promise<ConfirmCardResponseDto | ErrorResponse> {
        try {
            const payload = {
                session: request.session,
                otp: request.otp,
                isTrusted: 1
            }

            logger.info(`Selected sport: ${request.selectedSport} in confirmCard`);

            const headers = this.getHeaders();


            const response = await axios.post(
                `${this.baseUrl}/UserCard/confirmUserCardCreate`,
                payload,
                {headers}
            );

            const responseData = response.data;

            if (responseData.error) {
                const errorCode = responseData.error.errorCode?.toString() || 'unknown';
                return {
                    success: false,
                    errorCode: errorCode,
                    message: responseData.error.errorMessage || this.getErrorMessage(errorCode)
                };
            }


            const card = responseData.result.card;

            const cardIdForDelete = card.id;
            const cardId = card.cardId;
            const incompleteCardNumber = card.number;
            const owner = card.owner;
            const isTrusted = card.isTrusted;
            const balance = card.balance;
            const expireDate = card.expireDate;

            const user = await UserModel.findOne({
                _id: request.userId,
            });
            if (!user) {
                logger.error(`User not found for ID: ${request.userId}`);
                return {
                    success: false,
                    errorCode: 'user_not_found',
                    message: 'Foydalanuvchi topilmadi. Iltimos qaytadan urinib ko\'ring.'
                };
            }

            let plan: any;

            if (request.selectedSport == 'wrestling') {
                plan = await Plan.findOne({name: 'Yakka kurash'});
            } else if (request.selectedSport == 'football') {
                plan = await Plan.findOne({name: 'Futbol'});
            }

            if (!plan) {
                logger.error(`Plan not found`);
                return {
                    success: false,
                    errorCode: 'plan_not_found',
                    message: 'Plan topilmadi. Iltimos qaytadan urinib ko\'ring.'
                };
            }

            const existingUserCard = await UserCardsModel.findOne({
                incompleteCardNumber: incompleteCardNumber
            });

            if (existingUserCard) {
                return {
                    success: false,
                    errorCode: 'card_already_exists',
                    message: 'Bu karta raqam mavjud. Iltimos boshqa karta raqamini tanlang.'
                };
            }

            const userCard = await UserCardsModel.create({
                telegramId: request.telegramId,
                username: user.username ? user.username : undefined,
                incompleteCardNumber: incompleteCardNumber,
                cardToken: cardId,
                expireDate: expireDate,
                verificationCode: request.otp,
                verified: true,
                verifiedDate: new Date(),
                cardType: CardType.UZCARD,
                userId: user._id,
                planId: plan._id,
                UzcardIsTrusted: isTrusted,
                UzcardBalance: balance,
                UzcardId: cardId,
                UzcardOwner: owner,
                UzcardIncompleteNumber: incompleteCardNumber,
                UzcardIdForDeleteCard: cardIdForDelete,
            });

            logger.info(`User card created: ${JSON.stringify(userCard)}`);

            if (request.userId) {
                await this.handleSuccessfulPayment(request.userId, request.selectedSport, plan);
            }

            return {
                success: true,
                cardId: cardId,
                message: 'Card added successfully'
            };

        } catch (error) {
            // @ts-ignore
            logger.error(`Error in confirmCard: ${error?.message}`);

            // Check if it's a formatted UzCard API error response
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

            // Check if error is OTP related
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


    async resendCode(session: string, userId: string) {
        try {
            const payload = {
                session: session,
            }

            const headers = this.getHeaders();

            const response = await axios.get(
                `${this.baseUrl}/UserCard/resendOtp?session=${encodeURIComponent(session)}`,
                {headers}
            );

            const result: any = {
                success: true,
                session: session,
                message: 'Otp resent successfully'
            };

            return result;

        } catch (error) {
            // @ts-ignore
            logger.error(`Error in confirmCard: ${error?.message}`, error);

            // Check if it's a formatted UzCard API error response
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

            // Check if error is OTP related
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

    async performPayment(telegramId: number, planId: string) {
        const user = await UserModel.findOne({telegramId});
        if (!user) {
            logger.error(`User not found for Telegram ID: ${telegramId}`);
            throw new Error('User not found in uzcard.service.ts');
        }

        const card = await UserCardsModel.findOne({userId: user._id});
        if (!card) {
            logger.error(`Card not found for User ID: ${user._id}`);
            return {success: false, message: 'Card not found'};
        }

        if (card.cardType !== CardType.UZCARD) {
            logger.error(`Card type is not UZCARD for User ID: ${user._id}`);
            return {success: false, message: 'Invalid card type'};
        }

        const headers = this.getHeaders();
        const customRandomId = `subscription-uzcard-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const plan = await Plan.findById(planId);

        if (!plan) {
            logger.error(`Plan not found for Plan ID: ${planId}`);
            return {success: false, message: 'Plan not found'};
        }

        const pendingTransaction = await Transaction.create({
            provider: PaymentProvider.UZCARD,
            paymentType: PaymentTypes.SUBSCRIPTION,
            transId: customRandomId,
            amount: '7777',
            status: TransactionStatus.PENDING,
            userId: user._id,
            planId: plan
            ,
        });


        const payload = {
            userId: card.userId,
            cardId: card.cardToken,
            amount: 7777,
            extraId: customRandomId,
            sendOtp: false
        };

        try {

            const apiResponse = await axios.post(
                `${this.baseUrl}/Payment/payment`,
                payload,
                {headers}
            );

            logger.info(`UzCard API response for user ${telegramId}: ${JSON.stringify(apiResponse.data)}`);
            // Check for API errors in response
            if (apiResponse.data.error !== null) {
                const errorCode = apiResponse.data.error.errorCode?.toString() || 'unknown';
                const errorMessage = apiResponse.data.error.errorMessage || this.getErrorMessage(errorCode);


                // Update transaction status to FAILED
                await Transaction.findByIdAndUpdate(pendingTransaction._id, {
                    status: TransactionStatus.FAILED
                });

                return {
                    success: false,
                    errorCode: errorCode,
                    message: errorMessage
                };
            }

            if (!apiResponse.data.result) {
                logger.error(`UzCard payment unsuccessful for user ${telegramId}: ${JSON.stringify(apiResponse.data)}`);

                await Transaction.findByIdAndUpdate(pendingTransaction._id, {
                    status: TransactionStatus.FAILED,
                });

                return {success: false, message: 'Payment not confirmed'};
            }

            // Payment successful - update transaction
            await Transaction.findByIdAndUpdate(pendingTransaction._id, {
                status: TransactionStatus.PAID
            });

            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: user._id,
                plan: planId,
                telegramId: user.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                subscribedBy: CardType.UZCARD,
                paidBy: CardType.UZCARD,
                hasReceivedFreeBonus: true
            });

            logger.info(`UserSubscription created for telegram ID: ${telegramId}, plan ID: ${planId} in uzcard.service.ts`);


            logger.info(`Transaction updated to PAID status: ${JSON.stringify(pendingTransaction)}`);
            const cardDetails = apiResponse.data.result;

            const fiscalPayload: FiscalDto = {
                transactionId: cardDetails.transactionId,
                receiptId: cardDetails.utrno,
            }


            logger.info(`getFiscal arguments: ${JSON.stringify(payload)}`);
            const fiscalResult = await getFiscal(fiscalPayload);

            if (!fiscalResult.success) {
                logger.error(`There is error with fiscalization in performPayment method`)
            }


            return { success: true, qrCodeUrl: fiscalResult.QRCodeURL };


        } catch (error) {
            // @ts-ignore
            logger.error(`Error in performPayment`);


            // Update transaction to failed status
            await Transaction.findByIdAndUpdate(pendingTransaction._id, {
                status: TransactionStatus.FAILED,
                // @ts-ignore
                errorMessage: error.message || 'Payment processing error'
            });

            // Handle axios errors properly
            // @ts-ignore
            if (error.response) {
                // @ts-ignore
                const status = error.response.status;
                // @ts-ignore
                const errorData = error.response.data;

                logger.error(`UzCard API HTTP ${status} error for user ${telegramId}:`, errorData);

                if (errorData && errorData.error) {
                    const errorCode = errorData.error.errorCode?.toString() || 'unknown';
                    return {
                        success: false,
                        errorCode: errorCode,
                        message: errorData.error.errorMessage || this.getErrorMessage(errorCode)
                    };
                }

                // Handle specific HTTP status codes
                if (status === 400) {
                    return {
                        success: false,
                        errorCode: 'bad_request',
                        message: 'So\'rov ma\'lumotlarida xatolik. Karta ma\'lumotlarini tekshiring.'
                    };
                } else if (status === 401) {
                    return {
                        success: false,
                        errorCode: 'unauthorized',
                        message: 'Avtorizatsiya xatosi. Administratorga murojaat qiling.'
                    };
                }
            }

            return {
                success: false,
                errorCode: 'network_error',
                message: 'Tarmoq xatosi. Iltimos qaytadan urinib ko\'ring.'
            };
        }
    }

    async handleSuccessfulPayment(userId: string, selectedSport: string, plan: IPlanDocument): Promise<void> {

        const user = await UserModel.findById(userId);
        if (!user) {
            logger.error(`User not found for ID: ${userId}`);
            throw new Error('User not found');
        }

        if (selectedSport == undefined) {
            logger.error(`Selected sport not found in handleSuccessfulPayment in uzcard.service.ts(439)`);
            throw new Error('Selected sport not found');
        }

        user.subscriptionType = 'subscription'
        await user.save();
        const endDate = new Date();

        if (user.hasReceivedFreeBonus) {
            endDate.setMonth(endDate.getMonth() + 30);
        } else {
            endDate.setMonth(endDate.getMonth() + 60);
        }

        await UserSubscription.create({
            user: userId,
            plan: plan._id,
            telegramId: user.telegramId,
            planName: plan.name,
            subscriptionType: 'subscription',
            startDate: new Date(),
            endDate: endDate,
            isActive: true,
            autoRenew: true,
            status: 'active',
            paidBy: CardType.UZCARD,
            subscribedBy: CardType.UZCARD
        });

        if (user.hasReceivedFreeBonus) {
            if (selectedSport === 'wrestling') {
                await this.getBotService().handleCardAddedWithoutBonusForWrestling(
                    userId,
                    user.telegramId,
                    CardType.UZCARD,
                    plan,
                    user.username,
                    selectedSport
                );
                return;
            } else if (selectedSport === 'football') {
                await this.getBotService().handleCardAddedWithoutBonus(
                    userId,
                    user.telegramId,
                    CardType.UZCARD,
                    plan,
                    user.username,
                    selectedSport
                );
                return;
            }
        }

        if (selectedSport === 'wrestling') {
            await this.getBotService().handleUzCardWrestlingSubscriptionSuccess(
                userId,
                user.telegramId,
                user.username
            );
        } else if (selectedSport === 'football') {
            await this.getBotService().handleUzCardSubscriptionSuccess(
                userId,
                user.telegramId,
                selectedSport,
                user.username
            );
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