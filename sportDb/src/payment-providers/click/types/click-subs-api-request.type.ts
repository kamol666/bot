export type ClickSubsApiRequestType = {
    click_trans_id: string;
    service_id: string;
    click_paydoc_id: string;
    merchant_user_id?: string;
    merchant_trans_id: string;
    param2?: string;
    card_token?: string;
    amount: number;
    action: 0 | 1;                
    error: 0 | 1;                 
    error_note: string;
    sign_time: string;
    sign_string: string;
    merchant_prepare_id: number;
}
