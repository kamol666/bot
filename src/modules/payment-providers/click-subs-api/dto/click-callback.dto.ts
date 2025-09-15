import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, IsNotEmpty } from 'class-validator';

export class ClickCallbackDto {
    @IsInt()
    @Type(() => Number)
    click_trans_id: number;

    @IsInt()
    @Type(() => Number)
    service_id: number;

    @IsString()
    click_paydoc_id: string;

    @IsString()
    merchant_trans_id: string;

    @IsNumber()
    @Type(() => Number)
    amount: number;

    @IsInt()
    @Type(() => Number)
    action: number;

    @IsInt()
    @Type(() => Number)
    error: number;

    @IsString()
    error_note: string;

    @IsString()
    sign_time: string;

    @IsString()
    @IsNotEmpty()
    sign_string: string;

    // For complete action
    @IsOptional()
    @IsString()
    merchant_prepare_id?: string;
}

export class ClickPrepareDto extends ClickCallbackDto {
    @IsInt()
    action: 0; // 0 for prepare
}

export class ClickCompleteDto extends ClickCallbackDto {
    @IsInt()
    action: 1; // 1 for complete

    @IsString()
    @IsNotEmpty()
    merchant_prepare_id: string; // This is what we sent back in prepare response
}
