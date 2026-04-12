const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const vm = require('vm');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');



const FIELD_CONFIGS = {
    'Tk_InqGjaNbr': { maxSize: '17', fieldType: 'text' },     // 계좌번호
    'Tk_GjaSctNbr': { maxSize: '4',  fieldType: 'password' }, // 비밀번호
    'Tk_rlno1':     { maxSize: '6',  fieldType: 'text' }      // 생년월일
};



const jar = new CookieJar();

// proxy: false는 OS/환경변수 프록시가 axios에 자동 적용되는 것을 막기 위한 설정이다.
const client = axios.create({
    proxy: false,
    timeout: 30000
});

// axios 기본 쿠키 처리는 Node 환경에서 브라우저처럼 동작하지 않으므로
// tough-cookie jar에 Set-Cookie를 저장하고 다음 요청에 Cookie 헤더로 직접 넣는다.
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
// 농협 TransKey 구버전 JS의 SEED/RSA 구현을 Node VM 안에 로드한다.
// 최종 요청의 transkey_* 값은 이 구현과 같은 포맷이어야 서버가 복호화한다.
vm.createContext(transkeyContext);
vm.runInContext(fs.readFileSync('TranskeyLibPack_op.js', 'utf8'), transkeyContext);
transkeyContext.setMaxDigits(131);






async function sliceKeypad(filename, fieldName) {
    const inputImage = filename;
    const outputDir = './slices';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    // 4행 4열 구조 (이미지의 숫자 배치 기준)
    // 1행: [비어있음, 8, 9, 0, 1] -> 실제론 사이드 버튼 제외하고 계산
    // 여기서는 0~9까지 10개 조각을 순서대로 따는 예시이다.

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

// 제미나이 해설 안 본 부분 다 보기








function encryptSessionKeyWithTranskey(exponentHex, modulusHex, sessionKey) {
    // 서버의 setSessionKey는 Transkey JS의 RSAKeyPair/encryptedString 결과를 기대한다.
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

    // A. 키패드 로드
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

    // B. 리소스 할당 (allocate)
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

    // C. 이미지 획득
    const resImage = await client.get(`${BASE_URL}/servlet/transkeyServlet`, {
        params: { op: 'singleLayout', name: fieldName, transkeyUuid: uuid, dummy: Date.now() },
        headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` },
        responseType: 'arraybuffer'
    });

    const imgPath = `keypad_${fieldName}.png`;
    fs.writeFileSync(imgPath, Buffer.from(resImage.data));

    // D. 이미지 분석
    await sliceKeypad(imgPath, fieldName);
    const keypadMap = await recognizeNumbers(fieldName);

    // E. 좌표 추출 및 암호화
    const coords = getNumCoordinates(value, keypadMap, fieldName);
    const blocks = encryptTranskeyPacket(coords, sessionKey);

    const combinedValue = " " + blocks.join(' ');
    const encryptedPacket = combinedValue.replace(/%2B/g, '+');

    return encryptedPacket;
}

async function get_nhTransactions() {
    try {
        // console.log('--- Step -1: 보안 세션 빌드업 (nhbank.html) ---');
        // // 시작점인 nhbank.html에 먼저 접속하여 기본 쿠키들을 확보한다.
        // await client.get(`${BASE_URL}/nhbank.html`, 
        //     { headers: { ...COMMON_HEADERS, 'Referer': 'https://banking.nonghyup.com/' } }
        // );

        console.log('--- Step 0: 첫 접속 (세션 및 쿠키 생성) ---');
        // 여기서 서버가 주는 첫 쿠키(SSID 등)를 자동으로 jar에 담는다.
        const res = await client.post(`${BASE_URL}/servlet/IPMSP0011I.view`, '',
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/nhbank.html` } }
        );
        // 1. TOKEN 추출
        const tokenMatch = res.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const token = tokenMatch ? tokenMatch[1] : null;
        // 2. DEVICE_SESSION 설정
        const deviceSession = uuidv4();

        console.log(`✅ 토큰 획득 완료: ${token}`);
        console.log(`✅ 디바이스 세션 획득 완료: ${deviceSession}`);

        console.log('--- Step 1: RSA 공개키 획득 ---');
        const resRSA = await client.post(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRsaKey`, '',
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );
        const [exponent, modulus] = resRSA.data.split('||');
        if (!exponent || !modulus) {
            throw new Error(`RSA 공개키 응답 파싱 실패: ${String(resRSA.data).slice(0, 120)}`);
        }

        console.log('--- Step 2: 세션 키 등록 (UUID 바인딩) ---');
        const liveUuid = crypto.randomBytes(20).toString('hex');
        const sessionKey = crypto.randomBytes(8).toString('hex');

        const liveKey = encryptSessionKeyWithTranskey(exponent, modulus, sessionKey);

        await client.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${liveKey}&transkeyUuid=${liveUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Referer': `${BASE_URL}/servlet/IPMSP0011I.view` } }
        );

        const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));
        
        // 필드마다 현재 세션의 키패드 이미지를 새로 받아 OCR한 뒤 좌표 패킷을 만든다.
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