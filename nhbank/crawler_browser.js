const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const cheerio = require('cheerio');

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
                
                const client = axios.create({
                    baseURL: 'https://banking.nonghyup.com',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': 'https://banking.nonghyup.com/nhbank.html'
                    }
                });

                const payload = new URLSearchParams();
                payload.append('InqDat', userData.InqDat);
                payload.append('EndDat', userData.InqEndDat);
                payload.append('InqFDt', userData.InqDat);
                payload.append('InqEndDat', userData.InqEndDat);
                payload.append('GjaGbn', userData.acctDiv);
                payload.append('InqGjaNbr', userData.account);
                payload.append('E2E_GjaSctNbr', result.encPw); // 암호문 사용
                payload.append('E2E_rlno1', result.encBirth); // 암호문 사용
                payload.append('InqGbn_2', userData.order);
                payload.append('InqGbn', userData.searchDiv);
                payload.append('start_year', userData.InqDat.substring(0, 4));
                payload.append('start_month', userData.InqDat.substring(4, 6));
                payload.append('start_date', userData.InqDat.substring(6, 8));
                payload.append('end_year', userData.InqEndDat.substring(0, 4));
                payload.append('end_month', userData.InqEndDat.substring(4, 6));
                payload.append('end_date', userData.InqEndDat.substring(6, 8));

                const serviceRes = await client.post('/servlet/IPMSP0011I.view', payload);
                console.log("서버 응답:", serviceRes.status);

                // 1. HTML 데이터 로드
                const $ = cheerio.load(serviceRes.data);
                const transactions = [];

                // 2. 테이블 행(tr) 순회
                $('table.listTable tbody tr, table tr').each((i, el) => {
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
                console.log(`총 ${transactions.length}건의 거래내역을 저장했습니다.`);

                fs.writeFileSync('result.html', serviceRes.data);
                process.exit();
            }
        });
    });
}

crawlTransactions();