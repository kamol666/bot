#!/usr/bin/env node
const crypto = require('crypto-js');

function generateAuthHeader(merchantUserId, secretKey) {
    const timestamp = Math.floor(Date.now() / 1000);
    const digestString = timestamp + secretKey;
    const digest = crypto.SHA1(digestString).toString(crypto.enc.Hex);

    return `${merchantUserId}:${digest}:${timestamp}`;
}

// Qiymatlarni .env faylidan oling
const merchantUserId = "58924"; // CLICK_MERCHANT_USER_ID
const secretKey = "HD1KeG5xhY"; // CLICK_SECRET

const authHeader = generateAuthHeader(merchantUserId, secretKey);
console.log('✅ CRYPTO-JS Auth Header:', authHeader);

// Format tekshirish
const parts = authHeader.split(':');
console.log('✅ Merchant User ID:', parts[0]);
console.log('✅ Digest length:', parts[1]?.length, '(should be 40)');
console.log('✅ Timestamp length:', parts[2]?.length, '(should be 10)');
console.log('✅ Timestamp:', parts[2]);

// Node.js crypto bilan taqqoslash
const crypto_node = require('crypto');
const timestamp_node = Math.floor(Date.now() / 1000);
const digestString_node = timestamp_node + secretKey;
const digest_node = crypto_node.createHash('sha1').update(digestString_node).digest('hex');
const authHeader_node = `${merchantUserId}:${digest_node}:${timestamp_node}`;

console.log('\n🔄 Node.js crypto taqqoslash:');
console.log('Node.js Auth Header:', authHeader_node);
console.log('Digest lar bir xilmi?', digest_node === parts[1] || 'Different timestamps');
