export interface CardRemoveRequest {
    id: number;
    method: 'cards.remove';
    params: {
        token: string;
    };
}

export interface CardRemoveResponse {
    jsonrpc: '2.0';
    id: number;
    result: {
        success: boolean;
    };

}