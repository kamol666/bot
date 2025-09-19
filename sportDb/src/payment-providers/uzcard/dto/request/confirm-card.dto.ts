import {IsNotEmpty} from "class-validator";

export class ConfirmCardDto {

    @IsNotEmpty()
    session: string;

    @IsNotEmpty()
    otp: string;
    telegramId: string;
    selectedSport: string;
    userId?: string;

}
