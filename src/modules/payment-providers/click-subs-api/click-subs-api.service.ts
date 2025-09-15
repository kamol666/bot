import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto'; // 1. crypto moduli import qilindi
import { Plan } from 'src/shared/database/models/plans.model';
import { PaymentProvider, PaymentTypes, Transaction, TransactionStatus } from 'src/shared/database/models/transactions.model';
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
    private readonly baseUrl = 'https://api.click.uz/v2/merchant';

    constructor() { }

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
            card_number: string;
            expire_date: string;
            temporary: boolean;
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }
        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            card_number: requestBody.card_number,
            expire_date: requestBody.expire_date,
            temporary: requestBody.temporary,
        };

        try {
            console.log('Request data:', requestBodyWithServiceId);
            const response = await axios.post(
                `${this.baseUrl}/card_token/request`,
                requestBodyWithServiceId,
                { headers },
            );

            console.log('Received response data:', response.data);

            if (response.data.error_code !== 0) {
                throw new Error('Response error code is not 0');
            }
            const result: CreateCardTokenResponseDto = new CreateCardTokenResponseDto();

            result.token = response.data.card_token;
            result.incompletePhoneNumber = response.data.phone_number;

            return result;
        } catch (error) {
            // Handle errors appropriately
            console.error('Error creating card token:', error);
            throw error;
        }
    }

    async verifyCardToken(requestBody: VerifyCardTokenDto) {
        const headers = this.getHeaders();

        interface RequestBody {
            service_id: string;
            card_token: string;
            sms_code: number;
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            card_token: requestBody.card_token,
            sms_code: requestBody.sms_code,
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/card_token/verify`, // Changed endpoint to verify
                requestBodyWithServiceId,
                { headers },
            );

            if (response.data.error_code !== 0) {
                throw new Error(`Verification failed: ${response.data.error_message || 'Unknown error'}`);
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
                    // await this.botService.handleCardAddedWithoutBonus(
                    //     requestBody.userId,
                    //     user.telegramId,
                    //     CardType.PAYME,
                    //     plan,
                    //     user.username,
                    //     requestBody.selectedService
                    // );
                    logger.info(`Card added without bonus for user: ${user.telegramId}`);
                    return successResult;
                }

            }
            user.subscriptionType = 'subscription'
            await user.save();


            if (requestBody.selectedService === 'yulduz') {
                logger.info(`Auto subscription success for user: ${user.telegramId}`);
            }
            return successResult;
        } catch (error) {
            // Handle errors appropriately
            console.error('Error verifying card token:', error);
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
            card_token: userCard.cardToken,
            amount: plan.price.toString(),
            transaction_parameter: transaction._id.toString(),
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/card_token/payment`,
                payload,
                { headers },
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
        } catch (error) {
            transaction.status = TransactionStatus.FAILED;
            await transaction.save();
            logger.error('Error during payment with token:', error);
            return { success: false };
        }
    }

}
