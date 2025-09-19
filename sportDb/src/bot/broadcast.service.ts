import { Bot, Context, SessionFlavor } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import { UserModel } from '../database/models/user.model';
import logger from '../utils/logger';
import { InputFile } from 'grammy';

interface SessionData {
    pendingSubscription?: {
        type: string
    };
    hasAgreedToTerms?: boolean;
}

type BotContext = Context & SessionFlavor<SessionData>;

export class BroadcastService {
    private bot: Bot<BotContext>;
    private adminIds: number[];

    constructor(bot: Bot<BotContext>, adminIds: number[]) {
        this.bot = bot;
        this.adminIds = adminIds;
    }

    async sendBroadcastToAllUsers(
        senderId: number,
        text: string,
        videoPath?: string,
        parseMode?: 'Markdown' | 'HTML'
    ): Promise<{ success: number; failed: number }> {
        // Authorization check
        if (!this.adminIds.includes(senderId)) {
            logger.warn(`Unauthorized broadcast attempt by user ${senderId}`);
            throw new Error('Unauthorized: Only admins can broadcast messages');
        }

        const users = await UserModel.find({}, { telegramId: 1 });
        let successCount = 0;
        let failedCount = 0;
        let videoFileId: string | undefined;

        // Video handling with enhanced logging
        if (videoPath) {
            if (!fs.existsSync(videoPath)) {
                logger.error(`Video file not found at path: ${videoPath}`);
                throw new Error(`Video file not found at path: ${videoPath}`);
            }

            const stats = fs.statSync(videoPath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            logger.info(`Preparing to broadcast video: ${path.basename(videoPath)} (${fileSizeMB} MB) to ${users.length} users`);

            // Upload video once to get file_id
            try {
                logger.info('Uploading video once to obtain file_id for reuse...');
                const testResult = await this.bot.api.sendVideo(this.adminIds[0], new InputFile(videoPath), {
                    caption: 'Initial upload to obtain file_id'
                });
                videoFileId = testResult.video.file_id;
                logger.info(`Successfully obtained video file_id: ${videoFileId}`);
            } catch (error) {
                logger.error('Failed to obtain video file_id:', error);
                // Continue with fallback method instead of throwing
                logger.warn('Falling back to direct file uploads');
            }
        }

        logger.info(`Starting broadcast to ${users.length} users - Text length: ${text.length} chars` +
            (videoPath ? ` + Video attachment` : ''));

        const startTime = Date.now();
        let lastProgressLog = Date.now();
        let usersProcessed = 0;

        for (const user of users) {
            try {
                if (user.telegramId) {
                    // Progress logging every 30 seconds or 100 users
                    if (Date.now() - lastProgressLog > 30000 || usersProcessed % 100 === 0) {
                        const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
                        const rate = (usersProcessed / ((Date.now() - startTime) / 1000)).toFixed(1);
                        logger.info(`Broadcast progress: ${usersProcessed}/${users.length} users (${elapsedMin} min) - ${rate} users/sec`);
                        lastProgressLog = Date.now();
                    }

                    if (videoPath && videoFileId) {
                        await this.bot.api.sendVideo(user.telegramId, videoFileId, {
                            caption: text,
                            parse_mode: parseMode
                        });
                        logger.debug(`Video sent to user ${user.telegramId} using file_id`);
                    } else if (videoPath) {
                        // Fallback to regular method if file_id couldn't be obtained
                        const videoStream = fs.createReadStream(videoPath);
                        await this.bot.api.sendVideo(user.telegramId, new InputFile(videoStream), {
                            caption: text,
                            parse_mode: parseMode
                        });
                        logger.debug(`Video sent to user ${user.telegramId} (direct upload)`);
                    } else {
                        await this.bot.api.sendMessage(user.telegramId, text, {
                            parse_mode: parseMode
                        });
                        logger.debug(`Message sent to user ${user.telegramId}`);
                    }

                    successCount++;
                    usersProcessed++;

                    // Rate limiting delay (1 second between sends)
                    await new Promise(resolve => setTimeout(resolve, 200));
                } else {
                    logger.warn(`User ${user._id} has no telegramId`);
                    failedCount++;
                }
            } catch (error) {
                logger.error(`Failed to send broadcast to user ${user.telegramId}:`, error);
                failedCount++;

                // If it's a rate limit error, increase delay temporarily
                if (error instanceof Error && error.message.includes('Too Many Requests')) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    logger.warn('Rate limit hit, increased delay to 5 seconds');
                }
            }
        }

        const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
        logger.info(`Broadcast completed in ${totalTime} minutes: ${successCount} successful, ${failedCount} failed`);
        return { success: successCount, failed: failedCount };
    }
}