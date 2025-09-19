import { Bot, Context, InlineKeyboard, session, SessionFlavor } from 'grammy';
import { config, SubscriptionType } from '../config';
import { SubscriptionService } from '../services/subscription.service';
import logger from '../utils/logger';
import { IPlanDocument, Plan } from "../database/models/plans.model";
import { UserModel } from "../database/models/user.model";
import { generatePaymeLink } from "../shared/generators/payme-link.generator";
import { SubscriptionMonitorService } from '../services/subscription-monitor.service';
import { SubscriptionChecker } from '../schedulers/subscription-checker';
import { ClickRedirectParams, getClickRedirectLink } from "../shared/generators/click-redirect-link.generator";
import mongoose from "mongoose";
import { ClickSubsApiService } from "../payment-providers/click-subs-api/click-subs-api.service";
import { CardType, UserCardsModel } from "../database/models/user-cards.model";
import { BroadcastService } from "./broadcast.service";
import { BroadcastHandler } from "./broadcast.handler";

import { FlowStepType, SubscriptionFlowTracker } from '../database/models/subscription-flow-tracker.model';
import { PaymeSubsApiService } from "../payment-providers/payme-subs-api/payme-subs-api.service";
import { UzcardSubsApiService } from "../payment-providers/uzcard-subs-api/uzcard-subs-api.service";
import { AutoPaymentMonitorService } from "../services/auto-payment-monitor.service";
import { UserSubscriptionExpirationService } from "../services/user-subscription-expiration.service";
import { isUserEligibleForFreeBonus } from "./bot-plan-recorder";
import { UserSubscription } from "../database/models/user-subscription.model";
import { Transaction } from "../database/models/transactions.model";


interface SessionData {
    pendingSubscription?: {
        type: SubscriptionType
    };
    hasAgreedToTerms?: boolean;
    selectedSport?: 'football' | 'wrestling',
    lang?: 'uz' | 'ru'
}

type lang = 'uz' | 'ru'

type BotContext = Context & SessionFlavor<SessionData>;

export class SubscriptionBot {
    private bot: Bot<BotContext>;
    private subscriptionService: SubscriptionService;
    private subscriptionMonitorService: SubscriptionMonitorService;
    private autoPaymentMonitorService: AutoPaymentMonitorService;
    private userSubscriptionExpirationService: UserSubscriptionExpirationService;
    private subscriptionChecker: SubscriptionChecker;
    private clickSubsApiService = new ClickSubsApiService();
    private paymeSubsApiService = new PaymeSubsApiService();
    private uzcardSubsApiService = new UzcardSubsApiService();
    private readonly ADMIN_IDS = [1487957834, 7554617589, 85939027, 1083408, 2022496528, 2051328694];

    private broadcastService: BroadcastService;
    private broadcastHandler: BroadcastHandler;

    constructor() {
        this.bot = new Bot<BotContext>(config.BOT_TOKEN);
        this.subscriptionService = new SubscriptionService(this.bot);
        this.subscriptionMonitorService = new SubscriptionMonitorService(this.bot);
        this.autoPaymentMonitorService = new AutoPaymentMonitorService(this.bot, this.subscriptionService);
        // @ts-ignore
        this.broadcastService = new BroadcastService(this.bot, this.ADMIN_IDS);
        this.broadcastHandler = new BroadcastHandler(this.broadcastService);
        this.userSubscriptionExpirationService = new UserSubscriptionExpirationService();
        this.subscriptionChecker = new SubscriptionChecker(
            this.subscriptionMonitorService,
            this.autoPaymentMonitorService,
            this.userSubscriptionExpirationService
        );
        // Add this in the constructor after other initializations

        this.setupMiddleware();
        this.setupHandlers();
    }

    public async start(): Promise<void> {
        // Just start the checker once
        await this.subscriptionChecker.start();


        await this.bot.start({
            onStart: () => {
                logger.info('Bot started');
            }
        });
    }

