const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const crypto = require('crypto');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const fs = require('fs');
const vm = require('vm');
const { v4: uuidv4 } = require('uuid');
const cheerio = require('cheerio');

const CONFIG = {
    startX: 55, startY: 40,
    btnW: 33, btnH: 34, gap: 4
};

const FIELD_CONFIGS = {
    'Tk_InqGjaNbr': { maxSize: '17', fieldType: 'text' },     // 계좌번호
    'Tk_GjaSctNbr': { maxSize: '4',  fieldType: 'password' }, // 비밀번호
    'Tk_rlno1':     { maxSize: '6',  fieldType: 'text' }      // 생년월일
};

const jar = new CookieJar();

// [변경] Fiddler/Charles 같은 로컬 프록시를 강제하지 않고 NH 서버에 직접 요청한다.
// [변경] proxy:false는 OS/환경변수 프록시가 axios에 자동 적용되는 것을 막기 위한 설정이다.
const client = axios.create({
    proxy: false,
    timeout: 30000
});

// [변경] axios 기본 쿠키 처리는 Node 환경에서 브라우저처럼 동작하지 않으므로
// [변경] tough-cookie jar에 Set-Cookie를 저장하고 다음 요청에 Cookie 헤더로 직접 넣는다.
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

const transkeyContext = {
    navigator: { userAgent: 'Mozilla/5.0 Chrome/123.0.0.0', appName: 'Netscape', plugins: [] },
    screen: { height: 1080, colorDepth: 24, availWidth: 1920, availHeight: 1040 },
    history: { length: 1 },
    console
};
// [변경] 농협 TransKey 구버전 JS의 SEED/RSA 구현을 Node VM 안에 로드한다.
// [변경] 최종 요청의 transkey_* 값은 이 구현과 같은 포맷이어야 서버가 복호화한다.
vm.createContext(transkeyContext);
vm.runInContext(fs.readFileSync('TranskeyLibPack_op.js', 'utf8'), transkeyContext);
transkeyContext.setMaxDigits(131);

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

        // OCR 결과가 중복될 수 있으므로, 먼저 잡힌 후보 좌표를 사용한다.
        const posName = posOptions[0]; 

        const match = posName.match(/(\d+)_(\d+)(?:\.png)?$/);
        if (!match) throw new Error(`[${fieldName}] ${posName}에서 좌표 파싱 실패`);

        const row = parseInt(match[1]);
        const col = parseInt(match[2]);

        // [변경] TransKey는 화면 절대좌표가 아니라 키패드 이미지 내부 offsetX/Y를 암호화한다.
        // [변경] 그래서 packetX/packetY가 아니라 sliceX/sliceY 기준의 상대좌표를 사용해야 한다.
        const centerX = CONFIG.startX + (col - 1) * (CONFIG.btnW + CONFIG.gap) + (CONFIG.btnW / 2);
        const centerY = CONFIG.startY + (row - 1) * (CONFIG.btnH + CONFIG.gap) + (CONFIG.btnH / 2);

        // [변경] 같은 키를 여러 번 눌러도 완전히 같은 좌표가 반복되지 않도록 버튼 내부에서 약간 흔든다.
        const offsetX = (Math.random() * 6) - 3; 
        const offsetY = (Math.random() * 6) - 3;

        const x = Math.floor(centerX + offsetX);
        const y = Math.floor(centerY + offsetY);

        numCoords.push({ char, x, y });
        
        console.log(`   - ${index + 1}번째 [${char}]: (${centerX}, ${centerY}) -> 랜덤 적용: (${x}, ${y})`);
    });

    if (numCoords.length !== numChars.length) {
        console.error(`🚨 [${fieldName}] 길이 불일치! 입력:${numChars.length}, 결과:${numCoords.length}`);
    }

    return numCoords;
}

function encryptTransKeyPacket(coords, sessionKey) {
    // [변경] 구버전 TransKey는 16진수 세션키 문자열의 각 nibble을 SEED 키 바이트처럼 사용한다.
    const seedKey = Array.from(sessionKey.slice(0, 16)).map(ch => Number(`0x0${ch}`));
    // [변경] 원본 JS의 고정 IV: ASCII "MobileTransKey10"
    const iv = [0x4d, 0x6f, 0x62, 0x69, 0x6c, 0x65, 0x54, 0x72, 0x61, 0x6e, 0x73, 0x4b, 0x65, 0x79, 0x31, 0x30];

    const encryptedBlocks = coords.map(c => {
        // [변경] 브라우저 TransKey가 실제로 암호화하는 평문은 "x y" 형태다.
        const geo = `${c.x} ${c.y}`;
        const inData = new Array(16).fill(0);
        const outData = new Array(16);
        const roundKey = new Array(32);

        for (let i = 0; i < geo.length; i++) {
            if (geo.charAt(i) === ' ') {
                inData[i] = geo.charCodeAt(i);
            } else {
                // [변경] 원본 JS와 동일하게 숫자 문자를 16진수 문자열로 변환한 값을 넣는다.
                inData[i] = Number(geo.charAt(i)).toString(16);
            }
        }
        // [변경] 원본 JS가 평문 뒤에 붙이는 고정 마커: space + "e"
        inData[geo.length] = 32;
        inData[geo.length + 1] = 101;

        transkeyContext.Seed.SeedSetKey(roundKey, seedKey);
        transkeyContext.Seed.SeedEncryptCbc(roundKey, iv, inData, 16, outData);

        return outData.map(byte => Number(byte).toString(16)).join(',');
    });

    return encryptedBlocks;
}

