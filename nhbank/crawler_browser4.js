const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

const vivaldiPath = `"C:\\Users\\wncha\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe"`;
const targetUrl = "https://banking.nonghyup.com/servlet/IPMSP0011I.view";

// 1. 실행 옵션에 개발자 도구 자동 열기 추가
exec(`${vivaldiPath} --remote-debugging-port=9222 --auto-open-devtools-for-tabs ${targetUrl}`);

function getWsUrl() {
    return new Promise(resolve => {
        const interval = setInterval(() => {
            http.get('http://127.0.0.1:9222/json/list', res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const tabs = JSON.parse(data);
                        const tab = tabs.find(t => t.url.includes('nonghyup')) || tabs[0];
                        if (tab && tab.webSocketDebuggerUrl) {
                            clearInterval(interval);
                            resolve(tab.webSocketDebuggerUrl);
                        }
                    } catch (e) {}
                });
            }).on('error', () => {});
        }, 1000);
    });
}

async function crawlTransactions() {
    const userData = JSON.parse(fs.readFileSync('user_info.json', 'utf8'));
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);

    ws.on('open', async () => {
        console.log("브라우저 연결 성공. 데이터 주입 및 조회 시작...");
        await new Promise(res => setTimeout(res, 3000));

        const extractJS = `
            (async function(data) {
                const wait = (ms) => new Promise(res => setTimeout(res, ms));

                const fill = (id, val) => {
                    const el = document.getElementById(id);
                    if(el) {
                        el.value = val;
                        ['input', 'change', 'blur'].forEach(t => 
                            el.dispatchEvent(new Event(t, { bubbles: true }))
                        );
                    }
                };

                const clickRadio = async (name, val) => {
                    const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
                    if(el && el.offsetParent !== null) {
                        el.checked = true;
                        el.click();
                        // el.dispatchEvent(new Event('change', { bubbles: true }));
                        await wait(500);
                    }
                };

                try {
                    // 순차적으로 입력 (순서가 꼬이면 탭이 사라지거나 에러 발생)
                    await clickRadio('GjaGbn', data.acctDiv);
                    await clickRadio('InqGbn', data.searchDiv);
                    await clickRadio('InqGbn_2', data.order);

                    fill('InqGjaNbr', data.account);
                    fill('rlno1', data.birth);
                    fill('GjaSctNbr', data.password);

                    const setDate = (p, ds) => {
                        fill(p + '_year', ds.substring(0, 4));
                        fill(p + '_month', ds.substring(4, 6));
                        fill(p + '_date', ds.substring(6, 8));
                    };
                    setDate('start', data.InqDat);
                    setDate('end', data.InqEndDat);

                    await wait(2000);

                    const encData = {
                        encBirth: document.getElementsByName('E2E_rlno1')[0]?.value || '',
                        encPw: document.getElementsByName('E2E_GjaSctNbr')[0]?.value || ''
                    };

                    // 조회 버튼 클릭
                    const searchBtn = document.querySelector('button.btn_search, .btn_area button, #searchBtn')
                                    || Array.from(document.querySelectorAll('span')).find(el => el.textContent === '조회')?.parentElement;

                    if (searchBtn) {
                        searchBtn.click();
                        await wait(3000);
                    } else {
                        throw new Error("조회 버튼을 찾을 수 없습니다.");    
                    }

                    return {
                        encData,
                        html: document.documentElement.outerHTML    
                    };
                } catch(e) {
                    return { error: e.message };
                }
            })(${JSON.stringify(userData)})
        `;

        ws.send(JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: { 
                expression: extractJS, 
                awaitPromise: true, // 내부 Promise 완료 대기 필수
                returnByValue: true 
            }
        }));

        ws.on('message', async (msg) => {
            const response = JSON.parse(msg);
            if (response.id === 1 && response.result.result.value) {
                const result = response.result.result.value;
                if (result.error) {
                    console.error("브라우저 에러:", result.error);
                    return;
                }
                
                console.log("암호문 획득 성공! Axios 전송 중...");
                
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

                    // 1. 기본 설정 및 빈 값 필드
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

                    // 2. 조회 기간 설정 (2026-03-20 ~ 2026-03-31)
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

                    // 3. 계좌 및 인증 정보
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

                    // 4. 보안 및 세션 토큰 (Uuid와 TOKEN이 이번 패킷의 핵심입니다)
                    payload.append('transkeyUuid', '6d33270df27e7bb99756eb3c1da06f3c1fab0a2949c0b3fdc54f0840a1db8c33');
                    payload.append('TOKEN', '260401172018OEFIPINOPT0039828601'); 
                    payload.append('DEVICE_SESSION', 'd2e5f95c-e547-47fa-adc4-75a84266f09e');
                    payload.append('transkey_i', '3');
                    payload.append('transkey_inputs', 'Tk_InqGjaNbr:InqGjaNbr:text,Tk_GjaSctNbr:GjaSctNbr:password,Tk_rlno1:rlno1:text');
                    payload.append('secure_view', 'Y');
                    payload.append('POP_WEB', 'true');

                    // 5. 핵심 암호화 데이터 (E2E 세트)
                    payload.append('hid_key_data', '4ba881ffc4cf1c8cad5a5cfa2c8916a2e91c7588eaef1876eef2567c8d7235fb3b3d98b3153758003c2fa7c5e514b7412c13fd20b8f7142d5913496abe247c862eafa9eea540e51e302b3e55e55b42f25257dd67fbb000c3badf27d0e3f8ed592bd019a088db5063f95575a976182449b14fea64b067b56eeea3bcd68fdaa7a0f0ca9c8e2fe989e1e36edcf1220eb63b9219408983180096e72d21f0c359ca52036141ba9a4c697fce8c260d7e956e82418864a73b3f9d8f90ba7163b16dab67ce990ff3fbc6bc67371abcce3acd0e3e35ffc7b742f3f02c3d7166b27f162d2ff1f40a7ee0a6db662ef3cb57732161aac2feca874fe521709a90dea098b2807a');
                    payload.append('E2E_GjaSctNbr', '3985a89b08a88e0789b55dec5aafb774635c33d80164febdda9026d0469a314d543fee13228c7ccfd6081df0888a6d3fb837d758e0e2171aec59f2527f03b7a8');
                    payload.append('E2E_rlno1', '6a56c0a330abbab20f9335d3dfb6ee6c7009ef4d8454d44044342d311dcfbb4add11d02b2ecb3b978fa4ad7bd1a4b12390f4c81a183062bcb5c39ba093578ea8545bf3d53dec6591961556473cdaa11ce8f9ec0e3350a879129a485f98c6e844');

                    // 6. 기타 옵션 필드
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
                } catch (error) {
                    console.error("❌ 오류 발생:", error.message);
                }
            }
        });
    });
}

crawlTransactions();