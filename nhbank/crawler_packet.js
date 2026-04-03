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
            'Cookie': 'mainSetCookie=main_IP; EFIP_PT_SSID=NTRlOTE3MzUtY2FjMi00ZDMxLTkzZjYtNjljMzhjMDZhZDgz; acookie0=done0; mainSetCookie=main_IP; _n_session=17751327992732709136484; _n_dfseq=1; curSvcId=IPMSP0011I; PCID=59cd764b-0639-bd03-8f36-f31d901250e2-1775132799282; _n_dur=26; _n_cTime=1775132799300; _n_seq=1'
            }
    }));

    try {
        // STEP 1: 메인 페이지 접속하여 세션 쿠키 획득
        console.log("세션 연결 중...");
        await client.get('/servlet/IPMSP0011I.view');

        // STEP 2: 조회 요청 수행 (POST)
        const payload = new URLSearchParams("userIdDenyAutoComplete=&passwordDenyAutoComplete=&InqDat=20260320&EndDat=20260330&RnmNbr=&InqFdt=20260320&InqEndDat=20260330&Gbn_1=1&more=false&moreView=false&PagGbn=&InqChkGbn=&QckInqGbn=&lkg_acno_check_status=false&bas_am=&am_bascd=&lkg_acno=&tr_rec_sjt_srch_abr_nm=&GjaGbn=1&Tk_InqGjaNbr_check=direct&InqGjaNbr=3120226692471&transkey_Tk_InqGjaNbr=&Tk_GjaSctNbr_check=e2e&GjaSctNbr=0000&transkey_Tk_GjaSctNbr=&transkey_hMac_Tk_GjaSctNbr=&Tk_rlno1_check=e2e&rlno1=991202&transkey_Tk_rlno1=&InqGbn_2=2&InqGbn=1&start_year=2026&start_month=03&start_date=20&end_year=2026&end_month=03&end_date=30&bas_year=2026&bas_month=04&transkey_i=3&transkey_inputs=Tk_InqGjaNbr%3AInqGjaNbr%3Atext%2CTk_GjaSctNbr%3AGjaSctNbr%3Apassword%2CTk_rlno1%3Arlno1%3Atext&transkeyUuid=d4e506b87133dd2d2846377a8e5c1072518947f0ae775a44ac9b86a27716325e&secure_view=Y&hid_key_data=00938c1541d73697649aa1725f5ac1dac691907c0b377faea1db95391e535f061797da81975411c7707896a5890ded925d74c5b5a815d277c02154b897feefece9fd10be713615b5566b09e41f9d3498cb6c5f02f2a33395361e6b2ad5f27c2ab0147e2cc92e80c5f3a5454344044ebcc20347d44b8d756aa2857a10c2a8c6e5123945e8fb0778485ff0dd4ac8c3f18169fddacf5686bee3fb1540a86b1a595b435f863e4b5ba8226d3392ce3c421937da3d982748d7345c7f76ae0d828d513c9b732660f04503225c6a38b45ad4265273e0c06e13fd815e92a4898bac00362d290fc991ad8a07a9f55986d1caedb28e6a1d92cb4361ef5b3babf2fe6e2ac1e8&hid_enc_data=&E2E_passwordDenyAutoComplete=&E2E_GjaSctNbr=1d2e20c20b6c9602e98b24d41994e9a00a63e25a989adb8b64acc614a18e200341cdbaec90ae1b35dd386d956d0bbb6d815c827d6ea840aafc12595f9946ba97&E2E_rlno1=8c5a66bd5441422b44692a9674476bb46ae2c3d1648821e12ddd597527743a859d241746b713abd6b9b798c4d0a276a8dfd4713bb77f66b00ac146b3550da8b9d00e89fbe8585cb51e91ea2f3fbaef76f27d1e9163cd241b9a1725b63e2bacdc&TOKEN=260402212631OEFIPINOPT0161961901&DEVICE_SESSION=96f296cd-a665-4c80-bebd-5a5ea9e57dd1&POP_WEB=true");
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
    } catch (error) {
        console.error("오류 발생:", error.message);
    }
}

crawlTransactions();
