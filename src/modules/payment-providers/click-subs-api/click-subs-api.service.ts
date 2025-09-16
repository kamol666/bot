import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto'; // 1. crypto moduli import qilindi
import { Plan } from 'src/shared/database/models/plans.model';
import { PaymentProvider, Transaction, TransactionStatus } from 'src/shared/database/models/transactions.model';
import { CardType, UserCardsModel } from 'src/shared/database/models/user-cards.model';
import { UserSubscription } from 'src/shared/database/models/user-subscription.model';
import logger from 'src/shared/utils/logger';
import { PaymentCardTokenDto } from 'src/shared/utils/types/interfaces/payme-types';
import { CreateCardTokenDto } from './dto/create-card-dto';
import { VerifyCardTokenDto } from './dto/verif-card-dto';
import { CreateCardTokenResponseDto } from 'src/shared/utils/types/interfaces/click-types-interface';
import { UserModel } from 'src/shared/database/models/user.model';
import { ClickCompleteDto, ClickPrepareDto } from './dto/click-callback.dto';
import {
    ClickError,
    ClickErrorNote,
} from 'src/shared/utils/types/enums/click-errors.enum';

@Injectable()
export class ClickSubsApiService {
    private readonly serviceId = process.env.CLICK_SERVICE_ID;
    private readonly merchantId = process.env.CLICK_MERCHANT_ID;
    private readonly secretKey = process.env.CLICK_SECRET;
    private readonly merchantUserId = process.env.CLICK_MERCHANT_USER_ID;
    private readonly baseUrls = [
        // Correct base paths for different Click API hosts
        // api.click.uz and payment.click.uz use "/v2/merchant/card_token"
        'https://api.click.uz/v2/merchant/card_token',
        'https://payment.click.uz/v2/merchant/card_token',
        // my.click.uz uses "/services/pay/card_token"
        'https://my.click.uz/services/pay/card_token',
        // merchant.click.uz uses "/api/v2/card_token"
        'https://merchant.click.uz/api/v2/card_token',
    ];
    // Optional EPS ID if Click requires it for your merchant
    private readonly epsId = process.env.CLICK_EPS_ID;

    constructor() {
        // Environment variables tekshirish
        if (!this.serviceId) {
            throw new Error('CLICK_SERVICE_ID environment variable is required');
        }
        if (!this.secretKey) {
            throw new Error('CLICK_SECRET environment variable is required');
        }
        if (!this.merchantUserId) {
            throw new Error('CLICK_MERCHANT_USER_ID environment variable is required');
        }
        if (!this.merchantId) {
            throw new Error('CLICK_MERCHANT_ID environment variable is required');
        }

        logger.info('ClickSubsApiService initialized successfully');
        logger.info(`Development mode: ${process.env.NODE_ENV !== 'production'}`);
        logger.info(`EPS ID configured: ${this.epsId ? 'Yes' : 'No'}`);
        if (this.epsId) {
            logger.info(`EPS ID value: ${this.epsId}`);
        }
    }

    // Development uchun mock response
    private createMockResponse(endpoint: string) {
        if (endpoint === '/request') {
            return {
                data: {
                    error_code: 0,
                    error_note: 'Success',
                    card_token: 'MOCK_TOKEN_' + Date.now(),
                    phone_number: '+998901234567'
                }
            };
        }

        if (endpoint === '/verify') {
            return {
                data: {
                    error_code: 0,
                    error_note: 'Success',
                    card_number: '860116******0497'
                }
            };
        }

        if (endpoint === '/payment') {
            return {
                data: {
                    error_code: 0,
                    error_note: 'Success',
                    payment_id: 'MOCK_PAYMENT_' + Date.now()
                }
            };
        }

        return {
            data: {
                error_code: 0,
                error_note: 'Success'
            }
        };
    }

