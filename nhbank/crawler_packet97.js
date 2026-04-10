const axios = require('axios');
// const https = require('https');
const tunnel = require('tunnel');
// const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
// const { HttpsProxyAgent } = require('https-proxy-agent');
const forge = require('node-forge');
const crypto = require('crypto');
const sharp = require('sharp');
const PNG = require('pngjs').PNG;
// const pixelmatch = require('pixelmatch').default || require('pixelmatch');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
// const ERROR_LIMIT = 10; // 10픽셀 이상 차이 나면 숫자가 아니라고 판단

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

// Fiddler 프록시 에이전트 설정
// rejectUnauthorized: false를 통해 Fiddler 인증서 에러를 무시합니다.
// const proxyAgent = new HttpsProxyAgent('http://127.0.0.1:8888', {
//     rejectUnauthorized: false 
// });

// 쿠키 매니저 설정
const jar = new CookieJar();
// const client = wrapper(axios.create({
//     jar,
//     withCredentials: true,
//     timeout: 10000
// }));

// client.defaults.proxy = {
//     host: '127.0.0.1',
//     port: 8888
// };

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 1. Fiddler(8888) 경유 에이전트 생성
const tunnelingAgent = tunnel.httpsOverHttp({
    proxy: { host: '127.0.0.1', port: 8888 },
    // Fiddler 자체 인증서 허용 (매우 중요)
    rejectUnauthorized: false
});

// 2. client 설정 업데이트
const client = axios.create({
    httpsAgent: tunnelingAgent, // 터널 주입
    proxy: false,               // axios 기본 프록시 기능은 비활성화
    timeout: 30000              // 30초로 넉넉하게 설정
});

// 3. 쿠키 수동 관리 인터셉터 (핵심)
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
    // 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/html, */*; q=0.01'
};

async function sliceKeypad(filename, fieldName) {
    const inputImage = filename;
    const outputDir = './slices';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    const config1 = CONFIG[fieldName];

    // 4행 4열 구조 (이미지의 숫자 배치 기준)
    // 1행: [비어있음, 8, 9, 0, 1] -> 실제론 사이드 버튼 제외하고 계산
    // 여기서는 0~9까지 10개 조각을 순서대로 따는 예시입니다.
    
    const positions = [
        { r: 0, c: 0, label: `${fieldName}_1_1` }, { r: 0, c: 1, label: `${fieldName}_1_2` }, { r: 0, c: 2, label: `${fieldName}_1_3` }, { r: 0, c: 3, label: `${fieldName}_1_4` },
        { r: 1, c: 0, label: `${fieldName}_2_1` }, { r: 1, c: 3, label: `${fieldName}_2_4` },
        { r: 2, c: 0, label: `${fieldName}_3_1` }, { r: 2, c: 3, label: `${fieldName}_3_4` },
        { r: 3, c: 0, label: `${fieldName}_4_1` }, { r: 3, c: 1, label: `${fieldName}_4_2` }, { r: 3, c: 2, label: `${fieldName}_4_3` }, { r: 3, c: 3, label: `${fieldName}_4_4` }
    ];

    try {
        for (const pos of positions) {
            const left = config1.sliceX + (config1.btnW + config1.gap) * pos.c;
            const top = config1.sliceY + (config1.btnH + config1.gap) * pos.r;

            await sharp(inputImage)
                .extract({ left, top, width: config1.btnW, height: config1.btnH })
                .toFile(`${outputDir}/${pos.label}.png`);
        }
        console.log('✅ 모든 버튼 분할 완료!');
    } catch (err) {
        console.error('❌ 분할 중 오류:', err.message);
    }
}

async function recognizeWithThreshold(slicePath, thresholdValue) {
    const processedBuffer = await sharp(slicePath)
        .resize(120, 120, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
        .greyscale()
        .sharpen()
        .threshold(thresholdValue)
        .toBuffer();

    const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng', {
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: '10',
        oem: 3
    });
    return text.replace(/[^0-9]/g, '').trim();
}

