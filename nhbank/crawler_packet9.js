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

async function recognizeNumbers(fieldName) {
    const sliceDir = './slices';
    const refDir = './refs';
    
    // 1. 해당 필드(fieldName)로 시작하는 파일만 필터링합니다.
    const slices = fs.readdirSync(sliceDir).filter(f => 
        f.endsWith('.png') && f.startsWith(fieldName)
    );

    const refs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    // 정답지(Reference) 데이터 미리 로드
    const refImages = {};
    for (const num of refs) {
        refImages[num] = await readImage(`${refDir}/ref_${num}.png`);
    }

    console.log(`--- [${fieldName}] 숫자 인식 시작 ---`);
    const results = {};

    for (const sliceFile of slices) {
        const slicePath = `${sliceDir}/${sliceFile}`;
        const sliceImg = await readImage(slicePath);

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
            results[sliceFile] = null;
            console.log(`[${sliceFile}] 인식 결과: 알 수 없음 (빈 칸 혹은 로고)`);
        } else {
            results[sliceFile] = recognizedNum;
            console.log(`[${sliceFile}] 인식 결과: ${recognizedNum} (차이: ${minDiff}px)`);
        }

        // ⭐ 선택 사항: 인식이 끝난 개별 조각 파일을 삭제하여 폴더를 깨끗하게 유지합니다.
        // fs.unlinkSync(slicePath);
    }

    console.log(`\n--- [${fieldName}] 최종 키패드 맵 ---`);
    console.log(results);
    return results;
}

/**
 * @param {string} value - 사용자가 입력한 번호 (예: "1234")
 * @param {Object} keypadMap - recognizeNumbers()의 결과 (예: {'pos_1_1.png': 8, ...})
 */
function getNumCoordinates(value, keypadMap, fieldName) {
    const numCoords = [];
    const numChars = String(value).split('');

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

        const row = parseInt(match[1]); // 1-based
        const col = parseInt(match[2]); // 1-based

        // 좌표 계산 (CONFIG 값들이 정확한지 다시 한번 확인!)
        const x = Math.floor(CONFIG.startX + (col - 1) * CONFIG.gap + (CONFIG.btnW / 2));
        const y = Math.floor(CONFIG.startY + (row - 1) * CONFIG.gap + (CONFIG.btnH / 2));

        numCoords.push({ char, x, y });
        
        // 디버깅 로그: 각 자리수가 누락 없이 추가되는지 확인
        console.log(`  - ${index + 1}번째 자리 [${char}]: ${posName} -> (${x}, ${y})`);
    });

    if (numCoords.length !== numChars.length) {
        console.error(`🚨 [${fieldName}] 길이 불일치! 입력:${numChars.length}, 결과:${numCoords.length}`);
    }

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
    const coords = getNumCoordinates(value, keypadMap, fieldName);
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

        // 폼 데이터 직렬화
        // const body = Object.entries(rawData)
        //     .map(([key, val]) => {
        //         const encodedVal = encodeURIComponent(val)
        //             .replace(/%20/g, '+')    // 모든 %20(공백)을 +로 치환
        //             .replace(/%2C/g, ',');   // %2C(콤마)는 다시 ,로 복구
        //         return `${key}=${encodedVal}`;
        //     })
        //     .join('&');

        const finalPayloadString = payload.toString()
            .replace(/%2C/g, ',')   // 암호문 블록의 콤마(,) 복구
            .replace(/%3A/g, ':');  // transkey_inputs의 콜론(:) 복구

        console.log(`\n✅ 최종 전송 PAYLOAD: ${finalPayloadString}`);

        const response = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`, finalPayloadString, {
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