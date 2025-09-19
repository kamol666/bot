export interface CardCreateRequest {
    id: number;
    method: 'cards.create';
    params: {
        card: {
            number: string;
            expire: string;
        };
        account?: Record<string, any>;
        save?: boolean;
        customer?: string;
    };
}

export interface CardCreateResponse {
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