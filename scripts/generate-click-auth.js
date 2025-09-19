const crypto = require('crypto-js');

function generateAuthHeader(merchantUserId, secretKey) {
    const timestamp = Math.floor(Date.now() / 1000);
    const digestString = timestamp + secretKey;
    const digest = crypto.SHA1(digestString).toString(crypto.enc.Hex);
    return `${merchantUserId}:${digest}:${timestamp}`;
}

const merchantUserId = "58924"; // .env CLICK_MERCHANT_USER_ID
const secretKey = "HD1KeG5xhY"; // .env CLICK_SECRET

const authHeader = generateAuthHeader(merchantUserId.trim(), secretKey.trim());
console.log(authHeader);
