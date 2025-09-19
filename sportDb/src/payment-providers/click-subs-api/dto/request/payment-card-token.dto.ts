import {IsNotEmpty} from "class-validator";
import {PaymentProvider} from "../../../../database/models/transactions.model";

export class PaymentCardTokenDto {


    userId: string;

    telegramId: number;

    planId: string;

}