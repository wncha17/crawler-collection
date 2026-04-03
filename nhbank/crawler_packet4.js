const axios = require('axios');

// 1. 초기 설정: 브라우저와 동일한 환경을 시뮬레이션합니다.
const BASE_URL = 'https://banking.nonghyup.com';
const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    'Origin': BASE_URL,
    'Referer': `${BASE_URL}/servlet/IPMSP0011I.view`, // Referer 체크 대응
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'text/plain, */*; q=0.01',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};

// 최신 쿠키
const SESSION_COOKIE = 'EFIP_PT_SSID=NTIyMjAyMjktNzdiNy00MjJiLWI5YTQtMzBhOGE4YjgwMWI2;'; 

async function startSecuritySession() {
    try {
        console.log('--- Step 1: RSA 공개키 획득 ---');
        const resStep1 = await axios.get(`${BASE_URL}/servlet/transkeyServlet?op=getPublicRSAKey`, {
            headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE },
            responseType: 'text'
        });

        if (!resStep1.data || resStep1.data.length === 0) {
            console.log("경고: 서버에서 공개키를 주지 않았습니다. 기존 세션을 재사용합니다.");
            // 테스트를 위해 Fiddler에서 확인했던 Modulus를 임시로 넣을 수도 있습니다.
        } else {
            const parts = resStep1.data.split('||');
            const exponent = parts[0]; // 보통 10001
            const modulus = parts[1];
            console.log('추출된 Modulus:', modulus);
            
            // 이제 이 modulus와 exponent를 forge 라이브러리에 전달하여 암호화합니다.
        }
        // console.log('응답 헤더:', resStep1.headers);
        // console.log('응답 바디 길이:', resStep1.data.length);

        console.log('\n--- Step 2: 세션 키 설정 (Session Key Exchange) ---');
        // Fiddler(image_a617a6.png)에서 확인한 값을 테스트용으로 입력합니다.
        const testUuid = '5abe9371bf36d3145835037538ccf1bd2d0b0d0ade2010d79593b540ba5ccca9'; //
        const testKey = '422689fed7c11094a0d1c3032a25eb3705056eef4bf7ffc8bfdcbde604b4240bd261330b12eda20eb4b6f03d03b7cc47e750a322436047485f9391618796aa0b74382f011761e3cc335e5f1021fa35547b1629c4e436454857b4274d117d9d766ad1701ff8c98dbe5ccb2a5b761decc26247d5ef228488947317d3facee789dd'; //

        const resStep2 = await axios.post(`${BASE_URL}/servlet/transkeyServlet`, 
            `op=setSessionKey&key=${testKey}&transkeyUuid=${testUuid}`, 
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );
        console.log('세션키 설정 응답 상태:', resStep2.status); // 보통 200 OK와 빈 데이터가 옵니다.

        console.log('\n--- Step 3: 키패드 로드 (UUID 획득 시도) ---');
        // Step 2에서 사용한 UUID와 필드명(Tk_rlno1 등)을 일치시켜야 합니다.
        const params = new URLSearchParams({
            op: 'load',
            name: 'Tk_rlno1', // 주민번호 앞자리 예시
            keyboardType: 'number',
            fieldType: 'text',
            maxSize: '6',
            x: '0',
            y: '0',
            transkeyUuid: testUuid
        });

        const resStep3 = await axios.post(`${BASE_URL}/servlet/transkeyServlet`, 
            params.toString(), 
            { headers: { ...COMMON_HEADERS, 'Cookie': SESSION_COOKIE } }
        );

        // console.log('최종 응답 데이터:', resStep3.data); // 여기서 null이 아닌 <result> 스크립트가 나와야 성공입니다!
        
        const uuidMatch = resStep3.data.match(/transkeyUuid=([a-f0-9]{64})/);
        const liveUuid = uuidMatch ? uuidMatch[1] : null;

        if (!liveUuid) throw new Error("UUID를 획득하지 못했습니다.");
        console.log(`획득한 UUID: ${liveUuid}`);


    } catch (error) {
        console.error('오류 발생:', error.message);
        if (error.response) console.log('에러 상태:', error.response.status);
    }
}

startSecuritySession();