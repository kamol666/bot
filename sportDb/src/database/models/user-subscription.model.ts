import mongoose, {Document} from 'mongoose';
import {CardType} from "./user-cards.model";

export interface IUserSubscriptionDocument extends Document {
    user: mongoose.Schema.Types.ObjectId;
    plan: mongoose.Schema.Types.ObjectId;
    telegramId: number;
    planName: string;
    subscriptionType: 'subscription' | 'onetime';
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    autoRenew: boolean;
    status: 'active' | 'expired' | 'cancelled' | 'pending';
    paidBy: CardType;
    subscribedBy: CardType;
    hasReceivedFreeBonus: boolean;
    lastAttemptedAutoSubscriptionAt: Date;
    attemptCount: number;

}

const userSubscriptionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    plan: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Plan',
        required: true
    },
    planName: {
        type: String
    },
    telegramId: {
        type: Number
    },
    subscriptionType: {
        type: String,
        enum: ['subscription', 'onetime'],
        required: true
    },
    startDate: {
        type: Date,
        required: true,
        default: Date.now
    },
    endDate: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    autoRenew: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['active', 'expired', 'cancelled', 'pending'],
        default: 'active'
    },
    paidBy: {
        type: String,
        enum: CardType
    },
    subscribedBy: {
        type: String,
        enum: CardType
    },
    hasReceivedFreeBonus: {
        type: Boolean,
    },
    lastAttemptedAutoSubscriptionAt: {
        type: Date,
        required: false
    },
    attemptCount: {type: Number, default: 0},
}, {
    timestamps: true
});

// Indexes for better query performance
userSubscriptionSchema.index({user: 1, isActive: 1});
userSubscriptionSchema.index({endDate: 1});
userSubscriptionSchema.index({status: 1});

export const UserSubscription = mongoose.model<IUserSubscriptionDocument>('UserSubscription', userSubscriptionSchema);