    async handlePaymentSuccessForFootball(userId: string, telegramId: number, plan: IPlanDocument, username?: string): Promise<void> {

        try {
            if (!plan) {
                return;
            }

            const { user: subscription, wasKickedOut } = await this.subscriptionService.createSubscription(
                userId,
                plan,
                username
            );

            await UserModel.updateOne(
                { telegramId: telegramId },
                { $set: { subscribedTo: 'football' } }
            );


            const privateLink = await this.getFootballLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");


            let messageText = `🎉 Tabriklaymiz! To'lov muvaffaqiyatli amalga oshirildi!\n\n` +
                `⏰ Obuna tugash muddati: ${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}\n\n`;

            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
            //     messageText += `i️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
            //         `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
            // } else {
            //     messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;


            const user1 = await UserModel.findOne({
                telegramId: telegramId
            });

            // @ts-ignore
            logger.info(`User updated with subscribedTo: ${user1.subscribedTo}`);

            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ To'lov amalga oshirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    async handlePaymentSuccessForWrestling(userId: string, telegramId: number, plan: IPlanDocument, username?: string): Promise<void> {

        try {

            if (!plan) {
                return;
            }

            const { user: subscription } = await this.subscriptionService.createSimpleWrestlingSubscription(
                userId,
                plan,
                username
            );

            await UserModel.updateOne(
                { telegramId: telegramId },
                { $set: { subscribedTo: 'wrestling' } }
            );

            const privateLink = await this.getWrestlingLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");


            let messageText = `🎉 Tabriklaymiz! Yakka kurash uchun to'lov muvaffaqiyatli amalga oshirildi!\n\n` +
                `⏰ Obuna tugash muddati: ${subscription.subscriptionEndForWrestling.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEndForWrestling.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEndForWrestling.getFullYear()}\n\n`;

            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
            //     messageText += `i️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
            //         `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
            // } else {
            //     messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;


            const user1 = await UserModel.findOne({
                telegramId: telegramId
            });

            // @ts-ignore
            logger.info(`User updated with subscribedTo: ${user1.subscribedTo}`);

            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ To'lov amalga oshirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }


    async handlePaymentSuccessForUzcard(userId: string, telegramId: number, username?: string, fiscalQr?: string | undefined, selectedSport?: string): Promise<void> {

        logger.info(`Selected sport on handlePaymentSuccess: ${selectedSport}`);
        try {
            let plan: any;

            if (selectedSport === 'wrestling') {
                plan = await Plan.findOne({ name: 'Yakka kurash' });
            } else if (selectedSport === 'football') {
                plan = await Plan.findOne({ name: 'Futbol' });
            }

            if (!plan) {
                return;
            }

            let subscription: any;

            if (selectedSport == 'wrestling') {
                subscription = await this.subscriptionService.createSimpleWrestlingSubscription(
                    userId,
                    plan,
                    username
                );
            } else if (selectedSport == 'football') {
                subscription = await this.subscriptionService.createSubscription(
                    userId,
                    plan,
                    username
                );
            }

            let messageText: string = "";

            const privateLink = await this.getFootballLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");

            if (fiscalQr) {
                keyboard.row().url("🧾 Chekni ko'rish", fiscalQr);
            }

            // Use appropriate subscription end date based on sport
            const subscriptionEndDate = selectedSport === 'wrestling'
                ? (subscription.user.subscriptionEndForWrestling || subscription.user.subscriptionEnd)
                : subscription.user.subscriptionEnd;

            if (selectedSport == 'wrestling') {
                messageText = `🎉 Tabriklaymiz! Yakka kurash uchun to'lov muvaffaqiyatli amalga oshirildi!\n\n` +
                    `⏰ Obuna tugash muddati: ${subscriptionEndDate.getDate().toString().padStart(2, '0')}.${(subscriptionEndDate.getMonth() + 1).toString().padStart(2, '0')}.${subscriptionEndDate.getFullYear()}\n\n`;
            } else if (selectedSport == 'football') {
                messageText = `🎉 Tabriklaymiz! To'lov muvaffaqiyatli amalga oshirildi!\n\n` +
                    `⏰ Obuna tugash muddati: ${subscriptionEndDate.getDate().toString().padStart(2, '0')}.${(subscriptionEndDate.getMonth() + 1).toString().padStart(2, '0')}.${subscriptionEndDate.getFullYear()}\n\n`;
            }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

            if (fiscalQr) {
                messageText += `\n\n📋 To'lov cheki QR kodi mavjud. Chekni ko'rish uchun quyidagi tugmani bosing.`;
            }

            await UserModel.updateOne(
                { telegramId: telegramId },
                { $set: { subscribedTo: selectedSport } }
            );

            const user1 = await UserModel.findOne({
                telegramId: telegramId
            });

            // @ts-ignore
            logger.info(`User updated with subscribedTo: ${user1.subscribedTo}`);

            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            logger.error(`Error in handlePaymentSuccessForUzcard: ${error}`);
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ To'lov amalga oshirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    //TODO: change selectedSport to planId so no need for extra checkings
    async handleUzCardSubscriptionSuccess(
        userId: string,
        telegramId: number,
        selectedSport: string,
        username?: string
    ): Promise<void> {
        try {
            let plan: any;

            if (selectedSport === 'wrestling') {
                plan = await Plan.findOne({ name: 'Yakka kurash' });
            } else if (selectedSport === 'football') {
                plan = await Plan.findOne({ name: 'Futbol' });
            }
            if (!plan) {
                return;
            }


            const user = await UserModel.findById(userId);
            if (!user) {
                return;
            }


            if (selectedSport == 'wrestling') {
                await this.subscriptionService.createWrestlingSubscriptionWithCard(
                    userId,
                    plan,
                    username,
                    60
                );
            }
            const { user: subscription, wasKickedOut } = await this.subscriptionService.createUzcardSubscription(
                userId,
                plan,
                username,
                60
            );

            const privateLink = await this.getFootballLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");

            const normalEndDate = new Date(subscription.subscriptionStart);
            normalEndDate.setDate(normalEndDate.getDate() + plan.duration);

            const bonusEndFormatted = `${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}`;

            let messageText = `🎉 Tabriklaymiz! UzCard orqali obuna muvaffaqiyatli faollashtirildi!\n\n` +
                `🎁 60 kunlik bonus: ${bonusEndFormatted} gacha\n\n`;

            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
            //     messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. `;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ UzCard orqali obuna faollashtirishda xatolik. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    async handleUzCardWrestlingSubscriptionSuccess(
        userId: string,
        telegramId: number,
        username?: string,
        bonusDays: number = 60
    ): Promise<void> {
        try {
            const plan = await Plan.findOne({ name: 'Yakka kurash' });
            if (!plan) {
                return;
            }

            const user = await UserModel.findById(userId);
            if (!user) {
                return;
            }

            // Create wrestling subscription with bonus
            const {
                user: subscription,
                wasKickedOut
            } = await this.subscriptionService.createWrestlingSubscriptionWithCard(
                userId,
                plan,
                username,
                bonusDays
            );

            // Update user's subscribed sport
            await UserModel.updateOne(
                { telegramId: telegramId },
                { $set: { subscribedTo: 'wrestling' } }
            );

            const privateLink = await this.getWrestlingLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");

            const bonusEndFormatted = `${subscription.subscriptionEndForWrestling.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEndForWrestling.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEndForWrestling.getFullYear()}`;

            let messageText = `🎉 Tabriklaymiz! UzCard orqali yakka kurash obunasi muvaffaqiyatli faollashtirildi!\n\n` +
                `🎁 ${bonusDays} kunlik bonus: ${bonusEndFormatted} gacha\n\n`;

            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.WRESTLING_CHANNEL_ID, telegramId);
            //     messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. `;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

            const user1 = await UserModel.findOne({
                telegramId: telegramId
            });

            // @ts-ignore
            logger.info(`User updated with subscribedTo: ${user1.subscribedTo}`);

            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            logger.error(`Error in handleUzCardWrestlingSubscriptionSuccess: ${error}`);
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ UzCard orqali yakka kurash obunasini faollashtirishda xatolik. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    async handleAutoSubscriptionSuccess(userId: string, telegramId: number, planId: string, username?: string): Promise<void> {

        try {
            const plan = await Plan.findById(planId);

            if (!plan) {
                return;
            }

            await SubscriptionFlowTracker.create({
                telegramId,
                username,
                userId,
                step: FlowStepType.COMPLETED_SUBSCRIPTION,
            });

            const user = await UserModel.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }


            const { user: subscription, wasKickedOut } = await this.subscriptionService.createSubscription(
                userId,
                plan,
                username,
                true
            );

            const privateLink = await this.getFootballLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");

            // Format end date in DD.MM.YYYY format
            const endDateFormatted = `${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}`;


            let messageText = `🎉 Tabriklaymiz! Avtomatik to'lov muvaffaqiyatli faollashtirildi!\n\n`;

            messageText += `📆 Obuna muddati: ${endDateFormatted} gacha\n\n`;


            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
            //     messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
            //         `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
            // } else {
            //     messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;


            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            // Send error message to user
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ Avtomatik to'lov faollashtirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning."
            );
        }
    }

    async handleAutoSubscriptionSuccessForWrestling(userId: string, telegramId: number, planId: string, username?: string): Promise<void> {

        try {
            const plan = await Plan.findById(planId);

            if (!plan) {
                logger.error(`Plan with name 'Wrestling' not found in handleAutoSubscriptionSuccessForWrestling`);
                return;
            }

            await SubscriptionFlowTracker.create({
                telegramId,
                username,
                userId,
                step: FlowStepType.COMPLETED_SUBSCRIPTION,
            });

            const user = await UserModel.findById(userId);

            if (!user) {
                throw new Error('User not found');
            }

            const { user: subscription } = await this.subscriptionService.createWrestlingSubscriptionWithCard(
                userId,
                plan,
                username,
                30
            );

            const privateLink = await this.getWrestlingLink();
            const keyboard = new InlineKeyboard()
                .url("🔗 Kanalga kirish", privateLink.invite_link)
                .row()
                .text("🔙 Asosiy menyu", "main_menu");

            // Format end date in DD.MM.YYYY format
            const endDateFormatted = `${subscription.subscriptionEndForWrestling.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEndForWrestling.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEndForWrestling.getFullYear()}`;


            let messageText = `🎉 Tabriklaymiz! Yakka Kurash obunasi muvaffaqiyatli faollashtirildi!\n\n`;

            messageText += `📆 Obuna muddati: ${endDateFormatted} gacha\n\n`;


            // if (wasKickedOut) {
            //     //TODO we aren't banning users so this is not necessary, but I am keeping them for now
            //     await this.bot.api.unbanChatMember(config.CHANNEL_ID, telegramId);
            //     messageText += `ℹ️ Sizning avvalgi bloklanishingiz bekor qilindi. ` +
            //         `Quyidagi havola orqali kanalga qayta kirishingiz mumkin:`;
            // } else {
            //     messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;
            // }

            messageText += `Quyidagi havola orqali kanalga kirishingiz mumkin:`;


            await this.bot.api.sendMessage(
                telegramId,
                messageText,
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );

        } catch (error) {
            // Send error message to user
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ Avtomatik to'lov faollashtirildi, lekin obunani faollashtirish bilan bog'liq muammo yuzaga keldi. Iltimos, administrator bilan bog'laning."
            );
        }
    }

    async handleCardAddedWithoutBonus(userId: string, telegramId: number, cardType: CardType, plan: IPlanDocument, username?: string, selectedSport?: string): Promise<void> {
        try {
            const user = await UserModel.findById(userId);
            if (!user) {
                return;
            }

            if (!plan) {
                return;
            }

            user.subscriptionType = 'subscription'
            user.save();

            // Create regular subscription without bonus
            const {
                user: subscription,
                wasKickedOut,
                success
            } = await this.subscriptionService.renewSubscriptionWithCard(
                userId,
                telegramId,
                cardType,
                plan,
                username,
                selectedSport
            );

            if (success) {
                const privateLink = await this.getFootballLink();
                const keyboard = new InlineKeyboard()
                    .url("🔗 Kanalga kirish", privateLink.invite_link)
                    .row()
                    .text("📊 Obuna holati", "check_status")
                    .row()
                    .text("🔙 Asosiy menyu", "main_menu");

                // Format the end date
                const endDate = new Date(subscription.subscriptionEnd);
                const endDateFormatted = `${endDate.getDate().toString().padStart(2, '0')}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getFullYear()}`;

                let messageText = `✅ To'lov muvaffaqiyatli amalga oshirildi va kartangiz saqlandi!\n\n` +
                    `📆 Yangi obuna muddati: ${endDateFormatted} gacha\n\n` +
                    `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

                await this.bot.api.sendMessage(
                    telegramId,
                    messageText,
                    {
                        reply_markup: keyboard,
                        parse_mode: "HTML"
                    }
                );

            }

        } catch (error) {
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ Kartangiz qo'shildi, lekin obunani yangilashda xatolik yuz berdi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    async handleCardAddedWithoutBonusForWrestling(userId: string, telegramId: number, cardType: CardType, plan: IPlanDocument, username?: string, selectedSport?: string): Promise<void> {
        try {
            const user = await UserModel.findById(userId);
            if (!user) {
                return;
            }


            if (!plan) {
                return;
            }

            user.subscriptionType = 'subscription'
            user.save();

            // Create regular subscription without bonus
            const {
                user: subscription,
                wasKickedOut,
                success
            } = await this.subscriptionService.renewSubscriptionWithCard(
                userId,
                telegramId,
                cardType,
                plan,
                username,
                selectedSport
            );

            if (success) {
                const privateLink = await this.getFootballLink();
                const keyboard = new InlineKeyboard()
                    .url("🔗 Kanalga kirish", privateLink.invite_link)
                    .row()
                    .text("📊 Obuna holati", "check_status")
                    .row()
                    .text("🔙 Asosiy menyu", "main_menu");

                // Format the end date
                const endDate = new Date(subscription.subscriptionEnd);
                const endDateFormatted = `${endDate.getDate().toString().padStart(2, '0')}.${(endDate.getMonth() + 1).toString().padStart(2, '0')}.${endDate.getFullYear()}`;

                let messageText = `✅ To'lov muvaffaqiyatli amalga oshirildi va kartangiz saqlandi!\n\n` +
                    `📆 Yangi obuna muddati: ${endDateFormatted} gacha\n\n` +
                    `Quyidagi havola orqali kanalga kirishingiz mumkin:`;

                await this.bot.api.sendMessage(
                    telegramId,
                    messageText,
                    {
                        reply_markup: keyboard,
                        parse_mode: "HTML"
                    }
                );

            }

        } catch (error) {
            await this.bot.api.sendMessage(
                telegramId,
                "⚠️ Kartangiz qo'shildi, lekin obunani yangilashda xatolik yuz berdi. Iltimos, administrator bilan bog'laning. @sssupporttbot"
            );
        }
    }

    async getAutoSubscriptionDailyStats(date: Date = new Date()) {
        // Set date to start of day
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);

        // Set end of day
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        // Get counts for each step type
        const stats = await SubscriptionFlowTracker.aggregate([
            {
                $match: {
                    timestamp: { $gte: startOfDay, $lte: endOfDay }
                }
            },
            {
                $group: {
                    _id: "$step",
                    count: { $sum: 1 },
                    uniqueUsers: { $addToSet: "$telegramId" }
                }
            },
            {
                $project: {
                    step: "$_id",
                    count: 1,
                    uniqueUsersCount: { $size: "$uniqueUsers" }
                }
            }
        ]);

        // Calculate conversion rate
        const clickedCount = stats.find(s => s.step === FlowStepType.CLICKED_AUTO_PAYMENT)?.uniqueUsersCount || 0;
        const completedCount = stats.find(s => s.step === FlowStepType.COMPLETED_SUBSCRIPTION)?.uniqueUsersCount || 0;


        return {
            date: startOfDay.toISOString().split('T')[0],
            stats,
            summary: {
                clickedAutoPayment: clickedCount,
                completedSubscription: completedCount,
            }
        };
    }

    private setupHandlers(): void {
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('admin', this.handleAdminCommand.bind(this));
        this.bot.on('callback_query', this.handleCallbackQuery.bind(this));
        // Add this in the setupHandlers method
        this.bot.command('broadcast', (ctx) => this.broadcastHandler.handleBroadcastCommand(ctx));
    }

    private setupMiddleware(): void {
        this.bot.use(session({
            initial(): SessionData {
                return {
                    hasAgreedToTerms: false // Initialize as false by default
                };
            }
        }));
        this.bot.use((ctx, next) => {
            logger.info(`user chatId: ${ctx.from?.id}`);
            return next();
        })

        this.bot.catch((err) => {
            logger.error('Bot error:', err);
        });
    }

    private async handleCallbackQuery(ctx: BotContext): Promise<void> {
        if (!ctx.callbackQuery?.data) return;

        const data = ctx.callbackQuery.data;
        if (!data) return;

        if (data.startsWith('use_existing_card_')) {
            const parts = data.replace('use_existing_card_', '').split('_');
            const planId = parts[0];
            await this.handleUseExistingCard(ctx, planId);
            return;
        }

        if (data.startsWith('show_cards_')) {
            const userId = data.replace('show_cards_', '');
            await this.handleShowCards(ctx, userId);
            return;
        }

        // NEW: Handle showing existing card options
        if (data.startsWith('existing_card_menu_')) {
            const userId = data.replace('existing_card_menu_', '');
            await this.showExistingCardOptions(ctx, userId);
            return;
        }


        if (data === 'main_menu') {
            ctx.session.hasAgreedToTerms = false;
        }

        const paymentUnavailableMessage = {
            uz: "⚠️ Kechirasiz, hozircha bu to'lov turi mavjud emas.",
            ru: "⚠️ Извините, этот способ оплаты пока недоступен.",
        };

        const handlers: { [key: string]: (ctx: BotContext) => Promise<void> } = {
            'subscribe': this.handleSubscribeCallback.bind(this),
            'payment_type_onetime': this.handleOneTimePayment.bind(this),
            'payment_type_subscription': this.handleSubscriptionPayment.bind(this),
            'back_to_payment_types': this.showPaymentTypeSelection.bind(this),
            'check_status': this.handleStatus.bind(this),
            'renew': this.handleRenew.bind(this),
            'back_to_main_menu': this.showMainMenu.bind(this),
            'main_menu': this.showMainMenu.bind(this),
            'menu_football': this.showMainMenuForFootball.bind(this),
            'menu_wrestling': this.showMainMenuForWrestling.bind(this),
            'uz': this.handleSetUzbekLanguage.bind(this),
            'ru': this.handleSetRussianLanguage.bind(this),
            'confirm_subscribe_basic': this.confirmSubscription.bind(this),
            'agree_terms': this.handleAgreement.bind(this),
            'card_menu': this.handleCardMenu.bind(this),
            'delete_card': this.handleDeleteCard.bind(this),

            'not_supported_international': async (ctx) => {
                await ctx.answerCallbackQuery({
                    text: paymentUnavailableMessage[ctx.session.lang as "uz" | "ru"],
                    show_alert: true
                });
            },

        };

        const handler = handlers[data];
        if (handler) {
            await handler(ctx);
        }
    }

    private async showMainMenuForFootball(ctx: BotContext): Promise<void> {
        ctx.session.hasAgreedToTerms = false;
        ctx.session.selectedSport = 'football';

        await UserModel.updateOne(
            { telegramId: ctx.from?.id },
            { $set: { selectedSport: 'football' } }
        );


        const keyboard = {
            uz: new InlineKeyboard()
                .text("✅ Obuna bo'lish", "subscribe")
                .row()
                .text("📊 Obuna holati", "check_status")
                .row()
                .text("🔄 Obunani yangilash", "renew")
                .row()
                .text("🔙 Orqaga", "back_to_main_menu"),

            ru: new InlineKeyboard()
                .text("✅ Подписаться", "subscribe")
                .row()
                .text("📊 Статус подписки", "check_status")
                .row()
                .text("🔄 Обновить подписку", "renew")
                .row()
                .text("🔙 Назад", "back_to_main_menu"),
        };


        const messages = {
            uz: `Assalomu alaykum, ${ctx.from?.first_name}! 👋

⚽ Futbol Premium kontentiga xush kelibsiz! 🏆

Eng so'nggi futbol yangiliklari, ekspert tahlillari va premium kontentga kirish uchun obuna bo'ling:`,

            ru: `Здравствуйте, ${ctx.from?.first_name}! 👋

⚽ Добро пожаловать в раздел Премиум-футбола! 🏆

Подпишитесь, чтобы получить доступ к последним футбольным новостям, экспертным анализам и эксклюзивному контенту:`,
        };


        if (ctx.callbackQuery) {
            await ctx.editMessageText(messages[ctx.session.lang as "uz" | "ru"], {
                reply_markup: keyboard[ctx.session.lang as "uz" | "ru"],
                parse_mode: "HTML"
            });
        } else {
            await ctx.reply(messages[ctx.session.lang as "uz" | "ru"], {
                reply_markup: keyboard[ctx.session.lang as "uz" | "ru"],
                parse_mode: "HTML"
            });
        }
    }

    private async showMainMenuForWrestling(ctx: BotContext): Promise<void> {
        ctx.session.hasAgreedToTerms = false;
        ctx.session.selectedSport = 'wrestling';


        await UserModel.updateOne(
            { telegramId: ctx.from?.id },
            { $set: { selectedSport: 'wrestling' } }
        );

        const keyboard = {
            uz: new InlineKeyboard()
                .text("✅ Obuna bo'lish", "subscribe")
                .row()
                .text("📊 Obuna holati", "check_status")
                .row()
                .text("🔄 Obunani yangilash", "renew")
                .row()
                .text("🔙 Orqaga", "back_to_main_menu"),

            ru: new InlineKeyboard()
                .text("✅ Подписаться", "subscribe")
                .row()
                .text("📊 Статус подписки", "check_status")
                .row()
                .text("🔄 Обновить подписку", "renew")
                .row()
                .text("🔙 Назад", "back_to_main_menu"),
        };


        const messages = {
            uz: `Assalomu alaykum, ${ctx.from?.first_name}! 👋

🤼‍♂️ Yakka Kurash Premium kontentiga xush kelibsiz! 🥇

Professional kurash musobaqalari va ekspert sharhlariga kirish uchun obuna bo'ling:`,

            ru: `Здравствуйте, ${ctx.from?.first_name}! 👋

🤼‍♂️ Добро пожаловать в раздел Премиум-контента по борьбе! 🥇

Подпишитесь, чтобы получить доступ к профессиональным соревнованиям по борьбе и экспертным комментариям:`,
        };


        if (ctx.callbackQuery) {
            await ctx.editMessageText(messages[ctx.session.lang as "uz" | "ru"], {
                reply_markup: keyboard[ctx.session.lang as "uz" | "ru"],
                parse_mode: "HTML"
            });
        } else {
            await ctx.reply(messages[ctx.session.lang as "uz" | "ru"], {
                reply_markup: keyboard[ctx.session.lang as "uz" | "ru"],
                parse_mode: "HTML"
            });
        }
    }

    private async showMainMenu(ctx: BotContext): Promise<void> {
        ctx.session.hasAgreedToTerms = false;

        const keyboard = {
            uz: new InlineKeyboard()
                .text("⚽ Futbol", "menu_football")
                .text("🤼‍♂️ Kurash", "menu_wrestling")
                .row(),
            ru: new InlineKeyboard()
                .text("⚽ Футбол", "menu_football")
                .text("🤼‍♂️ Кураш", "menu_wrestling")
                .row(),
        }

        const lang = ctx.session.lang;
        const messages = {
            uz: `Assalomu alaykum, ${ctx.from?.first_name}! 👋

🏆 Sports Uz Premium platformasiga xush kelibsiz!

Qaysi sport turiga qiziqasiz?`,

            ru: `Здравствуйте, ${ctx.from?.first_name}! 👋

🏆 Добро пожаловать на платформу Sports Uz Premium!

Каким видом спорта вы интересуетесь?`
        };

        console.log(ctx.session)
        if (ctx.callbackQuery) {
            await ctx.editMessageText(messages[lang as 'uz' | 'ru'], {
                reply_markup: keyboard[lang as 'uz' | 'ru'],
                parse_mode: "HTML"
            });
        } else {
            await ctx.reply(messages[lang as 'uz' | 'ru'], {
                reply_markup: keyboard[lang as 'uz' | 'ru'],
                parse_mode: "HTML"
            });
        }
    }

    private async handleStart(ctx: BotContext): Promise<void> {
        ctx.session.hasAgreedToTerms = false;
        await this.createUserIfNotExist(ctx);
        await this.showlangMenu(ctx);
    }

    private async handleCardMenu(ctx: BotContext): Promise<void> {
        const cardMenuTexts = {
            uz: {
                message: "Karta bo'yicha amallarni tanlang:",
                delete: "💳 Kartani o'chirish",
                back: "🔙 Orqaga",
            },
            ru: {
                message: "Выберите действие с картой:",
                delete: "💳 Удалить карту",
                back: "🔙 Назад",
            },
        };

        const keyboard = new InlineKeyboard()
            .text(cardMenuTexts[ctx.session.lang as "uz" | "ru"].delete, "delete_card")
            .row()
            .text(cardMenuTexts[ctx.session.lang as "uz" | "ru"].back, "check_status");

        await ctx.editMessageText(
            cardMenuTexts[ctx.session.lang as "uz" | "ru"].message,
            { reply_markup: keyboard }
        );
    }

    private async handleStatus(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId });

            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            // Check selected sport from session
            const currentSport = ctx.session.selectedSport;
            const messages = {
                uz: "Iltimos, avval sport turini tanlang.",
                ru: "Пожалуйста, сначала выберите вид спорта.",
            };

            if (currentSport === undefined) {
                await ctx.answerCallbackQuery(messages[ctx.session.lang as "uz" | "ru"]);
                await this.showMainMenu(ctx);
                return;
            }

            // Determine subscription info based on selected sport
            let isActive: boolean;
            let subscriptionStart: Date | null = null;
            let subscriptionEnd: Date | null = null;
            let sportName: string;

            if (currentSport === 'wrestling') {
                isActive = user.isActiveSubsForWrestling;
                subscriptionStart = user.subscriptionStartForWrestling;
                subscriptionEnd = user.subscriptionEndForWrestling;
                sportName = 'Kurash';
            } else if (currentSport === 'football') {
                const existingSubscription = await this.subscriptionService.getSubscription(user._id as string);
                isActive = existingSubscription?.isActive || false;
                subscriptionStart = existingSubscription?.subscriptionStart || null;
                subscriptionEnd = existingSubscription?.subscriptionEnd || null;
                sportName = 'Futbol';
            } else {
                // Default case (shouldn't happen due to previous check)
                isActive = false;
                sportName = 'Sport';
            }

            // If no subscription exists for this sport
            if (!subscriptionStart && !subscriptionEnd) {
                const keyboard = {
                    uz: new InlineKeyboard()
                        .text("🎯 Obuna bo'lish", "subscribe")
                        .row()
                        .text("🔙 Asosiy menyu", "main_menu"),

                    ru: new InlineKeyboard()
                        .text("🎯 Подписаться", "subscribe")
                        .row()
                        .text("🔙 Главное меню", "main_menu"),
                };

                const messages = {
                    uz:
                        `Siz hali ${sportName} uchun obuna bo'lmagansiz 🤷‍♂️\nObuna bo'lish uchun quyidagi tugmani bosing:`,

                    ru:
                        `Вы ещё не подписаны на ${sportName} 🤷‍♂️\nЧтобы подписаться, нажмите кнопку ниже:`,
                };


                await ctx.editMessageText(
                    messages[ctx.session.lang as "uz" | "ru"],
                    { reply_markup: keyboard[ctx.session.lang as "uz" | "ru"] }
                );
                return;
            }

            // Format dates
            let subscriptionStartDate = {
                uz: "Mavjud emas",
                ru: "Недоступно",
            };
            let subscriptionEndDate = {
                uz: "Mavjud emas",
                ru: "Недоступно",
            };

            if (subscriptionStart) {
                const d = subscriptionStart;
                subscriptionStartDate[ctx.session.lang as "uz" | "ru"] = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
            }
            if (subscriptionEnd) {
                const d = subscriptionEnd;
                subscriptionEndDate[ctx.session.lang as "uz" | "ru"] = `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`;
            }

            // Prepare message
            const statusText = {
                uz: isActive ? '✅ Faol' : '❌ Muddati tugagan',
                ru: isActive ? '✅ Активна' : '❌ Истекла',
            };

            const expirationLabel = {
                uz: isActive
                    ? '⏰ Obuna tugash muddati:'
                    : '⏰ Obuna tamomlangan sana:',

                ru: isActive
                    ? '⏰ Дата окончания подписки:'
                    : '⏰ Подписка завершена:',
            };


            const subscriptionMessage = {
                uz:
                    `🎫 <b>Obuna ma'lumotlari:</b>\n\n` +
                    `🏆 Sport turi: ${sportName}\n` +
                    `📅 Holati: ${statusText[ctx.session.lang as 'uz' | 'ru']}\n` +
                    `📆 Obuna bo'lgan sana: ${subscriptionStartDate[ctx.session.lang as 'uz' | 'ru']}\n` +
                    `${expirationLabel[ctx.session.lang as 'uz' | 'ru']} ${subscriptionEndDate[ctx.session.lang as 'uz' | 'ru']}`,

                ru:
                    `🎫 <b>Информация о подписке:</b>\n\n` +
                    `🏆 Вид спорта: ${sportName}\n` +
                    `📅 Статус: ${statusText[ctx.session.lang as 'uz' | 'ru']}\n` +
                    `📆 Дата подписки: ${subscriptionStartDate[ctx.session.lang as 'uz' | 'ru']}\n` +
                    `${expirationLabel[ctx.session.lang as 'uz' | 'ru']} ${subscriptionEndDate[ctx.session.lang as 'uz' | 'ru']}`,
            };


            const keyboard = new InlineKeyboard();

            // Check if user has a saved card
            const userCard = await UserCardsModel.findOne({
                userId: user._id,
                telegramId: user.telegramId,
                verified: true
            });
            const texts = {
                uz: {
                    joinChannel: "🔗 Kanalga kirish",
                    cardMenu: "💳 Obuna bo'yicha",
                    resubscribe: "🎯 Qayta obuna bo'lish",
                    mainMenu: "🔙 Asosiy menyu"
                },
                ru: {
                    joinChannel: "🔗 Войти в канал",
                    cardMenu: "💳 По подписке",
                    resubscribe: "🎯 Повторно подписаться",
                    mainMenu: "🔙 Главное меню"
                }
            };


            if (isActive) {
                // Get the appropriate channel link based on subscription type
                if (currentSport === 'wrestling') {
                    const privateLink = await this.getWrestlingLink();
                    keyboard.url(texts[ctx.session.lang as "uz" | "ru"].joinChannel, privateLink.invite_link);
                } else {
                    const privateLink = await this.getFootballLink();
                    keyboard.url(texts[ctx.session.lang as "uz" | "ru"].joinChannel, privateLink.invite_link);
                }

                // Add card menu if user has a saved card
                if (userCard) {
                    keyboard.row().text(texts[ctx.session.lang as "uz" | "ru"].cardMenu, "card_menu");
                }
            } else {
                keyboard.text(texts[ctx.session.lang as "uz" | "ru"].resubscribe, "subscribe");
            }

            keyboard.row().text(texts[ctx.session.lang as "uz" | "ru"].mainMenu, "main_menu");


            await ctx.editMessageText(subscriptionMessage[ctx.session.lang as "uz" | "ru"], {
                reply_markup: keyboard,
                parse_mode: "HTML"
            });
        } catch (error) {
            const errorMessages = {
                uz: "Obuna holatini tekshirishda xatolik yuz berdi.",
                ru: "Произошла ошибка при проверке статуса подписки.",
            };

            await ctx.answerCallbackQuery(errorMessages[ctx.session.lang as "uz" | "ru"]);
        }
    }

