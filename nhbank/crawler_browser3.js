const { exec } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const http = require('http');
const cheerio = require('cheerio');

const vivaldiPath = `"C:\\Users\\wncha\\AppData\\Local\\Vivaldi\\Application\\vivaldi.exe"`;
const targetUrl = "https://banking.nonghyup.com/servlet/IPMSP0011I.view";

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
        console.log("브라우저 연결 성공. 자동화 시작...");
        await new Promise(res => setTimeout(res, 3000));

        const extractJS = `
            (async function(data) {
                const wait = (ms) => new Promise(res => setTimeout(res, ms));

                const typeExactly = async (id, val) => {
                    const el = document.getElementById(id);
                    if(!el) return;
                    el.focus();
                    el.value = '';
                    await wait(200);
                    for (const char of val) {
                        const options = { key: char, charCode: char.charCodeAt(0), bubbles: true };
                        el.dispatchEvent(new KeyboardEvent('keydown', options));
                        document.execCommand('insertText', false, char);
                        el.dispatchEvent(new KeyboardEvent('keyup', options));
                        await wait(80); 
                    }
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.blur();
                    await wait(200);
                };

                try {
                    // 1. 라디오 버튼 클릭 핸들러 (onclick 함수 강제 실행)
                    const clickRadio = async (id) => {
                        const el = document.getElementById(id);
                        if(el) { el.click(); await wait(500); }
                    };
                    
                    // 스크린샷 기반 ID 사용: 전체(allAcin), 최근순(a1775001216827 등 - 상황에 맞게 조정)
                    await clickRadio('allAcin'); 

                    // 2. 보안 필드 정밀 타이핑 (암호화 유도)
                    await typeExactly('InqGjaNbr', data.account);
                    await typeExactly('rlno1', data.birth);      // 991202
                    await typeExactly('GjaSctNbr', data.password);

                    // 3. 날짜 필드 (가장 확실한 value 직접 주입 + 이벤트)
                    const setDate = async (p, ds) => {
                        const parts = [ds.substring(0, 4), ds.substring(4, 6), ds.substring(6, 8)];
                        const suffixes = ['_year', '_month', '_date'];
                        for(let i=0; i<3; i++) {
                            const el = document.getElementById(p + suffixes[i]);
                            if(el) { el.value = parts[i]; el.dispatchEvent(new Event('change', {bubbles:true})); }
                        }
                    };
                    await setDate('start', data.InqDat);
                    await setDate('end', data.InqEndDat);

                    await wait(1500); // 전체 암호화 완료 대기

                    // 4. 조회 버튼 클릭
                    const btn = document.getElementById('btn_search');
                    if(btn) btn.click();

                    await wait(7000); 
                    return document.documentElement.outerHTML;
                } catch(e) { return { error: e.message }; }
            })(${JSON.stringify(userData)})
        `;

        ws.send(JSON.stringify({
            id: 1,
            method: "Runtime.evaluate",
            params: { 
                expression: extractJS, 
                awaitPromise: true, 
                returnByValue: true 
            }
        }));

        ws.on('message', async (msg) => {
            const response = JSON.parse(msg);
            if (response.id === 1 && response.result.result.value) {
                const resultHTML = response.result.result.value;

                if (resultHTML.error) {
                    console.error("브라우저 실행 에러:", resultHTML.error);
                    return;
                }

                console.log("결과 페이지 획득 성공! 데이터 파싱 중...");

                // 5. 브라우저에서 가져온 HTML로 파싱 시작
                const $ = cheerio.load(resultHTML);
                const transactions = [];

                // 테이블 선택자를 더 구체적으로 지정 (순번이 있는 테이블)
                $('table tr').each((i, el) => {
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
                console.log(`성공! 총 ${transactions.length}건의 데이터를 저장했습니다.`);

                // 확인용으로 HTML 저장
                fs.writeFileSync('debug_result.html', resultHTML);
                process.exit();
            }
        });
    });
}

crawlTransactions();