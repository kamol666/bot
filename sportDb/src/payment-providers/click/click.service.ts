import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {ClickRequest} from './types/click-request.type';
import {PaymentTypes, Transaction, TransactionStatus} from "../../database/models/transactions.model";
import {ClickAction, ClickError} from "./enums";
import {UserModel} from "../../database/models/user.model";
import {Plan} from "../../database/models/plans.model";
import {SubscriptionBot} from "../../bot/bot";
import {generateMD5} from "../../utils/hashing/hasher.helper";
import logger from "../../utils/logger";
import {UserSubscription} from "../../database/models/user-subscription.model";
import {CardType} from "../../database/models/user-cards.model";


@Injectable()
export class ClickService {
    private readonly secretKey: string;
    private readonly botService: SubscriptionBot;


    constructor(
        private readonly configService: ConfigService,
    ) {
        this.botService = new SubscriptionBot();
        const secretKey = this.configService.get<string>('CLICK_SECRET');
        if (!secretKey) {
            throw new Error('CLICK_SECRET is not defined in the configuration');
        }
        this.secretKey = secretKey;
    }

    async handleMerchantTransactions(clickReqBody: ClickRequest) {
        const actionType = +clickReqBody.action;
        clickReqBody.amount = parseFloat(clickReqBody.amount + '');

        logger.info(`Received Click request with body in handleMerchantTransactions: ${JSON.stringify(clickReqBody)}`);


        switch (actionType) {
            case ClickAction.Prepare:
                if (clickReqBody.param3 === 'merchant') {
                    return this.prepareSubsAPI(clickReqBody);
                }
                return this.prepare(clickReqBody);
            case ClickAction.Complete:
                if (clickReqBody.param3 === 'merchant') {
                    return this.completeSubsAPI(clickReqBody);
                }
                return this.complete(clickReqBody);
            default:
                return {
                    error: ClickError.ActionNotFound,
                    error_note: 'Invalid action',
                };
        }
    }

    async prepare(clickReqBody: ClickRequest) {


        const planId = clickReqBody.merchant_trans_id;
        const userId = clickReqBody.param2;
        const amount = clickReqBody.amount;
        const transId = clickReqBody.click_trans_id + '';
        const signString = clickReqBody.sign_string;
        const signTime = new Date(clickReqBody.sign_time).toISOString();

        const myMD5Params = {
            clickTransId: transId,
            paymentType: PaymentTypes.ONETIME,
            serviceId: clickReqBody.service_id,
            secretKey: this.secretKey,
            merchantTransId: planId,
            amount: amount,
            action: clickReqBody.action,
            signTime: clickReqBody.sign_time,
        };

        const myMD5Hash = generateMD5(myMD5Params);

        if (signString !== myMD5Hash) {
            logger.warn('Signature validation failed', {transId});
            return {
                error: ClickError.SignFailed,
                error_note: 'Invalid sign_string',
            };
        }

        // Check if the transaction already exists and is not in a PENDING state
        const existingTransaction = await Transaction.findOne({
            transId: transId,
            status: {$ne: TransactionStatus.PENDING}
        });

        if (existingTransaction) {
            return {
                error: ClickError.AlreadyPaid,
                error_note: 'Transaction already processed',
            };
        }

        // Create a new transaction only if it doesn't exist or is in a PENDING state
        const time = new Date().getTime();
        await Transaction.create({
            provider: 'click',
            paymentType: PaymentTypes.ONETIME,
            planId,
            userId,
            signTime,
            transId,
            prepareId: time,
            status: TransactionStatus.PENDING,
            amount: clickReqBody.amount,
            createdAt: new Date(time),
        });

        return {
            click_trans_id: +transId,
            merchant_trans_id: planId,
            merchant_prepare_id: time,
            error: ClickError.Success,
            error_note: 'Success',
        };
    }

