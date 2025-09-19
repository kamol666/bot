import {IsNotEmpty} from "class-validator";

class CreateCardTokenDto {

    @IsNotEmpty()
    cardToken: string

    @IsNotEmpty()
    amount: number;

    @IsNotEmpty()
    merchantTransId: string;
}