import {IsNotEmpty} from "class-validator";

class CreateCardTokenDto {

    @IsNotEmpty()
    serviceId: number;

    @IsNotEmpty()
    cardToken: string

    @IsNotEmpty()
    smsCode: number


}