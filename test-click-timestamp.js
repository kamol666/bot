#!/usr/bin/env node
const crypto = require('crypto');

// Test script to verify Click auth header generation
function generateClickAuthHeader(merchantUserId, secretKey) {
    // ✅ To'g'ri format - UNIX timestamp (10 raqam)
    const timestamp = Math.floor(Date.now() / 1000);
    const digestString = timestamp + secretKey;
    const digest = crypto.createHash('sha1').update(digestString).digest('hex');
    const authHeader = `${merchantUserId}:${digest}:${timestamp}`;

    console.log('✅ TO\'G\'RI FORMAT:');
    console.log('Timestamp:', timestamp, '(', String(timestamp).length, 'raqam)');
    console.log('Auth Header:', authHeader);
    console.log('');

    return authHeader;
}

function generateWrongAuthHeader(merchantUserId, secretKey) {
    // ❌ Noto'g'ri format - ISO string 
    const isoTimestamp = new Date().toISOString();
    const digestString = isoTimestamp + secretKey;
    const digest = crypto.createHash('sha1').update(digestString).digest('hex');
    const authHeader = `${merchantUserId}:${digest}:${isoTimestamp}`;

    console.log('❌ NOTO\'G\'RI FORMAT (ISO):');
    console.log('Timestamp:', isoTimestamp, '(', String(isoTimestamp).length, 'belgi)');
    console.log('Auth Header:', authHeader);
    console.log('');

    return authHeader;
}

// .env dan qiymatlar
const merchantUserId = "58924";
const secretKey = "HD1KeG5xhY";

console.log('=== CLICK AUTH HEADER TEST ===\n');

// To'g'ri format
generateClickAuthHeader(merchantUserId, secretKey);

// Noto'g'ri format (masalan eski kodni ko'rsatish uchun)
generateWrongAuthHeader(merchantUserId, secretKey);

console.log('📝 XULOSA:');
console.log('- Click API faqat UNIX timestamp (10 raqam) qabul qiladi');
console.log('- ISO format (2025-09-19T...) ishlamaydi');
console.log('- Math.floor(Date.now() / 1000) to\'g\'ri usul');
console.log('- new Date().toISOString() noto\'g\'ri!');
