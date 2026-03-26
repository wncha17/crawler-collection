const axios = require('axios');
const fs = require('fs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

async function getLoginInfo(filePath) {
    // 파일에서 아이디/비번 읽기
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    const userId = lines[0].split(': ').pop().trim();
    const userPw = lines[1].split(': ').pop().trim();
    return { userId, userPw };
}

async function crawlBbqCart() {
    // 쿠키 저장소 생성
    const jar = new CookieJar();
    // 1. Axios 인스턴스 생성 (Python의 requests.Session() 역할)
    const client = wrapper(axios.create({
        baseURL: 'https://bbq.co.kr',
        jar,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Origin': 'https://bbq.co.kr',
            'Referer': 'https://bbq.co.kr/member/login'
        }
    }));

    try {
        // STEP 0: CSRF 토큰 획득
        await client.get('/member/login');
        const csrfRes = await client.get('/api/auth/csrf');
        const csrfToken = csrfRes.data.csrfToken;

        // STEP 1: 로그인 수행
        const { userId, userPw } = await getLoginInfo('login_info.txt');

        // URLSearchParams로 urlencoded 형식을 만들기
        const loginPayload = new URLSearchParams();
        loginPayload.append('username', userId);
        loginPayload.append('password', userPw);
        loginPayload.append('csrfToken', csrfToken);
        loginPayload.append('redirect', 'false');
        loginPayload.append('callbackUrl', 'https://bbq.co.kr/member/login');
        loginPayload.append('json', 'true');

        const loginRes = await client.post('/api/auth/callback/member', loginPayload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (loginRes.status === 200) {
            console.log("로그인 성공!");

            // STEP 3: 장바구니 데이터 가져오기
            const cartPayload = {
                branchId: "", mealType: "DELIVERY", 
                latitude: 37.388291, longitude: 126.971175,
                legalDongId: "4117310300", administrativeDongId: "4117357800",
                ecouponList: []
            };

            const cartRes = await client.post('/api/delivery/cart/list', cartPayload, {
                headers: { 'Content-Type': 'application/json' }
            });

            // 데이터 가공
            const finalOutput = cartRes.data.responseList.map(menu => {
                const item = {
                    "상품명": menu.mainMenuName,
                    "기본가격": `${menu.price.toLocaleString()}원`,
                    "선택옵션": [],
                    "수량": `${menu.quantity}개`,
                    "주문금액": `${menu.totalMenuWithSubOptionAndQuantityPrice.toLocaleString()}원`
                };

                menu.subOptionHeadList.forEach(head => {
                    head.subOptionDetailList.forEach(detail => {
                        item["선택옵션"].push({
                            "옵션명": `${head.subOptionName}: ${detail.subOptionDetailName}`,
                            "추가가격": `${detail.price.toLocaleString()}원`
                        });
                    });
                });
                return item;
            });

            console.log(JSON.stringify(finalOutput, null, 4));
        }
    } catch (error) {
        console.error("오류 발생: ", error.message);
    }
}

crawlBbqCart();