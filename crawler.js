const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const readline = require('readline');

// 1. 사용자 정보 파일 읽기 함수
function loadUserInfo(filePath) {
    const info = {};
    const data = fs.readFileSync(filePath, 'utf-8');
    data.split('\n').forEach(line => {
        if (line.includes('=')) {
            const [key, value] = line.trim().split('=');
            info[key] = value;
        }
    });
    return info;
}

// 사용자 입력을 기다리는 함수 (Python의 input() 역할)
function waitForEnter(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function runAutomation() {
    const userData = loadUserInfo('user_info.txt');
    // 로그 메시지를 숨기는 옵션 설정
    let options = new chrome.Options();
    options.addArguments('--disable-logging'); // 로깅 비활성화
    options.addArguments('--log-level=3');      // 치명적 에러만 표시 (INFO, WARNING 무시)
    options.excludeSwitches('enable-logging'); // 개발자 도구 로그 제외

    const driver = await new Builder()
        .forBrowser('chrome')
        .setChromeOptions(options) // 옵션 적용
        .build();

    try {
        await driver.get("https://banking.nonghyup.com/servlet/IPMSP0011I.view");

        // [A] 자동 입력 구간
        await driver.sleep(2000);
        await driver.executeScript("var el = document.getElementById('SHOWBLOCK'); if(el) el.remove();");

        const acctInput = await driver.wait(until.elementLocated(By.name("InqGjaNbr")), 15000);
        await acctInput.sendKeys(userData['acct_no']);
        await driver.findElement(By.name("rlno1")).sendKeys(userData['birth']);
        console.log("\n✅ 계좌번호와 생년월일 입력 완료.");

        // [B] 사용자 직접 작업 구간
        console.log("-".repeat(50));
        console.log("1. 브라우저에서 '비밀번호 4자리'를 입력하세요.");
        console.log("2. 브라우저의 [조회] 버튼을 마우스로 '직접' 클릭하세요.");
        console.log("3. 화면에 거래내역 표가 나타나면, 이 터미널로 돌아와 'Enter'를 누르세요.");
        console.log("-".repeat(50));

        await waitForEnter("👉 조회가 완료되어 화면에 내역이 보이면 엔터를 누르세요: ");

        // [C] 모든 창과 프레임 전수 조사
        console.log("🔍 모든 창(Window)과 프레임(Iframe)을 뒤져서 데이터를 찾습니다...");

        let foundData = false;
        let htmlSource = "";
        const allWindows = await driver.getAllWindowHandles();

        for (const window of allWindows) {
            await driver.switchTo().window(window);
            
            const currentSource = await driver.getPageSource();
            if (currentSource.includes("tb_row") || currentSource.includes("거래일자")) {
                htmlSource = currentSource;
                foundData = true;
                break;
            }

            const frames = await driver.findElements(By.tagName("iframe"));
            for (const frame of frames) {
                try {
                    await driver.switchTo().frame(frame);
                    const frameSource = await driver.getPageSource();
                    if (frameSource.includes("tb_row") || frameSource.includes("거래일자")) {
                        htmlSource = frameSource;
                        foundData = true;
                        console.log("✅ 프레임 내부에서 데이터를 발견했습니다!");
                        break;
                    }
                } catch (e) {
                    // 무시
                } finally {
                    await driver.switchTo().defaultContent();
                }
            }
            if (foundData) break;
        }

        // [D] 결과 출력 및 저장
        if (foundData) {
            console.log("🎯 진짜 거래내역 데이터를 성공적으로 추출했습니다!");
            await parseAndSave(htmlSource);
        } else {
            console.log("⚠️ 모든 곳을 뒤졌지만 표를 찾지 못했습니다.");
        }

    } catch (error) {
        console.error(`❌ 오류 발생: ${error}`);
    } finally {
        await driver.sleep(5000);
        await driver.quit();
    }
}

async function parseAndSave(html) {
    const $ = cheerio.load(html);
    let table = $('table#listTable');

    if (table.length === 0) {
        $('table').each((i, el) => {
            if ($(el).text().includes("거래일자")) {
                table = $(el);
                return false;
            }
        });
    }

    if (table.length === 0) {
        console.log("⚠️ [오류] 거래내역 테이블을 찾지 못했습니다.");
        return;
    }

    const rows = table.find('tr');
    const jsonResult = [];

    rows.each((i, row) => {
        const cols = $(row).find('td'); // 데이터가 들어있는 td만 추출
        if (cols.length === 0) return; // 제목줄(th) 스킵

        // 각 칸의 텍스트를 배열로 담기 (공백 및 콤마 제거 전 원본 유지 후 가공)
        const rawTexts = cols.map((i, el) => $(el).text().trim()).get();
        
        // 첫 번째 칸이 숫자인지 확인 (순번 체크)
        if (!/^\d+$/.test(rawTexts[0])) return;

        // [핵심 로직] 인덱스가 꼬였으므로 텍스트 패턴으로 데이터 분류
        let item = {
            "순번": jsonResult.length + 1,
            "거래일시": "",
            "출금금액": "0원",
            "입금금액": "0원",
            "거래후잔액": "0원",
            "거래내용": "내용없음",
            "거래기록사항": "",
            "거래점": ""
        };

        // 이미지 구조 분석 기반 인덱스 재배치
        // 0:순번, 1:거래일시, 2:출금, 3:입금, 4:잔액, 5:내용, 6:기록, 7:지점
        
        // 1. 거래일시 (날짜와 시간 분리 추출 - 텍스트 내에서 패턴 추출)
        const dateTimeMatch = rawTexts[1].match(/\d{4}\/\d{2}\/\d{2}\s\d{2}:\d{2}:\d{2}/);
        item.거래일시 = dateTimeMatch ? dateTimeMatch[0] : rawTexts[1].split('\n')[0];

        // 2. 금액 필터링 함수
        const formatMoney = (val) => {
            if (!val || val.trim() === "") return "0원";
            const num = val.replace(/[^0-9]/g, '');
            return num ? `${Number(num).toLocaleString()}원` : "0원";
        };

        // 이미지의 컬럼 순서에 따른 강제 매핑
        item.출금금액 = formatMoney(rawTexts[2]);
        item.입금금액 = formatMoney(rawTexts[3]);
        item.거래후잔액 = formatMoney(rawTexts[4]);
        item.거래내용 = rawTexts[5] || "내용없음";
        item.거래기록사항 = rawTexts[6] || "";
        item.거래점 = rawTexts[7] || "정보없음";

        jsonResult.push(item);
    });

    console.log("\n🚀 [최종 보정] 추출된 거래내역 (JSON 형식):");
    if (jsonResult.length > 0) {
        console.log(JSON.stringify(jsonResult, null, 2));
        
        const filename = "nh_bank_history.csv";
        const header = "\ufeff순번,거래일시,출금금액,입금금액,거래후잔액,거래내용,거래기록사항,거래점\n";
        const csvRows = jsonResult.map(item => 
            `${item.순번},${item.거래일시},${item.출금금액},${item.입금금액},${item.거래후잔액},${item.거래내용},${item.거래기록사항},${item.거래점}`
        ).join('\n');
        
        fs.writeFileSync(filename, header + csvRows);
        console.log(`\n✅ CSV 저장 완료: ${filename}`);
    } else {
        console.log("⚠️ 유효한 데이터를 찾지 못했습니다.");
    }
}

runAutomation();