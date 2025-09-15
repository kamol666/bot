import { Injectable } from '@nestjs/common';
import { CreateCardTokenPaymeDto } from './dto/create-card-dto';
import { VerifyCardTokenPaymeDtoDto } from './dto/verify-card-dto';
import logger from 'src/shared/utils/logger';
import axios from 'axios';
import { CardCreateRequest, CardGetVerifyCodeRequest, CardVerifyRequest, ReceiptCreateRequest, ReceiptPayRequest } from 'src/shared/utils/types/interfaces/payme-types';
import { UserModel } from 'src/shared/database/models/user.model';
import { CardType, UserCardsModel } from 'src/shared/database/models/user-cards.model';
import { Plan } from 'src/shared/database/models/plans.model';
import { UserSubscription } from 'src/shared/database/models/user-subscription.model';
import { PaymentProvider, PaymentTypes, Transaction, TransactionStatus } from 'src/shared/database/models/transactions.model';

@Injectable()
export class PaymeSubsApiService {

    private readonly baseUrl = 'https://checkout.paycom.uz/api';

    private readonly PAYME_X_AUTH_CARDS = process.env.PAYME_SUBS_API_ID;
    private readonly PAYME_X_AUTH_RECEIPTS = `${process.env.PAYME_SUBS_API_ID}:${process.env.PAYME_SUBS_API_KEY}`;

    constructor() { }

    async createCardToken(requestBody: CreateCardTokenPaymeDto) {
        // Create headers
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth': this.PAYME_X_AUTH_CARDS,
            'Cache-Control': 'no-cache'
        };

        const cardCreateRequest: CardCreateRequest = {
            id: 123,
            method: 'cards.create',
            params: {
                card: {
                    number: requestBody.number,
                    expire: requestBody.expire,
                },
                account: {
                    user_id: requestBody.userId,
                    plan_id: requestBody.planId
                },
                save: true,
            },
        };

