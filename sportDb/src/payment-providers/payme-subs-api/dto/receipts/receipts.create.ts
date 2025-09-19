export interface ReceiptCreateRequest {
    id: number;
    method: 'receipts.create';
    params: {
        amount: number;
        account: {
            user_id: string;
            plan_id: string;
        }
    };
}

export interface ReceiptCreateResponse {
    jsonrpc: '2.0';
    id: number;
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
            currency: number;
            commission: number;
            account: Array<{
                name: string;
                title: string;
                value: string;
                main: boolean;
            }>;
            card: any;
            merchant: any;
            meta: any;
            processing_id: any;
        };
    };
}
