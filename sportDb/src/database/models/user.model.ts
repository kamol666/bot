import mongoose, {Document, Schema} from 'mongoose';
import {IPlanDocument} from "./plans.model";

export interface IUserDocument extends Document {
    telegramId: number;
    username?: string;
    subscriptionType: string;
    subscriptionStart: Date;
    subscriptionEnd: Date;
    isActive: boolean;
    plans: IPlanDocument[];
    isKickedOut: boolean;
    hasReceivedFreeBonus: boolean;
    freeBonusReceivedAt?: Date;
    hadPaidSubscriptionBeforeBonus: boolean;
    hasSentWarning: boolean;
    lastWarningDate?: Date;
    bonusPeriodEnded?: Date;
    lastAttemptedAutoSubscriptionAt?: Date;
    attemptCount: number;

    isActiveForFootball: boolean;

    selectedSport: string;
    subscribedTo: string;
    isActiveSubsForWrestling: boolean;
    subscriptionStartForWrestling: Date;
    subscriptionEndForWrestling: Date;
}

const SubscriptionType = {
    SUBSCRIPTION: 'subscription',
    ONETIME: 'onetime'
}

const userSchema = new Schema({
    telegramId: {type: Number, required: true, unique: true},
    username: {type: String},
    subscriptionType: {type: String, enum: Object.values(SubscriptionType)},
    subscriptionStart: {type: Date, required: false},
    subscriptionEnd: {type: Date, required: false},
    isActive: {type: Boolean, default: false},
    plans: [{type: Schema.Types.ObjectId, ref: 'Plan'}],
    isKickedOut: {type: Boolean, default: false},
    hasReceivedFreeBonus: {type: Boolean, default: false},
    freeBonusReceivedAt: {type: Date},
    hadPaidSubscriptionBeforeBonus: {type: Boolean, default: false},
    hasSentWarning: {type: Boolean, default: false},
    lastWarningDate: {type: Date, required: false},
    bonusPeriodEnded: {type: Date, required: false},
    lastAttemptedAutoSubscriptionAt: {type: Date, required: false}, // use this to check if you tried to withdraw money from user like lastWarningDate
    attemptCount: {type: Number, default: 0},

    isActiveForFootball: {type: Boolean, default: false},

    selectedSport: {type: String}, // it is used for session not for statistics or sth
    subscribedTo: {type: String},
    isActiveSubsForWrestling: {type: Boolean, default: false},
    subscriptionStartForWrestling: {type: Date, required: false},
    subscriptionEndForWrestling: {type: Date, required: false},

});

userSchema.index({telegramId: 1, isActive: 1});
userSchema.index({subscriptionEnd: 1});

export const UserModel = mongoose.model<IUserDocument>('User', userSchema);
