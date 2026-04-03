const axios = require('axios');
const fs = require('fs');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

async function crawlTransactions() {
    const jar = new CookieJar();
    const client = wrapper(axios.create({
        baseURL: 'https://banking.nonghyup.com',
        jar,
        withCredentials: true,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Origin': 'https://banking.nonghyup.com',
            'Accept': 'text/html, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Cookie': 'mainSetCookie=main_IP; mainSetCookie=main_IP; PCID=0c78485c-5837-2d88-fd7a-cadc3934c5cc-1774568756431; _n_session=17748261931842426013903; curSvcId=IPMSP0011I; acookie0=done0; EFIP_PT_SSID=NGY3OTM1YTQtMDQ3MS00MjY5LWE1MWYtNjNlNTA1ZDAzM2Ux; _n_seq=127; _n_dur=3; _n_cTime=1775188479189; _n_dfseq=127'
        }
    }));

    try {
        // STEP 1: 메인 페이지 접속하여 세션 쿠키 획득
        console.log("세션 연결 중...");
        await client.get('/servlet/IPMSP0011I.view', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"'
            }
        });


        const transkeyRes = await client.post('/servlet/transkeyServlet',
            'op=load&name=Tk_rlno1&keyboardType=number&fieldType=text&maxSize=6&x=0&y=0',
            { 
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': '*/*',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Referer': 'https://banking.nonghyup.com/servlet/IPMSP0011I.view',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
                } 
            }
        );

        // [자동화 단계 2] 응답 데이터에서 UUID 추출
        // 응답 문자열 내의 uuid 값을 따내기
        const uuidMatch = transkeyRes.data.match(/transkeyUuid=([a-f0-9]{64})/);
        const liveUuid = uuidMatch ? uuidMatch[1] : null;


        console.log("Status:", transkeyRes.status);
        console.log("Headers:", transkeyRes.headers);
        console.log("Data Type:", typeof transkeyRes.data);
        console.log("Data Length:", transkeyRes.data ? transkeyRes.data.length : 0);

        console.log(transkeyRes.data)

        if (!liveUuid) throw new Error("UUID를 획득하지 못했습니다.");
        console.log(`획득한 UUID: ${liveUuid}`);


        /*
        // STEP 2: 조회 요청 수행 (POST)
        const payload = new URLSearchParams("userIdDenyAutoComplete=&passwordDenyAutoComplete=&InqDat=20260320&EndDat=20260331&RnmNbr=&InqFdt=20260320&InqEndDat=20260331&Gbn_1=1&more=false&moreView=false&PagGbn=&InqChkGbn=&QckInqGbn=&lkg_acno_check_status=false&bas_am=&am_bascd=&lkg_acno=&tr_rec_sjt_srch_abr_nm=&GjaGbn=1&Tk_InqGjaNbr_check=direct&InqGjaNbr=3120226692471&transkey_Tk_InqGjaNbr=&Tk_GjaSctNbr_check=e2e&GjaSctNbr=0000&transkey_Tk_GjaSctNbr=&transkey_hMac_Tk_GjaSctNbr=&Tk_rlno1_check=e2e&rlno1=991202&transkey_Tk_rlno1=&InqGbn_2=2&InqGbn=1&start_year=2026&start_month=03&start_date=20&end_year=2026&end_month=03&end_date=31&bas_year=2026&bas_month=04&transkey_i=3&transkey_inputs=Tk_InqGjaNbr%3AInqGjaNbr%3Atext%2CTk_GjaSctNbr%3AGjaSctNbr%3Apassword%2CTk_rlno1%3Arlno1%3Atext&transkeyUuid=a111a16db816dce9072d584b266a6d9d04b09be913272b838e36b097b677372a&secure_view=Y&hid_key_data=3ec69538c0b5532b2d326e5b92bff054be4e9ede8010ae5e93461d70c0ffbd7e3af135e2b48f96214f1557c314e68793a2ef77494d5bb581f79e6989653412cc27415ecefdffe38342739b254115aa2df4bcf53d925d0f19269d82be38778227c8ad6b33c703642e8eb62ac364b374715a6fc87e1251b4636436c8b7fd0eb412980292d553276855f9390664d340061b5b82b0a522f6c77bf5326610f61d1d10f784b3085bb2115cbbd9a116c06941ff2eb1178255cae0b1042c41212d9eb9018591d029d252f12853dcb485647263d242a33974e3410b5ad8fb285a98576efe94fa301d4ef9c26fe3da3317e228427aff2d035c1f83247dfa802f6031264f6f&hid_enc_data=&E2E_passwordDenyAutoComplete=&E2E_GjaSctNbr=4df481ad1a82c1e54e5d9a4ea9ce1a254aaa056cd00fbefac1b70a5311b03f49836b9efbdf9ec727abab55d0331d5e3ca72974e1591c1c7a8275094a15a2863e&E2E_rlno1=63f144a5f323e58b10ab179b74bd8ab1930cbde2b770d1f923fdeda43cc5fb8ad98994c6c9b77e20c7f2d8a11beb2f0aff5153b3b16c7909073bd3b8054a4e4282f8cf273bcb9c31e33cccf7750f01d23282ef270b38354ad2657156b5be35a4&TOKEN=260401154222OEFIPINOPT0120906001&DEVICE_SESSION=d2e5f95c-e547-47fa-adc4-75a84266f09e&POP_WEB=true");
        // const userData = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));
        

        console.log("데이터 조회 요청 중...");
        const response = await client.post('servlet/IPMSP0012R.frag', payload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': 'https://banking.nonghyup.com/servlet/IPMSP0011I.view'
            }
        });

        if (response.status === 200) {
            console.log("조회 성공!");
            console.log(response.data);
        }

        */
    } catch (error) {
        console.error("오류 발생:", error.message);
    }
}

crawlTransactions();
