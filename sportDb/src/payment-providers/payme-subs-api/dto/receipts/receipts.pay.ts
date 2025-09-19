export interface ReceiptPayRequest {
    id: number;
    method: 'receipts.pay';
    params: {
        id: string;
        token: string;
    };
}

export interface ReceiptPayResponse {
    jsonrpc: '2.0';
    id: number | null;
    result: {
        receipt: {
            _id: string;
            create_time: number;
            pay_time: number;
            cancel_time: number;
            state: number;
            type: number;
            external: boolean;
            operation: number;
            category: any;
            error: any;
            description: string;
            detail: any;
            amount: number;
            commission: number;
            account: Array<{
                name: string;
                title: string;
                value: string;
            }>;
            card: {
                number: string;
                expire: string;
            };
            merchant: any;
            meta: any;
        };
    };
}