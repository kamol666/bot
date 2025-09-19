import {UserSubscription} from '../database/models/user-subscription.model';
import logger from '../utils/logger';

export class UserSubscriptionExpirationService {

    constructor() {
    }

    /**
     * Check and expire UserSubscription documents where endDate has passed
     */
    async handleExpiredSubscriptions(): Promise<void> {
        try {
            const now = new Date();

            // Find all active subscriptions that have expired
            const expiredSubscriptions = await UserSubscription.find({
                endDate: {$lt: now},
                isActive: true,
                status: 'active'
            });

            logger.info(`Found ${expiredSubscriptions.length} expired user_subscriptions to process`);

            // Process each expired subscription
            for (const subscription of expiredSubscriptions) {
                await this.expireSubscription(subscription);
            }

            logger.info(`Successfully processed ${expiredSubscriptions.length} expired subscriptions`);

        } catch (error) {
            logger.error('Error handling expired subscriptions:', error);
        }
    }

    /**
     * Get count of subscriptions that will expire in the next N days
     */
    async getExpiringSubscriptionsCount(days: number = 1): Promise<number> {
        try {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + days);

            return await UserSubscription.countDocuments({
                endDate: {
                    $gte: new Date(),
                    $lt: futureDate
                },
                isActive: true,
                status: 'active'
            });
        } catch (error) {
            logger.error('Error getting expiring subscriptions count:', error);
            return 0;
        }
    }

    /**
     * Get all subscriptions expiring in the next N days
     */
    async getExpiringSubscriptions(days: number = 1): Promise<any[]> {
        try {
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + days);

            return await UserSubscription.find({
                endDate: {
                    $gte: new Date(),
                    $lt: futureDate
                },
                isActive: true,
                status: 'active'
            }).populate('user plan');
        } catch (error) {
            logger.error('Error getting expiring subscriptions:', error);
            return [];
        }
    }

    /**
     * Check if a user has any active subscriptions
     */
    async hasActiveSubscription(userId: string): Promise<boolean> {
        try {
            const activeSubscription = await UserSubscription.findOne({
                user: userId,
                isActive: true,
                status: 'active',
                endDate: {$gte: new Date()}
            });

            return !!activeSubscription;
        } catch (error) {
            logger.error(`Error checking active subscription for user ${userId}:`, error);
            return false;
        }
    }

    /**
     * Get user's active subscriptions
     */
    async getUserActiveSubscriptions(userId: string): Promise<any[]> {
        try {
            return await UserSubscription.find({
                user: userId,
                isActive: true,
                status: 'active',
                endDate: {$gte: new Date()}
            }).populate('plan');
        } catch (error) {
            logger.error(`Error getting active subscriptions for user ${userId}:`, error);
            return [];
        }
    }

    /**
     * Expire a single subscription
     */
    private async expireSubscription(subscription: any): Promise<void> {
        try {
            // Update the subscription status
            subscription.isActive = false;
            subscription.status = 'expired';
            await subscription.save();

            logger.info(`Expired subscription ${subscription._id} for user ${subscription.telegramId || subscription.user}`);

        } catch (error) {
            logger.error(`Error expiring subscription ${subscription._id}:`, error);
        }
    }
}