function encryptSessionKeyWithTranskey(exponentHex, modulusHex, sessionKey) {
    // [변경] 서버의 setSessionKey는 TransKey JS의 RSAKeyPair/encryptedString 결과를 기대한다.
    const rsaKey = new transkeyContext.RSAKeyPair(exponentHex, '', modulusHex);
    return transkeyContext.encryptedString(rsaKey, sessionKey);
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
    // 2. 블록 사이를 '공백( )'으로 구분해서 하나의 문자열로 합칩니다.
    const combinedValue = " " + blocks.join(' ');
    const encryptedPacket = combinedValue.replace(/%2B/g, '+');

    return encryptedPacket;
}

async function get_nhTransactions() {
    try {
        console.log('--- Step -1: 보안 세션 빌드업 (nhbank.html) ---');
        // 진짜 시작점인 nhbank.html에 먼저 접속하여 기본 쿠키들을 확보
        await client.get(`${BASE_URL}/nhbank.html`, 
            { headers: { ...COMMON_HEADERS, 'Referer': 'https://banking.nonghyup.com/' } }
        );

        console.log('--- Step 0: 첫 접속 (세션 및 쿠키 생성) ---');
        // 여기서 서버가 주는 첫 쿠키(SSID 등)를 자동으로 jar에 담습니다.
        const res = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`,
            '',
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/nhbank.html` } }
        );
        // 1. TOKEN 추출
        const tokenMatch = res.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const token = tokenMatch ? tokenMatch[1] : null;

        // 2. DEVICE_SESSION 추출
        const deviceSession = uuidv4();

        console.log(`✅ 토큰 획득 완료: ${token}`);
        console.log(`✅ 디바이스 세션 획득 완료: ${deviceSession}`);
        
        console.log('--- Step 1: RSA 공개키 획득 ---');
        // [변경] 농협 구버전 TransKey JS와 같은 엔드포인트/대소문자를 써야 공개키가 내려온다.
        const resRSA = await client.post(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRsaKey`, '',
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );
        const [exponent, modulus] = resRSA.data.split('||');
        if (!exponent || !modulus) {
            throw new Error(`RSA 공개키 응답 파싱 실패: ${String(resRSA.data).slice(0, 120)}`);
        }

        console.log('--- Step 2: 세션 키 등록 (UUID 바인딩) ---');
        // [변경] transkeyUuid와 sessionKey는 이후 키패드 load/allocate/암호화 패킷 전체에 같은 값을 사용한다.
        const liveUuid = crypto.randomBytes(20).toString('hex');
        const sessionKey = crypto.randomBytes(8).toString('hex');

        const liveKey = encryptSessionKeyWithTranskey(exponent, modulus, sessionKey); 

        await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${liveKey}&transkeyUuid=${liveUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );

        console.log('--- Step 3: 통합 페이로드 구성 및 전송 ---');

        const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));

        // [변경] 필드마다 현재 세션의 키패드 이미지를 새로 받아 OCR한 뒤 좌표 패킷을 만든다.
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

        const finalPayloadString = payload.toString();

        console.log(`\n✅ 최종 전송 PAYLOAD 구성 완료 (${finalPayloadString.length} bytes)`);

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

            const $ = cheerio.load(response.data);
            const transactions = [];

            // 테이블 선택자를 더 구체적으로 지정 (순번이 있는 테이블)
            $('table tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length >= 8) {
                    transactions.push({
                        "no": $(cells[0]).text().trim(),
                        "date": $(cells[1]).text().trim(),
                        "withdrawal": $(cells[2]).text().trim(),
                        "deposit": $(cells[3]).text().trim(),
                        "balance": $(cells[4]).text().trim(),
                        "description": $(cells[5]).text().trim(),
                        "record": $(cells[6]).text().trim(),
                        "branch": $(cells[7]).text().trim()
                    });
                }
            });

            fs.writeFileSync('transactions.json', JSON.stringify(transactions, null, 4), 'utf8');
            console.log(`✅ 성공! 총 ${transactions.length}건의 데이터를 저장했습니다.`);
                            
        } else {
            console.log('⚠️ 응답은 왔으나 조회가 되지 않았을 수 있습니다. HTML 확인 요망');
            fs.writeFileSync('result_balance.html', response.data);
        }
        
        
    } catch (err) {
        console.error('❌ 프로세스 실패:', err.message);
        if (err.response) {
            console.error('   status:', err.response.status);
            console.error('   content-type:', err.response.headers?.['content-type']);
            if (typeof err.response.data === 'string') {
                fs.writeFileSync('error_response.html', err.response.data);
                console.error('   응답 본문 저장: error_response.html');
                console.error('   응답 앞부분:', err.response.data.slice(0, 500).replace(/\s+/g, ' ').trim());
            }
        }
    }
}

get_nhTransactions();