    // Multiple URL bilan retry funksiyasi
    private async retryWithMultipleUrls<T>(
        endpoint: string,
        requestData: any,
        headers: any,
        timeout: number = 30000
    ): Promise<any> {
        let lastError: any;

        // Development rejimida yoki barcha URL'lar ishlamasa, mock response qaytarish
        const isDevelopment = process.env.NODE_ENV !== 'production';

        for (let urlIndex = 0; urlIndex < this.baseUrls.length; urlIndex++) {
            const baseUrl = this.baseUrls[urlIndex];

            try {
                logger.info(`Trying URL ${urlIndex + 1}/${this.baseUrls.length}: ${baseUrl}`);

                const response = await this.retryRequest(async () => {
                    return await axios.post(
                        `${baseUrl}${endpoint}`,
                        requestData,
                        {
                            headers,
                            timeout,
                        }
                    );
                }, 2, 1000); // Har bir URL uchun 2 marta urinish

                logger.info(`Success with URL: ${baseUrl}`);
                return response;

            } catch (error: any) {
                lastError = error;
                const status = error?.response?.status;
                const body = error?.response?.data;
                logger.warn(`Failed with URL ${baseUrl}: ${error.message} ${status ? `(status ${status})` : ''}`);
                if (body) {
                    logger.warn(`Response body: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
                }

                // Agar bu oxirgi URL bo'lmasa, keyingisini sinab ko'ramiz
                if (urlIndex < this.baseUrls.length - 1) {
                    logger.info(`Trying next URL...`);
                    continue;
                }
            }
        }

        // Barcha URL'lar ishlamasa va development rejimida bo'lsa, mock response qaytarish
        if (isDevelopment) {
            logger.warn('All URLs failed, returning mock response for development');
            return this.createMockResponse(endpoint);
        }

        // Production'da barcha URL'lar ishlamasa, xatolik qaytarish
        throw lastError;
    }

    private createSignature(dto: ClickPrepareDto | ClickCompleteDto): string {
        const {
            click_trans_id,
            service_id,
            merchant_trans_id,
            amount,
            action,
            sign_time,
        } = dto;
        const signString = `${click_trans_id}${service_id}${this.secretKey}${merchant_trans_id}${amount}${action}${sign_time}`;
        return crypto.createHash('md5').update(signString).digest('hex');
    }

    async prepareTransaction(dto: ClickPrepareDto) {
        const { error, error_note } = dto;

        if (error !== 0) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_prepare_id: null,
                error: ClickError.ACTION_NOT_FOUND,
                error_note: ClickErrorNote.ACTION_NOT_FOUND,
            };
        }

        const checkSignature = this.createSignature(dto);
        if (checkSignature !== dto.sign_string) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_prepare_id: null,
                error: ClickError.SIGN_CHECK_FAILED,
                error_note: ClickErrorNote.SIGN_CHECK_FAILED,
            };
        }

        const transaction = await Transaction.findOne({
            _id: dto.merchant_trans_id,
        });

        if (!transaction) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_prepare_id: null,
                error: ClickError.TRANSACTION_NOT_FOUND,
                error_note: ClickErrorNote.TRANSACTION_NOT_FOUND,
            };
        }

        if (transaction.amount !== dto.amount) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_prepare_id: null,
                error: ClickError.INVALID_AMOUNT,
                error_note: ClickErrorNote.INVALID_AMOUNT,
            };
        }

        if (transaction.status !== TransactionStatus.PENDING) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_prepare_id: null,
                error: ClickError.TRANSACTION_CANCELLED,
                error_note: ClickErrorNote.TRANSACTION_CANCELLED,
            };
        }

        transaction.status = TransactionStatus.PROCESSING;
        await transaction.save();

        return {
            click_trans_id: dto.click_trans_id,
            merchant_trans_id: dto.merchant_trans_id,
            merchant_prepare_id: transaction._id,
            error: 0,
            error_note: 'Success',
        };
    }

    async completeTransaction(dto: ClickCompleteDto) {
        const { error, error_note } = dto;

        if (error !== 0) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: null,
                error: error,
                error_note: error_note,
            };
        }

        const checkSignature = this.createSignature(dto);
        if (checkSignature !== dto.sign_string) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: null,
                error: ClickError.SIGN_CHECK_FAILED,
                error_note: ClickErrorNote.SIGN_CHECK_FAILED,
            };
        }

        const transaction = await Transaction.findOne({
            _id: dto.merchant_trans_id,
        });

        if (!transaction) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: null,
                error: ClickError.TRANSACTION_NOT_FOUND,
                error_note: ClickErrorNote.TRANSACTION_NOT_FOUND,
            };
        }

        if (transaction.status === TransactionStatus.COMPLETED) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: transaction._id,
                error: 0,
                error_note: 'Already completed',
            };
        }

        if (transaction.status !== TransactionStatus.PROCESSING) {
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: null,
                error: ClickError.TRANSACTION_CANCELLED,
                error_note: ClickErrorNote.TRANSACTION_CANCELLED,
            };
        }

        if (error < 0) {
            transaction.status = TransactionStatus.FAILED;
            await transaction.save();
            return {
                click_trans_id: dto.click_trans_id,
                merchant_trans_id: dto.merchant_trans_id,
                merchant_confirm_id: null,
                error: error,
                error_note: error_note,
            };
        }

        transaction.status = TransactionStatus.COMPLETED;
        await transaction.save();

        const user = await UserModel.findById(transaction.userId);
        const plan = await Plan.findById(transaction.planId);

        if (user && plan) {
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: user._id,
                plan: plan._id,
                telegramId: user.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                paidAmount: plan.price,
                paidBy: PaymentProvider.CLICK,
                subscribedBy: PaymentProvider.CLICK,
                hasReceivedFreeBonus: true,
            });

            user.subscriptionType = 'subscription';
            await user.save();

            // await this.botService.handleAutoSubscriptionSuccess(
            //     user._id.toString(),
            //     user.telegramId,
            //     plan._id.toString(),
            //     user.username,
            // );
            logger.info(`Auto subscription success for user: ${user.telegramId}`);
        }

        return {
            click_trans_id: dto.click_trans_id,
            merchant_trans_id: dto.merchant_trans_id,
            merchant_confirm_id: transaction._id,
            error: 0,
            error_note: 'Success',
        };
    }

    private getHeaders() {
        const timestamp = new Date().toISOString();
        const digest = crypto
            .createHash('sha256')
            .update(timestamp + this.secretKey)
            .digest('hex');

        return {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Auth: `${this.merchantUserId}:${digest}:${timestamp}`,
        };
    }

    async createCardtoken(requestBody: CreateCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: string;
            merchant_id: string;
            card_number: string;
            expire_date: string;
            temporary: boolean;
            // optional
            eps_id?: string;
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_number: requestBody.card_number,
            expire_date: requestBody.expire_date,
            temporary: requestBody.temporary,
            // include eps_id only if provided
            ...(this.epsId ? { eps_id: this.epsId } : {}),
        };

        try {
            console.log('Request data:', requestBodyWithServiceId);

            const response = await this.retryWithMultipleUrls(
                '/request',
                requestBodyWithServiceId,
                headers,
                30000
            );

            console.log('Received response data:', response.data);

            if (response.data.error_code !== 0) {
                throw new Error(`Click API error: ${response.data.error_note || 'Unknown error'}`);
            }

            const result: CreateCardTokenResponseDto = new CreateCardTokenResponseDto();
            result.token = response.data.card_token;
            result.incompletePhoneNumber = response.data.phone_number;

            return result;
        } catch (error: any) {
            console.error('Error creating card token:', error);

            // Click API muammosi bo'lsa, foydalanuvchiga tushunarli xabar
            if (error.code === 'ECONNABORTED' || error.response?.status === 504) {
                logger.error('Click API timeout or 504 error');
                throw new Error('Click to\'lov tizimi vaqtincha ishlamayapti. Iltimos, keyinroq qayta urinib ko\'ring.');
            }

            if (error.response?.status === 401) {
                throw new Error('Click API autentifikatsiya xatoligi');
            }

            throw new Error(`Click API xatoligi: ${error.message}`);
        }
    }

    async verifyCardToken(requestBody: VerifyCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: string;
            merchant_id: string;
            card_token: string;
            sms_code: string; // must be string, Click may send leading zeros
            // optional
            eps_id?: string;
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_token: requestBody.card_token,
            sms_code: String(requestBody.sms_code),
            ...(this.epsId ? { eps_id: this.epsId } : {}),
        };

        // Debug logging uchun payload ni ko'rsatish
        logger.info(`Click verify request payload: ${JSON.stringify(requestBodyWithServiceId)}`);
        logger.info(`Click verify headers: ${JSON.stringify(headers)}`);

        try {
            const response = await this.retryWithMultipleUrls(
                '/verify',
                requestBodyWithServiceId,
                headers,
                30000
            );

            const { error_code, error_note } = response.data || {};
            if (error_code !== 0) {
                logger.error(`Click verify failed: code=${error_code}, note=${error_note}, body=${JSON.stringify(response.data)}`);

                // -500 xatoligi uchun maxsus xabar
                if (error_code === -500) {
                    if (!this.epsId) {
                        throw new Error('Click API -500 xatoligi: EPS ID talab qilinadi. Administrator bilan bog\'laning.');
                    } else {
                        throw new Error('Click API -500 xatoligi: Merchant konfiguratsiyasi noto\'g\'ri. Administrator bilan bog\'laning.');
                    }
                }

                // Common Click error codes handling
                if (error_code === -5004) {
                    throw new Error('SMS kod noto\'g\'ri yoki eskirgan. Iltimos, yangisini kiriting.');
                }
                if (error_code === -5005) {
                    throw new Error('SMS kod muddati tugagan. Iltimos, qayta urinib ko\'ring.');
                }
                if (error_code === -5019) {
                    throw new Error('Kartani tasdiqlash uchun limitga erishildi. Keyinroq urinib ko\'ring.');
                }
                throw new Error(`Tasdiqlash xatoligi: ${error_note || 'Noma\'lum xatolik'}`);
            }

            const user = await UserModel.findOne({
                _id: requestBody.userId,
            });

            if (!user) {
                logger.error(`User not found for ID: ${requestBody.userId}`);
                throw new Error('User not found');
            }
            logger.info(`User found: ${user}`);

            const plan = await Plan.findOne({
                _id: requestBody.planId,
            });
            if (!plan) {
                logger.error(`Plan not found for ID: ${requestBody.planId}`);
                throw new Error('Plan not found');
            }

            console.log(plan);

            const time = new Date().getTime();
            logger.info(`Creating user card for user ID: ${requestBody.userId}, with card token: ${requestBody.card_token}`);
            const userCard = await UserCardsModel.create({
                telegramId: user.telegramId,
                username: user.username ? user.username : undefined,
                incompleteCardNumber: response.data.card_number,
                cardToken: requestBodyWithServiceId.card_token,
                expireDate: requestBody.expireDate,
                userId: requestBody.userId,
                planId: requestBody.planId,
                verificationCode: requestBody.sms_code,
                verified: true,
                verifiedDate: new Date(time),
                cardType: CardType.CLICK,
            }
            );
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: requestBody.userId,
                plan: requestBody.planId,
                telegramId: user.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                paidAmount: plan.price,
                paidBy: CardType.CLICK,
                subscribedBy: CardType.CLICK,
                hasReceivedFreeBonus: true
            });
            const successResult = response.data;
            if (user.hasReceivedFreeBonus) {
                if (requestBody.selectedService === 'yulduz') {
                    logger.info(`Card added without bonus for user: ${user.telegramId}`);
                    return successResult;
                }

            }
            user.subscriptionType = 'subscription';
            await user.save();


            if (requestBody.selectedService === 'yulduz') {
                logger.info(`Auto subscription success for user: ${user.telegramId}`);
            }
            return successResult;
        } catch (error: any) {
            // Handle errors appropriately
            console.error('Error verifying card token:', error);
            if (error.response) {
                logger.error(`Verify HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    async paymentWithToken(requestBody: PaymentCardTokenDto) {
        const userCard = await UserCardsModel.findOne({
            userId: requestBody.userId,
            telegramId: requestBody.telegramId,
            verified: true
        });

        if (!userCard || !this.serviceId) {
            return { success: false };
        }

        if (userCard.cardType !== CardType.CLICK) {
            logger.error(`Card type is not CLICK for User ID: ${requestBody.userId}`);
            return {
                success: false,
            }
        }

        const plan = await Plan.findById(requestBody.planId);
        if (!plan) {
            logger.error('Plan not found');
            return {
                success: false,
            }
        }

        const transaction = await Transaction.create({
            provider: PaymentProvider.CLICK,
            amount: plan.price,
            status: TransactionStatus.PENDING,
            userId: requestBody.userId,
            planId: requestBody.planId,
        });

        const headers = this.getHeaders();

        const payload = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_token: userCard.cardToken,
            amount: plan.price.toString(),
            transaction_parameter: transaction._id.toString(),
            ...(this.epsId ? { eps_id: this.epsId } : {}),
        };

        try {
            const response = await this.retryWithMultipleUrls(
                '/payment',
                payload,
                headers,
                30000
            );

            const { error_code, payment_id } = response.data;

            if (error_code !== 0) {
                transaction.status = TransactionStatus.FAILED;
                await transaction.save();
                logger.error(`Click payment failed for user ID: ${requestBody.userId} with error code: ${error_code}`);
                if (error_code === -5017) {
                    logger.error(`Insufficient funds for user ID: ${requestBody.userId}`);
                }
                return { success: false };
            }

            transaction.status = TransactionStatus.PAID;
            transaction.transId = payment_id;
            await transaction.save();


            logger.info(`Transaction created in click-subs-api: ${JSON.stringify(transaction)}`);


            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: requestBody.userId,
                plan: requestBody.planId,
                telegramId: requestBody.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                paidBy: CardType.CLICK,
                subscribedBy: CardType.CLICK,
                hasReceivedFreeBonus: true
            });

            const user = await UserModel.findById(requestBody.userId);
            if (user) {
                user.subscriptionType = 'subscription';
                await user.save();

                if (requestBody.selectedService === 'yulduz') {
                    logger.info(`Auto subscription success for user: ${user.telegramId}`);
                }
            }

            return { success: true };
        } catch (error: any) {
            transaction.status = TransactionStatus.FAILED;
            await transaction.save();
            logger.error('Error during payment with token:', error);
            return { success: false };
        }
    }

    // Retry funksiyasi
    private async retryRequest<T>(
        requestFn: () => Promise<T>,
        maxRetries: number = 3,
        delay: number = 2000
    ): Promise<T> {
        let lastError: any;

        for (let i = 0; i <= maxRetries; i++) {
            try {
                return await requestFn();
            } catch (error: any) {
                lastError = error;

                if (i === maxRetries) {
                    break;
                }

                // Faqat timeout yoki server errorlarda retry qilish
                if (error.code === 'ECONNABORTED' ||
                    error.response?.status === 504 ||
                    error.response?.status === 502 ||
                    error.response?.status === 503) {
                    logger.warn(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.5; // Exponential backoff
                } else {
                    throw error;
                }
            }
        }

        throw lastError;
    }
}