async function recognizeNumbers(fieldName) {
    const sliceDir = './slices';
    const slices = fs.readdirSync(sliceDir).filter(f => f.endsWith('.png') && f.startsWith(fieldName));
    const results = {};

    console.log(`--- [${fieldName}] AI 멀티 레이어 인식 시작 ---`);

    for (const sliceFile of slices) {
        const slicePath = `${sliceDir}/${sliceFile}`;
        
        // 1차 시도: 180 (기존에 잘 되었던 설정)
        let recognized = await recognizeWithThreshold(slicePath, 180);

        // 2차 시도: 1차 실패 시 140~150으로 재시도 (8이나 뭉친 글자용)
        if (recognized === "") {
            recognized = await recognizeWithThreshold(slicePath, 140);
        }

        if (recognized === "") {
            results[sliceFile] = null;
            console.log(`[${sliceFile}] AI 판독: 최종 실패`);
        } else {
            const finalNum = parseInt(recognized.charAt(0));
            results[sliceFile] = finalNum;
            console.log(`[${sliceFile}] AI 판독 완료: ${finalNum}`);
        }
    }
    return results;
}

/**
 * @param {string} value - 사용자가 입력한 번호 (예: "1234")
 * @param {Object} keypadMap - recognizeNumbers()의 결과 (예: {'pos_1_1.png': 8, ...})
 */
function getNumCoordinates(value, keypadMap, fieldName) {
    const numCoords = [];
    const numChars = String(value).split('');
    const config1 = CONFIG[fieldName]

    // 1. 역방향 맵핑 생성 (숫자 -> 좌표 파일명 리스트)
    // 중복 인식을 대비해 배열로 저장하는 것이 안전합니다.
    const numberToPos = {};
    for (const [pos, num] of Object.entries(keypadMap)) {
        if (num !== null) {
            // 해당 숫자가 처음 등장하면 배열 생성, 아니면 추가
            if (!numberToPos[num]) numberToPos[num] = [];
            numberToPos[num].push(pos);
        }
    }

    console.log(`[${fieldName}] 좌표 변환 시작: 입력값="${value}" (길이: ${numChars.length})`);

    numChars.forEach((char, index) => {
        const num = parseInt(char);
        const posOptions = numberToPos[num];
        
        if (!posOptions || posOptions.length === 0) {
            throw new Error(`[${fieldName}] 숫자 ${char}를 키패드에서 찾을 수 없습니다. (인식 결과 확인 필요)`);
        }

        // 여러 개의 좌표가 있다면 첫 번째 것을 사용 (보통 하나만 있어야 정상)
        const posName = posOptions[0]; 

        // 정규식 수정: 파일명 끝에서 _행_열 숫자를 정확히 추출
        const match = posName.match(/(\d+)_(\d+)(?:\.png)?$/);
        if (!match) throw new Error(`[${fieldName}] ${posName}에서 좌표 파싱 실패`);

        const row = parseInt(match[1]); // 행 (1~4)
        const col = parseInt(match[2]); // 열 (1~3)

        // 1. 기준이 되는 중심점(Center) 계산
        const centerX = config1.packetX + (col - 1) * (config1.btnW + config1.gap) + (config1.btnW / 2);
        const centerY = config1.packetY + (row - 1) * (config1.btnH + config1.gap) + (config1.btnH / 2);

        // 2. 인간미(Randomness) 추가: ±3픽셀 내외로 무작위 오차 발생
        // Math.random() * 6 - 3 => -3.0 ~ +3.0 사이의 실수 생성
        const offsetX = (Math.random() * 6) - 3; 
        const offsetY = (Math.random() * 6) - 3;

        // 3. 최종 정수 좌표 확정
        const x = Math.floor(centerX + offsetX);
        const y = Math.floor(centerY + offsetY);

        numCoords.push({ char, x, y });
        
        // 로그를 찍어보면 이제 7606의 '6'들이 서로 다른 좌표로 출력될 겁니다.
        console.log(`   - ${index + 1}번째 [${char}]: (${centerX}, ${centerY}) -> 랜덤 적용: (${x}, ${y})`);

        // // 디버깅을 위해 잠시 고정 (offsetRange = 0)
        // const x = Math.floor(centerX); 
        // const y = Math.floor(centerY);
        // console.log(`[DEBUG] 필드:${fieldName} / 숫자:${char} / 최종좌표:(${x}, ${y})`);
    });

    if (numCoords.length !== numChars.length) {
        console.error(`🚨 [${fieldName}] 길이 불일치! 입력:${numChars.length}, 결과:${numCoords.length}`);
    }

    return numCoords;
}

