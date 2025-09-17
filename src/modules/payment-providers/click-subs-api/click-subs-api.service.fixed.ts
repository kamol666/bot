import { Injectable } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
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
import mongoose from 'mongoose';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClickSubsApiService {
    private readonly serviceId: string;
    private readonly merchantId: string;
    private readonly secretKey: string;
    private readonly merchantUserId: string;

    // Professional Click API endpoints
    private readonly cardTokenUrls = [
        'https://api.click.uz/v2/merchant',
        'https://payment.click.uz/v2/merchant',
        'https://merchant.click.uz/api/v2',
        'https://api.click.uz/merchant',
        'https://payment.click.uz/merchant',
        'https://my.click.uz/services/pay',
    ];

    constructor(private readonly configService: ConfigService) {
        this.serviceId = this.configService.get<string>('CLICK_SERVICE_ID');
        this.merchantId = this.configService.get<string>('CLICK_MERCHANT_ID');
        this.secretKey = this.configService.get<string>('CLICK_SECRET');
        this.merchantUserId = this.configService.get<string>('CLICK_MERCHANT_USER_ID');

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
        logger.info(`Environment: ${process.env.NODE_ENV}`);
        logger.info(`Service ID: ${this.serviceId}`);
        logger.info(`Merchant ID: ${this.merchantId}`);
        logger.info(`Merchant User ID: ${this.merchantUserId}`);
    }

    private getHeaders() {
        const timestamp = new Date().toISOString();
        const digest = crypto
            .createHash('sha256')
            .update(timestamp + this.secretKey)
            .digest('hex');

        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Auth': `${this.merchantUserId}:${digest}:${timestamp}`,
            'User-Agent': 'BotClic/1.0',
            'X-Requested-With': 'XMLHttpRequest',
        };
    }

    private async retryWithMultipleUrls<T>(
        endpoint: string,
        requestData: any,
        headers: any,
        timeout: number = 30000
    ): Promise<any> {
        let lastError: any;

        for (let urlIndex = 0; urlIndex < this.cardTokenUrls.length; urlIndex++) {
            const baseUrl = this.cardTokenUrls[urlIndex];
            const fullUrl = `${baseUrl}${endpoint}`;

            try {
                logger.info(`Trying URL ${urlIndex + 1}/${this.cardTokenUrls.length}: ${fullUrl}`);
                logger.info(`Request data: ${JSON.stringify(requestData)}`);
                logger.info(`Request headers: ${JSON.stringify(headers)}`);

                const response = await this.retryRequest(async () => {
                    return await axios.post(fullUrl, requestData, {
                        headers,
                        timeout,
                    });
                }, 2, 1000);

                logger.info(`✅ SUCCESS with URL: ${fullUrl}`);
                logger.info(`Response: ${JSON.stringify(response.data)}`);
                return response;

            } catch (error: any) {
                lastError = error;
                const status = error?.response?.status;
                const errorCode = error?.response?.data?.error_code;
                const errorNote = error?.response?.data?.error_note;

                logger.error(`❌ FAILED with URL ${fullUrl}`);
                logger.error(`Status: ${status}, Error Code: ${errorCode}, Error Note: ${errorNote}`);

                if (error?.response?.data) {
                    logger.error(`Response body: ${JSON.stringify(error.response.data)}`);
                }

                if (errorCode === -404) {
                    logger.warn(`Resource not found at ${fullUrl}, trying next endpoint...`);
                    continue;
                }

                if (urlIndex < this.cardTokenUrls.length - 1) {
                    logger.info(`⏭️ Trying next URL...`);
                    continue;
                }
            }
        }

        const errorCode = lastError?.response?.data?.error_code;
        if (errorCode === -404) {
            throw new Error('Click Card Token API topilmadi. Merchant konfiguratsiyasi noto\'g\'ri. Click support: +998 71 200 09 09');
        }

        throw lastError;
    }

    async createCardtoken(requestBody: CreateCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: string;
            merchant_id: string;
            card_number: string;
            expire_date: string;
            temporary: number;
        }

        if (!this.serviceId || !this.merchantId) {
            throw new Error('Service ID or Merchant ID is not defined');
        }

        const sanitizedCardNumber = (requestBody.card_number || '').replace(/\s+/g, '');
        const sanitizedExpireDate = (requestBody.expire_date || '').replace(/\D/g, '');

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_number: sanitizedCardNumber,
            expire_date: sanitizedExpireDate,
            temporary: requestBody.temporary ? 1 : 0,
        };

        try {
            console.log('🔄 Starting card token creation...');
            console.log('Request data:', requestBodyWithServiceId);

            const response = await this.retryWithMultipleUrls(
                '/card_token',
                requestBodyWithServiceId,
                headers,
                30000
            );

            console.log('✅ Received response data:', response.data);

            if (response.data.error_code !== 0) {
                const code = response.data.error_code;
                const note = response.data.error_note || 'Unknown error';
                logger.error(`Click create card token failed: code=${code}, note=${note}`);

                if (code === -404) {
                    throw new Error('Click Card Token servisi topilmadi. Merchant konfiguratsiyasi noto\'g\'ri. Click: +998 71 200 09 09');
                }
                if (code === -500) {
                    throw new Error('Click ichki xatolik. Merchant settings bilan muammo. Click support: +998 71 200 09 09');
                }
                if (code === -5014) {
                    throw new Error('Karta raqami noto\'g\'ri yoki qo\'llab-quvvatlanmaydi.');
                }
                if (code === -5019) {
                    throw new Error('Limitga erishildi. Keyinroq urinib ko\'ring.');
                }
                if (code === -401) {
                    throw new Error('Click API autentifikatsiya xatoligi. Credentials noto\'g\'ri.');
                }
                throw new Error(`Click API error: ${note} (kod: ${code})`);
            }

            const result: CreateCardTokenResponseDto = new CreateCardTokenResponseDto();
            result.token = response.data.card_token;
            result.incompletePhoneNumber = response.data.phone_number;

            try {
                await UserCardsModel.findOneAndUpdate(
                    { telegramId: requestBody.telegramId },
                    {
                        telegramId: requestBody.telegramId,
                        userId: new mongoose.Types.ObjectId(requestBody.userId),
                        planId: new mongoose.Types.ObjectId(requestBody.planId),
                        cardToken: response.data.card_token,
                        originalCardNumber: sanitizedCardNumber,
                        originalExpireDate: sanitizedExpireDate,
                        isTemporary: !!requestBody.temporary,
                        verified: false,
                        cardType: CardType.CLICK,
                    },
                    { upsert: true, new: true }
                );
                logger.info(`Card token saved for user: ${requestBody.telegramId}`);
            } catch (saveError) {
                logger.warn('Failed to save card token:', saveError);
            }

            return result;
        } catch (error: any) {
            console.error('Error creating card token:', error);

            if (error.code === 'ECONNABORTED' || error.response?.status === 504) {
                throw new Error('Click API timeout. Tarmoq yomon yoki Click server ishlamayapti.');
            }

            if (error.response?.status === 401) {
                throw new Error('Click API autentifikatsiya xatoligi.');
            }

            if (error.response?.status === 403) {
                throw new Error('Click API ruxsat yo\'q. Merchant faol emas yoki IP cheklangan.');
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
            sms_code: string;
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const storedCard = await UserCardsModel.findOne({
            cardToken: requestBody.card_token
        });

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_token: requestBody.card_token,
            sms_code: String(requestBody.sms_code),
        };

        logger.info(`Click verify request payload: ${JSON.stringify(requestBodyWithServiceId)}`);
        logger.info(`Click verify headers: ${JSON.stringify(headers)}`);

        try {
            const response = await this.retryWithMultipleUrls(
                '/card_token',
                requestBodyWithServiceId,
                headers,
                30000
            );

            const { error_code, error_note } = response.data || {};
            if (error_code !== 0) {
                logger.error(`Click verify failed: code=${error_code}, note=${error_note}`);

                if (error_code === -500) {
                    throw new Error('Click API -500 xatoligi: Merchant konfiguratsiyasi noto\'g\'ri.');
                }
                if (error_code === -5004) {
                    throw new Error('SMS kod noto\'g\'ri yoki eskirgan.');
                }
                if (error_code === -5005) {
                    throw new Error('SMS kod muddati tugagan.');
                }
                if (error_code === -5019) {
                    throw new Error('Kartani tasdiqlash limitga erishildi.');
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

            const plan = await Plan.findOne({
                _id: requestBody.planId,
            });
            if (!plan) {
                logger.error(`Plan not found for ID: ${requestBody.planId}`);
                throw new Error('Plan not found');
            }

            const expireDateToSave = requestBody.expireDate || storedCard?.originalExpireDate;
            const time = new Date().getTime();

            const userCard = await UserCardsModel.findOneAndUpdate(
                { telegramId: user.telegramId },
                {
                    telegramId: user.telegramId,
                    username: user.username ? user.username : undefined,
                    incompleteCardNumber: response.data.card_number,
                    cardToken: requestBodyWithServiceId.card_token,
                    expireDate: expireDateToSave,
                    userId: user._id,
                    planId: plan._id,
                    verificationCode: requestBody.sms_code,
                    verified: true,
                    verifiedDate: new Date(time),
                    cardType: CardType.CLICK,
                },
                { upsert: true, new: true }
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
            return { success: false };
        }

        const plan = await Plan.findById(requestBody.planId);
        if (!plan) {
            logger.error('Plan not found');
            return { success: false };
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
        } as any;

        try {
            const response = await this.retryWithMultipleUrls(
                '/payment',
                payload,
                headers,
                30000
            );

            const { error_code, payment_id, error_note } = response.data;

            if (error_code !== 0) {
                transaction.status = TransactionStatus.FAILED;
                await transaction.save();
                logger.error(`Click payment failed: code=${error_code}, note=${error_note}`);
                return { success: false };
            }

            transaction.status = TransactionStatus.PAID;
            transaction.transId = payment_id;
            await transaction.save();

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
            }

            return { success: true };
        } catch (error: any) {
            transaction.status = TransactionStatus.FAILED;
            await transaction.save();
            logger.error('Error during payment with token:', error);
            return { success: false };
        }
    }

    async resendSmsCode(cardToken: string) {
        try {
            const userCard = await UserCardsModel.findOne({
                cardToken: cardToken
            });

            if (!userCard || !userCard.originalCardNumber || !userCard.originalExpireDate) {
                throw new Error('Card token not found or original card data missing');
            }

            logger.info(`Resending SMS for card token: ${cardToken}`);

            const createDto: any = {
                card_number: userCard.originalCardNumber,
                expire_date: userCard.originalExpireDate,
                temporary: userCard.isTemporary || false,
                telegramId: userCard.telegramId,
                userId: userCard.userId?.toString(),
                planId: userCard.planId?.toString(),
            };

            const result = await this.createCardtoken(createDto);

            if (result.token) {
                logger.info(`SMS resent successfully. New token: ${result.token}`);
                return {
                    success: true,
                    message: 'SMS kod qayta yuborildi',
                    new_token: result.token,
                    phone_number: result.incompletePhoneNumber
                };
            } else {
                throw new Error('Failed to create new card token');
            }
        } catch (error: any) {
            logger.error('Error resending SMS code:', error);
            return {
                success: false,
                message: error.message || 'SMS kod qayta yuborishda xatolik'
            };
        }
    }

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

                if (error.code === 'ECONNABORTED' ||
                    error.response?.status === 504 ||
                    error.response?.status === 502 ||
                    error.response?.status === 503) {
                    logger.warn(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 1.5;
                } else {
                    throw error;
                }
            }
        }

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
}
