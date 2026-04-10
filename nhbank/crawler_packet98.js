const axios = require('axios');
const tunnel = require('tunnel');
const { CookieJar } = require('tough-cookie');
const forge = require('node-forge');
const crypto = require('crypto');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const CONFIG = {
    'Tk_InqGjaNbr': { 
        sliceX: 55, sliceY: 40,
        packetX: 232, packetY: 524,
        btnW: 33, btnH: 34, gap: 4 
    },
    'Tk_GjaSctNbr': {
        sliceX: 55, sliceY: 40,
        packetX: 232, packetY: 573,
        btnW: 33, btnH: 34, gap: 4 
    },
    'Tk_rlno1': {
        sliceX: 55, sliceY: 40,
        packetX: 232, packetY: 622,
        btnW: 33, btnH: 34, gap: 4
    }
};

const FIELD_CONFIGS = {
    'Tk_InqGjaNbr': { maxSize: '17', fieldType: 'text' },     // 계좌번호
    'Tk_GjaSctNbr': { maxSize: '4',  fieldType: 'password' }, // 비밀번호
    'Tk_rlno1':     { maxSize: '6',  fieldType: 'text' }      // 생년월일
};

const jar = new CookieJar();

// Fiddler 경유 Agent 생성
const tunnelingAgent = tunnel.httpsOverHttp({
    proxy: { host: '127.0.0.1', port: 8888 },
    rejectUnauthorized: false
});

const client = axios.create({
    httpsAgent: tunnelingAgent,
    proxy: false,
    timeout: 30000
});

// 쿠키 수동 관리 인터셉터
client.interceptors.request.use(async (config) => {
    const cookie = await jar.getCookieString(config.url);
    if (cookie) config.headers['Cookie'] = cookie;
    return config;
});

client.interceptors.response.use(async (response) => {
    const setCookie = response.headers['set-cookie'];
    if (setCookie) {
        await Promise.all(setCookie.map(cookie => jar.setCookie(cookie, response.config.url)));
    }
    return response;
});

const BASE_URL = 'https://banking.nonghyup.com';
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Origin': BASE_URL,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/html, */*; q=0.01'
};

async function get_nhTransactions() {
    try {
        console.log('--- Step 0: 첫 접속 (세션 및 쿠키 생성) ---');
        const res = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`,
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/nhbank.html` } }
        );
        // 1. TOKEN 추출
        const tokenMatch = res.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const token = tokenMatch ? tokenMatch[1] : null;
        
    } catch (err) {
        console.error('프로세스 실패:', err.message);
    }
}