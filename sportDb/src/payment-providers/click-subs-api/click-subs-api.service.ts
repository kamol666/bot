import {Injectable} from '@nestjs/common';
import {clickAuthHash} from "../../utils/hashing/click-auth-hash";
import {CreateCardTokenDto} from "./dto/create-card-token.dto";
import {CreateCardTokenResponseDto} from "./dto/response/create-card-token-response.dto";
import axios from "axios";
import {VerifyCardTokenDto} from "./dto/request/verify-card-token.dto";
import {CardType, UserCardsModel} from "../../database/models/user-cards.model";
import {PaymentCardTokenDto} from "./dto/request/payment-card-token.dto";
import {UserModel} from "../../database/models/user.model";
import logger from "../../utils/logger";
import {SubscriptionBot} from "../../bot/bot";
import {PaymentProvider, PaymentTypes, Transaction, TransactionStatus} from "../../database/models/transactions.model";
import {Plan} from "../../database/models/plans.model";
import {UserSubscription} from "../../database/models/user-subscription.model";


@Injectable()
export class ClickSubsApiService {

    private botService: SubscriptionBot;
    private readonly baseUrl = 'https://api.click.uz/v2/merchant';
    private readonly serviceId = process.env.CLICK_SERVICE_ID;

    // this is set statically, we should think about this later, maybe get it from query params

    getBotService(): SubscriptionBot {
        if (!this.botService) {
            this.botService = new SubscriptionBot();
        }
        return this.botService;
    }

    async createCardToken(requestBody: CreateCardTokenDto): Promise<CreateCardTokenResponseDto> {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Auth': clickAuthHash()
        };

