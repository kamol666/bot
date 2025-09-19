import logger from "../utils/logger";
import {UserSubscription} from "../database/models/user-subscription.model";
import {IPlanDocument} from "../database/models/plans.model"; // adjust the path

export async function addUserSubscriptionRecord(
    userId: string,
    plan: IPlanDocument,
    startDate: Date,
    endDate: Date,
    subscriptionType: 'subscription' | 'onetime',
    paidAmount: number,
    autoRenew = false
): Promise<void> {
    try {
        await UserSubscription.create({
            user: userId,
            plan: plan,
            startDate,
            endDate,
            subscriptionType,
            paidAmount,
            autoRenew,
            status: 'active',
            isActive: true
        });
    } catch (err) {
        logger.error(`Failed to save UserSubscription record: ${err}`);
    }
}

export async function existUserSubscriptionRecordForWrestling(userId: string, planId: string): Promise<boolean> {
    try {
        const userSubscription = await UserSubscription.findOne({user: userId, plan: planId}).exec();
        return !!userSubscription;
    } catch (err) {
        logger.error(`Failed to check UserSubscription record: ${err}`);
        return false;
    }
}

export async function existUserSubscriptionRecordForFootball(userId: string, planId: string): Promise<boolean> {
    try {
        const userSubscription = await UserSubscription.findOne({user: userId, plan: planId}).exec();
        return !!userSubscription;
    } catch (err) {
        logger.error(`Failed to check UserSubscription record: ${err}`);
        return false;
    }
}

export async function isUserEligibleForFreeBonus(userId: string, planId: string): Promise<boolean> {
    try {
        const userSubscription = await UserSubscription.findOne({
                user: userId,
                plan: planId,
                subscriptionType: 'subscription',
                autoRenew: true
            }
        ).exec();
        return !!userSubscription;
    } catch (err) {
        logger.error(`Failed to check UserSubscription record: ${err}`);
        return false;
    }
}