function encryptTransKeyPacket(coords, sessionKey) {
    const key = Buffer.from(sessionKey, 'hex');
    const iv = key;

    const encryptedBlocks = coords.map(c => {
        const coordString = `${c.x},${c.y}`;
        const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
        
        let encrypted = cipher.update(coordString, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        // 1. 앞의 32글자(16바이트)만 추출
        const finalHex = encrypted.substring(0, 32).toLowerCase();

        // 2. 2글자씩 잘라서 배열로 만든 뒤, 각 바이트가 2자리가 되도록 보장 (매우 중요)
        const bytes = finalHex.match(/.{1,2}/g);
        
        // 3. 콤마(,)로 연결 (여기서는 순수하게 콤마만 넣습니다. 인코딩은 나중에!)
        return bytes.join(',');
    });

    return encryptedBlocks; // ["b2,6d,78...", "dc,4c,de..."] 형식으로 반환됨
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

/**
 * @param {string} fieldName - 농협 필드명 (예: 'Tk_InqGjaNbr', 'Tk_GjaSctNbr')
 * @param {string} value - 실제 입력할 값 (예: '1234')
 * @param {string} uuid - transkeyUuid
 * @param {string} sessionKey - sessionKey
 */
async function getEncryptedField(fieldName, value, uuid, sessionKey) {
    const config = FIELD_CONFIGS[fieldName] || { maxSize: '17', fieldType: 'text' };
    console.log(`--- [${fieldName}] 처리 시작 ---`);

    // 0. 키패드 로드
    await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
        new URLSearchParams({
            op: 'load',
            name: fieldName,
            transkeyUuid: uuid,
            keyboardType: 'number',
            fieldType: config.fieldType,
            maxSize: config.maxSize,
            x: '0', y: '0'
        }).toString(),
        { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`} }
    );

    // A. 리소스 할당 (allocate)
    await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
        new URLSearchParams({
            op: 'allocate',
            name: fieldName,
            transkeyUuid: uuid,
            keyboardType: 'number',
            fieldType: config.fieldType,
            maxSize: config.maxSize,
            x: '0', y: '0'
        }).toString(),
        { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`} }
    );

    // B. 이미지 획득
    const resImage = await client.get(`${BASE_URL}/servlet/transkeyServlet`, {
        params: { op: 'singleLayout', name: fieldName, transkeyUuid: uuid, dummy: Date.now() },
        headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` },
        responseType: 'arraybuffer'
    });
    
    const imgPath = `keypad_${fieldName}.png`;
    fs.writeFileSync(imgPath, Buffer.from(resImage.data));

    // C. 이미지 분석 (기존 함수 활용)
    // 주의: sliceKeypad와 recognizeNumbers가 파일명을 인자로 받게 살짝 수정해야 함
    await sliceKeypad(imgPath, fieldName);
    const keypadMap = await recognizeNumbers(fieldName);

    // D. 좌표 추출 및 암호화 (기존 함수 활용)
    const coords = getNumCoordinates(value, keypadMap, fieldName);

    // 1. 함수는 완벽하게 손질된 '블록 배열'을 줍니다.
    const blocks = encryptTransKeyPacket(coords, sessionKey);
    // 2. 블록 사이를 '공백( )'으로 구분해서 하나의 문자열로 합칩니다. (가장 중요!)
    const combinedValue = " " + blocks.join(' ');
    const encryptedPacket = combinedValue.replace(/%2B/g, '+');

    return encryptedPacket;
}

async function get_nhTransactions() {
    try {
        const browserCookies = "mainSetCookie=main_IP; mainSetCookie=main_IP; PCID=0c78485c-5837-2d88-fd7a-cadc3934c5cc-1774568756431; _n_session=17748261931842426013903; acookie0=done0; curSvcId=IPMSP0011I; EFIP_PT_SSID=NTRkOGM4NjQtNGU2Ni00ZmE4LWIyMzYtZjZhZjY2OTRiNmVj; _n_dfseq=189; _n_dur=4; _n_cTime=1775803985319; _n_seq=189";

        for (const cookieStr of browserCookies.split(';')) {
            await jar.setCookie(cookieStr.trim(), BASE_URL);
        }

        console.log('--- Step -1: 보안 세션 빌드업 (nhbank.html) ---');
        // 진짜 시작점인 nhbank.html에 먼저 접속하여 기본 쿠키들을 확보
        await client.get(`${BASE_URL}/nhbank.html`, 
            { headers: { ...COMMON_HEADERS, 'Referer': 'https://banking.nonghyup.com/' } }
        );

        console.log('--- Step 0: 첫 접속 (세션 및 쿠키 생성) ---');
        // 여기서 서버가 주는 첫 쿠키(SSID 등)를 자동으로 jar에 담습니다.
        const res = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`,
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/nhbank.html` } }
        );
        // 1. TOKEN 추출
        const tokenMatch = res.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const token = tokenMatch ? tokenMatch[1] : null;
        // const token = '260410110331OEFIPINOPT0069765801';
        // 2. DEVICE_SESSION 추출
        const deviceSession = uuidv4();
        // const deviceSession = '00a8e0c1-45cb-4d32-b2ce-33e0840ba05e';

        console.log(`✅ 토큰 획득 완료: ${token}`);
        console.log(`✅ 디바이스 세션 획득 완료: ${deviceSession}`);
        
        console.log('--- Step 1: RSA 공개키 획득 ---');
        const resRSA = await client.get(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRSAKey`,
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );
        const [exponent, modulus] = resRSA.data.split('||');

        console.log('--- Step 2: 세션 키 등록 (UUID 바인딩) ---');
        const liveUuid = crypto.randomBytes(32).toString('hex');
        const sessionKey = crypto.randomBytes(16).toString('hex'); // 랜덤 세션키

        // RSA 암호화 (생략된 encryptWithRSA 함수 사용)
        const liveKey = encryptWithRSA(modulus, exponent, sessionKey); 

        // const liveKey = '41f9a10390799d7d0be893233535d88e60b77a444825f931af82c1046d50eb948e05a4d015d9d58f828c1780019788624d53571c92ceb324c0073c2f8e2af0ab26a77e236886432ac735c8045a31f5c5aa9c5b69b2d8497e0787e576573dd3632562913ee064d4297715ac33c70e694d3c6185918fcd52bfded808885fca6dfe';
        // const liveUuid = '05426d91961431e18e83bb88b9550772a3ba6c573b3d21c2103595aceafa6725';

        await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${liveKey}&transkeyUuid=${liveUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );

        console.log('--- Step 3: 통합 페이로드 구성 및 전송 ---');

        const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));

        // Step 6: 각 필드별 암호화 패킷 생성 (함수 호출로 끝!)
        const encAccount = await getEncryptedField('Tk_InqGjaNbr', userInfo.InqGjaNbr, liveUuid, sessionKey);
        await new Promise(resolve => setTimeout(resolve, 800));
        const encPassword = await getEncryptedField('Tk_GjaSctNbr', userInfo.GjaSctNbr, liveUuid, sessionKey);
        await new Promise(resolve => setTimeout(resolve, 800));
        const encBirth = await getEncryptedField('Tk_rlno1', userInfo.rlno1, liveUuid, sessionKey);
        
        const payload = new URLSearchParams();

        payload.append('InqDat', userInfo.InqStrtYmd);
        payload.append('EndDat', userInfo.InqEndYmd);
        payload.append('RnmNbr', '');
        payload.append('InqFdt', userInfo.InqStrtYmd);
        payload.append('InqEndDat', userInfo.InqEndYmd);
        payload.append('Gbn_1', '1');
        payload.append('more', 'false');
        payload.append('moreView', 'false');
        payload.append('PagGbn', '');
        payload.append('InqChkGbn', '');
        payload.append('QckInqGbn', '');
        payload.append('lkg_acno_check_status', 'false');
        payload.append('bas_am', '');
        payload.append('am_bascd', '');
        payload.append('lkg_acno', '');
        payload.append('tr_rec_sjt_srch_abr_nm', '');
        payload.append('GjaGbn', '1');
        payload.append('Tk_InqGjaNbr_check', 'transkey');
        payload.append('InqGjaNbr', userInfo.InqGjaNbr);
        payload.append('transkey_Tk_InqGjaNbr', encAccount);
        payload.append('Tk_GjaSctNbr_check', 'transkey');
        payload.append('GjaSctNbr', '0000');
        payload.append('transkey_Tk_GjaSctNbr', encPassword);
        payload.append('transkey_hMac_Tk_GjaSctNbr', '');
        payload.append('Tk_rlno1_check', 'transkey');
        payload.append('rlno1', userInfo.rlno1);
        payload.append('transkey_Tk_rlno1', encBirth);
        payload.append('InqGbn_2', '2');
        payload.append('InqGbn', '1');
        payload.append('start_year', userInfo.InqStrtYmd.substring(0, 4));
        payload.append('start_month', userInfo.InqStrtYmd.substring(4, 6));
        payload.append('start_date', userInfo.InqStrtYmd.substring(6, 8));
        payload.append('end_year', userInfo.InqEndYmd.substring(0, 4));
        payload.append('end_month', userInfo.InqEndYmd.substring(4, 6));
        payload.append('end_date', userInfo.InqEndYmd.substring(6, 8));
        payload.append('bas_year', '2026');
        payload.append('bas_month', '04');
        payload.append('transkey_i', '3');
        payload.append('transkey_inputs', 'Tk_InqGjaNbr:InqGjaNbr:text,Tk_GjaSctNbr:GjaSctNbr:password,Tk_rlno1:rlno1:text');
        payload.append('transkeyUuid', liveUuid);
        payload.append('secure_view', 'Y');
        payload.append('TOKEN', token);
        payload.append('DEVICE_SESSION', deviceSession);
        payload.append('POP_WEB', 'true');

        // const body = Object.entries(rawData)
        //     .map(([key, val]) => {
        //         const encodedVal = encodeURIComponent(val)
        //             .replace(/%20/g, '+')    // 모든 %20(공백)을 +로 치환
        //             .replace(/%2C/g, ',');   // %2C(콤마)는 다시 ,로 복구
        //         return `${key}=${encodedVal}`;
        //     })
        //     .join('&');

        const finalPayloadString = payload.toString();

        console.log(`\n✅ 최종 전송 PAYLOAD: ${finalPayloadString}`);

        const response = await client.post(`${BASE_URL}/servlet/IPMSP0012R.frag`, finalPayloadString, {
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
            fs.writeFileSync('result_balance.html', response.data);
        }
        
        
    } catch (err) {
        console.error('❌ 프로세스 실패:', err.message);
    }
}

get_nhTransactions();