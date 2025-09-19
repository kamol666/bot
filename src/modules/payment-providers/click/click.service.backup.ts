import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClickRequest } from './types/click-request.type';
import {
  Transaction,
  TransactionStatus,
  PaymentProvider,
} from '../../../shared/database/models/transactions.model';
import { ClickAction, ClickError } from './enums';
import { UserModel } from '../../../shared/database/models/user.model';
import { Plan } from '../../../shared/database/models/plans.model';
import { generateMD5 } from '../../../shared/database/hashing/hasher.helper';
import logger from '../../../shared/utils/logger';
import { UserSubscription } from '../../../shared/database/models/user-subscription.model';
import { CardType } from '../../../shared/database/models/user-cards.model';
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

  constructor(private readonly configService: ConfigService) {
    this.botService = require('../../bot/bot.service').BotService;
    const secretKey = this.configService.get<string>('CLICK_SECRET');
    const serviceId = this.configService.get<string>('CLICK_SERVICE_ID');
    const merchantId = this.configService.get<string>('CLICK_MERCHANT_ID');
    const merchantUserId = this.configService.get<string>('CLICK_MERCHANT_USER_ID');

    // Validate config values
    if (!secretKey || typeof secretKey !== 'string' || secretKey.length < 10) {
      logger.error('Invalid or missing CLICK_SECRET in configuration');
      throw new Error('CLICK_SECRET is not defined or invalid in the configuration');
    }
    if (!serviceId || typeof serviceId !== 'string') {
      logger.error('Invalid or missing CLICK_SERVICE_ID in configuration');
      throw new Error('CLICK_SERVICE_ID is not defined or invalid in the configuration');
    }
    if (!merchantId || typeof merchantId !== 'string') {
      logger.error('Invalid or missing CLICK_MERCHANT_ID in configuration');
      throw new Error('CLICK_MERCHANT_ID is not defined or invalid in the configuration');
    }
    if (!merchantUserId || typeof merchantUserId !== 'string' || merchantUserId.length < 3) {
      logger.error('Invalid or missing CLICK_MERCHANT_USER_ID in configuration');
      throw new Error('CLICK_MERCHANT_USER_ID is not defined or invalid in the configuration');
    }

    this.secretKey = secretKey;
    this.serviceId = serviceId;
    this.merchantId = merchantId;
    this.merchantUserId = merchantUserId;
  }

  /**
   * Generates Click API authentication header
   * Format: merchant_user_id:digest:timestamp
   * digest = sha1(timestamp + secret_key)
   */
  private generateAuthHeader(): string {
    const timestamp = Math.floor(Date.now() / 1000);
    const digestString = timestamp + this.secretKey;
    const digest = crypto.createHash('sha1').update(digestString).digest('hex');
    return `${this.merchantUserId}:${digest}:${timestamp}`;
  }

  /**
   * Handles incoming Click payment requests
   */
  async handleMerchantTransactions(clickReqBody: ClickRequest) {
    try {
      const actionType = +clickReqBody.action;
      clickReqBody.amount = parseFloat(clickReqBody.amount + '');
      logger.info(`Received Click request: ${JSON.stringify(clickReqBody)}`);
      switch (actionType) {
        case ClickAction.Prepare:
          if (clickReqBody.param1 === 'merchant') {
            return await this.prepareSubsAPI(clickReqBody);
          }
          return await this.prepare(clickReqBody);
        case ClickAction.Complete:
          if (clickReqBody.param1 === 'merchant') {
            return await this.completeSubsAPI(clickReqBody);
          }
          return await this.complete(clickReqBody);
        default:
          logger.warn('Invalid action type received', { actionType });
          return {
            error: ClickError.ActionNotFound,
            error_note: 'Invalid action',
          };
      }
    } catch (error) {
      logger.error('Error in handleMerchantTransactions:', { error: error.message });
      return {
        error: ClickError.SignFailed,
        error_note: 'Internal server error',
      };
    }
  }

  /**
   * Prepares a one-time payment transaction
   */
  async prepare(clickReqBody: ClickRequest) {
    try {
      const { merchant_trans_id: planId, param2: userId, amount, click_trans_id, sign_string, sign_time, service_id, action } = clickReqBody;
      if (!planId || !userId || !amount || !click_trans_id || !sign_string || !sign_time || !service_id || !action) {
        logger.warn('Missing required parameters in prepare');
        return { error: ClickError.SignFailed, error_note: 'Missing required parameters' };
      }
      const transId = click_trans_id + '';
      const myMD5Params = {
        clickTransId: transId,
        paymentType: 'ONETIME',
        serviceId: service_id,
        secretKey: this.secretKey,
        merchantTransId: planId,
        amount,
        action,
        signTime: sign_time,
      };
      const myMD5Hash = generateMD5(myMD5Params);
      if (sign_string !== myMD5Hash) {
        logger.warn('Signature validation failed', { transId });
        return { error: ClickError.SignFailed, error_note: 'Invalid sign_string' };
      }
      const existingTransaction = await Transaction.findOne({ transId, status: { $ne: TransactionStatus.PENDING } });
      if (existingTransaction) {
        return { error: ClickError.AlreadyPaid, error_note: 'Transaction already processed' };
      }
      const time = Date.now();
      await Transaction.create({
        provider: PaymentProvider.CLICK,
        paymentType: 'ONETIME',
        planId,
        userId,
        signTime: sign_time,
        transId,
        prepareId: time,
        status: TransactionStatus.PENDING,
        amount,
        createdAt: new Date(time),
      });
      return {
        click_trans_id: +transId,
        merchant_trans_id: planId,
        merchant_prepare_id: time,
        error: ClickError.Success,
        error_note: 'Success',
      };
    } catch (error) {
      logger.error('Error in prepare:', { error: error.message });
      return { error: ClickError.SignFailed, error_note: 'Internal server error' };
    }
  }

  /**
   * Completes a one-time payment transaction
   */
  async complete(clickReqBody: ClickRequest) {
    try {
      const { merchant_trans_id: planId, param2: userId, merchant_prepare_id: prepareId, click_trans_id, service_id, amount, sign_time, error: reqError, sign_string, action } = clickReqBody;
      if (!planId || !userId || !prepareId || !click_trans_id || !service_id || !amount || !sign_time || !sign_string || !action) {
        logger.warn('Missing required parameters in complete');
        return { error: ClickError.SignFailed, error_note: 'Missing required parameters' };
      }
      const transId = click_trans_id + '';
      const myMD5Params = {
        clickTransId: transId,
        serviceId: service_id,
        secretKey: this.secretKey,
        merchantTransId: planId,
        merchantPrepareId: prepareId,
        amount,
        action,
        signTime: sign_time,
      };
      const myMD5Hash = generateMD5(myMD5Params);
      if (sign_string !== myMD5Hash) {
        return { error: ClickError.SignFailed, error_note: 'Invalid sign_string' };
      }
      const user = await UserModel.findById(userId);
      if (!user) {
        logger.warn('User not found', { userId });
        return { error: ClickError.UserNotFound, error_note: 'Invalid userId' };
      }
      const plan = await Plan.findById(planId);
      if (!plan) {
        logger.warn('Plan not found', { planId });
        return { error: ClickError.UserNotFound, error_note: 'Invalid planId' };
      }
      const isPrepared = await Transaction.findOne({ prepareId, userId, planId });
      if (!isPrepared) {
        return { error: ClickError.TransactionNotFound, error_note: 'Invalid merchant_prepare_id' };
      }
      const isAlreadyPaid = await Transaction.findOne({ planId, prepareId, status: TransactionStatus.PAID });
      if (isAlreadyPaid) {
        logger.warn('Transaction already paid', { prepareId });
        return { error: ClickError.AlreadyPaid, error_note: 'Already paid' };
      }
      if (parseInt(`${amount}`) !== plan.price) {
        return { error: ClickError.InvalidAmount, error_note: 'Invalid amount' };
      }
      const transaction = await Transaction.findOne({ transId });
      if (transaction && transaction.status === TransactionStatus.CANCELED) {
        return { error: ClickError.TransactionCanceled, error_note: 'Already cancelled' };
      }
      if (reqError > 0) {
        await Transaction.findOneAndUpdate({ transId }, { status: TransactionStatus.FAILED });
        return { error: reqError, error_note: 'Failed' };
      }
      await Transaction.findOneAndUpdate({ transId }, { status: TransactionStatus.PAID });
      if (transaction) {
        try {
          const user = await UserModel.findById(transaction.userId).exec();
          if (user) {
            user.subscriptionType = 'onetime';
            await user.save();
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            await UserSubscription.create({
              user: transaction.userId,
              plan: transaction.planId,
              telegramId: user.telegramId,
              planName: plan.name,
              subscriptionType: 'onetime',
              startDate: new Date(),
              endDate,
              isActive: true,
              autoRenew: false,
              status: 'active',
              paidBy: CardType.CLICK,
              hasReceivedFreeBonus: false,
            });
            logger.info(`UserSubscription created for user ID: ${userId}, telegram ID: ${user.telegramId}, plan ID: ${planId}`);
            if (this.botService) {
              if (plan.name === 'Yakka kurash') {
                await this.botService.handlePaymentSuccessForWrestling(transaction.userId.toString(), user.telegramId, plan, user.username);
              } else {
                await this.botService.handlePaymentSuccessForFootball(transaction.userId.toString(), user.telegramId, plan, user.username);
              }
            }
          }
        } catch (error) {
          logger.error('Error handling payment success:', { error: error.message });
        }
      }
      return {
        click_trans_id: +transId,
        merchant_trans_id: planId,
        error: ClickError.Success,
        error_note: 'Success',
      };
    } catch (error) {
      logger.error('Error in complete:', { error: error.message });
      return { error: ClickError.SignFailed, error_note: 'Internal server error' };
    }
  }

  /**
   * Prepares a subscription payment transaction
   */
  async prepareSubsAPI(clickReqBody: ClickRequest) {
    try {
      const { merchant_trans_id: planId, param2: userId, amount, click_trans_id, sign_string, sign_time, service_id, action } = clickReqBody;
      if (!planId || !userId || !amount || !click_trans_id || !sign_string || !sign_time || !service_id || !action) {
        logger.warn('Missing required parameters in prepareSubsAPI');
        return { error: ClickError.SignFailed, error_note: 'Missing required parameters' };
      }
      const transId = click_trans_id + '';
      const myMD5Params = {
        clickTransId: transId,
        paymentType: 'SUBSCRIPTION',
        serviceId: service_id,
        secretKey: this.secretKey,
        merchantTransId: planId,
        amount,
        action,
        signTime: sign_time,
      };
      const myMD5Hash = generateMD5(myMD5Params);
      if (sign_string !== myMD5Hash) {
        logger.warn('Signature validation failed in SUBSCRIBE API', { transId });
        return { error: ClickError.SignFailed, error_note: 'Invalid sign_string' };
      }
      const existingTransaction = await Transaction.findOne({ transId, status: { $ne: TransactionStatus.PENDING } });
      if (existingTransaction) {
        return { error: ClickError.AlreadyPaid, error_note: 'Transaction already processed' };
      }
      logger.debug('Creating a new transaction', { transId });
      const time = Date.now();
      await Transaction.create({
        provider: PaymentProvider.CLICK,
        paymentType: 'SUBSCRIPTION',
        planId,
        userId,
        signTime: sign_time,
        transId,
        prepareId: time,
        status: TransactionStatus.PENDING,
        amount,
        createdAt: new Date(time),
      });
      return {
        click_trans_id: +transId,
        merchant_trans_id: planId,
        merchant_prepare_id: time,
        error: ClickError.Success,
        error_note: 'Success',
      };
    } catch (error) {
      logger.error('Error in prepareSubsAPI:', { error: error.message });
      return { error: ClickError.SignFailed, error_note: 'Internal server error' };
    }
  }

  /**
   * Completes a subscription payment transaction
   */
  async completeSubsAPI(clickReqBody: ClickRequest) {
    try {
      const { merchant_trans_id: planId, param2: userId, merchant_prepare_id: prepareId, click_trans_id, service_id, amount, sign_time, error: reqError, sign_string, action } = clickReqBody;
      if (!planId || !userId || !prepareId || !click_trans_id || !service_id || !amount || !sign_time || !sign_string || !action) {
        logger.warn('Missing required parameters in completeSubsAPI');
        return { error: ClickError.SignFailed, error_note: 'Missing required parameters' };
      }
      const transId = click_trans_id + '';
      const myMD5Params = {
        clickTransId: transId,
        serviceId: service_id,
        secretKey: this.secretKey,
        merchantTransId: planId,
        merchantPrepareId: prepareId,
        amount,
        action,
        signTime: sign_time,
      };
      const myMD5Hash = generateMD5(myMD5Params);
      if (sign_string !== myMD5Hash) {
        logger.warn('Signature validation failed during completion', { transId });
        return { error: ClickError.SignFailed, error_note: 'Invalid sign_string' };
      }
      const user = await UserModel.findById(userId);
      if (!user) {
        logger.warn('User not found', { userId });
        return { error: ClickError.UserNotFound, error_note: 'Invalid userId' };
      }
      const plan = await Plan.findById(planId);
      if (!plan) {
        logger.warn('Plan not found', { planId });
        return { error: ClickError.UserNotFound, error_note: 'Invalid planId' };
      }
      const isPrepared = await Transaction.findOne({ prepareId, userId, planId });
      if (!isPrepared) {
        return { error: ClickError.TransactionNotFound, error_note: 'Invalid merchant_prepare_id' };
      }
      const isAlreadyPaid = await Transaction.findOne({ planId, prepareId, status: TransactionStatus.PAID });
      if (isAlreadyPaid) {
        logger.warn('Transaction already paid', { prepareId });
        return { error: ClickError.AlreadyPaid, error_note: 'Already paid' };
      }
      if (parseInt(`${amount}`) !== plan.price) {
        return { error: ClickError.InvalidAmount, error_note: 'Invalid amount' };
      }
      const transaction = await Transaction.findOne({ transId });
      if (transaction && transaction.status === TransactionStatus.CANCELED) {
        return { error: ClickError.TransactionCanceled, error_note: 'Already cancelled' };
      }
      if (reqError > 0) {
        logger.error('Transaction failed with error', { error: reqError });
        await Transaction.findOneAndUpdate({ transId }, { status: TransactionStatus.FAILED });
        return { error: reqError, error_note: 'Failed' };
      }
      logger.debug('Marking transaction as PAID', { transId });
      await Transaction.findOneAndUpdate({ transId }, { status: TransactionStatus.PAID });
      if (transaction) {
        try {
          logger.info(`Sending payment success notification to user ID: ${user.id} in AutoPaymentMonitorService`);
        } catch (error) {
          logger.error('Error handling payment success in SUBSCRIBE API:', { error: error.message });
        }
      }
      return {
        click_trans_id: +transId,
        merchant_trans_id: planId,
        error: ClickError.Success,
        error_note: 'Success',
      };
    } catch (error) {
      logger.error('Error in completeSubsAPI:', { error: error.message });
      return { error: ClickError.SignFailed, error_note: 'Internal server error' };
    }
  }

  /**
   * Creates an invoice via Click API
   */
  async createInvoice(amount: number, phoneNumber: string, userId: string, planId: string): Promise<CreateInvoiceResponse> {
    try {
      if (!amount || !phoneNumber || !userId || !planId) {
        logger.warn('Missing required parameters in createInvoice');
        throw new Error('Missing required parameters');
      }
      const url = 'https://api.click.uz/v2/merchant/invoice/create';
      const authHeader = this.generateAuthHeader();
      const timestamp = Date.now();
      const merchantTransId = `${userId}_${timestamp}`;
      const requestData: CreateInvoiceRequest = {
        service_id: this.serviceId,
        amount,
        phone_number: phoneNumber,
        merchant_trans_id: merchantTransId,
        param1: planId,
      };
      logger.info('Invoice creation requested', {
        userId,
        planId,
        amount,
        merchantTransId,
        phoneNumber: phoneNumber.substring(0, 6) + '***',
      });
      const response = await axios.post<CreateInvoiceResponse>(url, requestData, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: authHeader,
        },
        timeout: 10000,
      });
      if (response.data.error_code !== 0) {
        logger.error('Click API returned error', {
          error_code: response.data.error_code,
          error_note: response.data.error_note,
          userId,
        });
        throw new Error(`Click API error: ${response.data.error_note}`);
      }
      logger.info('Invoice created successfully', {
        invoiceId: response.data.invoice_id,
        merchantTransId,
        userId,
        planId,
      });
      return response.data;
    } catch (error) {
      logger.error('Error creating invoice:', { error: error.message, userId, planId });
      throw new Error('Invoice creation failed');
    }
  }

  /**
   * Checks invoice status via Click API
   */
  async checkInvoiceStatus(invoiceId: number): Promise<InvoiceStatus> {
    try {
      if (!invoiceId) throw new Error('Missing invoiceId');
      const url = `https://api.click.uz/v2/merchant/invoice/status/${this.serviceId}/${invoiceId}`;
      const authHeader = this.generateAuthHeader();
      logger.info('Checking invoice status', { invoiceId });
      const response = await axios.get<InvoiceStatus>(url, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: authHeader,
        },
        timeout: 10000,
      });
      if (response.data.error_code !== 0) {
        logger.error('Invoice status API returned error', {
          error_code: response.data.error_code,
          error_note: response.data.error_note,
          invoiceId,
        });
      }
      logger.info('Invoice status response', {
        invoiceId,
        status: response.data.invoice_status,
        error_code: response.data.error_code,
      });
      return response.data;
    } catch (error) {
      logger.error('Error checking invoice status:', { error: error.message, invoiceId });
      throw new Error('Invoice status check failed');
    }
  }

  /**
   * Checks payment status via payment_id
   */
  async checkPaymentStatus(paymentId: number) {
    try {
      if (!paymentId) throw new Error('Missing paymentId');
      const url = `https://api.click.uz/v2/merchant/payment/status/${this.serviceId}/${paymentId}`;
      const authHeader = this.generateAuthHeader();
      logger.info('Checking payment status', { paymentId });
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: authHeader,
        },
        timeout: 10000,
      });
      logger.info('Payment status response', {
        paymentId,
        status: response.data.payment_status,
        error_code: response.data.error_code,
      });
      return response.data;
    } catch (error) {
      logger.error('Error checking payment status:', { error: error.message, paymentId });
      throw new Error('Payment status check failed');
    }
  }

  /**
   * Checks payment status via merchant_trans_id and date
   */
  async checkPaymentByMerchantTransId(merchantTransId: string, date: string) {
    try {
      if (!merchantTransId || !date) throw new Error('Missing merchantTransId or date');
      const url = `https://api.click.uz/v2/merchant/payment/status_by_mti/${this.serviceId}/${merchantTransId}/${date}`;
      const authHeader = this.generateAuthHeader();
      logger.info('Checking payment status by merchantTransId', { merchantTransId, date });
      const response = await axios.get(url, {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Auth: authHeader,
        },
        timeout: 10000,
      });
      logger.info('Payment status by merchantTransId response', {
        merchantTransId,
        paymentId: response.data.payment_id,
        error_code: response.data.error_code,
      });
      return response.data;
    } catch (error) {
      logger.error('Error checking payment status by merchantTransId:', { error: error.message, merchantTransId, date });
      throw new Error('Payment status check by merchantTransId failed');
    }
  }
}
