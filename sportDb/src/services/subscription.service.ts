import {IUserDocument, UserModel} from '../database/models/user.model';
import logger from '../utils/logger';
import {IPlanDocument} from "../database/models/plans.model";
import {PaymentService} from "./payment.service";
import {CardType} from "../database/models/user-cards.model";
import {PaymentCardTokenDto} from "../payment-providers/click-subs-api/dto/request/payment-card-token.dto";
import {SubscriptionType} from "../config";
import {Bot, Context, InlineKeyboard, SessionFlavor} from "grammy";

interface SubscriptionResponse {
    user: IUserDocument;
    wasKickedOut?: boolean;
    success?: boolean;
}

interface SessionData {
    pendingSubscription?: {
        type: SubscriptionType
    };
    hasAgreedToTerms?: boolean;
}

type BotContext = Context & SessionFlavor<SessionData>;

export class SubscriptionService {

    private bot: Bot<BotContext>;

    constructor(bot: Bot<BotContext>) {
        this.bot = bot;
    }

    async createSubscription(
        userId: string,
        plan: IPlanDocument,
        username?: string,
        isAutoSubscription: boolean = false,
        bonusDays: number = 30
    ): Promise<SubscriptionResponse> {

        const existingUser = await UserModel.findById(userId).exec();
        logger.info(`Fetched user from DB: ${existingUser ? 'FOUND' : 'NOT FOUND'}`);

        const hasReceivedBonus = existingUser?.hasReceivedFreeBonus ?? false;

        const shouldGetBonus = isAutoSubscription && !hasReceivedBonus;

        const now = new Date();
        let endDate = new Date();

        // For new users or users without an active subscription
        if (!existingUser) {

            if (shouldGetBonus) {
                // Only apply bonus days for eligible users
                endDate.setDate(now.getDate() + bonusDays);
                logger.info(`New user eligible for bonus. Granting only ${bonusDays} days. New endDate: ${endDate}`);

                const subscription = new UserModel({
                    userId,
                    username,
                    subscriptionStart: now,
                    subscriptionEnd: endDate,
                    isActive: true,
                    planId: plan.id,
                    isKickedOut: false,
                    hasReceivedFreeBonus: true,
                    freeBonusReceivedAt: now,
                    hadPaidSubscriptionBeforeBonus: false // not a paid user before bonus
                });

                const savedUser = await subscription.save();

                return {user: savedUser, wasKickedOut: false};

            } else {
                // Apply standard plan duration for non-eligible users
                endDate.setDate(now.getDate() + plan.duration);

                const subscription = new UserModel({
                    userId,
                    username,
                    subscriptionStart: now,
                    subscriptionEnd: endDate,
                    isActive: true,
                    planId: plan.id,
                    isKickedOut: false,
                    hasReceivedFreeBonus: false,
                    hadPaidSubscriptionBeforeBonus: true
                });

                const savedUser = await subscription.save();
                logger.info(`New user created and saved to DB with subscription ending on ${endDate}`);

                return {user: savedUser, wasKickedOut: false};
            }
        }

        // For existing users
        logger.info(`User exists. Checking current subscription status...`);
        const isCurrentlyActive = existingUser.isActive && existingUser.subscriptionEnd > now;

        if (isCurrentlyActive) {
            if (shouldGetBonus) {
                // Only add bonus days to current subscription end date
                endDate = new Date(existingUser.subscriptionEnd);
                endDate.setDate(endDate.getDate() + bonusDays);
                existingUser.hadPaidSubscriptionBeforeBonus = true;
                logger.info(`Extending current subscription with bonus. Adding ${bonusDays} days. New endDate: ${endDate}`);
            } else {
                // Add plan duration to current subscription end date
                endDate = new Date(existingUser.subscriptionEnd);
                endDate.setDate(endDate.getDate() + plan.duration);
                existingUser.hadPaidSubscriptionBeforeBonus = true;
                logger.info(`Extending current subscription without bonus. Adding ${plan.duration} days. New endDate: ${endDate}`);
            }
        } else {

            if (shouldGetBonus) {
                // Only apply bonus days for eligible users starting from today
                endDate.setDate(now.getDate() + bonusDays);
                logger.info(`Applying only bonus of ${bonusDays} days. New endDate: ${endDate}`);
            } else {
                // Apply standard plan duration for non-eligible users
                endDate.setDate(now.getDate() + plan.duration);
                existingUser.hadPaidSubscriptionBeforeBonus = true;
                logger.info(`No bonus applied. Adding plan duration of ${plan.duration} days. New endDate: ${endDate}`);
            }
        }

        // Updating user fields
        existingUser.subscriptionStart = now;
        existingUser.subscriptionEnd = endDate;
        existingUser.isActive = true;
        existingUser.plans.push(plan);
        existingUser.isKickedOut = false;

        if (shouldGetBonus) {
            existingUser.hasReceivedFreeBonus = true;
            existingUser.freeBonusReceivedAt = now;
        } else {
            existingUser.hadPaidSubscriptionBeforeBonus = true;
        }

        if (username) {
            existingUser.username = username;
        }

        const wasKickedOut = existingUser.isKickedOut;
        const savedUser = await existingUser.save();

        return {user: savedUser, wasKickedOut};
    }

