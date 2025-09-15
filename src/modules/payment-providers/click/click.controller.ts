import { Body, Controller, HttpCode, HttpStatus, Post, Get, Param } from '@nestjs/common';
import { ClickRequest } from './types/click-request.type';
import { ClickService } from './click.service';
import logger from '../../../shared/utils/logger';

@Controller('click')
export class ClickController {
  constructor(private readonly clickService: ClickService) {
    console.log('ClickController initialized');
  }

  @Post('')
  @HttpCode(HttpStatus.OK)
  async handleMerchantTransactions(@Body() clickReqBody: ClickRequest) {
    logger.info(`clickReqBody: ${JSON.stringify(clickReqBody)}`);
    return await this.clickService.handleMerchantTransactions(clickReqBody);
  }

  /**
   * Invoice yaratish endpoint
   * merchant_trans_id = User ID (siz yaratadigan unique ID)
   */
  @Post('create-invoice')
  @HttpCode(HttpStatus.OK)
  async createInvoice(
    @Body() body: {
      amount: number;
      phoneNumber: string;
      userId: string;        // ✅ Bu merchant_trans_id bo'ladi
      planId: string;        // ✅ Bu param1 ga boradi
    }
  ) {
    logger.info('Invoice yaratish so\'rovi:', {
      userId: body.userId,
      planId: body.planId,
      amount: body.amount
    });

    // ✅ merchant_trans_id = userId (PHP legacy format)
    return await this.clickService.createInvoice(
      body.amount,
      body.phoneNumber,
      body.userId,   // ✅ Bu merchant_trans_id sifatida yuboriladi
      body.planId,   // ✅ Bu param1 sifatida yuboriladi
    );
  }

  /**
   * Invoice status tekshirish endpoint
   */
  @Get('invoice-status/:invoiceId')
  @HttpCode(HttpStatus.OK)
  async checkInvoiceStatus(@Param('invoiceId') invoiceId: number) {
    logger.info('Invoice status tekshirish:', { invoiceId });
    return await this.clickService.checkInvoiceStatus(invoiceId);
  }

  /**
   * Payment status tekshirish endpoint (payment_id orqali)
   */
  @Get('payment-status/:paymentId')
  @HttpCode(HttpStatus.OK)
  async checkPaymentStatus(@Param('paymentId') paymentId: number) {
    logger.info('Payment status tekshirish:', { paymentId });
    return await this.clickService.checkPaymentStatus(paymentId);
  }

  /**
   * Payment status tekshirish endpoint (merchant_trans_id orqali)
   */
  @Get('payment-status-by-mti/:merchantTransId/:date')
  @HttpCode(HttpStatus.OK)
  async checkPaymentByMerchantTransId(
    @Param('merchantTransId') merchantTransId: string,
    @Param('date') date: string
  ) {
    logger.info('Payment status tekshirish (MTI):', { merchantTransId, date });
    return await this.clickService.checkPaymentByMerchantTransId(merchantTransId, date);
  }
}