        interface RequestBody {
            service_id: string,
            card_number: string,
            expire_date: string,
            temporary: boolean,
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }
        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            card_number: requestBody.card_number,
            expire_date: requestBody.expire_date,
            temporary: requestBody.temporary
        };

        try {

            console.log("Request data:", requestBodyWithServiceId);
            const response = await axios.post(
                `${this.baseUrl}/card_token/request`,
                requestBodyWithServiceId,
                {headers}
            );

            console.log("Received response data:", response.data);

            if (response.data.error_code !== 0) {
                throw new Error("Response error code is not 0");
            }
            const result: CreateCardTokenResponseDto = new CreateCardTokenResponseDto();


            result.token = response.data.card_token;
            result.incompletePhoneNumber = response.data.phone_number;

            return result;
        } catch (error) {
            // Handle errors appropriately
            console.error('Error creating card token:', error);
            throw error;
        }
    }

    async verifyCardToken(requestBody: VerifyCardTokenDto) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Auth': clickAuthHash()
        };

        interface RequestBody {

            service_id: string
            card_token: string,
            sms_code: number,
        }

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const requestBodyWithServiceId: RequestBody = {
            service_id: this.serviceId,
            card_token: requestBody.card_token,
            sms_code: requestBody.sms_code
        };


        try {
            const response = await axios.post(
                `${this.baseUrl}/card_token/verify`, // Changed endpoint to verify
                requestBodyWithServiceId,
                {headers}
            );


            if (response.data.error_code !== 0) {
                throw new Error(`Verification failed: ${response.data.error_message || 'Unknown error'}`);
            }

            const user = await UserModel.findOne({
                _id: requestBody.userId,
            });


            if (!user) {
                logger.error(`User not found for ID: ${requestBody.userId}`);
                throw new Error('User not found');
            }
            logger.info(`User found: ${user}`);


            const plan = await Plan.findOne({
                _id: requestBody.planId
            });
            if (!plan) {
                logger.error(`Plan not found for ID: ${requestBody.planId}`);
                throw new Error('Plan not found');
            }


            const time = new Date().getTime();
            logger.info(`Creating user card for user ID: ${requestBody.userId}, with card token: ${requestBody.card_token}`);
            const userCard = await UserCardsModel.create({
                    telegramId: user.telegramId,
                    username: user.username ? user.username : undefined,
                    incompleteCardNumber: response.data.card_number,
                    cardToken: requestBodyWithServiceId.card_token,
                    expireDate: requestBody.expireDate,
                    userId: requestBody.userId,
                    planId: requestBody.planId,
                    verificationCode: requestBody.sms_code,
                    verified: true,
                    verifiedDate: new Date(time),
                    cardType: CardType.CLICK
                }
            )
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: requestBody.userId,
                plan: requestBody.planId,
                telegramId: user.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                paidBy: CardType.CLICK,
                subscribedBy: CardType.CLICK,
                hasReceivedFreeBonus: true
            });
            const successResult = response.data;
            if (user.hasReceivedFreeBonus) {
                if (requestBody.selectedSport === 'wrestling') {
                    await this.getBotService().handleCardAddedWithoutBonusForWrestling(
                        requestBody.userId,
                        user.telegramId,
                        CardType.CLICK,
                        plan,
                        user.username,
                        requestBody.selectedSport
                    );
                    return successResult;
                } else if (requestBody.selectedSport === 'football') {
                    await this.getBotService().handleCardAddedWithoutBonus(
                        requestBody.userId,
                        user.telegramId,
                        CardType.CLICK,
                        plan,
                        user.username,
                        requestBody.selectedSport
                    );
                    return successResult;
                }
            }

            user.subscriptionType = 'subscription'
            await user.save();

            if (requestBody.selectedSport === 'wrestling') {
                await this.getBotService().handleAutoSubscriptionSuccessForWrestling(
                    requestBody.userId,
                    user.telegramId,
                    requestBody.planId,
                    user.username
                );
            } else if (requestBody.selectedSport === 'football') {
                await this.getBotService().handleAutoSubscriptionSuccess(
                    requestBody.userId,
                    user.telegramId,
                    requestBody.planId,
                    user.username
                );
            }

            return response.data;
        } catch (error) {
            console.error('Error verifying card token:', error);
            throw error;
        }


    }

    async paymentWithToken(requestBody: PaymentCardTokenDto) {
        const userCard = await UserCardsModel.findOne({
            userId: requestBody.userId,
            telegramId: requestBody.telegramId,
            verified: true
        });

        if (!userCard || !this.serviceId) {
            return {success: false};
        }

        if (userCard.cardType !== CardType.CLICK) {
            logger.error(`Card type is not CLICK for User ID: ${requestBody.userId}`);
            return {
                success: false,
            }
        }

        const plan = await Plan.findById(requestBody.planId);
        if (!plan) {
            logger.error('Plan not found');
            return {
                success: false,
            }
        }

        const headers = this.getHeaders();

        const payload = {
            service_id: this.serviceId,
            card_token: userCard.cardToken,
            amount: "7777",
            transaction_parameter: "67a35e3f20d13498efcac2f0",
            transaction_param3: requestBody.userId,
            transaction_param4: "merchant" // test this later
        };

        try {
            const response = await axios.post(
                `${this.baseUrl}/card_token/payment`,
                payload,
                {headers});


            const {error_code} = response.data;

            logger.error(`Error code from response: ${error_code}`);

            if (error_code === -5017) {
                // Handle insufficient funds case
                logger.error(`Insufficient funds for user ID: ${requestBody.userId}`);
                return {success: false};
            }

            const paymentId = response.data.payment_id;

            const customRandomId = `subscription-click-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;


            const transaction = await Transaction.create(
                {
                    provider: PaymentProvider.CLICK,
                    paymentType: PaymentTypes.SUBSCRIPTION,
                    transId: paymentId ? paymentId : customRandomId,
                    amount: '7777',
                    status: TransactionStatus.PAID,
                    userId: requestBody.userId,
                    planId: requestBody.planId,
                }
            )

            logger.info(`Transaction created in click-subs-api: ${JSON.stringify(transaction)}`);


            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);

            await UserSubscription.create({
                user: requestBody.userId,
                plan: requestBody.planId,
                telegramId: requestBody.telegramId,
                planName: plan.name,
                subscriptionType: 'subscription',
                startDate: new Date(),
                endDate: endDate,
                isActive: true,
                autoRenew: true,
                status: 'active',
                paidBy: CardType.CLICK,
                subscribedBy: CardType.CLICK,
                hasReceivedFreeBonus: true
            });

            logger.info(`UserSubscription created for user ID: ${requestBody.userId}, telegram ID: ${requestBody.telegramId}, plan ID: ${requestBody.planId} in click-subs-api`);


            return {success: true};

        } catch {
            return {success: false};
        }
    }


    async deleteCardToken(userId: string) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Auth': clickAuthHash()
        };

        if (!this.serviceId) {
            throw new Error('Service ID is not defined');
        }

        const userCard = await UserCardsModel.findOne({
            userId: userId,
            verified: true
        });

        if (!userCard) {
            throw new Error(`User card not found`);
        }

        const serviceId = this.serviceId;
        const cardToken = userCard.cardToken;

        try {
            const response = await axios.delete(
                `https://api.click.uz/v2/merchant/card_token/${serviceId}/${cardToken}`,
                {headers}
            );

            console.log(response.data);
            return response;
        } catch (error) {
            console.error('Error deleting card token:', error);
            // Re-throw the error so the caller can handle it
            throw error;
        }
    }

    private getHeaders() {
        return {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Auth': clickAuthHash()
        };
    }

}




