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
  async checkInvoiceStatus(@Param('invoiceId') invoiceId: string) {
    const invoiceIdNumber = parseInt(invoiceId, 10);

    if (isNaN(invoiceIdNumber)) {
      return {
        error_code: -1,
        error_note: 'Invalid invoice ID format'
      };
    }

    logger.info('Invoice status tekshirish:', { invoiceId: invoiceIdNumber });
    return await this.clickService.checkInvoiceStatus(invoiceIdNumber);
  }
}
