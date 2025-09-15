import dotenv from 'dotenv';
import { cleanEnv, num, str } from 'envalid';

export type SubscriptionType = 'basic';

dotenv.config();

const env = cleanEnv(process.env, {
  APP_PORT: num(),
  // PUBLIC_BASE_URL is optional, used for tunnelled public access
  PUBLIC_BASE_URL: str({ default: '' }),
  // BASE_URL is required, can be localhost or the public url
  BASE_URL: str(),
  BOT_TOKEN: str(),
  MONGODB_URI: str(),
  CHANNEL_ID: str(),
  NODE_ENV: str({
    choices: ['development', 'production'],
    default: 'development',
  }),

  CLICK_SERVICE_ID: str(),
  CLICK_MERCHANT_ID: str(),
  CLICK_SECRET: str(),
  CLICK_MERCHANT_USER_ID: str(),

  PAYME_MERCHANT_ID: str(),
  PAYME_LOGIN: str(),
  PAYME_PASSWORD: str(),
  PAYME_PASSWORD_TEST: str(),
});

// Use the public URL for the base URL if it's available, otherwise use the default.
// This is crucial for Telegram bot payments which require a public HTTPS endpoint.
export const config = {
  ...env,
  BASE_URL: env.PUBLIC_BASE_URL || env.BASE_URL,
};
