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

    // Professional Click API endpoints (hozircha faqat rasmiy API bazasi bilan cheklaymiz)
    private readonly cardTokenUrls = [
        // Asosiy rasmiy baza
        'https://api.click.uz/v2/merchant',
        // Normalizatsiya test uchun (agar ichki routing slash farq qilsa)
        'https://api.click.uz/v2/merchant/'
    ];

    constructor(private readonly configService: ConfigService) {
        this.serviceId = (this.configService.get<string>('CLICK_SERVICE_ID') || '').trim();
        this.merchantId = (this.configService.get<string>('CLICK_MERCHANT_ID') || '').trim();
        // secretKey trimming – oxirida \n yoki space bo'lsa digest noto'g'ri bo'ladi
        this.secretKey = (this.configService.get<string>('CLICK_SECRET') || '').trim();
        this.merchantUserId = (this.configService.get<string>('CLICK_MERCHANT_USER_ID') || '').trim();

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
        const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp (10 digits)
        const digest = crypto
            .createHash('sha1')
            .update(String(timestamp) + this.secretKey)
            .digest('hex');

        // Diagnostika uchun qisqa log (faqat birinchi 6 va oxirgi 4)
        logger.debug(`[CLICK AUTH] ts=${timestamp} (len=${String(timestamp).length}) digest=${digest.slice(0, 6)}...${digest.slice(-4)} len=${digest.length}`);

        if (String(timestamp).length !== 10) {
            logger.error('Timestamp 10 xonali emas! Click Auth ishlamaydi.');
        }
        if (digest.length !== 40) {
            logger.error('SHA1 digest uzunligi 40 emas! Secret noto\'g\'ri yoki trim kerak.');
        }

        return {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Auth': `${this.merchantUserId}:${digest}:${timestamp}`,
        };
    }

    private buildUrl(base: string, endpoint: string) {
        return `${base.replace(/\/+$/, '')}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
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
            const fullUrl = this.buildUrl(baseUrl, endpoint);

            try {
                logger.info(`Trying URL ${urlIndex + 1}/${this.cardTokenUrls.length}: ${fullUrl}`);
                logger.info(`Request data: ${JSON.stringify(requestData)}`);
                logger.info(`Auth header (masked): ${headers.Auth?.split(':')[0]}:****:${headers.Auth?.split(':')[2]}`);

                const response = await this.retryRequest(async () => {
                    return await axios.post(fullUrl, requestData, {
                        headers,
                        timeout,
                        maxRedirects: 0, // Redirect bo'lsa darhol ushlaymiz
                        validateStatus: () => true // JSON emas bo'lsa ham ko'rib chiqamiz
                    });
                }, 1, 800);

                const contentType = response.headers?.['content-type'] || '';

                // Redirect ni aniqlash (302/301) – ko'pincha HTML portalga olib keladi
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    logger.error(`❌ Redirect qaytdi (status=${response.status}). Bu API emas, HTML portalga yo'naltirilmoqda.`);
                    throw new Error('REDIRECT_RESPONSE');
                }

                logger.info(`Response Status: ${response.status}`);
                logger.info(`Response Content-Type: ${contentType}`);

                if (typeof response.data === 'string') {
                    // HTML portal qaytganini aniqlash
                    const sample = response.data.slice(0, 120).replace(/\n/g, ' ');
                    if (response.data.startsWith('<!DOCTYPE html') || contentType.includes('text/html')) {
                        logger.error('❌ Click API HTML sahifa qaytardi (Portal/Website o\'rniga API).');
                        logger.error(`   HTML first 120 chars: ${sample}`);
                        throw new Error('HTML_RESPONSE');
                    }
                }

                if (contentType && !contentType.includes('application/json') && typeof response.data !== 'object') {
                    logger.error(`❌ Kutilgan JSON emas. Content-Type: ${contentType}`);
                    throw new Error('NON_JSON_RESPONSE');
                }

                if (response.status === 403) {
                    logger.error('❌ 403 Forbidden – IP whitelisting yoki ruxsat berilmagan servis');
                    throw new Error('FORBIDDEN_RESPONSE');
                }

                if (response.status === 401) {
                    logger.error('❌ 401 Unauthorized – Auth header yoki secret noto\'g\'ri');
                    throw new Error('UNAUTHORIZED_RESPONSE');
                }

                if (response.status === 404 || (response.data && response.data.error_code === -404)) {
                    logger.error(`❌ Click API 404: Resource not found -> ${fullUrl}`);
                    throw new Error('RESOURCE_NOT_FOUND');
                }

                logger.info(`✅ SUCCESS with URL: ${fullUrl}`);
                logger.debug(`Raw response: ${typeof response.data === 'object' ? JSON.stringify(response.data) : '[non-json]'}`);
                return response;

            } catch (error: any) {
                lastError = error;

                const map: Record<string, string> = {
                    'HTML_RESPONSE': '❌ Click API JSON o\'rniga HTML portal sahifasini qaytardi. card_token servisi yoqilmagan yoki noto\'g\'ri URL / IP whitelist. Support bilan bog\'laning.',
                    'NON_JSON_RESPONSE': '❌ Click API noto\'g\'ri format (JSON emas). Endpoint aktiv emas yoki orada proxy HTML qo\'yib yuboryapti.',
                    'RESOURCE_NOT_FOUND': '❌ 404: Service/Merchant kombinatsiyasi Click tizimida yoqilmagan. Supportdan faollashtiring.',
                    'REDIRECT_RESPONSE': '❌ Redirect xolati: API emas, HTML portalga yo\'naltirish. IP yoki endpoint faollashtirilmagan.',
                    'FORBIDDEN_RESPONSE': '❌ 403 Forbidden: IP whitelisting yoqilmagan yoki ruxsat berilmagan servis.',
                    'UNAUTHORIZED_RESPONSE': '❌ 401 Unauthorized: Auth noto\'g\'ri. merchant_user_id / secret / vaqtni tekshiring.'
                };
                if (map[error.message]) {
                    lastError = new Error(map[error.message]);
                }

                const status = error?.response?.status;
                logger.error(`❌ FAILED URL ${fullUrl} status=${status} message=${lastError.message}`);
                if (error?.response?.data && typeof error.response.data !== 'string') {
                    logger.error(`   Body: ${JSON.stringify(error.response.data)}`);
                }

                if (urlIndex < this.cardTokenUrls.length - 1) {
                    logger.info('⏭️ Next base URL bilan urinib ko\'riladi...');
                    continue;
                }
            }
        }

        throw lastError;
    }

    async createCardtoken(requestBody: CreateCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: number;
            merchant_id: number;
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
            service_id: Number(this.serviceId),
            merchant_id: Number(this.merchantId),
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

            // HTML fallback holatini qo'shimcha tekshirish
            if (typeof response.data === 'string' && response.data.startsWith('<!DOCTYPE html')) {
                throw new Error('Click API HTML portal sahifasini qaytardi. card_token endpoint hali yoqilmagan yoki noto\'g\'ri domen ishlatilgan.');
            }

            if (response.data.error_code !== 0) {
                const code = response.data.error_code;
                const note = response.data.error_note || 'Unknown error';
                logger.error(`❌ Click create card token failed: code=${code}, note=${note}`);

                // Maxsus xatolik xabarlari
                if (code === -404) {
                    throw new Error(`❌ Click Card Token servisi topilmadi (-404)
🔍 Sabab: Service ID va Merchant ID kombinatsiyasi noto'g'ri
📋 Sizning ma'lumotlar:
   - Service ID: ${this.serviceId}
   - Merchant ID: ${this.merchantId}
   - Merchant User ID: ${this.merchantUserId}
   
📞 Click support: +998 71 200 09 09 
📧 support@click.uz
💡 So'rang: "card_token servisini production da yoqing"`);
                }
                if (code === -500) {
                    throw new Error('❌ Click ichki server xatoligi (-500)\n🔧 Merchant sozlamalari yoki servis statusini tekshiring\n📞 Click support: +998 71 200 09 09');
                }
                if (code === -401) {
                    throw new Error(`❌ Auth xatoligi (-401)
🔐 Tekshiring:
   - merchant_user_id: ${this.merchantUserId}
   - secret_key to'g'ri ekanligini
   - server vaqti to'g'ri ekanligini (${new Date().toISOString()})
📞 Click support: +998 71 200 09 09`);
                }
                if (code === -5014) {
                    throw new Error('❌ Karta raqami noto\'g\'ri yoki qo\'llab-quvvatlanmaydi\n💳 To\'g\'ri format: 8600 1234 1234 1234');
                }
                if (code === -5019) {
                    throw new Error('❌ Limitga erishildi\n⏰ Keyinroq urinib ko\'ring (10-15 daqiqadan so\'ng)');
                }
                throw new Error(`❌ Click API xatoligi: ${note} (kod: ${code})\n📞 Yordam: +998 71 200 09 09`);
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
                        incompleteCardNumber: sanitizedCardNumber,
                        expireDate: sanitizedExpireDate,
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

            if (error.message?.includes('HTML portal')) {
                throw new Error(error.message + ' (CARD_TOKEN SERVISINI CLICK TOMONIDAN YOQDIRING)');
            }
            if (error.code === 'ECONNABORTED' || error.response?.status === 504) {
                throw new Error('Click API timeout. Tarmoq yoki Click server muammosi.');
            }
            if (error.response?.status === 401) {
                throw new Error('Click API autentifikatsiya xatoligi (401).');
            }
            if (error.response?.status === 403) {
                throw new Error('Click API ruxsat etilmagan (403). IP yoki servis bloklangan.');
            }
            throw new Error(`Click API xatoligi: ${error.message}`);
        }
    }

    async verifyCardToken(requestBody: VerifyCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: number; // was string -> align with createCardtoken
            merchant_id: number; // was string -> align with createCardtoken
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
            service_id: Number(this.serviceId),
            merchant_id: Number(this.merchantId),
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

            const expireDateToSave = requestBody.expireDate || storedCard?.expireDate;
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
            service_id: Number(this.serviceId),
            merchant_id: Number(this.merchantId),
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

            if (!userCard || !userCard.incompleteCardNumber || !userCard.expireDate) {
                throw new Error('Card token not found or original card data missing');
            }

            logger.info(`Resending SMS for card token: ${cardToken}`);

            const createDto: any = {
                card_number: userCard.incompleteCardNumber,
                expire_date: userCard.expireDate,
                temporary: false, // Cards are not temporary for Click API
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
