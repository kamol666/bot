import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ClickRequest } from './types/click-request.type';
import { ClickAction, ClickError } from './enums';
import logger from '../../../shared/utils/logger';
import { generateMD5 } from '../../../shared/database/hashing/hasher.helper';
import {
  Transaction,
  TransactionStatus,
} from '../../../shared/database/models/transactions.model';
import { UserModel } from '../../../shared/database/models/user.model';
import { Plan } from '../../../shared/database/models/plans.model';
import { CreateInvoiceRequest, CreateInvoiceResponse, InvoiceStatus } from './types/create-invoice.type';
import axios from 'axios';

@Injectable()
export class ClickService {
  private readonly secretKey: string;
  private readonly serviceId: string;
  private readonly merchantId: string;
  private readonly merchantUserId: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => require('../../bot/bot.service').BotService))
    private readonly botService: any,  // ✅ BotService inject qilish
  ) {
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

    logger.info(
      `Handling merchant transaction with action type: ${actionType}`,
    );

    switch (actionType) {
      case ClickAction.Prepare:
        return this.prepare(clickReqBody);
      case ClickAction.Complete:
        return this.complete(clickReqBody);
      default:
        return {
          error: ClickError.ActionNotFound,
          error_note: 'Invalid action',
        };
    }
  }

  async prepare(clickReqBody: ClickRequest) {
    logger.info('Preparing transaction', { clickReqBody });

    // ✅ TO'G'RI mapping (PHP legacy format)
    const userId = clickReqBody.merchant_trans_id;  // ✅ User ID
    const planId = clickReqBody.param1;             // ✅ Plan ID
    const amount = clickReqBody.amount;
    const transId = clickReqBody.click_trans_id + '';
    const signString = clickReqBody.sign_string;
    const signTime = new Date(clickReqBody.sign_time).toISOString();

    // ✅ Validation
    if (!userId || !planId) {
      return {
        error: ClickError.UserNotFound,
        error_note: 'Invalid user or plan ID',
      };
    }

    const myMD5Params = {
      clickTransId: transId,
      serviceId: clickReqBody.service_id,
      secretKey: this.secretKey,
      merchantTransId: userId,  // ✅ User ID
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

    // ✅ User va Plan mavjudligini tekshirish
    const user = await UserModel.findById(userId);
    if (!user) {
      return {
        error: ClickError.UserNotFound,
        error_note: 'User not found',
      };
    }

    const plan = await Plan.findById(planId);
    if (!plan) {
      return {
        error: ClickError.UserNotFound,
        error_note: 'Plan not found',
      };
    }

    // ✅ Amount tekshirish
    if (parseInt(`${amount}`) !== plan.price) {
      return {
        error: ClickError.InvalidAmount,
        error_note: 'Invalid amount',
      };
    }

    // Check if the transaction already exists and is not in a PENDING state
    const existingTransaction = await Transaction.findOne({
      transId: transId,
      status: { $ne: TransactionStatus.PENDING },
    });

    if (existingTransaction) {
      return {
        error: ClickError.AlreadyPaid,
        error_note: 'Transaction already processed',
      };
    }

    // Create a new transaction with correct mapping
    const time = new Date().getTime();
    await Transaction.create({
      provider: 'click',
      planId,      // ✅ Plan ID
      userId,      // ✅ User ID  
      signTime,
      transId,
      prepareId: time,
      status: TransactionStatus.PENDING,
      amount: clickReqBody.amount,
      createdAt: new Date(time),
    });

    return {
      click_trans_id: +transId,
      merchant_trans_id: userId,        // ✅ User ID qaytarish (PHP legacy)
      merchant_prepare_id: time,
      error: ClickError.Success,
      error_note: 'Success',
    };
  }

  async complete(clickReqBody: ClickRequest) {
    logger.info('Completing transaction', { clickReqBody });

    // ✅ TO'G'RI mapping (PHP legacy format)
    const userId = clickReqBody.merchant_trans_id;  // ✅ User ID
    const planId = clickReqBody.param1;             // ✅ Plan ID
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
      merchantTransId: userId,  // ✅ User ID
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
        { status: TransactionStatus.FAILED },
      );
      return {
        error: error,
        error_note: 'Failed',
      };
    }

    const updatedTransaction = await Transaction.findOneAndUpdate(
      { transId: transId },
      { status: TransactionStatus.PAID },
      { new: true },
    );

    if (updatedTransaction) {
      try {
        const user = await UserModel.findById(
          updatedTransaction.userId,
        ).exec();
        if (user && this.botService) {
          // ✅ To'lov muvaffaqiyatli bo'lganda botga xabar yuborish
          await this.botService.handlePaymentSuccess(
            updatedTransaction.userId.toString(),
            user.telegramId,
            user.username,
          );
          logger.info(`✅ Payment success notification sent for user: ${user.telegramId}`);
        }
      } catch (error) {
        logger.error('❌ Error handling payment success:', error);
        // Continue with the response even if notification fails
      }
    }

    return {
      click_trans_id: +transId,
      merchant_trans_id: userId,  // ✅ User ID qaytarish (PHP legacy)
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
