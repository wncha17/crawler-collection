const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const forge = require('node-forge');
const crypto = require('crypto');
const sharp = require('sharp');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ERROR_LIMIT = 10; // 10픽셀 이상 차이 나면 숫자가 아니라고 판단

const CONFIG = {
    startX: 55,
    startY: 40,
    btnW: 33,
    btnH: 34,
    gap: 4
};

// 쿠키 매니저 설정
const jar = new CookieJar();
const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    timeout: 10000
}));

const BASE_URL = 'https://banking.nonghyup.com';
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Origin': BASE_URL,
    // 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/plain, */*; q=0.01'
};

function formatToNhStyle(hexString) {
    if (!hexString) return "";
    const bytes = hexString.match(/.{1,2}/g);
    if (!bytes) return "";

    const processedBytes = bytes.map(byte => {
        const hex = byte.toLowerCase();
        // 0으로 시작하면 0 제거 (농협 스타일: 0a -> a)
        return hex.startsWith('0') ? hex.substring(1) : hex; 
    });

    // 1. 맨 앞은 무조건 공백 한 칸으로 시작
    let result = " "; 
    for (let i = 0; i < processedBytes.length; i++) {
        // 2. 16바이트마다 '한 칸 공백' 추가 (여기에 +를 직접 넣지 마세요!)
        if (i > 0 && i % 16 === 0) {
            result += " "; 
        } else if (i > 0) {
            result += ",";
        }
        result += processedBytes[i];
    }
    return result;
}

async function sliceKeypad() {
    const inputImage = 'auto_keypad.png';
    const outputDir = './slices';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    // 4행 4열 구조 (이미지의 숫자 배치 기준)
    // 1행: [비어있음, 8, 9, 0, 1] -> 실제론 사이드 버튼 제외하고 계산
    // 여기서는 0~9까지 10개 조각을 순서대로 따는 예시입니다.
    
    const positions = [
        { r: 0, c: 0, label: 'pos_1_1' }, { r: 0, c: 1, label: 'pos_1_2' }, { r: 0, c: 2, label: 'pos_1_3' }, { r: 0, c: 3, label: 'pos_1_4' },
        { r: 1, c: 0, label: 'pos_2_1' }, { r: 1, c: 3, label: 'pos_2_4' },
        { r: 2, c: 0, label: 'pos_3_1' }, { r: 2, c: 3, label: 'pos_3_4' },
        { r: 3, c: 0, label: 'pos_4_1' }, { r: 3, c: 1, label: 'pos_4_2' }, { r: 3, c: 2, label: 'pos_4_3' }, { r: 3, c: 3, label: 'pos_4_4' }
    ];

    try {
        for (const pos of positions) {
            const left = CONFIG.startX + (CONFIG.btnW + CONFIG.gap) * pos.c;
            const top = CONFIG.startY + (CONFIG.btnH + CONFIG.gap) * pos.r;

            await sharp(inputImage)
                .extract({ left, top, width: CONFIG.btnW, height: CONFIG.btnH })
                .toFile(`${outputDir}/${pos.label}.png`);
        }
        console.log('✅ 모든 버튼 분할 완료!');
    } catch (err) {
        console.error('❌ 분할 중 오류:', err.message);
    }
}

// 이미지 파일을 읽어 PNG 객체로 변환하는 함수
function readImage(path) {
    return new Promise((resolve) => {
        const img = fs.createReadStream(path).pipe(new PNG()).on('parsed', () => resolve(img));
    });
}

async function recognizeNumbers() {
    const sliceDir = './slices';
    const refDir = './refs';
    const slices = fs.readdirSync(sliceDir).filter(f => f.endsWith('.png'));
    const refs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    // 1. 정답지(Reference) 데이터 미리 로드
    const refImages = {};
    for (const num of refs) {
        refImages[num] = await readImage(`${refDir}/ref_${num}.png`);
    }

    console.log('--- 숫자 인식 시작 ---');
    const results = {};

    for (const sliceFile of slices) {
        const sliceImg = await readImage(`${sliceDir}/${sliceFile}`);
        let minDiff = Infinity;
        let recognizedNum = -1;

        // 2. 10개의 정답지와 하나씩 비교
        for (const num of refs) {
            const refImg = refImages[num];
            const diffCanvas = new PNG({ width: refImg.width, height: refImg.height });
            
            // 두 이미지 간의 차이 픽셀 수 계산
            const diffPixels = pixelmatch(
                sliceImg.data, refImg.data, diffCanvas.data, 
                refImg.width, refImg.height, { threshold: 0.1 }
            );

            if (diffPixels < minDiff) {
                minDiff = diffPixels;
                recognizedNum = num;
            }
        }

        if (minDiff > ERROR_LIMIT) {
            results[sliceFile] = null; // 또는 'EMPTY'
            console.log(`[${sliceFile}] 인식 결과: 알 수 없음 (빈 칸 혹은 로고)`);
        } else {
            results[sliceFile] = recognizedNum;
            console.log(`[${sliceFile}] 인식 결과: ${recognizedNum} (차이: ${minDiff}px)`);
        }
    }

    console.log('\n--- 최종 키패드 맵 ---');
    console.log(results);
    return results;
}

