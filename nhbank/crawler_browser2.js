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

                const fill = (id, val) => {
                    const el = document.getElementById(id);
                    if(el) {
                        el.value = val;
                        ['focus', 'keydown', 'input', 'keyup', 'change', 'blur'].forEach(t => 
                            el.dispatchEvent(new Event(t, { bubbles: true }))
                        );
                    }
                };

                const clickRadio = async (name, val) => {
                    const el = document.querySelector('input[name="' + name + '"][value="' + val + '"]');
                    if(el && el.offsetParent !== null) {
                        el.checked = true;
                        el.click();
                        await wait(800);
                    }
                };

                try {
                    // 1. 데이터 주입
                    await clickRadio('GjaGbn', data.acctDiv);
                    await clickRadio('InqGbn', data.searchDiv);
                    await clickRadio('InqGbn_2', data.order);

                    fill('InqGjaNbr', data.account);
                    fill('rlno1', data.birth);
                    fill('GjaSctNbr', data.password);

                    await wait(1000);

                    const setDate = (p, ds) => {
                        fill(p + '_year', ds.substring(0, 4));
                        fill(p + '_month', ds.substring(4, 6));
                        fill(p + '_date', ds.substring(6, 8));
                    };
                    setDate('start', data.InqDat);
                    setDate('end', data.InqEndDat);

                    await wait(1500);

                    // 2. 조회 버튼 클릭 (타겟팅 강화)
                    const searchBtn = document.getElementById('btn_search');
                    if (searchBtn) {
                        // 단순히 click()이 안될 때를 대비해 mousedown/mouseup 이벤트까지 발생
                        ['mousedown', 'click', 'mouseup'].forEach(ev => 
                            searchBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }))
                        );
                    } else {
                        throw new Error("조회 버튼을 찾을 수 없습니다.");
                    }

                    // 3. 서버에서 데이터를 가져와 화면이 갱신될 때까지 충분히 대기
                    // (이 부분이 너무 짧으면 결과 테이블이 뜨기 전의 HTML을 가져옵니다)
                    await wait(6000); 

                    // 4. 최종적으로 그려진 화면의 HTML 반환
                    return document.documentElement.outerHTML;

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