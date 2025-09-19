export interface CardGetVerifyCodeRequest {
    id: number;
    method: 'cards.get_verify_code';
    params: {
        token: string;
    };
}

export interface CardGetVerifyCodeResponse {
    jsonrpc: '2.0';
    id: number;
    result: {
        sent: boolean;
        phone: string;
        wait: number;
    };
}