/**
 * @param {string} password - 사용자가 입력한 비밀번호 (예: "1234")
 * @param {Object} keypadMap - recognizeNumbers()의 결과 (예: {'pos_1_1.png': 8, ...})
 */
function getPasswordCoordinates(password, keypadMap) {
    const passwordCoords = [];
    const passwordChars = password.split('');

    // 1. 숫자별로 어느 위치(pos_r_c)에 있는지 역추적 맵 생성
    const numberToPos = {};
    for (const [pos, num] of Object.entries(keypadMap)) {
        if (num !== null) {
            numberToPos[num] = pos;
        }
    }

    // 2. 비밀번호 각 글자에 대해 좌표 계산
    passwordChars.forEach((char) => {
        const posName = numberToPos[parseInt(char)]; // 예: "pos_1_4"
        if (!posName) throw new Error(`숫자 ${char}를 키패드에서 찾을 수 없습니다.`);

        // 파일명에서 row와 col 추출 (예: pos_1_4 -> r=0, c=3)
        const match = posName.match(/pos_(\d)_(\d)/);
        const row = parseInt(match[1]) - 1;
        const col = parseInt(match[2]) - 1;

        // 중앙 좌표 계산
        const x = Math.floor(CONFIG.startX + (col * (CONFIG.btnW + CONFIG.gap)) + (CONFIG.btnW / 2));
        const y = Math.floor(CONFIG.startY + (row * (CONFIG.btnH + CONFIG.gap)) + (CONFIG.btnH / 2));

        passwordCoords.push({ char, x, y });
    });

    return passwordCoords;
}