    private async handleSubscribeCallback(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            const currentSport = ctx.session.selectedSport;

            if (currentSport === undefined) {
                await ctx.answerCallbackQuery("Iltimos, avval sport turini tanlang.");
                await this.showMainMenu(ctx);
                return;
            }

            // Check subscription based on current sport selection
            let hasActiveSubscription = false;
            let subscriptionEndDate: Date | null = null;

            if (currentSport === 'wrestling') {
                hasActiveSubscription = user.isActiveSubsForWrestling;
                subscriptionEndDate = user.subscriptionEndForWrestling;
            } else if (currentSport === 'football') {
                const existingSubscription = await this.subscriptionService.getSubscription(user._id as string);
                hasActiveSubscription = existingSubscription?.isActive || false;
                subscriptionEndDate = existingSubscription?.subscriptionEnd || null;
            }

            if (hasActiveSubscription && subscriptionEndDate) {
                const keyboard = {
                    uz: new InlineKeyboard()
                        .text("📊 Obuna holati", "check_status"),

                    ru: new InlineKeyboard()
                        .text("📊 Статус подписки", "check_status"),
                };


                const sportName = currentSport === 'wrestling' ? 'kurash' : 'futbol';
                const formattedDate = `${subscriptionEndDate.getDate().toString().padStart(2, '0')}.${(subscriptionEndDate.getMonth() + 1).toString().padStart(2, '0')}.${subscriptionEndDate.getFullYear()}`;
                const messages = {
                    uz: `⚠️ Siz ${sportName} uchun allaqachon obuna bo'lgansiz ✅\n\nObuna tugash muddati: ${formattedDate}`,

                    ru: `⚠️ Вы уже подписаны на ${sportName} ✅\n\nДата окончания подписки: ${formattedDate}`,
                }
                await ctx.editMessageText(
                    messages[ctx.session.lang as 'uz' | 'ru'],
                    { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                );
                return;
            }

            ctx.session.hasAgreedToTerms = false;

            const keyboard = {
                uz: new InlineKeyboard()
                    .url("📄 Foydalanish shartlari", "https://telegra.ph/SPORTSuz-Premium---OMMAVIY-OFERTA-04-22-2")
                    .row()
                    .text("✅ Qabul qilaman", "agree_terms")
                    .row()
                    .text("❌ Bekor qilish", "main_menu"),

                ru: new InlineKeyboard()
                    .url("📄 Условия использования", "https://telegra.ph/SPORTSuz-Premium---OMMAVIY-OFERTA-04-22-2")
                    .row()
                    .text("✅ Принимаю", "agree_terms")
                    .row()
                    .text("❌ Отменить", "main_menu"),
            };
            const messages = {
                uz: `📜 <b>Foydalanish shartlari va shartlar:</b>\n\n` +
                    `Iltimos, obuna bo'lishdan oldin foydalanish shartlari bilan tanishib chiqing.\n\n` +
                    `Tugmani bosib foydalanish shartlarini o'qishingiz mumkin. Shartlarni qabul qilganingizdan so'ng "Qabul qilaman" tugmasini bosing.`,

                ru: `📜 <b>Условия использования:</b>\n\n` +
                    `Пожалуйста, ознакомьтесь с условиями использования перед оформлением подписки.\n\n` +
                    `Нажмите кнопку, чтобы прочитать условия. После прочтения нажмите "Принимаю", чтобы согласиться.`
            };


            await ctx.editMessageText(
                messages[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'],
                    parse_mode: "HTML"
                }
            );
        } catch (error) {
            logger.error(`There is error in handleSubscribeCallback: ${error}`);
            await ctx.answerCallbackQuery("Obuna turlarini ko'rsatishda xatolik yuz berdi.");
        }
    }

