export interface CreateInvoiceRequest {
    service_id: string;
    amount: number;
    phone_number: string;
    merchant_trans_id: string;  // User ID (PHP legacy)
    param1?: string;            // Plan ID uchun
    param2?: string;            // Qo'shimcha ma'lumot uchun
}

export interface CreateInvoiceResponse {
    error_code: number;         // 0 = success, >0 = error
    error_note: string;
    invoice_id?: number;
    eps_id?: string;
}

export interface InvoiceStatus {
    error_code: number;         // 0 = success, >0 = error  
    error_note: string;
    invoice_status?: number;    // 1 = paid, 0 = pending, -1 = cancelled
    invoice_status_note?: string;
}
