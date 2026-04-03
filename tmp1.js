const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');

// 1. Vivaldi 실행
const vivaldiPath = "C:\\Users\\wncha\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe";
const targetUrl = "https://banking.nonghyup.com/servlet/IPMSP0011I.view";
exec(`${vivaldiPath} --remote-debugging-port=9222 --auto-open-devtools-for-tabs ${targetUrl}`);

// 브라우저 9222 포트에서 WebSocket URL 가져오기
function getWsUrl() {
    return new Promise(resolve => {
        const interval = setInterval(() => {
            http.get('http://127.0.0.1:9222/json/list', res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    const tabs = JSON.parse(data);
                    const tab = tabs.find(t => t.url.includes('nonghyup')) || tabs[0];
                    if (tab && tab.webSocketDebuggerUrl) {
                        clearInterval(interval);
                        resolve(tab.webSocketDebuggerUrl);
                    }
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
        console.log("브라우저 연결 성공. 암호문 추출 중...");

        // 브라우저 내에서 암호화를 강제하고 값을 가져오는 스크립트
        const extractJS = `
            (function(data) {
                // 1. 기본 필드 입력
                const fill = (id, val) => {
                    const el = document.getElementById(id);
                    if(el) {
                        el.value = val;
                        // 값을 넣은 후 브라우저가 인식하도록 핵심 이벤트들을 순차적으로 발생시킴
                        ['input', 'change', 'blur'].forEach(type => 
                            el.dispatchEvent(new Event('blur', { bubbles: true }))
                        );
                    }
                };
                fill('InqGjaNbr', data.account);
                fill('GjaSctNbr', data.password);
                fill('rlno1', data.birth);

                // 2. 날짜 필드 주입
                const setDate = (prefix, dateStr) => {
                    const y = dateStr.substring(0, 4);
                    const m = dateStr.substring(4, 6);
                    const d = dateStr.substring(6, 8);
                    
                    fill(prefix + '_year', y);
                    fill(prefix + '_month', m);
                    fill(prefix + '_date', d);
                };
                setDate('start', data.InqDat);
                setDate('end', data.InqEndDat);

                // 지연 시간을 두고 순차적으로 실행하는 헬퍼 함수
                const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                // 3. 라디오 버튼 클릭 시뮬레이션 --> 수정 요망
                const clickRadio = (name, val) => {
                    const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
                    if(el) {
                        el.checked = true;
                        el.click();
                        await wait(300); // 페이지 스크립트 반응 시간 부여

                        // 이벤트 전파
                        ['click', 'change'].forEach(type =>
                            el.dispatchEvent(new Event(type, { bubbles: true }))
                        );
                    }
                };
                clickRadio('GjaGbn', data.acctDiv);
                clickRadio('InqGbn_2', data.order);
                clickRadio('InqGbn', data.searchDiv);


                // 보안 모듈이 연산할 시간을 잠시 준 뒤 값을 반환
                return new Promise(resolve => {
                    setTimeout(() => {
                        resolve({
                            encBirth: document.getElementsByName('E2E_rlno1')[0]?.value || '',
                            encPw: document.getElementsByName('E2E_GjaSctNbr')[0]?.value || ''
                        });
                    }, 1500);
                });
            })(${JSON.stringify(userData)})
        `;

        // CDP를 통해 실행
        ws.send(JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: { expression: extractJS, awaitPromise: true, returnByValue: true }
        }));

        ws.on('message', async (msg) => {
            const response = JSON.parse(msg);
            if (response.id === 1 && response.result.result.value) {
                const { encBirth, encPw } = response.result.result.value;
                console.log("암호문 획득 성공!");

                // --- 여기서부터 Axios 통신 ---
                const client = axios.create({
                    baseURL: 'https://banking.nonghyup.com',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': 'https://banking.nonghyup.com/nhbank.html'
                    }
                });

                const payload = new URLSearchParams();

                // ! 현재 데이터 입력이 제대로 안되는 상황 !
                payload.append('InqDat', userData.InqDat);
                payload.append('EndDat', userData.InqEndDat);
                payload.append('InqFDt', userData.InqDat);
                payload.append('InqEndDat', userData.InqEndDat);

                payload.append('GjaGbn', userData.acctDiv);
                payload.append('InqGjaNbr', userData.account);
                payload.append('E2E_GjaSctNbr', encPw);
                payload.append('E2E_rlno1', encBirth); 
                payload.append('InqGbn_2', userData.order);
                payload.append('InqGbn', userData.searchDiv);

                payload.append('start_year', userData.InqDat.substring(0, 4));
                payload.append('start_month', userData.InqDat.substring(4, 6));
                payload.append('start_date', userData.InqDat.substring(6, 8));
                payload.append('end_year', userData.InqEndDat.substring(0, 4));
                payload.append('end_month', userData.InqEndDat.substring(4, 6));
                payload.append('end_date', userData.InqEndDat.substring(6, 8));


                const serviceRes = await client.post('/servlet/IPMSP0011I.view', payload);
                console.log("서버 응답 코드:", serviceRes.status);
                fs.writeFileSync('result.html', serviceRes.data);
                process.exit();
            }
        });
    });
}

crawlTransactions();