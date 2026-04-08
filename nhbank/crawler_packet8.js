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

const FIELD_CONFIGS = {
    'Tk_InqGjaNbr': { maxSize: '17', fieldType: 'text' },     // 계좌번호
    'Tk_GjaSctNbr': { maxSize: '4',  fieldType: 'password' }, // 비밀번호
    'Tk_rlno1':     { maxSize: '6',  fieldType: 'text' }      // 생년월일
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

async function sliceKeypad(filename, fieldName) {
    const inputImage = filename;
    const outputDir = './slices';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

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

// 이미지 추출 + 이진화(흑백) + 미세 이동
async function findBestMatch(sliceBuffer, refImages, width, height) {
    let bestNum = null;
    let minDiff = Infinity;

    // 0부터 9까지 모든 숫자 정답지와 대조
    for (const num of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const refImg = refImages[num]; // 미리 로드해둔 정답지 데이터

        // 상하좌우 2px씩 총 25번의 좌표를 뒤집니다 (Jitter Search)
        for (let yOff = -2; yOff <= 2; yOff++) {
            for (let xOff = -2; xOff <= 2; xOff++) {
                // 1. 미세 이동하여 추출하고, .threshold()로 회색 배경을 날립니다.
                const currentData = await sharp(sliceBuffer)
                    .extract({ 
                        left: 2 + xOff, // 패딩 2px 기준
                        top: 2 + yOff, 
                        width: width, 
                        height: height 
                    })
                    .threshold(180) // 180보다 밝으면 흰색, 어두우면 검은색 (회색 제거)
                    .raw()
                    .toBuffer();

                // 2. pixelmatch로 정답지와 비교
                const diff = pixelmatch(currentData, refImg.data, null, width, height, { threshold: 0.1 });

                // 3. 최소 오차 업데이트
                if (diff < minDiff) {
                    minDiff = diff;
                    bestNum = num;
                }
                if (minDiff === 0) break; // 완벽 일치 시 조기 종료
            }
            if (minDiff === 0) break;
        }
    }
    return { bestNum, minDiff };
}

async function recognizeNumbers(fieldName) {
    const sliceDir = './slices';
    const refDir = './refs';
    
    // 1. 해당 필드(fieldName)로 시작하는 파일만 필터링합니다.
    const slices = fs.readdirSync(sliceDir).filter(f => 
        f.endsWith('.png') && f.startsWith(fieldName)
    ).sort();

    // const refs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    // 정답지(Reference) 데이터 미리 로드
    const refImages = {};
    for (let i = 0; i <= 9; i++) {
        refImages[i] = await readImage(`${refDir}/ref_${i}.png`);
    }

    console.log(`--- [${fieldName}] 숫자 인식 시작 ---`);
    const results = {};

    let REF_W = 33;
    let REF_H = 34;
    for (const sliceFile of slices) {
        // 파일명에서 행(row)과 열(col) 정보를 파싱 (예: Tk_rlno1_1_2.png -> row 1, col 2)
        const parts = sliceFile.split('_');
        const row = parseInt(parts[parts.length - 2]); // 뒤에서 두 번째
        const col = parseInt(parts[parts.length - 1].split('.')[0]); // 마지막 숫자

        // 각 버튼의 고유 시작 좌표 계산
        const currentStartX = CONFIG.startX + (col - 1) * CONFIG.gap;
        const currentStartY = CONFIG.startY + (row - 1) * CONFIG.gap;

        // 1. 버튼 자르기 (Jitter Search를 위해 사방 2px 여유)
        const sliceBuffer = await sharp(`keypad_${fieldName}.png`) // 원본 전체 키패드 이미지 경로
            .extract({ 
                left: Math.max(0, currentStartX - 2), 
                top: Math.max(0, currentStartY - 2), 
                width: REF_W + 4, 
                height: REF_H + 4 
            })
            .toBuffer();

        // 2. 탐색 함수 실행 (앞서 만든 findBestMatch 호출)
        const { bestNum, minDiff } = await findBestMatch(sliceBuffer, refImages, REF_W, REF_H);

        // 3. 결과 저장 및 출력
        if (minDiff < CONFIG.ERROR_LIMIT) {
            results[sliceFile] = bestNum; // results 객체에 저장
            console.log(`[${sliceFile}] 인식 성공: ${bestNum} (차이: ${minDiff}px)`);
        } else {
            results[sliceFile] = null;
            console.log(`[${sliceFile}] 인식 실패 (최소 차이: ${minDiff}px)`);
        }
    }

    console.log(`\n--- [${fieldName}] 최종 키패드 맵 ---`);
    console.log(results);
    return results;
}

/**
 * @param {string} value - 사용자가 입력한 비밀번호 (예: "1234")
 * @param {Object} keypadMap - recognizeNumbers()의 결과 (예: {'pos_1_1.png': 8, ...})
 */
function getNumCoordinates(value, keypadMap) {
    const numCoords = [];
    const numChars = String(value).split(''); // 숫자가 들어올 경우 대비

    const numberToPos = {};
    for (const [pos, num] of Object.entries(keypadMap)) {
        if (num !== null) {
            numberToPos[num] = pos;
        }
    }

    numChars.forEach((char) => {
        const posName = numberToPos[parseInt(char)]; 
        if (!posName) throw new Error(`숫자 ${char}를 키패드에서 찾을 수 없습니다.`);

        // (\d)_(\d) 앞에 어떤 문자가 와도 뒤의 숫자 두 개만 추출합니다.
        const match = posName.match(/(\d)_(\d)(?:\.png)?$/); 
        
        if (!match) throw new Error(`${posName}에서 좌표를 추출할 수 없습니다.`);

        const row = parseInt(match[1]) - 1;
        const col = parseInt(match[2]) - 1;

        const x = Math.floor(CONFIG.startX + (col * (CONFIG.btnW + CONFIG.gap)) + (CONFIG.btnW / 2));
        const y = Math.floor(CONFIG.startY + (row * (CONFIG.btnH + CONFIG.gap)) + (CONFIG.btnH / 2));

        numCoords.push({ char, x, y });
    });

    return numCoords;
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
    const coords = getNumCoordinates(value, keypadMap);
    const encryptedPacket = encryptTransKeyPacket(coords, sessionKey);

    return formatToNhStyle(encryptedPacket);
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

        console.log('--- Step 3: 통합 페이로드 구성 및 전송 ---');

        const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));

        // Step 6: 각 필드별 암호화 패킷 생성 (함수 호출로 끝!)
        const encAccount = await getEncryptedField('Tk_InqGjaNbr', userInfo.InqGjaNbr, liveUuid, sessionKey);
        await new Promise(resolve => setTimeout(resolve, 800));
        const encPassword = await getEncryptedField('Tk_GjaSctNbr', userInfo.GjaSctNbr, liveUuid, sessionKey);
        await new Promise(resolve => setTimeout(resolve, 800));
        const encBirth = await getEncryptedField('Tk_rlno1', userInfo.rlno1, liveUuid, sessionKey);
        
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
        // const body = Object.entries(rawData)
        //     .map(([key, val]) => {
        //         const encodedVal = encodeURIComponent(val)
        //             .replace(/%20/g, '+')    // 모든 %20(공백)을 +로 치환
        //             .replace(/%2C/g, ',');   // %2C(콤마)는 다시 ,로 복구
        //         return `${key}=${encodedVal}`;
        //     })
        //     .join('&');

        // console.log(`\nPAYLOAD: ${body}`)

        const response = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`, rawData, {
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