import { connectDB } from './database/db';
import { SubscriptionBot } from './bot/bot';
import logger from './utils/logger';
import {bootstrap} from "./api/main";

async function main() {
    try {
        await connectDB();

        const bot = new SubscriptionBot();
        await bootstrap();
        await bot.start();
    } catch (error) {
        logger.error('Application startup error:', error);
        process.exit(1);
    }
}

main().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});