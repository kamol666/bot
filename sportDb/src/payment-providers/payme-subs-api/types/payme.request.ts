import {CardCreateRequest} from "../dto/cards/cards.create";
import {CardGetVerifyCodeRequest} from "../dto/cards/cards.get_verify_code";
import {CardVerifyRequest} from "../dto/cards/cards.verify";
import {CardRemoveRequest} from "../dto/cards/cards.remove";
import {ReceiptCreateRequest} from "../dto/receipts/receipts.create";
import {ReceiptPayRequest} from "../dto/receipts/receipts.pay";

export type PaymeRequest =
    | CardCreateRequest
    | CardGetVerifyCodeRequest
    | CardVerifyRequest
    | CardRemoveRequest
    | ReceiptCreateRequest
    | ReceiptPayRequest;