        try {
            const response = await axios.post(
                this.baseUrl,
                cardCreateRequest,
                { headers }
            );


            if (response.data.error) {
                return {
                    success: false,
                    error: {
                        code: response.data.error.code,
                        message: this.getErrorMessage(response.data.error.code)
                    }
                };
            }

            if (response.data.result && response.data.result.card && response.data.result.card.token) {


                //TODO if it matches as expected return response, send verify code to user
                const cardGetVerifyCodeRequest: CardGetVerifyCodeRequest = {
                    id: 123,
                    method: 'cards.get_verify_code',
                    params: {
                        token: response.data.result.card.token,
                    },
                };

                const result = await axios.post(
                    this.baseUrl,
                    cardGetVerifyCodeRequest,
                    { headers }
                );

                logger.warn('Response from get_verify_code: ' + JSON.stringify(result.data.result));


                return {
                    success: true,
                    token: response.data.result.card.token,
                };
            } else {
                logger.error('Unexpected response format:', response.data);
                return {
                    success: false,
                    error: {
                        code: -1,
                        message: 'Unexpected response format from payment service'
                    }
                };
            }
        } catch (error) {
            logger.error('Error creating card token:', error);

            // Check if the error response has data from Payme
            //@ts-ignore
            if (error.response && error.response.data && error.response.data.error) {
                return {
                    success: false,
                    error: {
                        //@ts-ignore
                        code: error.response.data.error.code,
                        //@ts-ignore
                        message: this.getErrorMessage(error.response.data.error.code)
                    }
                };
            }

            return {
                success: false,
                error: {
                    code: -1,
                    message: 'Error connecting to payment service'
                }
            };
        }

    }


    async verifyCardToken(requestBody: VerifyCardTokenPaymeDtoDto) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth': this.PAYME_X_AUTH_CARDS,
            'Cache-Control': 'no-cache'
        };

        const cardVerifyRequest: CardVerifyRequest = {
            id: 123,
            method: 'cards.verify',
            params: {
                token: requestBody.token,
                code: requestBody.code,
            },
        };

        try {
            const response = await axios.post(
                this.baseUrl,
                cardVerifyRequest,
                { headers }
            );
            logger.warn('Response from verify: ' + JSON.stringify(response.data));

            if (response.data.error) {
                return {
                    success: false,
                    error: {
                        code: response.data.error.code,
                        message: this.getErrorMessage(response.data.error.code)
                    }
                };
            }

            const user = await UserModel.findOne({
                _id: requestBody.userId,
            });
            if (!user) {
                logger.error(`User not found for ID: ${requestBody.userId}`);
                return {
                    success: false,
                    error: {
                        code: -2,
                        message: 'User not found'
                    }
                };
            }
            logger.info(`User found: ${user}`);

            const existingUserCard = await UserCardsModel.findOne({
                incompleteCardNumber: response.data.result.card.number
            });

            if (existingUserCard) {
                return {
                    success: false,
                    error: {
                        code: -6,
                        message: 'Bu karta raqam mavjud. Iltimos boshqa karta raqamini tanlang.'

                    }
                };
            }

            try {
                const time = new Date().getTime();
                logger.info(`Creating user card for user ID: ${requestBody.userId}, with card token: ${requestBody.token}`);
                const userCard = await UserCardsModel.create({
                    telegramId: user.telegramId,
                    username: user.username ? user.username : undefined,
                    incompleteCardNumber: response.data.result.card.number,
                    cardToken: response.data.result.card.token,
                    expireDate: response.data.result.card.expire,
                    userId: requestBody.userId,
                    planId: requestBody.planId,
                    verificationCode: requestBody.code,
                    verified: true,
                    verifiedDate: new Date(time),
                    cardType: CardType.PAYME
                });

                user.subscriptionType = 'subscription'
                await user.save();

                const plan = await Plan.findOne({
                    _id: requestBody.planId
                });
                if (!plan) {
                    logger.error(`Plan not found for ID: ${requestBody.planId}`);
                    throw new Error('Plan not found');
                }

                const successResult = {
                    success: true,
                    result: response.data.result
                };

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
                    paidBy: CardType.PAYME,
                    subscribedBy: CardType.PAYME,
                    hasReceivedFreeBonus: true
                });

                if (user.hasReceivedFreeBonus) {
                    if (requestBody.selectedService === 'yulduz') {
                        logger.info(`Card added for user with existing bonus: ${user.telegramId}`);
                        return successResult;
                    }
                }

                if (requestBody.selectedService === 'yulduz') {
                    logger.info(`Auto subscription success for user: ${user.telegramId}`);
                }


                return {
                    success: true,
                    result: response.data.result
                };
            } catch (error) {
                logger.error('Error processing successful verification:', error);
                return {
                    success: false,
                    error: {
                        code: -3,
                        message: 'Verification was successful, but processing failed'
                    }
                };
            }
        } catch (error) {
            logger.error('Error verifying card token:', error);

            // Check if the error response has data from Payme
            if (axios.isAxiosError(error) && error.response?.data?.error) {
                return {
                    success: false,
                    error: {
                        code: error.response.data.error.code,
                        message: this.getErrorMessage(error.response.data.error.code)
                    }
                };
            }

            return {
                success: false,
                error: {
                    code: -1,
                    message: 'Error connecting to payment service'
                }
            };
        }

    }

    async resendCode(requestBody: any) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth': this.PAYME_X_AUTH_CARDS,
            'Cache-Control': 'no-cache'
        };

        const cardResendRequest: CardGetVerifyCodeRequest = {
            id: 123,
            method: 'cards.get_verify_code',
            params: {
                token: requestBody.token,
            },
        };

        try {
            const response = await axios.post(
                this.baseUrl,
                cardResendRequest,
                { headers }
            );
            return {
                success: true,
                result: response.data.result
            };
        } catch (error) {
            logger.error('Error resending code:', error);
            return {
                success: false,
                error: {
                    code: -1,
                    message: 'Error connecting to payment service'
                }
            };
        }

    }


    async payReceipt(receiptId: string, userId: string, planId: string) {
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth': this.PAYME_X_AUTH_RECEIPTS,
            'Cache-Control': 'no-cache'
        };

        const user = await UserModel.findById(userId);
        if (!user) {
            logger.error('User not found');
            return;
        }

        const plan = await Plan.findById(planId);
        if (!plan) {
            logger.error('Plan not found');
            return;
        }

        const userCard = await UserCardsModel.findOne({ userId: userId });
        if (!userCard) {
            logger.error('User card not found');
            return;
        }
        if (userCard.cardType !== CardType.PAYME) {
            logger.error('User card type is not PAYME');
            return;
        }

        const receiptPayRequest: ReceiptPayRequest = {
            id: 123,
            method: 'receipts.pay',
            params: {
                id: receiptId,
                token: userCard.cardToken
            },
        }

        try {
            const response = await axios.post(
                this.baseUrl,
                receiptPayRequest,
                { headers }
            );


            logger.info(`response from pay receipt: ${JSON.stringify(response.data)}`);

            // Check if there's an error in the response
            if (response.data.error) {
                logger.error(`Payment failed with error: ${response.data.error.code} - ${response.data.error.message}`);

                // Handle specific error codes
                if (response.data.error.code === -31630) {
                    logger.info('Payment failed due to insufficient funds');
                }

                return {
                    success: false,
                    error: {
                        code: response.data.error.code,
                        message: response.data.error.message
                    }
                };
            }

            receiptId = response.data.result.receipt._id;
            const customRandomId = `subscription-payme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;


            const transaction = await Transaction.create(
                {
                    provider: PaymentProvider.PAYME,
                    paymentType: PaymentTypes.SUBSCRIPTION,
                    transId: receiptId ? receiptId : customRandomId,
                    amount: '5555',
                    status: TransactionStatus.PAID,
                    userId: userId,
                    planId: planId,
                }
            )

            user.subscriptionType = 'subscription'
            await user.save();

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
                paidBy: CardType.PAYME,
                subscribedBy: CardType.PAYME,
                hasReceivedFreeBonus: true
            });
            logger.info(`UserSubscription created for user ID: ${userId}, telegram ID: ${user.telegramId}, plan ID: ${planId} in payme-subs-api`);


            logger.info(`Transaction created in payme-subs-api: ${JSON.stringify(transaction)}`);
            return {
                success: true,
                result: response.data.result
            };
        } catch (error) {
            logger.error('Error paying receipt:', error);
            return {
                success: false,
                error: {
                    code: -1,
                    message: 'Error connecting to payment service'
                }
            };
        }
    }
    async createReceipt(userId: string, planId: string) {

        let receiptId = null;
        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-Auth': this.PAYME_X_AUTH_RECEIPTS,
            'Cache-Control': 'no-cache'
        };

        logger.warn(`LOOOOOOK, planId in createReceipt: ${planId}`);

        const plan = await Plan.findById(planId);
        if (!plan) {
            logger.error('No plan found');
            return;
        }

        const amountInTiyns = plan.price * 100;

        const receiptCreateRequest: ReceiptCreateRequest = {
            id: 123,

            method: 'receipts.create',
            params: {
                amount: amountInTiyns,
                account: {
                    user_id: userId,
                    plan_id: planId
                }
            },
        }

        try {
            const response = await axios.post(
                this.baseUrl,
                receiptCreateRequest,
                { headers }
            );

            receiptId = response.data.result.receipt._id;

            logger.info(`response from create receipt: ${JSON.stringify(response.data)}`);

            return {
                success: true,
                receiptId: receiptId
            };
        } catch (error) {
            logger.error('Error creating receipt:', error);
            return {
                success: false,
                error: {
                    code: -1,
                    message: 'Error connecting to payment service'
                }
            };
        }
    }


    private getErrorMessage(errorCode: number): string {
        const errorMessages = {
            '-31300': `Karta raqami noto'g'ri. Iltimos tekshirib qaytadan kiriting.`,
            '-31301': `Amal qilish muddati noto'g'ri. Iltimos tekshirib qaytadan kiriting.`,
            '-31302': 'Karta bloklanmagan. Bankga murojaat qiling.',
            '-31303': 'Karta foydalanishga yaroqsiz.',
            '-31304': 'Kartada yetarli mablag\' mavjud emas.',
            '-31050': 'Kartada SMS xabarnoma xizmati faollashtirilmagan.',
            '-31051': `Karta telefon raqami noto'g'ri.`,
            '-31103': `Tasdiqlash kodi noto'g'ri.`,

        };

        //@ts-ignore
        return errorMessages[errorCode] || 'Kutilmagan xatolik yuz berdi. Iltimos qaytadan urinib ko\'ring.';
    }

}
