const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

async function automateNonghyup() {
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
            // 'Cookie': 'mainSetCookie=main_IP; PCID=71c29d65-2bc4-68ce-2bec-fc98c4da26b2-1774859233948; acookie0=done0; mainSetCookie=main_IP; _n_session=17749991681634876366829; curSvcId=IPMSP0011I; EFIP_PT_SSID=NjgxZjEyYmEtMjY4Mi00MGMwLWJjMmQtNTM2NjFkYmY0ZTEw; _n_seq=16; _n_dur=4; _n_cTime=1775025745517; _n_dfseq=16'
        }
    }));

    try {
        // STEP 1: 세션 초기화 및 TOKEN 추출
        console.log("1. 금융 세션 연결 및 토큰 추출 중...");
        const mainPage = await client.get('/servlet/IPMSP0011I.view');
        console.log(mainPage.data);


        /*
        const tokenMatch = mainPage.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const autoToken = tokenMatch ? tokenMatch[1] : null;

        // STEP 2: 조회 요청 (자동화된 Payload 구성)
        // const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));
        const payload = new URLSearchParams();

        // 1. 기본 빈 값 필드
        payload.append('userIdDenyAutoComplete', '');
        payload.append('passwordDenyAutoComplete', '');
        payload.append('InqDat', '20260320');
        payload.append('EndDat', '20260330');
        payload.append('RnmNbr', '');
        payload.append('InqFdt', '20260320');
        payload.append('InqEndDat', '20260330');
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
        payload.append('Tk_InqGjaNbr_check', 'direct');
        payload.append('InqGjaNbr', '3120226692471');
        payload.append('transkey_Tk_InqGjaNbr', '');
        payload.append('Tk_GjaSctNbr_check', 'e2e');
        payload.append('GjaSctNbr', '0000');
        payload.append('transkey_Tk_GjaSctNbr', '');
        payload.append('transkey_hMac_Tk_GjaSctNbr', '');
        payload.append('Tk_rlno1_check', 'e2e');
        payload.append('rlno1', '991202');
        payload.append('transkey_Tk_rlno1', '');
        payload.append('InqGbn_2', '2');
        payload.append('InqGbn', '1');
        payload.append('start_year', '2026');
        payload.append('start_month', '03');
        payload.append('start_date', '20');
        payload.append('end_year', '2026');
        payload.append('end_month', '03');
        payload.append('end_date', '30');
        payload.append('bas_year', '2026');
        payload.append('bas_month', '04');
        payload.append('transkey_i', '3');
        payload.append('transkey_inputs', 'Tk_InqGjaNbr:InqGjaNbr:text,Tk_GjaSctNbr:GjaSctNbr:password,Tk_rlno1:rlno1:text');
        payload.append('transkeyUuid', 'd4e506b87133dd2d2846377a8e5c1072518947f0ae775a44ac9b86a27716325e');
        payload.append('secure_view', 'Y');
        payload.append('hid_key_data', '00938c1541d73697649aa1725f5ac1dac691907c0b377faea1db95391e535f061797da81975411c7707896a5890ded925d74c5b5a815d277c02154b897feefece9fd10be713615b5566b09e41f9d3498cb6c5f02f2a33395361e6b2ad5f27c2ab0147e2cc92e80c5f3a5454344044ebcc20347d44b8d756aa2857a10c2a8c6e5123945e8fb0778485ff0dd4ac8c3f18169fddacf5686bee3fb1540a86b1a595b435f863e4b5ba8226d3392ce3c421937da3d982748d7345c7f76ae0d828d513c9b732660f04503225c6a38b45ad4265273e0c06e13fd815e92a4898bac00362d290fc991ad8a07a9f55986d1caedb28e6a1d92cb4361ef5b3babf2fe6e2ac1e8');
        payload.append('hid_enc_data', '');
        payload.append('E2E_passwordDenyAutoComplete', '');
        payload.append('E2E_GjaSctNbr', '1d2e20c20b6c9602e98b24d41994e9a00a63e25a989adb8b64acc614a18e200341cdbaec90ae1b35dd386d956d0bbb6d815c827d6ea840aafc12595f9946ba97');
        payload.append('E2E_rlno1', '8c5a66bd5441422b44692a9674476bb46ae2c3d1648821e12ddd597527743a859d241746b713abd6b9b798c4d0a276a8dfd4713bb77f66b00ac146b3550da8b9d00e89fbe8585cb51e91ea2f3fbaef76f27d1e9163cd241b9a1725b63e2bacdc');
        payload.append('TOKEN', '260402212631OEFIPINOPT0161961901');
        payload.append('DEVICE_SESSION', '96f296cd-a665-4c80-bebd-5a5ea9e57dd1');
        payload.append('POP_WEB', 'true');



        console.log("2. 거래 내역 조회 요청 중...");
        const response = await client.post('/servlet/IPMSP0012R.frag', payload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': 'https://banking.nonghyup.com/servlet/IPMSP0011I.view'
            }
        });

        if (response.status === 200){
            console.log(response.data);
            console.log("거래 내역 조회 성공!");
            console.log(await jar.getSetCookieStrings('https://banking.nonghyup.com'));
        }
        

        /*
        // STEP 3: HTML 데이터 파싱 (Cheerio)
        if (response.data.includes('거래일시')) {
            console.log("3. 데이터 파싱 시작...");
            const $ = cheerio.load(response.data);
            const transactions = [];

            // 테이블의 각 행(tr)을 돌며 데이터를 추출합니다.
            $('table tbody tr').each((i, el) => {
                const cols = $(el).find('td');
                if (cols.length > 0) {
                    transactions.push({
                        date: $(cols[1]).text().trim(),      // 거래일시
                        withdrawal: $(cols[2]).text().trim(), // 출금금액
                        deposit: $(cols[3]).text().trim(),    // 입금금액
                        balance: $(cols[4]).text().trim(),    // 거래후잔액
                        desc: $(cols[5]).text().trim()        // 거래내용
                    });
                }
            });

            console.table(transactions); // 결과를 표 형태로 출력
            console.log(`총 ${transactions.length}건의 내역을 성공적으로 가져왔습니다.`);
        } else {
            console.log("⚠️ 조회 결과가 없거나 형식이 다릅니다.");
        }
        */

    } catch (error) {
        console.error("❌ 오류 발생:", error.message);
    }
}

automateNonghyup();