    async complete(clickReqBody: ClickRequest) {


        const planId = clickReqBody.merchant_trans_id;
        const userId = clickReqBody.param2;
        const prepareId = clickReqBody.merchant_prepare_id;
        const transId = clickReqBody.click_trans_id + '';
        const serviceId = clickReqBody.service_id;
        const amount = clickReqBody.amount;
        const signTime = clickReqBody.sign_time;
        const error = clickReqBody.error;
        const signString = clickReqBody.sign_string;

        const myMD5Params = {
            clickTransId: transId,
            serviceId,
            secretKey: this.secretKey,
            merchantTransId: planId,
            merchantPrepareId: prepareId,
            amount,
            action: clickReqBody.action,
            signTime,
        };

        const myMD5Hash = generateMD5(myMD5Params);

        if (signString !== myMD5Hash) {
            return {
                error: ClickError.SignFailed,
                error_note: 'Invalid sign_string',
            };
        }

        const user = await UserModel.findById(userId);

        if (!user) {
            return {
                error: ClickError.UserNotFound,
                error_note: 'Invalid userId',
            };
        }

        const plan = await Plan.findById(planId);

        if (!plan) {
            return {
                error: ClickError.UserNotFound,
                error_note: 'Invalid planId',
            };
        }

        const isPrepared = await Transaction.findOne({
            prepareId,
            userId,
            planId,
        });

        if (!isPrepared) {
            return {
                error: ClickError.TransactionNotFound,
                error_note: 'Invalid merchant_prepare_id',
            };
        }

        const isAlreadyPaid = await Transaction.findOne({
            planId,
            prepareId,
            status: TransactionStatus.PAID,
        });

        if (isAlreadyPaid) {
            return {
                error: ClickError.AlreadyPaid,
                error_note: 'Already paid',
            };
        }

        if (parseInt(`${amount}`) !== plan.price) {
            return {
                error: ClickError.InvalidAmount,
                error_note: 'Invalid amount',
            };
        }

        const transaction = await Transaction.findOne({
            transId,
        });

        if (transaction && transaction.status === TransactionStatus.CANCELED) {
            return {
                error: ClickError.TransactionCanceled,
                error_note: 'Already cancelled',
            };
        }

        if (error > 0) {
            await Transaction.findOneAndUpdate(
                {transId: transId},
                {status: TransactionStatus.FAILED});
            return {
                error: error,
                error_note: 'Failed',
            };
        }

        // update payment status
        await Transaction.findOneAndUpdate(
            {transId: transId},
            {status: TransactionStatus.PAID}
        );


        if (transaction) {
            try {
                const user = await UserModel.findById(transaction.userId).exec();
                if (user) {
                    user.subscriptionType = 'onetime';

                    await user.save();

                    // Create subscription record for one-time payment
                    const endDate = new Date();
endDate.setDate(endDate.getDate() + 30);
                    endDate.setMonth(endDate.getMonth() + 30);

                    await UserSubscription.create({
                        user: transaction.userId,
                        plan: transaction.planId,
                        telegramId: user.telegramId,
                        planName: plan.name,
                        subscriptionType: 'onetime',
                        startDate: new Date(),
                        endDate: endDate,
                        isActive: true,
                        autoRenew: false,
                        status: 'active',
                        paidBy: CardType.CLICK,
                        hasReceivedFreeBonus: false,
                    });

                    logger.info(`UserSubscription created for user ID: ${userId}, telegram ID: ${user.telegramId}, plan ID: ${planId} in payme-subs-api`);


                    logger.info(`Plan Name in ClickService is ${plan.name}`);

                    if (plan.name == 'Yakka kurash') {
                        await this.botService.handlePaymentSuccessForWrestling(
                            transaction.userId.toString(),
                            user.telegramId,
                            plan,
                            user.username,
                        );
                    } else {
                        await this.botService.handlePaymentSuccessForFootball(
                            transaction.userId.toString(),
                            user.telegramId,
                            plan,
                            user.username,
                        );
                    }
                }
            } catch (error) {
                logger.error('Error handling payment success:', error);
                throw error;
            }
        }

        return {
            click_trans_id: +transId,
            merchant_trans_id: planId,
            error: ClickError.Success,
            error_note: 'Success',
        };
    }

