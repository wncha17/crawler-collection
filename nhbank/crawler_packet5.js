const axios = require('axios');
const forge = require('node-forge');
const crypto = require('crypto');

const BASE_URL = 'https://banking.nonghyup.com';
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/plain, */*; q=0.01'
};

// 최신 쿠키를 입력하세요.
const SESSION_COOKIE = 'mainSetCookie=main_IP; mainSetCookie=main_IP; PCID=474a5c82-1a76-c776-50d2-6dea2d61597a-1774957310344; acookie0=done0; EFIP_PT_SSID=NzU1ZjJjNzQtNTE2ZC00ZDI2LWFjNjgtYzA1MWM1MGZhNmMy; _n_session=17752813075539787592069; curSvcId=IPMSP0011I; _n_dfseq=4; _n_dur=13; _n_cTime=1775283228969; _n_seq=4'; 

// 1. RSA 암호화 함수 (testKey 생성용)
function encryptSessionKey(modulusHex, exponentHex) {
    // 서버와 약속할 랜덤 세션키 생성 (16진수 문자열)
    const sessionKey = crypto.randomBytes(16).toString('hex');
    console.log('생성된 원본 세션키:', sessionKey);

    const publicKey = forge.pki.setRsaPublicKey(
        new forge.jsbn.BigInteger(modulusHex, 16),
        new forge.jsbn.BigInteger(exponentHex, 16)
    );

    // RSAES-PKCS1-v1_5 방식으로 암호화
    const encrypted = publicKey.encrypt(sessionKey, 'RSAES-PKCS1-V1_5');
    return forge.util.bytesToHex(encrypted);
}

async function startSecuritySession() {
    try {
        console.log('--- Step 0: TOKEN 추출 ---');
        const resStep0 = await axios.get(`${BASE_URL}/servlet/IPMSP0011I.view`,
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );

        const tokenMatch = resStep0.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const autoToken = tokenMatch ? tokenMatch[1] : null;
        if (!autoToken) throw new Error("TOKEN을 획득하지 못했습니다.");
        console.log(`획득한 TOKEN: ${autoToken}`);

        console.log('\n--- Step 1: RSA 공개키 획득 및 수동 대입 ---');
        const resStep1 = await axios.get(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRSAKey`,
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );

        let modulus, exponent;
        if (!resStep1.data || resStep1.data.length === 0) {
            console.log("서버 응답 없음: Fiddler의 값을 수동 대입합니다.");
            exponent = "10001";
            // [중요] image_a61769.png 하단 'Response Body'에 있는 bec6bd...로 시작하는 긴 문자열을 복사해 넣으세요.
            modulus = "bec6bdcd79a4aaee8fa6cf02fb3482271521ba902229bce5688ecbbdc823de11cf2fff94e27ebb6b906a880c9189db4487542922380a345af41d97b8a6e3e6c3c7bd9e5da251494754098d3afe58dfb42ab1424c7b9dd37aa310b3854ab4de5d51ecea6b2afa8a3ee1c9bac50f58aaae2eee0901e435024c46b772d9857f6be5"; 
        } else {
            [exponent, modulus] = resStep1.data.split('||');
            console.log("서버로부터 공개키를 새로 받았습니다.");
        }

        console.log('\n--- Step 2: 동적 세션 키 및 UUID 생성 ---');
        const liveUuid = crypto.randomBytes(32).toString('hex');
        const liveKey = encryptSessionKey(modulus, exponent);
        
        console.log(`생성된 UUID: ${liveUuid}`);
        console.log(`암호화된 liveKey (일부): ${liveKey.substring(0, 30)}...`);

        const resStep2 = await axios.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${liveKey}&transkeyUuid=${liveUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );
        console.log('세션키 설정 응답 상태:', resStep2.status);

        console.log('\n--- Step 3: 키패드 로드 (최종 확인) ---');
        const params = new URLSearchParams({
            op: 'load',
            name: 'Tk_rlno1',
            keyboardType: 'number',
            fieldType: 'text',
            maxSize: '6',
            x: '0',
            y: '0',
            transkeyUuid: liveUuid
        });

        const resStep3 = await axios.post(`${BASE_URL}/servlet/transkeyServlet`, 
            params.toString(), 
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );

        let liveUuid2 = null;
        if (resStep3.data.includes('transkeyUuid=' + liveUuid)) {
            console.log('🎉 성공: 서버가 우리가 만든 동적 키와 UUID를 수락했습니다!');
            // console.log('전체 응답:', resStep3.data);
            const uuidMatch = resStep3.data.match(/transkeyUuid=([a-f0-9]{64})/);
            liveUuid2 = uuidMatch ? uuidMatch[1] : null;

            if (!liveUuid2) throw new Error("UUID를 획득하지 못했습니다.");
            console.log(`획득한 UUID: ${liveUuid2}`);
        } else {
            console.log('실패: UUID가 일치하지 않거나 세션이 거부되었습니다.');
        }

        console.log('\n--- Step 4: 키패드 이미지(Layout) 데이터 획득 ---');
        // op=getLayout은 실제 키패드 이미지와 버튼 좌표 정보를 가져옵니다.
        const resStep4 = await axios.get(`${BASE_URL}/servlet/transkeyServlet`, {
            params: {
                op: 'singleLayout',
                name: 'Tk_rlno1', //
                transkeyUuid: liveUuid2, // 서버에서 확정해준 UUID 사용
                keyboardType: 'number',
                dummy: '1396405611',
                fieldType: 'text',
                keyType: '1'
            },
            headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE },
            responseType: 'arraybuffer' // 이미지는 바이너리 데이터이므로 arraybuffer로 받습니다.
        });

        if (resStep4.status === 200) {
            console.log('✅ 이미지 레이아웃 획득 성공! 데이터 크기:', resStep4.data.byteLength);
            // fs.writeFileSync('keypad.png', Buffer.from(resStep4.data)); // 파일로 저장해서 확인 가능합니다.
            require('fs').writeFileSync('keypad_view.png', Buffer.from(resStep4.data));
        }

    } catch (error) {
        console.error('오류 발생:', error.message);
    }
}

startSecuritySession();