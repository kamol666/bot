export interface CardVerifyRequest {
    id: number;
    method: 'cards.verify';
    params: {
        token: string;
        code: string;
    };
}

export interface CardVerifyResponse {
    jsonrpc: '2.0';
    id: number;
    result: {
        card: {
            number: string;
            expire: string;
            token: string;
            recurrent: boolean;
            verify: boolean;
        };
    };
}