    async createUzcardSubscription(
        userId: string,
        plan: IPlanDocument,
        username?: string,
        bonusDays: number = 60
    ): Promise<SubscriptionResponse> {

        const existingUser = await UserModel.findById(userId).exec();
        logger.info(`Fetched user from DB: ${existingUser ? 'FOUND' : 'NOT FOUND'}`);

        if (!existingUser) {
            throw new Error('User must exist before subscribing with Uzcard');
        }

        const now = new Date();
        let endDate = new Date();

        const isCurrentlyActive = existingUser.isActive && existingUser.subscriptionEnd > now;

        if (isCurrentlyActive) {
            endDate = new Date(existingUser.subscriptionEnd);
            endDate.setDate(endDate.getDate() + bonusDays);
            logger.info(`Extending active subscription with Uzcard bonus. +${bonusDays} days. New endDate: ${endDate}`);
        } else {
            endDate.setDate(now.getDate() + bonusDays);
            logger.info(`Setting new subscription with Uzcard bonus. +${bonusDays} days. New endDate: ${endDate}`);
        }

        existingUser.subscriptionStart = now;
        existingUser.subscriptionEnd = endDate;
        existingUser.isActive = true;
        existingUser.plans.push(plan);
        existingUser.isKickedOut = false;
        existingUser.hasReceivedFreeBonus = true;
        existingUser.freeBonusReceivedAt = now;
        existingUser.hadPaidSubscriptionBeforeBonus = false;

        if (username) {
            existingUser.username = username;
        }

        const wasKickedOut = existingUser.isKickedOut;
        const savedUser = await existingUser.save();

        return {user: savedUser, wasKickedOut};
    }

    async createWrestlingSubscriptionWithCard(
        userId: string,
        plan: IPlanDocument,
        username?: string,
        bonusDays: number = 30
    ): Promise<SubscriptionResponse> {

        const existingUser = await UserModel.findById(userId).exec();
        logger.info(`Fetched user from DB for wrestling card subscription: FOUND`);

        const now = new Date();
        let endDate = new Date();

        // Check if user has active wrestling subscription
        const isCurrentlyActiveForWrestling = existingUser!.isActiveSubsForWrestling &&
            existingUser!.subscriptionEndForWrestling &&
            existingUser!.subscriptionEndForWrestling > now;

        if (isCurrentlyActiveForWrestling) {
            // Add bonus days to current wrestling subscription end date
            endDate = new Date(existingUser!.subscriptionEndForWrestling);
            endDate.setDate(endDate.getDate() + bonusDays);
            logger.info(`Extending current wrestling subscription with bonus. Adding ${bonusDays} days. New endDate: ${endDate}`);
        } else {
            // Apply bonus days starting from today
            endDate.setDate(now.getDate() + bonusDays);
            logger.info(`Starting new wrestling subscription with bonus of ${bonusDays} days. New endDate: ${endDate}`);
        }

        // Update wrestling-specific fields
        existingUser!.subscriptionStartForWrestling = now;
        existingUser!.subscriptionEndForWrestling = endDate;
        existingUser!.isActiveSubsForWrestling = true;
        existingUser!.plans.push(plan);
        existingUser!.isKickedOut = false;

        // Set bonus flags
        existingUser!.hasReceivedFreeBonus = true;
        existingUser!.freeBonusReceivedAt = now;

        if (existingUser!.plans.length > 0) {
            existingUser!.hadPaidSubscriptionBeforeBonus = true;
        }


        if (username) {
            existingUser!.username = username;
        }

        const wasKickedOut = existingUser!.isKickedOut;
        const savedUser = await existingUser!.save();

        return {user: savedUser, wasKickedOut};
    }

