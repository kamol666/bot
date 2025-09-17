import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickRequest } from './types/click-request.type';
import {
  Transaction,
  TransactionStatus,
  PaymentProvider,
} from "../../../shared/database/models/transactions.model";
import { ClickAction, ClickError } from "./enums";
import { UserModel } from "../../../shared/database/models/user.model";
import { Plan } from "../../../shared/database/models/plans.model";
import { generateMD5 } from "../../../shared/database/hashing/hasher.helper";
import logger from "../../../shared/utils/logger";
import { UserSubscription } from "../../../shared/database/models/user-subscription.model";
import { CardType } from "../../../shared/database/models/user-cards.model";
import { CreateInvoiceRequest, CreateInvoiceResponse, InvoiceStatus } from './types/create-invoice.type';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class ClickService {
  private readonly secretKey: string;
  private readonly serviceId: string;
  private readonly merchantId: string;
  private readonly merchantUserId: string;
  private readonly botService: any;


  constructor(
    private readonly configService: ConfigService,
  ) {
    this.botService = require('../../bot/bot.service').BotService;
    const secretKey = this.configService.get<string>('CLICK_SECRET');
    const serviceId = this.configService.get<string>('CLICK_SERVICE_ID');
    const merchantId = this.configService.get<string>('CLICK_MERCHANT_ID');
    const merchantUserId = this.configService.get<string>('CLICK_MERCHANT_USER_ID');

    if (!secretKey) {
      throw new Error('CLICK_SECRET is not defined in the configuration');
    }
    if (!serviceId) {
      throw new Error('CLICK_SERVICE_ID is not defined in the configuration');
    }
    if (!merchantId) {
      throw new Error('CLICK_MERCHANT_ID is not defined in the configuration');
    }
    if (!merchantUserId) {
      throw new Error('CLICK_MERCHANT_USER_ID is not defined in the configuration');
    }

    this.secretKey = secretKey;
    this.serviceId = serviceId;
    this.merchantId = merchantId;
    this.merchantUserId = merchantUserId;
  }

  /**
   * Auth header yaratish (Click dokumentatsiyasi bo'yicha)
   * Format: merchant_user_id:digest:timestamp
   * digest = sha1(timestamp + secret_key)
   */
  private generateAuthHeader(): string {
    const timestamp = Math.floor(Date.now() / 1000); // UNIX timestamp (10 digit)
    const digestString = timestamp + this.secretKey;

    // SHA1 hash yaratish
    const digest = crypto.createHash('sha1').update(digestString).digest('hex');

    // Format: merchant_user_id:digest:timestamp
    return `${this.merchantUserId}:${digest}:${timestamp}`;
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
      paymentType: 'ONETIME',
      serviceId: clickReqBody.service_id,
      secretKey: this.secretKey,
      merchantTransId: planId,
      amount: amount,
      action: clickReqBody.action,
      signTime: clickReqBody.sign_time,
    };

    const myMD5Hash = generateMD5(myMD5Params);

    if (signString !== myMD5Hash) {
      logger.warn('Signature validation failed', { transId });
      return {
        error: ClickError.SignFailed,
        error_note: 'Invalid sign_string',
      };
    }

    // Check if the transaction already exists and is not in a PENDING state
    const existingTransaction = await Transaction.findOne({
      transId: transId,
      status: { $ne: TransactionStatus.PENDING }
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
      provider: PaymentProvider.CLICK,
      paymentType: 'ONETIME',
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
        { transId: transId },
        { status: TransactionStatus.FAILED });
      return {
        error: error,
        error_note: 'Failed',
      };
    }

    // update payment status
    await Transaction.findOneAndUpdate(
      { transId: transId },
      { status: TransactionStatus.PAID }
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

          if (this.botService) {
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
      paymentType: 'SUBSCRIPTION',
      serviceId: clickReqBody.service_id,
      secretKey: this.secretKey,
      merchantTransId: planId,
      amount: amount,
      action: clickReqBody.action,
      signTime: clickReqBody.sign_time,
    };

    const myMD5Hash = generateMD5(myMD5Params);

    if (signString !== myMD5Hash) {
      logger.warn('Signature validation failed in SUBSCRIBE API', { transId });
      return {
        error: ClickError.SignFailed,
        error_note: 'Invalid sign_string',
      };
    }

    const existingTransaction = await Transaction.findOne({
      transId: transId,
      status: { $ne: TransactionStatus.PENDING }
    });

    if (existingTransaction) {
      return {
        error: ClickError.AlreadyPaid,
        error_note: 'Transaction already processed',
      };
    }

    logger.debug('Creating a new transaction', { transId });
    const time = new Date().getTime();
    await Transaction.create({
      provider: PaymentProvider.CLICK,
      paymentType: 'SUBSCRIPTION',
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
      logger.warn('Signature validation failed during completion', { transId });
      return {
        error: ClickError.SignFailed,
        error_note: 'Invalid sign_string',
      };
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      logger.warn('User not found', { userId });
      return {
        error: ClickError.UserNotFound,
        error_note: 'Invalid userId',
      };
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      logger.warn('Plan not found', { planId });
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
      logger.warn('Transaction already paid', { prepareId });
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

    const transaction = await Transaction.findOne({ transId });

    if (transaction && transaction.status === TransactionStatus.CANCELED) {
      return {
        error: ClickError.TransactionCanceled,
        error_note: 'Already cancelled',
      };
    }

    if (error > 0) {
      logger.error('Transaction failed with error', { error });
      await Transaction.findOneAndUpdate(
        { transId: transId },
        { status: TransactionStatus.FAILED }
      );
      return {
        error: error,
        error_note: 'Failed',
      };
    }

    logger.debug('Marking transaction as PAID', { transId });
    await Transaction.findOneAndUpdate(
      { transId: transId },
      { status: TransactionStatus.PAID }
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

  /**
 * Click API orqali invoice yaratish
 * merchant_trans_id = User ID (PHP legacy format)
 */
  async createInvoice(
    amount: number,
    phoneNumber: string,
    userId: string,        // ✅ User ID
    planId: string,        // ✅ Plan ID
  ): Promise<CreateInvoiceResponse> {
    try {
      const url = 'https://api.click.uz/v2/merchant/invoice/create';

      // ✅ Auth header yaratish
      const authHeader = this.generateAuthHeader();

      // ✅ merchant_trans_id ni avtomatik yaratamiz
      const timestamp = Date.now();
      const merchantTransId = `${userId}_${timestamp}`;

      const requestData: CreateInvoiceRequest = {
        service_id: this.serviceId,
        amount,
        phone_number: phoneNumber,
        merchant_trans_id: merchantTransId,  // ✅ Auto-generated unique ID
        param1: planId,                      // ✅ Plan ID qo'shimcha param sifatida
      };

      logger.info('Invoice yaratilmoqda', {
        userId,
        planId,
        amount,
        merchantTransId,                     // ✅ Auto-generated ID'ni log qilamiz
        phoneNumber: phoneNumber.substring(0, 6) + '***' // ✅ Xavfsiz logging
      });

      const response = await axios.post<CreateInvoiceResponse>(url, requestData, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Auth': authHeader,  // ✅ Auth header qo'shildi!
        },
        timeout: 10000, // ✅ 10 sekund timeout
      });

      // ✅ Click har doim 200 jo'natadi, error_code tekshiramiz
      if (response.data.error_code !== 0) {
        logger.error('Click API xatolik qaytardi', {
          error_code: response.data.error_code,
          error_note: response.data.error_note,
          userId
        });
        throw new Error(`Click API xatolik: ${response.data.error_note}`);
      }

      logger.info('Invoice muvaffaqiyatli yaratildi', {
        invoiceId: response.data.invoice_id,
        merchantTransId,                     // ✅ Auto-generated ID
        userId,
        planId
      });

      return response.data;
    } catch (error) {
      logger.error('Invoice yaratishda xatolik:', {
        error: error.message,
        userId,
        planId
      });
      throw new Error('Invoice yaratishda xatolik yuz berdi');
    }
  }

  /**
   * Invoice status tekshirish
   */
  async checkInvoiceStatus(invoiceId: number): Promise<InvoiceStatus> {
    try {
      // ✅ GET so'rov URL formatida (dokumentatsiya bo'yicha)
      const url = `https://api.click.uz/v2/merchant/invoice/status/${this.serviceId}/${invoiceId}`;

      // ✅ Auth header yaratish
      const authHeader = this.generateAuthHeader();

      logger.info('Invoice status tekshirilmoqda', { invoiceId });

      const response = await axios.get<InvoiceStatus>(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Auth': authHeader,  // ✅ Auth header qo'shildi!
        },
        timeout: 10000, // ✅ 10 sekund timeout
      });

      // ✅ Click har doim 200 jo'natadi, error_code tekshiramiz
      if (response.data.error_code !== 0) {
        logger.error('Invoice status API xatolik qaytardi', {
          error_code: response.data.error_code,
          error_note: response.data.error_note,
          invoiceId
        });
      }

      logger.info('Invoice status javobi', {
        invoiceId,
        status: response.data.invoice_status,
        error_code: response.data.error_code
      });

      return response.data;
    } catch (error) {
      logger.error('Invoice status tekshirishda xatolik:', {
        error: error.message,
        invoiceId
      });
      throw new Error('Invoice status tekshirishda xatolik yuz berdi');
    }
  }

  /**
   * Payment status tekshirish (payment_id orqali)
   */
  async checkPaymentStatus(paymentId: number) {
    try {
      // ✅ GET so'rov URL formatida
      const url = `https://api.click.uz/v2/merchant/payment/status/${this.serviceId}/${paymentId}`;

      // ✅ Auth header yaratish
      const authHeader = this.generateAuthHeader();

      logger.info('Payment status tekshirilmoqda', { paymentId });

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Auth': authHeader,
        },
        timeout: 10000,
      });

      logger.info('Payment status javobi', {
        paymentId,
        status: response.data.payment_status,
        error_code: response.data.error_code
      });

      return response.data;
    } catch (error) {
      logger.error('Payment status tekshirishda xatolik:', {
        error: error.message,
        paymentId
      });
      throw new Error('Payment status tekshirishda xatolik yuz berdi');
    }
  }

  /**
   * Payment status tekshirish merchant_trans_id orqali
   */
  async checkPaymentByMerchantTransId(merchantTransId: string, date: string) {
    try {
      // ✅ Format: YYYY-MM-DD
      const url = `https://api.click.uz/v2/merchant/payment/status_by_mti/${this.serviceId}/${merchantTransId}/${date}`;

      const authHeader = this.generateAuthHeader();

      logger.info('Payment status tekshirilmoqda (MTI)', { merchantTransId, date });

      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Auth': authHeader,
        },
        timeout: 10000,
      });

      logger.info('Payment status javobi (MTI)', {
        merchantTransId,
        paymentId: response.data.payment_id,
        error_code: response.data.error_code
      });

      return response.data;
    } catch (error) {
      logger.error('Payment status (MTI) tekshirishda xatolik:', {
        error: error.message,
        merchantTransId,
        date
      });
      throw new Error('Payment status tekshirishda xatolik yuz berdi');
    }
  }
}
