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
        
        const tokenMatch = mainPage.data.match(/window\[['"]TOKEN['"]\]\s*=\s*['"]([^'"]+)['"]/);
        const autoToken = tokenMatch ? tokenMatch[1] : null;

        // STEP 2: 조회 요청 (자동화된 Payload 구성)
        // const userInfo = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));
        const payload = new URLSearchParams();

        // 1. 기본 빈 값 필드
        payload.append('userIdDenyAutoComplete', '');
        payload.append('passwordDenyAutoComplete', '');
        payload.append('RnmNbr', '');
        payload.append('PagGbn', '');
        payload.append('InqChkGbn', '');
        payload.append('QckInqGbn', '');
        payload.append('bas_am', '');
        payload.append('am_bascd', '');
        payload.append('lkg_acno', '');
        payload.append('tr_rec_sjt_srch_abr_nm', '');
        payload.append('transkey_Tk_InqGjaNbr', '');
        payload.append('transkey_Tk_GjaSctNbr', '');
        payload.append('transkey_hMac_Tk_GjaSctNbr', '');
        payload.append('transkey_Tk_rlno1', '');
        payload.append('hid_enc_data', '');
        payload.append('E2E_passwordDenyAutoComplete', '');

        // 2. 조회 기간 및 날짜 설정
        payload.append('InqDat', '20260320');
        payload.append('EndDat', '20260331');
        payload.append('InqFdt', '20260320');
        payload.append('InqEndDat', '20260331');
        payload.append('start_year', '2026');
        payload.append('start_month', '03');
        payload.append('start_date', '20');
        payload.append('end_year', '2026');
        payload.append('end_month', '03');
        payload.append('end_date', '31');
        payload.append('bas_year', '2026');
        payload.append('bas_month', '04');

        // 3. 계좌 정보 및 인증 방식
        payload.append('InqGjaNbr', '3120226692471');
        payload.append('GjaSctNbr', '0000');
        payload.append('rlno1', '991202');
        payload.append('GjaGbn', '1');
        payload.append('InqGbn', '1');
        payload.append('InqGbn_2', '2');
        payload.append('Gbn_1', '1');
        payload.append('Tk_InqGjaNbr_check', 'direct');
        payload.append('Tk_GjaSctNbr_check', 'e2e');
        payload.append('Tk_rlno1_check', 'e2e');

        // 4. 보안 세션 및 토큰
        payload.append('TOKEN', autoToken); // 정규표현식으로 추출한 값 사용
        payload.append('DEVICE_SESSION', 'd2e5f95c-e547-47fa-adc4-75a84266f09e');
        payload.append('transkeyUuid', 'b5cec06a0e0d95c50917104ad34e0091b11a3d22acf4a2adc7c4acb943d3471a');
        payload.append('transkey_i', '3');
        payload.append('transkey_inputs', 'Tk_InqGjaNbr:InqGjaNbr:text,Tk_GjaSctNbr:GjaSctNbr:password,Tk_rlno1:rlno1:text');
        payload.append('secure_view', 'Y');
        payload.append('POP_WEB', 'true');

        // 5. 핵심 암호화 데이터
        payload.append('hid_key_data', '80899c2c828defcfebe7b7bbbe4f2d189bf55f7605d11850ff3720d31087bf2867c5350ba9de6d74cafd4483ca52af673735ada2c39320c8def7285be4bc18f9e9c0800454355c4debc9e063e3f53c40bcfb4f4aa95eaeba6b5b64005ac7da51e9ccd9338feb4063d107373d974d08c78ba55403bb37af24f8af2b0bc9097e5712f239ca23fa037dbb949891bbfe0ea036e66ad8e2e1fadbd5c7e4698c1840c30d1ca6f97f46fe7057a9a9b6f6b7a3bc8dfb93c5a3da1181019dcf02b1ebe7388ccdb69d0f00a5b7f5f3a3009e048af5395de4e8e3332257ae90e747da04970d3db559a0962a2d25ac21d224308aa945846fff9be859152381dbcead0ea1d39b');
        payload.append('E2E_GjaSctNbr', 'e862359e318b66664e7f4d190541898b256b416208dd3d6f29a3fa8571c69135bba8dcd3f65a85ac1d4a0a884a44f71d761c36f97a1392a70d54140ac47d587a');
        payload.append('E2E_rlno1', '5321e36ea8aaa7b548adb190f40ed3c1d4518240c61b7d83f80ede91b2f491acd19ca7ce8b869bb36d4fbaecf62b312757ab31bdbbb4d4c2e7045c09a53eb731312433a8decbd7c31dc6f774a6c647125ccfa585f0745da2a04b240c91896a04');
        
        // 6. 기타 옵션
        payload.append('more', 'false');
        payload.append('moreView', 'false');
        payload.append('lkg_acno_check_status', 'false');



        console.log("2. 거래 내역 조회 요청 중...");
        const response = await client.post('/servlet/IPMSP0012R.frag', payload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': 'https://banking.nonghyup.com/servlet/IPMSP0011I.view'
            }
        });

        if (response.status === 200){
            console.log(response.data);
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