    async createSimpleWrestlingSubscription(
        userId: string,
        plan: IPlanDocument,
        username?: string
    ): Promise<SubscriptionResponse> {
        const existingUser = await UserModel.findById(userId).exec();
        logger.info(`Fetched user from DB: ${existingUser ? 'FOUND' : 'NOT FOUND'}`);

        const now = new Date();
        const endDate = new Date();
        endDate.setDate(now.getDate() + plan.duration);

        // For new users
        if (!existingUser) {
            const subscription = new UserModel({
                userId,
                username,
                subscriptionStartForWrestling: now,
                subscriptionEndForWrestling: endDate,
                isActiveSubsForWrestling: true,
                planId: plan.id,
                isKickedOut: false,
            });

            const savedUser = await subscription.save();
            logger.info(`New user created for wrestling with subscription ending on ${endDate}`);

            return {user: savedUser, wasKickedOut: false};
        }

        // For existing users
        logger.info(`Existing user found. Creating/extending wrestling subscription...`);

        const isCurrentlyActiveForWrestling = existingUser.isActive &&
            existingUser.subscriptionEndForWrestling &&
            existingUser.subscriptionEndForWrestling > now;

        let newEndDate: Date;

        if (isCurrentlyActiveForWrestling) {
            newEndDate = new Date(existingUser.subscriptionEndForWrestling);
            newEndDate.setDate(newEndDate.getDate() + plan.duration);
            logger.info(`Extending current wrestling subscription. Adding ${plan.duration} days. New endDate: ${newEndDate}`);
        } else {
            newEndDate = new Date();
            newEndDate.setDate(now.getDate() + plan.duration);
            logger.info(`Starting new wrestling subscription. Adding ${plan.duration} days. New endDate: ${newEndDate}`);
        }

        existingUser.subscriptionStartForWrestling = now;
        existingUser.subscriptionEndForWrestling = newEndDate;
        existingUser.isActive = true;
        existingUser.isActiveSubsForWrestling = true;
        existingUser.plans.push(plan);
        existingUser.isKickedOut = false;

        if (username) {
            existingUser.username = username;
        }

        const savedUser = await existingUser.save();

        return {user: savedUser};
    }

    async getSubscription(userId: string): Promise<IUserDocument | null> {
        return UserModel.findById(userId).exec();
    }

    async renewSubscriptionWithCard(
        userId: string,
        telegramId: number,
        cardType: CardType,
        plan: IPlanDocument,
        username?: string,
        selectedSport?: string
    ): Promise<SubscriptionResponse> {
        logger.info(`Starting renewSubscriptionWithCard for userId: ${userId}, cardType: ${cardType}`);

        // Get plan information
        if (!plan) {
            logger.error('No plan found');
            throw new Error('Subscription plan not found');
        }

        const user = await this.getSubscription(userId);
        if (!user) {
            logger.error(`User not found for ID: ${userId}`);
            throw new Error('User not found');
        }

        const paymentService = new PaymentService();

        try {
            let paymentResult;

            const requestBody: PaymentCardTokenDto = {
                userId: userId,
                telegramId: telegramId,
                planId: plan._id as string,
            }

            switch (cardType) {
                case CardType.CLICK:
                    logger.info(`(Auto payment) Calling Click for userId: ${userId}, cardType: ${cardType}`);
                    const clickResult = await paymentService.paymentWithClickSubsApi(requestBody);
                    paymentResult = clickResult;
                    break;
                case CardType.PAYME:
                    logger.info(`(Auto payment) Calling Payme for userId: ${userId}, cardType: ${cardType}`);
                    paymentResult = await paymentService.paymentWithPaymeSubsApi(requestBody);
                    break;
                case CardType.UZCARD:
                    logger.info(`(Auto payment) Calling Uzcard for userId: ${userId}, cardType: ${cardType}`);
                    paymentResult = await paymentService.paymentWithUzcardSubsApi(requestBody);
                    break;
                default:
                    throw new Error(`Unsupported card type: ${cardType}`);
            }


            if (!paymentResult) {
                logger.error(`Payment result is false for userId: ${userId}, cardType: ${cardType}`);

                const message = `❌ Avtomatik to'lov amalga oshmadi!\n\n` +
                    `Kartangizda mablag' yetarli emas yoki boshqa muammo yuzaga keldi.\n`;

                await this.bot.api.sendMessage(
                    user.telegramId,
                    message
                );
                logger.info(`Sent failed payment notification to user ${user.telegramId}`);
                return {user, success: false};
            }

            let subscriptionResponse: SubscriptionResponse;

            if (selectedSport === 'wrestling') {
                subscriptionResponse = await this.createSimpleWrestlingSubscription(
                    userId,
                    plan,
                    username,
                );
            } else if (selectedSport === 'football') {
                subscriptionResponse = await this.createSubscription(
                    userId,
                    plan,
                    username,
                    false
                );
            }

            logger.info(`Subscription renewed successfully for user ${userId} until`);


            // @ts-ignore
            if (cardType === CardType.UZCARD && paymentResult.qrCodeUrl) {
                await this.bot.api.sendMessage(
                    telegramId,
                    `🧾 To'lov uchun chek tayyor!\n\nChekni quyidagi tugma orqali ko'rishingiz mumkin.`,
                    {
                        // @ts-ignore
                        reply_markup: new InlineKeyboard().url("🧾 Chekni ko'rish", paymentResult.qrCodeUrl),
                        parse_mode: "HTML"
                    }
                );
            }



            return {
                ...subscriptionResponse!,
                success: true,
            };
        } catch (error) {
            logger.error(`Failed to renew subscription with card for user ${userId}:`, error);
            throw error;
        }
    }
}