    private async handleRenew(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }


            const currentSport = ctx.session.selectedSport;

            if (currentSport === undefined) {
                const messages = {
                    uz: "Iltimos, avval sport turini tanlang.",
                    ru: "Пожалуйста, сначала выберите вид спорта.",
                };

                await ctx.answerCallbackQuery(messages[ctx.session.lang as 'uz' | 'ru']);
                await this.showMainMenu(ctx);
                return;
            }

            // Get subscription status based on current sport selection
            let isActive: boolean;
            let subscriptionEnd: Date | null = null;
            let sportName: string;

            if (currentSport === 'wrestling') {
                isActive = user.isActiveSubsForWrestling;
                subscriptionEnd = user.subscriptionEndForWrestling;
                sportName = 'kurash';
            } else if (currentSport === 'football') {
                // For general subscription, get from subscription service
                const existingSubscription = await this.subscriptionService.getSubscription(user._id as string);
                isActive = existingSubscription?.isActive || false;
                subscriptionEnd = existingSubscription?.subscriptionEnd || null;
                sportName = 'futbol';
            } else {
                // TODO: Handle other sports or undefined case
                isActive = false;
                subscriptionEnd = null;
                sportName = 'sport';
            }

            // Check if subscription exists and is active for the current sport
            if (!isActive || !subscriptionEnd) {
                const keyboard = {
                    uz: new InlineKeyboard()
                        .text("🎯 Obuna bo'lish", "subscribe")
                        .row()
                        .text("🔙 Asosiy menyu", "main_menu"),

                    ru: new InlineKeyboard()
                        .text("🎯 Подписаться", "subscribe")
                        .row()
                        .text("🔙 Главное меню", "main_menu"),
                };
                const messages = {
                    uz: `⚠️ Siz ${sportName} uchun hali obuna bo'lmagansiz. Obuna bo'lish uchun quyidagi tugmani bosing:`,
                    ru: `⚠️ Вы ещё не подписаны на ${sportName}. Чтобы подписаться, нажмите кнопку ниже:`,
                };


                await ctx.editMessageText(
                    messages[ctx.session.lang as 'uz' | 'ru'],
                    { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                );
                return;
            }

            // Calculate days until subscription expires
            const now = new Date();
            const daysUntilExpiration = Math.ceil(
                (subscriptionEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            // If subscription is active and not within 3 days of expiration
            if (isActive && daysUntilExpiration > 3) {
                const keyboard = {
                    uz: new InlineKeyboard()
                        .text("📊 Obuna holati", "check_status")
                        .row()
                        .text("🔙 Asosiy menyu", "main_menu"),

                    ru: new InlineKeyboard()
                        .text("📊 Статус подписки", "check_status")
                        .row()
                        .text("🔙 Главное меню", "main_menu"),
                };
                const messages = {
                    uz:
                        `⚠️ Sizning ${sportName} obunangiz hali faol va ${daysUntilExpiration} kundan so'ng tugaydi.\n\n` +
                        `Obunani faqat muddati tugashiga 3 kun qolganda yoki muddati tugagandan so'ng yangilash mumkin.`,

                    ru:
                        `⚠️ Ваша подписка на ${sportName} всё ещё активна и истекает через ${daysUntilExpiration} дней.\n\n` +
                        `Подписку можно обновить только за 3 дня до окончания срока или после его истечения.`,
                };


                await ctx.editMessageText(
                    messages[ctx.session.lang as 'uz' | 'ru'],
                    { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                );
                return;
            }

            // For renewal, we should also show terms and conditions first
            // Reset agreement status
            ctx.session.hasAgreedToTerms = false;

            const keyboard = {
                uz: new InlineKeyboard()
                    .url("📄 Foydalanish shartlari", "https://telegra.ph/SPORTSuz-Premium---OMMAVIY-OFERTA-04-22-2")
                    .row()
                    .text("✅ Qabul qilaman", "agree_terms")
                    .row()
                    .text("❌ Bekor qilish", "main_menu"),

                ru: new InlineKeyboard()
                    .url("📄 Условия использования", "https://telegra.ph/SPORTSuz-Premium---OMMAVIY-OFERTA-04-22-2")
                    .row()
                    .text("✅ Принимаю", "agree_terms")
                    .row()
                    .text("❌ Отменить", "main_menu"),
            };

            const messages = {
                uz:
                    `📜 <b>Foydalanish shartlari va shartlar:</b>\n\n` +
                    `Iltimos, ${sportName} obunasini yangilashdan oldin foydalanish shartlari bilan tanishib chiqing.\n\n` +
                    `Tugmani bosib foydalanish shartlarini o'qishingiz mumkin. Shartlarni qabul qilganingizdan so'ng "Qabul qilaman" tugmasini bosing.`,

                ru:
                    `📜 <b>Условия использования:</b>\n\n` +
                    `Пожалуйста, ознакомьтесь с условиями использования перед обновлением подписки на ${sportName}.\n\n` +
                    `Нажмите кнопку, чтобы прочитать условия. После прочтения нажмите "Принимаю".`,
            };

            await ctx.editMessageText(
                messages[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'],
                    parse_mode: "HTML"
                }
            );
        } catch (error) {
            logger.error(`There was an error renewing subscription: ${error}`);
            await ctx.answerCallbackQuery("Obunani yangilashda xatolik yuz berdi.");
        }
    }


    private async handleAgreement(ctx: BotContext): Promise<void> {
        try {
            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            ctx.session.hasAgreedToTerms = true;

            await this.showPaymentTypeSelection(ctx);
        } catch (error) {
            await ctx.answerCallbackQuery("To'lov turlarini ko'rsatishda xatolik yuz berdi.");
        }
    }

    private async handleOneTimePayment(ctx: BotContext): Promise<void> {

        let selectedSport = ctx.session.selectedSport;
        try {
            if (!ctx.session.hasAgreedToTerms) {
                await this.handleSubscribeCallback(ctx);
                return;
            }

            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId: telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            await this.selectedSportChecker(ctx);

            if (selectedSport != user.selectedSport) {
                const chooseSportMessage = {
                    uz: "Iltimos, avval sport turini tanlang.",
                    ru: "Пожалуйста, сначала выберите вид спорта.",
                };

                await ctx.answerCallbackQuery(chooseSportMessage[ctx.session.lang as 'uz' | 'ru']);
                await this.showMainMenu(ctx);
                return;
            }

            const keyboard = await this.getOneTimePaymentMethodKeyboard(ctx, user._id as string, telegramId as number, ctx.session.selectedSport);

            const oneTimePaymentMessage = {
                uz:
                    "💰 <b>Bir martalik to'lov</b>\n\n" +
                    "Iltimos, o'zingizga ma'qul to'lov turini tanlang:",

                ru:
                    "💰 <b>Единовременная оплата</b>\n\n" +
                    "Пожалуйста, выберите подходящий способ оплаты:",
            };

            await ctx.editMessageText(oneTimePaymentMessage[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );
        } catch (error) {
            await ctx.answerCallbackQuery("To'lov turlarini ko'rsatishda xatolik yuz berdi.");
        }
    }

    private async showPaymentTypeSelection(ctx: BotContext): Promise<void> {
        try {
            // Check if user has agreed to terms before proceeding
            if (!ctx.session.hasAgreedToTerms) {
                await this.handleSubscribeCallback(ctx);
                return;
            }

            const keyboard = {
                uz: new InlineKeyboard()
                    .text("🔄 Obuna | 60 kun bepul", "payment_type_subscription")
                    .row()
                    .text("💰 Bir martalik to'lov", "payment_type_onetime")
                    .row()
                    .text("🌍 Xalqaro to'lov (Tez kunda)", "not_supported_international")
                    .row()
                    .text("🔙 Asosiy menyu", "main_menu"),

                ru: new InlineKeyboard()
                    .text("🔄 Подписка | 60 дней бесплатно", "payment_type_subscription")
                    .row()
                    .text("💰 Единовременная оплата", "payment_type_onetime")
                    .row()
                    .text("🌍 Международная оплата (Скоро)", "not_supported_international")
                    .row()
                    .text("🔙 Главное меню", "main_menu"),
            };
            const messages = {
                uz:
                    "🎯 Iltimos, to'lov turini tanlang:\n\n" +
                    "💰 <b>Bir martalik to'lov</b> - 30 kun uchun.\n\n" +
                    "🔄 <b>60 kunlik (obuna)</b> - Avtomatik to'lovlarni yoqish.\n\n" +
                    "🌍 <b>Xalqaro to'lov</b> - <i>Tez orada ishga tushuriladi!</i>\n\n" +
                    "🎁 <b>Obuna to‘lov turini tanlang va 60 kunlik bonusni qo'lga kiriting!</b>",

                ru:
                    "🎯 Пожалуйста, выберите тип оплаты:\n\n" +
                    "💰 <b>Единовременная оплата</b> – на 30 дней.\n\n" +
                    "🔄 <b>60-дневная подписка</b> – с автоматическим продлением.\n\n" +
                    "🌍 <b>Международный платеж</b> – <i>Скоро будет доступен!</i>\n\n" +
                    "🎁 <b>Выберите тип подписки и получите бонус — 60 дней бесплатно!</b>",
            };


            await ctx.editMessageText(
                messages[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'],
                    parse_mode: "HTML"
                }
            );
        } catch (error) {
            await ctx.answerCallbackQuery("To'lov turlarini ko'rsatishda xatolik yuz berdi.");
        }
    }

    private async handleSubscriptionPayment(ctx: BotContext): Promise<void> {
        try {
            if (!ctx.session.hasAgreedToTerms) {
                await this.handleSubscribeCallback(ctx);
                return;
            }

            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId: telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            const userId = user._id as string;

            await SubscriptionFlowTracker.create({
                telegramId,
                username: ctx.from?.username,
                userId: userId,
                step: FlowStepType.CLICKED_AUTO_PAYMENT,
            });

            await this.selectedSportChecker(ctx);

            const keyboard = await this.getSubscriptionPaymentMethodKeyboard(userId, telegramId as number, ctx);

            const autoPaymentMessage = {
                uz: "🔄 <b>Avtomatik to'lov (obuna)</b>\n\n" +
                    "Iltimos, to'lov tizimini tanlang. Har 30 kunda to'lov avtomatik ravishda amalga oshiriladi:",
                ru: "🔄 <b>Автоматическая оплата (подписка)</b>\n\n" +
                    "Пожалуйста, выберите платежную систему. Оплата будет автоматически списываться каждые 30 дней:",
            };

            await ctx.editMessageText(
                autoPaymentMessage[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard,
                    parse_mode: "HTML"
                }
            );
        } catch (error) {
            await ctx.answerCallbackQuery("To'lov turlarini ko'rsatishda xatolik yuz berdi.");
        }
    }

    private async getOneTimePaymentMethodKeyboard(ctx: BotContext, userId: string, telegramId: number, selectedSport?: string) {

        if (selectedSport == undefined) {
            const chooseSportMessage = {
                uz: "Iltimos, avval sport turini tanlang.",
                ru: "Пожалуйста, сначала выберите вид спорта.",
            };

            await ctx.answerCallbackQuery(chooseSportMessage[ctx.session.lang as 'uz' | 'ru']);
            await this.showMainMenu(ctx);
            return;
        }

        let plan: any;

        if (selectedSport === 'wrestling') {
            plan = await Plan.findOne({ name: 'Yakka kurash' });
        } else if (selectedSport === 'football') {
            plan = await Plan.findOne({ name: 'Futbol' });
        }

        const redirectURLParams: ClickRedirectParams = {
            userId: userId,
            planId: plan._id,
            amount: plan.price,
            selectedSport: selectedSport
        };


        logger.info(`Selected sport: ${selectedSport}`);
        const paymeCheckoutPageLink = generatePaymeLink({
            planId: plan._id as string,
            amount: plan.price,
            userId: userId,
            selectedSport: selectedSport
        });

        const uzcardOneTimePaymentLink = `${process.env.BASE_UZCARD_ONETIME_URL}/?userId=${userId}&telegramId=${telegramId}&selectedSport=${selectedSport}`;

        const clickUrl = getClickRedirectLink(redirectURLParams);
        const keyboards={
            uz: new InlineKeyboard()
                .url('📲 Uzcard/Humo orqali to\'lash', uzcardOneTimePaymentLink)
                .url('📲 Payme orqali to\'lash', paymeCheckoutPageLink)
                .url('💳 Click orqali to\'lash', clickUrl)
                .row()
                .text("🔙 Orqaga", "back_to_payment_types")
                .text("🏠 Asosiy menyu", "main_menu"),
            ru:new InlineKeyboard()
                .url('📲 Uzcard/Humo', uzcardOneTimePaymentLink)
                .url('📲 Payme', paymeCheckoutPageLink)
                .url('💳 Click', clickUrl)
                .row()
                .text("🔙 Назад", "back_to_payment_types")
                .text("🏠 Главное меню", "main_menu")
        }

       return keyboards[ctx.session.lang as 'uz' | 'ru'];
    }

    private async getSubscriptionPaymentMethodKeyboard(userId: string, telegramId: number, ctx: BotContext) {

        const selectedSport = await this.selectedSportChecker(ctx);


        let plan: any;

        if (selectedSport === 'wrestling') {
            plan = await Plan.findOne({ name: 'Yakka kurash' });
        } else if (selectedSport === 'football') {
            plan = await Plan.findOne({ name: 'Futbol' });
        }

        const clickUrl = process.env.BASE_CLICK_URL + `?userId=${userId}&planId=${plan._id}&selectedSport=${selectedSport}`;
        const uzcardUrl = process.env.UZCARD_API_URL_SPORTS + `?userId=${userId}&telegramId=${telegramId}&selectedSport=${selectedSport}`
        const paymeUrl = process.env.BASE_PAYME_URL + `?userId=${userId}&planId=${plan._id}&selectedSport=${selectedSport}`;

        const existingCards = await this.getUserExistingCards(userId);
        const hasExistingCards = existingCards && existingCards.length > 0;

        const keyboard = new InlineKeyboard();

        const paymentMessages = {
            uz: {
                savedCard: '💳 Saqlangan kartadan foydalanish',
                uzcard: '🏦 Uzcard/Humo (60 kun bepul)',
                click: '💳 Click (30 kun bepul)',
                payme: '📲 Payme (30 kun bepul)',
                back: '🔙 Orqaga',
                mainMenu: '🏠 Asosiy menyu',
            },
            ru: {
                savedCard: '💳 Использовать сохранённую карту',
                uzcard: '🏦 Uzcard/Humo (60 дней бесплатно)',
                click: '💳 Click (30 дней бесплатно)',
                payme: '📲 Payme (30 дней бесплатно)',
                back: '🔙 Назад',
                mainMenu: '🏠 Главное меню',
            }
        };

        if (hasExistingCards) {
            keyboard
                .text(paymentMessages[ctx.session.lang as 'uz' | 'ru'].savedCard, `existing_card_menu_${userId}`)
                .row();
            return keyboard;
        }
        keyboard
            .url(paymentMessages[ctx.session.lang as 'uz' | 'ru'].uzcard, uzcardUrl)
            .row()
            .url(paymentMessages[ctx.session.lang as 'uz' | 'ru'].click, clickUrl)
            .row()
            .url(paymentMessages[ctx.session.lang as 'uz' | 'ru'].payme, paymeUrl)
            .row()
            .text(paymentMessages[ctx.session.lang as 'uz' | 'ru'].back, "back_to_payment_types")
            .text(paymentMessages[ctx.session.lang as 'uz' | 'ru'].mainMenu, "main_menu");

        return keyboard;
    }

    private async getUserExistingCards(userId: string) {
        return UserCardsModel.find({
            userId: userId,
            verified: true,
            isDeleted: false,
        });
    }

    private async confirmSubscription(ctx: BotContext): Promise<void> {
        try {
            // Check if user has agreed to terms before proceeding
            if (!ctx.session.hasAgreedToTerms) {
                await this.handleSubscribeCallback(ctx);
                return;
            }

            const telegramId = ctx.from?.id;
            const user = await UserModel.findOne({ telegramId: telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("Foydalanuvchi ID'sini olishda xatolik yuz berdi.");
                return;
            }

            const plan = await Plan.findOne({
                name: 'Futbol'
            });

            if (!plan) {
                return;
            }

            try {
                const { user: subscription, wasKickedOut } = await this.subscriptionService.createSubscription(
                    user._id as string,
                    plan,
                    ctx.from?.username
                );

                const privateLink = await this.getFootballLink();

                const keyboard = {
                    uz: new InlineKeyboard()
                        .url("🔗 Kanalga kirish", privateLink.invite_link)
                        .row()
                        .text("🔙 Asosiy menyu", "main_menu"),

                    ru: new InlineKeyboard()
                        .url("🔗 Перейти в канал", privateLink.invite_link)
                        .row()
                        .text("🔙 Главное меню", "main_menu"),
                }


                const subscriptionMessages = {
                    uz:
                        `🎉 Tabriklaymiz! Siz muvaffaqiyatli obuna bo'ldingiz!\n\n` +
                        `⏰ Obuna tugash muddati: ${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}\n\n` +
                        `Quyidagi havola orqali kanalga kirishingiz mumkin:\n\n`,

                    ru:
                        `🎉 Поздравляем! Вы успешно оформили подписку!\n\n` +
                        `⏰ Срок окончания подписки: ${subscription.subscriptionEnd.getDate().toString().padStart(2, '0')}.${(subscription.subscriptionEnd.getMonth() + 1).toString().padStart(2, '0')}.${subscription.subscriptionEnd.getFullYear()}\n\n` +
                        `Вы можете перейти в канал по следующей ссылке:\n\n`,
                };



                await ctx.editMessageText(subscriptionMessages[ctx.session.lang as 'uz' | 'ru'], {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'],
                    parse_mode: "HTML"
                });

            } catch (error) {
                if (error instanceof Error && error.message === 'User already has an active subscription') {
                    const keyboard = {
                        uz: new InlineKeyboard()
                            .text("📊 Obuna holati", "check_status")
                            .row()
                            .text("🔙 Asosiy menyu", "main_menu"),

                        ru: new InlineKeyboard()
                            .text("📊 Статус подписки", "check_status")
                            .row()
                            .text("🔙 Главное меню", "main_menu"),
                    };

                    const alreadySubscribedMessage = {
                        uz: "⚠️ Siz allaqachon faol obunaga egasiz. Obuna holatini tekshirish uchun quyidagi tugmani bosing:",
                        ru: "⚠️ У вас уже активна подписка. Нажмите на кнопку ниже, чтобы проверить статус подписки:",
                    };

                    await ctx.editMessageText(
                        alreadySubscribedMessage[ctx.session.lang as 'uz' | 'ru'],
                        { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                    );
                    return;
                }
                const subscriptionConfirmationError = {
                    uz: "❌ Obunani tasdiqlashda xatolik yuz berdi.",
                    ru: "❌ Произошла ошибка при подтверждении подписки.",
                };

                await ctx.answerCallbackQuery(subscriptionConfirmationError[ctx.session.lang as 'uz' | 'ru']);
            }
        } catch (error) {
            const subscriptionConfirmationError = {
                uz: "❌ Obunani tasdiqlashda xatolik yuz berdi.",
                ru: "❌ Произошла ошибка при подтверждении подписки.",
            };

            await ctx.answerCallbackQuery(subscriptionConfirmationError[ctx.session.lang as 'uz' | 'ru']);
        }
    }

    private async getFootballLink() {
        try {
            return await this.bot.api.createChatInviteLink(config.CHANNEL_ID, {
                member_limit: 1,
                expire_date: 0,
                creates_join_request: false
            });
        } catch (error) {
            throw error;
        }
    }

    private async getWrestlingLink() {
        try {

            return await this.bot.api.createChatInviteLink(config.WRESTLING_CHANNEL_ID, {
                member_limit: 1,
                expire_date: 0,
                creates_join_request: false
            });
        } catch (error) {
            throw error;
        }
    }

    private async createUserIfNotExist(ctx: BotContext): Promise<void> {
        const telegramId = ctx.from?.id;
        const username = ctx.from?.username;

        if (!telegramId) {
            return;
        }

        const user = await UserModel.findOne({ telegramId });
        if (!user) {
            const newUser = new UserModel({
                telegramId,
                username
            });
            await newUser.save();
        } else if (username && user.username !== username) {
            // Update username if it has changed
            user.username = username;
            await user.save();
        }
    }

    private async handleAdminCommand(ctx: BotContext): Promise<void> {
        logger.info(`Admin command issued by user ID: ${ctx.from?.id}`);

        // Check if user is authorized
        if (!this.ADMIN_IDS.includes(ctx.from?.id || 0)) {
            await ctx.reply('⛔️ You are not authorized to use this command.');
            return;
        }

        try {
            await this.showAdminStats(ctx);

            // Refresh stats right before showing
            // await this.refreshBlockedUsersList();
            //
            // await this.updateAdminStatsWithBlockedCount(ctx);
        } catch (error) {
            await ctx.reply('❌ Error processing admin command. Please try again later.');
        }
    }

    private async showAdminStats(ctx: BotContext): Promise<void> {
        try {
            // Calculate statistics
            const totalUsers = await UserModel.countDocuments();
            const activeUsers = await UserModel.countDocuments({ isActive: true });

            // Today's date setup
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTimestamp = Math.floor(today.getTime() / 1000);

            // Users who joined today
            const newUsersToday = await UserModel.countDocuments({
                _id: {
                    $gt: new mongoose.Types.ObjectId(todayTimestamp)
                }
            });

            const newSubscribersToday = await UserModel.countDocuments({
                subscriptionStart: { $gte: today },
                isActive: true
            });

            const expiredSubscriptions = await UserModel.countDocuments({
                isActive: false,
                subscriptionEnd: { $exists: true, $ne: null }
            });

            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const expiringIn3Days = await UserModel.countDocuments({
                subscriptionEnd: {
                    $gte: new Date(),
                    $lte: threeDaysFromNow
                },
                isActive: true
            });

            const neverSubscribed = await UserModel.countDocuments({
                $or: [
                    { subscriptionStart: { $exists: false } },
                    { subscriptionStart: null }
                ]
            });

            const autoSubscriptionStats = await this.getAutoSubscriptionDailyStats();

            // ========================
            // CARD STATISTICS SECTION
            // ========================

            // Overall card stats
            const totalCardStats = await UserCardsModel.aggregate([
                { $match: { verified: true } },
                {
                    $group: {
                        _id: "$cardType",
                        count: { $sum: 1 }
                    }
                }
            ]);

            const totalCards = totalCardStats.reduce((acc, cur) => acc + cur.count, 0);
            const totalCardBreakdown: Record<string, number> = {
                click: 0,
                uzcard: 0,
                payme: 0
            };
            totalCardStats.forEach(stat => {
                totalCardBreakdown[stat._id] = stat.count;
            });

            // Cards added today
            const todayCardStats = await UserCardsModel.aggregate([
                {
                    $match: {
                        verified: true,
                        createdAt: { $gte: today }
                    }
                },
                {
                    $group: {
                        _id: "$cardType",
                        count: { $sum: 1 }
                    }
                }
            ]);

            const todayCardTotal = todayCardStats.reduce((acc, cur) => acc + cur.count, 0);
            const todayCardBreakdown: Record<string, number> = {
                click: 0,
                uzcard: 0,
                payme: 0
            };
            todayCardStats.forEach(stat => {
                todayCardBreakdown[stat._id] = stat.count;
            });

            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);

            const completedSubscription = await UserCardsModel.countDocuments({
                verified: true,
                createdAt: { $gte: startOfDay }
            });
            //
            //
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);


            const todayEnd = new Date();
            todayEnd.setHours(23, 59, 59, 999);


            const countPaids = await Transaction.countDocuments({
                status: 'PAID',
                paymentType: 'subscription',
                updatedAt: {
                    $gte: todayStart,
                    $lte: todayEnd
                }
            });



            // ========================
            // NEW REQUIREMENTS SECTION
            // ========================


            // ========================
            // FORMAT MESSAGE
            // ========================
            const statsMessage = `📊 <b>Bot statistikasi</b>: \n\n` +
                `👥 Umumiy foydalanuvchilar: ${totalUsers} \n` +
                `✅ Umumiy aktiv foydalanuvchilar: ${activeUsers} \n` +
                `🆕 Bugun botga start berganlar: ${newUsersToday} \n` +
                `💸 Bugun kanalga qo'shilgan foydalanuvchilar: ${newSubscribersToday} \n` +
                `📉 Obunasi tugaganlar: ${expiredSubscriptions} \n` +
                `💳 Abonent to'lov qilganlari: ${countPaids} \n` +
                `⏳ Obunasi 3 kun ichida tugaydiganlar: ${expiringIn3Days} \n` +
                `🚫 Hech qachon obuna bo'lmaganlar: ${neverSubscribed} \n\n` +


                `📊 <b>Avtomatik to'lov statistikasi (bugun)</b>: \n\n` +
                `🔄 Avtomatik to'lov tugmasini bosganlar: ${autoSubscriptionStats.summary.clickedAutoPayment} \n` +
                `✅ Karta qo'shganlar: ${completedSubscription} \n\n` +


                `💳 <b>Qo'shilgan kartalar statistikasi</b>: \n\n` +
                `📦 Umumiy qo'shilgan kartalar: ${totalCards} \n` +
                ` 🔵 Uzcard: ${totalCardBreakdown.uzcard} \n` +
                ` 🟡 Click: ${totalCardBreakdown.click} \n` +
                ` 🟣 Payme: ${totalCardBreakdown.payme} \n\n` +
                `📅 <u>Bugun qo'shilgan kartalar</u>: ${todayCardTotal} \n` +
                ` 🔵 Uzcard: ${todayCardBreakdown.uzcard} \n` +
                ` 🟡 Click: ${todayCardBreakdown.click} \n` +
                ` 🟣 Payme: ${todayCardBreakdown.payme} \n\n\n`;


            await ctx.reply(statsMessage, { parse_mode: "HTML" });
        } catch (error) {
            console.error('Error generating stats:', error);
            await ctx.reply('❌ Error generating statistics. Please try again later.');
        }
    }

    private async handleDeleteCard(ctx: BotContext): Promise<void> {
        let isUzcard = false;

        try {
            const telegramId = ctx.from?.id;
            logger.info(`Received delete card request from telegramId: ${telegramId}`);

            const user = await UserModel.findOne({ telegramId });
            if (!user) {
                await ctx.answerCallbackQuery("User ID not found");
                return;
            }
            const userCard = await UserCardsModel.findOne({ telegramId });

            if (!userCard) {
                await ctx.answerCallbackQuery("UserCard not found");
                return;
            }

            // Step 1: Delete card from payment systems
            try {
                if (userCard && userCard.cardType == CardType.CLICK) {
                    logger.info(`Attempting to delete card from payment system(CLICK) for userId: ${user._id}`);
                    await this.clickSubsApiService.deleteCardToken(user._id as string);
                }

                if (userCard && userCard.cardType == CardType.PAYME) {
                    logger.info(`Attempting to delete card from payment system(PAYME) for userId: ${user._id}`);
                    const response = await this.paymeSubsApiService.deleteCardToken(telegramId as number);
                    if (!response.success) {
                        throw Error('Failed to delete card from payment system(PAYME)');
                    }
                }

                if (userCard && userCard.cardType == CardType.UZCARD) {
                    isUzcard = true;
                    logger.info(`Attempting to delete card from payment system(UZCARD) for userId: ${user._id}`);
                    const deleted = await this.uzcardSubsApiService.deleteCard(user._id as string);
                    if (deleted) {
                        logger.info('UZCARD deleted successfully.');
                    } else {
                        logger.warn('Failed to delete UZCARD.');
                        return;
                    }
                }
            } catch (error) {
                logger.error('Card deletion API error:', error);
            }

            // Step 2: Delete from our database
            await UserCardsModel.deleteOne({
                userId: user._id,
                telegramId: user.telegramId
            });
            logger.info(`Card deleted from database for userId: ${user._id}`);

            const now = new Date();

            const keyboard = {
                uz: new InlineKeyboard()
                    .text("📊 Obuna holati", "check_status")
                    .row()
                    .text("🔙 Asosiy menyu", "main_menu"),

                ru: new InlineKeyboard()
                    .text("📊 Статус подписки", "check_status")
                    .row()
                    .text("🔙 Главное меню", "main_menu"),
            };


            // CASE 1: User had paid subscription before getting bonus
            if (user.hadPaidSubscriptionBeforeBonus && user.freeBonusReceivedAt) {
                const bonusDurationDays = isUzcard ? 60 : 30;
                const bonusEndDate = new Date(user.freeBonusReceivedAt.getTime());
                bonusEndDate.setDate(bonusEndDate.getDate() + bonusDurationDays);

                const isBonusStillActive = bonusEndDate > now;

                if (isBonusStillActive) {
                    // Calculate original end date (before bonus was added)
                    const originalEndDate = new Date(user.subscriptionStart);
                    originalEndDate.setDate(originalEndDate.getDate() + user.plans[0].duration);

                    if (originalEndDate <= now) {
                        logger.info(`User ${user._id} original subscription already ended.`);
                        user.subscriptionEnd = now;
                        user.isActive = false;
                        await user.save();
                        await this.subscriptionMonitorService.handleExpiredUser(user);

                        const cardDeletedOriginalExpiredMessage = {
                            uz: "❌ Karta o'chirildi. Asl obuna muddatingiz allaqachon tugagan.",
                            ru: "❌ Карта удалена. Срок вашей основной подписки уже истек.",
                        };

                        await ctx.editMessageText(
                            cardDeletedOriginalExpiredMessage[ctx.session.lang as 'uz' | 'ru'],
                            { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                        );
                    } else {
                        logger.info(`User ${user._id} still within original subscription period. End date adjusted to original.`);

                        // Correct way to subtract days from the date
                        const currentEndDate = new Date(user.subscriptionEnd);

                        if (isUzcard) {
                            logger.info('Card type is UZCARD so we need to subtract 60 days');
                            currentEndDate.setDate(currentEndDate.getDate() - 60);
                        } else {
                            logger.info('Card type is not UZCARD so we need to subtract 30 days');
                            currentEndDate.setDate(currentEndDate.getDate() - 30);
                        }

                        user.subscriptionEnd = currentEndDate;
                        await user.save();

                        const bonusCanceledMessage = {
                            uz: `⚠️ Bonus obuna bekor qilindi. Asl obuna muddatingiz ${currentEndDate.toLocaleDateString()} gacha saqlanib qoladi.`,
                            ru: `⚠️ Бонусная подписка отменена. Срок вашей основной подписки сохранится до ${currentEndDate.toLocaleDateString()}.`,
                        };

                        await ctx.editMessageText(
                            bonusCanceledMessage[ctx.session.lang as 'uz' | 'ru'],
                            { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                        );
                    }
                    return; // Exit after handling this case
                }
            }
            // CASE 2: User only had bonus subscription (no previous paid subscription)
            else if (user.hasReceivedFreeBonus) {
                logger.info(`Terminating bonus for user ${user._id} who had no paid subscription`);
                user.subscriptionEnd = now;
                user.isActive = false;
                await user.save();
                const cardDeletedWithBonusCanceledMessage = {
                    uz: "❌ Karta o'chirildi. Bonus obuna bekor qilindi.",
                    ru: "❌ Карта удалена. Бонусная подписка отменена.",
                };


                await this.subscriptionMonitorService.handleExpiredUser(user);
                await ctx.editMessageText(
                    cardDeletedWithBonusCanceledMessage[ctx.session.lang as 'uz' | 'ru'],
                    { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
                );
                return; // ADD THIS RETURN - This was missing!
            }

            // CASE 3: Regular card deletion (no bonus involved) OR fallback for any other case
            logger.info(`User ${user._id} does not have a bonus subscription. Normal card deletion.`);
            const cardDeletedMessage = {
                uz: "✅ Karta muvaffaqiyatli o'chirildi.",
                ru: "✅ Карта успешно удалена.",
            };

            await ctx.editMessageText(
                cardDeletedMessage[ctx.session.lang as 'uz' | 'ru'],
                { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
            );

        } catch (error) {
            const keyboard = {
                uz: new InlineKeyboard()
                    .text("📊 Obuna holati", "check_status")
                    .row()
                    .text("🔙 Asosiy menyu", "main_menu"),

                ru: new InlineKeyboard()
                    .text("📊 Статус подписки", "check_status")
                    .row()
                    .text("🔙 Главное меню", "main_menu"),
            };

            const deleteCardErrorMessage = {
                uz: "❌ Karta o'chirishda xatolik yuz berdi.",
                ru: "❌ Ошибка при удалении карты.",
            };

            logger.error('Delete card error:', error);
            await ctx.editMessageText(
                deleteCardErrorMessage[ctx.session.lang as 'uz' | 'ru'],
                { reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru'] }
            );
        }
    }


    private async handleUseExistingCard(ctx: BotContext, planId: string): Promise<void> {

        const selectedSport = await this.selectedSportChecker(ctx);

        const telegramId = ctx.from?.id;

        const user = await UserModel.findOne({ telegramId });

        if (!user) {
            logger.error(`User not found on handleUseExistingCard with userId: ${telegramId}`);
            return;
        }

        const userId = user._id as string;


        const plan = await Plan.findById(planId);
        if (!plan) {
            logger.error(`Plan not found on handleUseExistingCard with planId: ${planId}`)
            return;
        }

        const userCard = await UserCardsModel.findOne({ userId: userId });
        if (!userCard) {
            logger.error(`UserCard not found with userId: ${telegramId}`)
            return;
        }

        // Check if user is eligible for free bonus
        const isEligible = await isUserEligibleForFreeBonus(userId, planId);

        if (!isEligible) {
            // User gets free bonus - these methods handle all messaging
            if (userCard.cardType === CardType.UZCARD) {
                await this.handleUzCardEligiblePayment(userId, user.telegramId, selectedSport as string, user.username as string);
            } else {
                await this.handleOtherCardEligiblePayment(userId, user.telegramId, selectedSport as string, planId, user.username as string);
            }
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: userId,
                plan: planId,
                telegramId: user.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                subscribedBy: userCard.cardType,
                hasReceivedFreeBonus: true
            });
            return; // These methods handle the response, so we return
        }

        // User will be charged with existing card
        const {
            user: subscription,
            wasKickedOut,
            success
        } = await this.subscriptionService.renewSubscriptionWithCard(
            userId,
            user.telegramId,
            userCard.cardType,
            plan,
            user.username,
            selectedSport
        );

        if (success) {
            logger.info(`SUCCESS: User ${userId} renewed subscription with existing card`);

            // Since renewSubscriptionWithCard doesn't send messages, we need to inform user
            const paymentSuccessMessage = {
                uz: "✅ To'lov muvaffaqiyatli amalga oshirildi!\n💳 Obuna yangilandi",
                ru: "✅ Оплата прошла успешно!\n💳 Подписка обновлена",
            };

            const keyboard = {
                uz: new InlineKeyboard()
                    .text("🏠 Asosiy menyu", "main_menu")
                    .text("📊 Status", "check_status"),

                ru: new InlineKeyboard()
                    .text("🏠 Главное меню", "main_menu")
                    .text("📊 Статус", "check_status"),
            };

            await ctx.reply(
                paymentSuccessMessage[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru']
                }
            );
        } else {
            logger.error(`FAILED: User ${userId} subscription renewal with existing card failed`);

            // Handle failure case
            const paymentFailedMessage = {
                uz: "❌ To'lov amalga oshirilmadi. Iltimos, qayta urinib ko'ring.",
                ru: "❌ Оплата не прошла. Пожалуйста, попробуйте еще раз.",
            };

            const keyboard = {
                uz: new InlineKeyboard()
                    .text("🔄 Qayta urinish", `use_existing_card_${planId}`)
                    .text("💳 Boshqa to'lov", "payment_type_subscription")
                    .text("🏠 Asosiy menyu", "main_menu"),

                ru: new InlineKeyboard()
                    .text("🔄 Повторить попытку", `use_existing_card_${planId}`)
                    .text("💳 Другой способ оплаты", "payment_type_subscription")
                    .text("🏠 Главное меню", "main_menu"),
            }

            await ctx.reply(
                paymentFailedMessage[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru']
                }
            );
        }
    }

    private async handleShowCards(ctx: BotContext, userId: string): Promise<void> {
        const cards = await this.getUserExistingCards(userId);


        const message = cards.map((card, index) =>
            `💳 ${index + 1}. ${card.incompleteCardNumber} (${card.cardType})`
        ).join('\n');

        const yourCardsMessage = {
            uz: `Sizning kartalaringiz:\n${message}`,
            ru: `Ваши карты:\n${message}`,
        };

        const keyboard = {
            uz: new InlineKeyboard().text("🔙 Orqaga", "payment_type_subscription"),
            ru: new InlineKeyboard().text("🔙 Назад", "payment_type_subscription"),
        };

        await ctx.reply(
            yourCardsMessage[ctx.session.lang as 'uz' | 'ru'],
            {
                reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru']
            }
        );
    }

    private async showExistingCardOptions(ctx: BotContext, userId: string): Promise<void> {
        const selectedSport = await this.selectedSportChecker(ctx);

        let plan: any;
        if (selectedSport === 'wrestling') {
            plan = await Plan.findOne({ name: 'Yakka kurash' });
        } else if (selectedSport === 'football') {
            plan = await Plan.findOne({ name: 'Futbol' });
        }

        if (!plan) {
            await ctx.reply("❌ Tarif topilmadi.");
            return;
        }

        const existingCards = await this.getUserExistingCards(userId);
        const noSavedCardMessage = {
            ru: "❌ У вас нет сохраненной карты.",
            uz: "❌ Sizda saqlangan karta yo'q.",
        };
        const keyboard = {
            uz: new InlineKeyboard()
                .text("🔙 Orqaga", "payment_type_subscription")
                .text("🏠 Asosiy menyu", "main_menu"),

            ru: new InlineKeyboard()
                .text("🔙 Назад", "payment_type_subscription")
                .text("🏠 Главное меню", "main_menu")
        };


        if (!existingCards || existingCards.length === 0) {
            await ctx.reply(
                noSavedCardMessage[ctx.session.lang as 'uz' | 'ru'],
                {
                    reply_markup: keyboard[ctx.session.lang as 'uz' | 'ru']
                }
            );
            return;
        }

        const cardsList = existingCards.map((card, index) =>
            `💳 ${index + 1}. ${card.incompleteCardNumber} (${card.cardType})`
        ).join('\n');

        const chooseOneMessage = {
            uz: "Quyidagilardan birini tanlang:",
            ru: "Выберите один из вариантов:",
        };

        const extrakeyboard = {
            uz: new InlineKeyboard()
                .row()
                .text("👁️ Kartalarni ko'rish", `show_cards_${userId}`)
                .row()
                .text("🔙 Orqaga", "payment_type_subscription")
                .text("🏠 Asosiy menyu", "main_menu")
                .text("💳 Mavjud kartadan foydalanish", `use_existing_card_${plan._id}`),

            ru: new InlineKeyboard()
                .row()
                .text("👁️ Просмотреть карты", `show_cards_${userId}`)
                .row()
                .text("🔙 Назад", "payment_type_subscription")
                .text("🏠 Главное меню", "main_menu")
                .text("💳 Использовать сохранённую карту", `use_existing_card_${plan._id}`)
        };


        await ctx.reply(
            chooseOneMessage[ctx.session.lang as 'uz' | 'ru'],
            {
                reply_markup: extrakeyboard[ctx.session.lang as 'uz' | 'ru']
            }
        );
    }


    //TODO use this method later please
    private async getPlanBySport(selectedSport: string) {
        const sportPlanMap: Record<string, string> = {
            wrestling: 'Yakka kurash',
            football: 'Futbol',
        };

        const planName = sportPlanMap[selectedSport];
        if (!planName) return null;

        return Plan.findOne({ name: planName });
    }

    private async handleUzCardEligiblePayment(userId: string, telegramId: number, selectedSport: string, username: string): Promise<void> {
        switch (selectedSport) {
            case 'football':
                await this.handleUzCardSubscriptionSuccess(userId, telegramId, selectedSport, username);
                break;

            case 'wrestling':
                await this.handleUzCardWrestlingSubscriptionSuccess(userId, telegramId, username);
                break;

            default:
                logger.error(`Look there is error in handleUzCardEligiblePayment with selectedSport: ${selectedSport} 2130`);
                break;
        }
    }

    private async handleOtherCardEligiblePayment(userId: string, telegramId: number, selectedSport: string, planId: string, username: string): Promise<void> {
        switch (selectedSport) {
            case 'football':
                await this.handleAutoSubscriptionSuccess(userId, telegramId, planId, username);
                break;

            case 'wrestling':
                await this.handleAutoSubscriptionSuccessForWrestling(userId, telegramId, planId, username);
                break;

            default:
                logger.error(`Look there is error in handleOtherCardEligiblePayment with selectedSport: ${selectedSport} 1998`);
                break;
        }
    }

    private async selectedSportChecker(ctx: BotContext) {
        const selectedSport = ctx.session.selectedSport;
        const chooseSportMessage = {
            uz: "Iltimos, avval sport turini tanlang.",
            ru: "Пожалуйста, сначала выберите вид спорта.",
        };

        if (selectedSport === undefined) {
            await ctx.answerCallbackQuery(chooseSportMessage[ctx.session.lang as 'uz' | 'ru']);
            await this.showMainMenu(ctx);
            return;
        }

        return selectedSport;
    }

    private async showlangMenu(ctx: BotContext) {
        const keyboard = new InlineKeyboard()
            .text("O'zbek tili 🇺🇿", 'uz')
            .row()
            .text('Pусский язык 🇷🇺', 'ru')
            .row()

        const message = "Iltimos quyidagi tillardan birini tanlang\n" + "Пожалуйста, выберите один из следующих языков"

        if (ctx.callbackQuery) {
            await ctx.editMessageText(message, {
                reply_markup: keyboard,
                parse_mode: 'HTML',
            });
        } else {
            await ctx.reply(message, {
                reply_markup: keyboard,
                parse_mode: 'HTML',
            });
        }

    }

    private async handleSetUzbekLanguage(ctx: BotContext) {
        ctx.session.hasAgreedToTerms = false;
        ctx.session.lang = "uz"
        await this.showMainMenu(ctx)

    }

    private async handleSetRussianLanguage(ctx: BotContext) {
        ctx.session.hasAgreedToTerms = false;
        ctx.session.lang = "ru"
        await this.showMainMenu(ctx)

    }
}