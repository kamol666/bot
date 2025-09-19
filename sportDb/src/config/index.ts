import dotenv from 'dotenv';
import {cleanEnv, num, str} from 'envalid';

export interface SubscriptionPlan {
    price: number;
    duration: number;
    name: string;
}

export type SubscriptionType = 'basic' | 'standard' | 'premium';

export const SUBSCRIPTION_PLANS: Record<SubscriptionType, SubscriptionPlan> = {
    basic: {price: 7777, duration: 30, name: 'Basic'},
    standard: {price: 5000, duration: 90, name: 'Standard'},
    premium: {price: 15000, duration: 360, name: 'Premium'}
};

dotenv.config();

export const config = cleanEnv(process.env, {
    APP_PORT: num({default: 3000}),
    BOT_TOKEN: str(),
    MONGODB_URI: str(),
    CHANNEL_ID: str(),
    WRESTLING_CHANNEL_ID: str(),
    NODE_ENV: str({choices: ['development', 'production'], default: 'development'}),

    CLICK_SERVICE_ID: str(),
    CLICK_MERCHANT_ID: str(),
    CLICK_SECRET: str(),
    CLICK_MERCHANT_USER_ID: str(),

    PAYME_MERCHANT_ID: str(),
    PAYME_LOGIN: str(),
    PAYME_PASSWORD: str(),
    PAYME_PASSWORD_TEST: str()
});