function encryptTransKeyPacket(coords, sessionKey) {
    const coordString = coords.map(c => `(${c.x},${c.y})`).join('');
    const key = Buffer.from(sessionKey, 'hex');
    const iv = key;

    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    let encrypted = cipher.update(coordString, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const hmac = crypto.createHmac('sha256', key);
    hmac.update(Buffer.from(encrypted, 'hex')); 
    const signature = hmac.digest('hex');

    return (encrypted + signature).toUpperCase();
}

// 1. RSA 암호화 함수 (testKey 생성용)
function encryptWithRSA(modulusHex, exponentHex, sessionKey) {
    const publicKey = forge.pki.setRsaPublicKey(
        new forge.jsbn.BigInteger(modulusHex, 16),
        new forge.jsbn.BigInteger(exponentHex, 16)
    );

    const sessionKeyBytes = forge.util.hexToBytes(sessionKey); 
    const encrypted = publicKey.encrypt(sessionKeyBytes, 'RSAES-PKCS1-V1_5');
    return forge.util.bytesToHex(encrypted);
}

async function get_nhTransactions() {
    try {
        console.log('--- Step 0: 첫 접속 (세션 및 쿠키 생성) ---');
        // 여기서 서버가 주는 첫 쿠키(SSID 등)를 자동으로 jar에 담습니다.
        const res = await client.get(`${BASE_URL}/servlet/IPMSP0011I.view`, { headers: COMMON_HEADERS });
        // 1. TOKEN 추출
        const tokenMatch = res.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const token = tokenMatch ? tokenMatch[1] : null;
        // 2. DEVICE_SESSION 추출
        const deviceSession = uuidv4();

        console.log(`✅ 토큰 획득 완료: ${token}`);
        console.log(`✅ 디바이스 세션 획득 완료: ${deviceSession}`);
        
        console.log('--- Step 1: RSA 공개키 획득 ---');
        const resRSA = await client.get(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRSAKey`, { headers: COMMON_HEADERS });
        const [exponent, modulus] = resRSA.data.split('||');

        console.log('--- Step 2: 세션 키 등록 (UUID 바인딩) ---');
        const liveUuid = crypto.randomBytes(32).toString('hex');
        const sessionKey = crypto.randomBytes(16).toString('hex'); // 랜덤 세션키
        
        // RSA 암호화 (생략된 encryptWithRSA 함수 사용)
        const liveKey = encryptWithRSA(modulus, exponent, sessionKey); 

        await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${liveKey}&transkeyUuid=${liveUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );

        console.log('--- Step 3: 키패드 로드 (서버 인증) ---');
        await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
            new URLSearchParams({
                op: 'load',
                name: 'Tk_InqGjaNbr',
                transkeyUuid: liveUuid,
                keyboardType: 'number',
                fieldType: 'text'
            }).toString(), 
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );

        console.log('--- Step 3.5: 리소스 할당 (allocate) ---');
        await client.post(`${BASE_URL}/servlet/transkeyServlet`,
            new URLSearchParams({
                op: 'allocate',
                name: 'Tk_InqGjaNbr',
                transkeyUuid: liveUuid,
                keyboardType: 'number',
                fieldType: 'text',
                maxSize: '17',
                x: '0',
                y: '0'
            }).toString(),
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`} }
        );

        await new Promise(resolve => setTimeout(resolve, 500));

        console.log('--- Step 4: 이미지 획득 ---');
        const resImage = await client.get(`${BASE_URL}/servlet/transkeyServlet`, {
            params: {
                op: 'singleLayout',
                name: 'Tk_InqGjaNbr',
                transkeyUuid: liveUuid,
                dummy: Date.now()
            },
            headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` },
            responseType: 'arraybuffer'
        });

        fs.writeFileSync('auto_keypad.png', Buffer.from(resImage.data));
        
        console.log('--- Step 5: 이미지 분석 및 숫자 인식 ---');
        await sliceKeypad(); // 이미지 분할
        const keypadMap = await recognizeNumbers(); // 숫자 인식

        // console.log('--- Step 6: 비밀번호 좌표 추출 ---');
        // const coords = getPasswordCoordinates("7606", keypadMap);

        // console.log('✅ 준비 완료! 클릭 좌표:', coords);

        console.log('--- Step 6: 통합 페이로드 구성 및 전송 ---');

        const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));

        // 1. 각 필드별 암호화 패킷 생성 (숫자 인식 로직은 이미 구현된 것 활용)
        const encAccount = formatToNhStyle(encryptTransKeyPacket(getPasswordCoordinates(userInfo.InqGjaNbr, keypadMap), sessionKey));
        const encPassword = formatToNhStyle(encryptTransKeyPacket(getPasswordCoordinates(userInfo.GjaSctNbr, keypadMap), sessionKey));
        const encBirth = formatToNhStyle(encryptTransKeyPacket(getPasswordCoordinates(userInfo.rlno1, keypadMap), sessionKey));
        
        const rawData = {
            "InqDat": userInfo.InqStrtYmd,
            "EndDat": userInfo.InqEndYmd,
            "RnmNbr": "",
            "InqFdt": userInfo.InqStrtYmd,
            "InqEndDat": userInfo.InqEndYmd,
            "Gbn_1": "1",
            "more": "false",
            "moreView": "false",
            "PagGbn": "",
            "InqChkGbn": "",
            "QckInqGbn": "",
            "lkg_acno_check_status": "false",
            "bas_am": "",
            "am_bascd": "",
            "lkg_acno": "",
            "tr_rec_sjt_srch_abr_nm": "",
            "GjaGbn": "1",
            "Tk_InqGjaNbr_check": "transkey",
            "InqGjaNbr": userInfo.InqGjaNbr,
            "transkey_Tk_InqGjaNbr": encAccount,
            "Tk_GjaSctNbr_check": "transkey",
            "GjaSctNbr": "0000",
            "transkey_Tk_GjaSctNbr": encPassword,
            "transkey_hMac_Tk_GjaSctNbr": "",
            "Tk_rlno1_check": "transkey",
            "rlno1": userInfo.rlno1,
            "transkey_Tk_rlno1": encBirth,
            "InqGbn_2": "2",
            "InqGbn": "1",
            "start_year": userInfo.InqStrtYmd.substring(0, 4),
            "start_month": userInfo.InqStrtYmd.substring(4, 6),
            "start_date": userInfo.InqStrtYmd.substring(6, 8),
            "end_year": userInfo.InqEndYmd.substring(0, 4),
            "end_month": userInfo.InqEndYmd.substring(4, 6),
            "end_date": userInfo.InqEndYmd.substring(6, 8),
            "bas_year": "2026",
            "bas_month": "04",
            "transkey_i": "3",
            "transkey_inputs": "Tk_InqGjaNbr:InqGjaNbr:text,Tk_GjaSctNbr:GjaSctNbr:password,Tk_rlno1:rlno1:text",
            "transkeyUuid": liveUuid,
            "secure_view": "Y",
            "TOKEN": token,
            "DEVICE_SESSION": deviceSession,
            "POP_WEB": "true"
        };

        // 폼 데이터 직렬화
        const body = Object.entries(rawData)
            .map(([key, val]) => {
                const encodedVal = encodeURIComponent(val)
                    .replace(/%20/g, '+')    // 모든 %20(공백)을 +로 치환
                    .replace(/%2C/g, ',');   // %2C(콤마)는 다시 ,로 복구
                return `${key}=${encodedVal}`;
            })
            .join('&');

        console.log(`\nPAYLOAD: ${body}`)

        const response = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`, body, {
            headers: {
                ...COMMON_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`
            }
        });

        if (response.data.includes('거래일시')) {
            console.log('✅ 성공! 데이터를 수신했습니다.');
            fs.writeFileSync('result_balance.html', response.data);
        } else {
            console.log('⚠️ 응답은 왔으나 조회가 되지 않았을 수 있습니다. HTML 확인 요망');
        }
        
        
    } catch (err) {
        console.error('❌ 프로세스 실패:', err.message);
    }
}

get_nhTransactions();