import {IsNotEmpty} from "class-validator";


class CreateInvoiceDto {

    @IsNotEmpty()
    serviceId: number;

    @IsNotEmpty()
    amount: number;

    @IsNotEmpty()
    phoneNumber: string;

    @IsNotEmpty()
    merchantTransId: string;

}
