import logger from '../utils/logger';
import { config } from '../config';

export type PaymeLinkGeneratorParams = {
  planId: string;
  userId: string;
  amount: number;
};

const PAYME_CHECKOUT_URL = config.BASE_URL + '/api/payme';

export function generatePaymeLink(params: PaymeLinkGeneratorParams): string {
  const merchantId = config.PAYME_MERCHANT_ID;
  const amountInTiyns = params.amount * 100;
  const paramsInString = `m=${merchantId};ac.plan_id=${params.planId};ac.user_id=${params.userId};ac.selected_service=${params.planId};a=${amountInTiyns}`;
  logger.info(paramsInString);
  const encodedParams = base64Encode(paramsInString);
  console.log(amountInTiyns);
  return `${PAYME_CHECKOUT_URL}/?${encodedParams}`;
}

function base64Encode(input: string): string {
  return Buffer.from(input).toString('base64');
}
