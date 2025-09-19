import {CardCreateResponse} from "../dto/cards/cards.create";
import {CardGetVerifyCodeResponse} from "../dto/cards/cards.get_verify_code";
import {CardVerifyResponse} from "../dto/cards/cards.verify";
import {CardRemoveResponse} from "../dto/cards/cards.remove";
import {ReceiptCreateResponse} from "../dto/receipts/receipts.create";
import {ReceiptPayResponse} from "../dto/receipts/receipts.pay";

export type PaymeResponse =
    | CardCreateResponse
    | CardGetVerifyCodeResponse
    | CardVerifyResponse
    | CardRemoveResponse
    | ReceiptCreateResponse
    | ReceiptPayResponse;