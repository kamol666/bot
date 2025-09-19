import {Context, SessionFlavor} from 'grammy';
import * as path from 'path';
import { BroadcastService } from './broadcast.service';
import logger from '../utils/logger';
import {formatLinks} from "../utils/linkFormatter";

interface SessionData {
    pendingSubscription?: {
        type: string
    };
    hasAgreedToTerms?: boolean;
}

type BotContext = Context & SessionFlavor<SessionData>;

export class BroadcastHandler {
    private broadcastService: BroadcastService;

    constructor(broadcastService: BroadcastService) {
        this.broadcastService = broadcastService;
    }

    async handleBroadcastCommand(ctx: BotContext): Promise<void> {
        const senderId = ctx.from?.id;
        const senderUsername = ctx.from?.username || 'unknown';

        if (!senderId) {
            logger.warn('Broadcast command from unidentified sender');
            await ctx.reply("Error: Could not identify sender");
            return;
        }

        logger.info(`Broadcast command received from @${senderUsername} (${senderId})`);

        // Get the command arguments - everything after /broadcast
        const args = ctx.message?.text?.split(' ').slice(1).join(' ') || '';

        if (!args) {
            logger.info('Broadcast command with empty message');
            await ctx.reply(
                "⚠️ Please provide a message to broadcast.\n\n" +
                "Usage:\n" +
                "- Text only: `/broadcast Your message here`\n" +
                "- With video: `/broadcast Your message here --video=filename.mp4`"
            );
            return;
        }

        try {
            const videoMatch = args.match(/--video=(\S+)/i);
            let videoPath: string | undefined;
            let messageText = args;

            if (videoMatch) {
                const videoFilename = videoMatch[1];
                messageText = args.replace(/--video=(\S+)/i, '').trim();
                videoPath = path.join(__dirname, '..', 'videos', videoFilename);
            }

            // Dynamically format links (default: Markdown)
            const formattedMessage = messageText;

            logger.info(`Broadcasting formatted message: ${formattedMessage.substring(0, 50)}...`);

            // Send with parse_mode
            const result = await this.broadcastService.sendBroadcastToAllUsers(
                senderId,
                formattedMessage,
                videoPath,
                'Markdown'
            );


            const completionMessage = `✅ Broadcast complete!\n\n` +
                `📊 Statistics:\n` +
                `- Successfully sent: ${result.success}\n` +
                `- Failed: ${result.failed}`;

            logger.info(`Broadcast completed - Success: ${result.success}, Failed: ${result.failed}`);
            await ctx.reply(completionMessage);

        } catch (error) {
            logger.error('Broadcast command error:', error);
            await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}