    async prepareSubsAPI(clickReqBody: ClickRequest) {

        const planId = clickReqBody.merchant_trans_id;
        const userId = clickReqBody.param2;
        const amount = clickReqBody.amount;
        const transId = clickReqBody.click_trans_id + '';
        const signString = clickReqBody.sign_string;
        const signTime = new Date(clickReqBody.sign_time).toISOString();

        const myMD5Params = {
            clickTransId: transId,
            paymentType: PaymentTypes.SUBSCRIPTION,
            serviceId: clickReqBody.service_id,
            secretKey: this.secretKey,
            merchantTransId: planId,
            amount: amount,
            action: clickReqBody.action,
            signTime: clickReqBody.sign_time,
        };

        const myMD5Hash = generateMD5(myMD5Params);

        if (signString !== myMD5Hash) {
            logger.warn('Signature validation failed in SUBSCRIBE API', {transId});
            return {
                error: ClickError.SignFailed,
                error_note: 'Invalid sign_string',
            };
        }

        const existingTransaction = await Transaction.findOne({
            transId: transId,
            status: {$ne: TransactionStatus.PENDING}
        });

        if (existingTransaction) {
            return {
                error: ClickError.AlreadyPaid,
                error_note: 'Transaction already processed',
            };
        }

        logger.debug('Creating a new transaction', {transId});
        const time = new Date().getTime();
        await Transaction.create({
            provider: 'click',
            paymentType: PaymentTypes.SUBSCRIPTION,
            planId,
            userId,
            signTime,
            transId,
            prepareId: time,
            status: TransactionStatus.PENDING,
            amount: clickReqBody.amount,
            createdAt: new Date(time),
        });


        return {
            click_trans_id: +transId,
            merchant_trans_id: planId,
            merchant_prepare_id: time,
            error: ClickError.Success,
            error_note: 'Success',
        };
    }

    async completeSubsAPI(clickReqBody: ClickRequest) {

        const planId = clickReqBody.merchant_trans_id;
        const userId = clickReqBody.param2;
        const prepareId = clickReqBody.merchant_prepare_id;
        const transId = clickReqBody.click_trans_id + '';
        const serviceId = clickReqBody.service_id;
        const amount = clickReqBody.amount;
        const signTime = clickReqBody.sign_time;
        const error = clickReqBody.error;
        const signString = clickReqBody.sign_string;

        const myMD5Params = {
            clickTransId: transId,
            serviceId,
            secretKey: this.secretKey,
            merchantTransId: planId,
            merchantPrepareId: prepareId,
            amount,
            action: clickReqBody.action,
            signTime,
        };

        const myMD5Hash = generateMD5(myMD5Params);

        if (signString !== myMD5Hash) {
            logger.warn('Signature validation failed during completion', {transId});
            return {
                error: ClickError.SignFailed,
                error_note: 'Invalid sign_string',
            };
        }

        const user = await UserModel.findById(userId);
        if (!user) {
            logger.warn('User not found', {userId});
            return {
                error: ClickError.UserNotFound,
                error_note: 'Invalid userId',
            };
        }

        const plan = await Plan.findById(planId);
        if (!plan) {
            logger.warn('Plan not found', {planId});
            return {
                error: ClickError.UserNotFound,
                error_note: 'Invalid planId',
            };
        }

        const isPrepared = await Transaction.findOne({
            prepareId,
            userId,
            planId,
        });

        if (!isPrepared) {
            return {
                error: ClickError.TransactionNotFound,
                error_note: 'Invalid merchant_prepare_id',
            };
        }

        const isAlreadyPaid = await Transaction.findOne({
            planId,
            prepareId,
            status: TransactionStatus.PAID,
        });

        if (isAlreadyPaid) {
            logger.warn('Transaction already paid', {prepareId});
            return {
                error: ClickError.AlreadyPaid,
                error_note: 'Already paid',
            };
        }

        if (parseInt(`${amount}`) !== plan.price) {
            return {
                error: ClickError.InvalidAmount,
                error_note: 'Invalid amount',
            };
        }

        const transaction = await Transaction.findOne({transId});

        if (transaction && transaction.status === TransactionStatus.CANCELED) {
            return {
                error: ClickError.TransactionCanceled,
                error_note: 'Already cancelled',
            };
        }

        if (error > 0) {
            logger.error('Transaction failed with error', {error});
            await Transaction.findOneAndUpdate(
                {transId: transId},
                {status: TransactionStatus.FAILED}
            );
            return {
                error: error,
                error_note: 'Failed',
            };
        }

        logger.debug('Marking transaction as PAID', {transId});
        await Transaction.findOneAndUpdate(
            {transId: transId},
            {status: TransactionStatus.PAID}
        );

        if (transaction) {
            try {
                logger.info(`Sending payment success notification to user ID: ${user.id} in AutoPaymentMonitorService`);

            } catch (error) {
                logger.error('Error handling payment success in SUBSCRIBE API:', error);
            }
        }


        return {
            click_trans_id: +transId,
            merchant_trans_id: planId,
            error: ClickError.Success,
            error_note: 'Success',
        };
    }


}