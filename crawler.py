import time, csv, os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from bs4 import BeautifulSoup

# 1. 사용자 정보 파일 읽기 함수
def load_user_info(file_path):
    info = {}
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            if '=' in line:
                key, value = line.strip().split('=')
                info[key] = value
    return info


def get_val_safe(driver, name):
    """요소를 찾지 못해도 에러 대신 빈 문자열을 반환하는 안전 함수"""
    try:
        # 1. 먼저 input 태그에서 값을 찾아보기
        element = driver.find_element(By.NAME, name)
        return element.get_attribute("value")
    except:
        try:
            # 2. 태그가 없다면 자바스크립트 변수에서 직접 꺼내보기
            return driver.execute_script(f'return window["{name}"];')
        except:
            return ""
        
    
def run_automation():
    user_data = load_user_info('user_info.txt')
    driver = webdriver.Chrome()
    wait = WebDriverWait(driver, 15)

    driver.get("https://banking.nonghyup.com/servlet/IPMSP0011I.view")

    try:
        # [A] 자동 입력 구간
        time.sleep(2)
        driver.execute_script("var el = document.getElementById('SHOWBLOCK'); if(el) el.remove();")

        acct_input = wait.until(EC.element_to_be_clickable((By.NAME, "InqGjaNbr")))
        acct_input.send_keys(user_data['acct_no'])
        driver.find_element(By.NAME, "rlno1").send_keys(user_data['birth'])
        print("\n✅ 계좌번호와 생년월일 입력 완료.")

        # [B] 사용자 직접 작업 구간
        print("-" * 50)
        print("1. 브라우저에서 '비밀번호 4자리'를 입력하세요.")
        print("2. 브라우저의 [조회] 버튼을 마우스로 '직접' 클릭하세요.")
        print("3. 화면에 거래내역 표가 나타나면, 이 터미널로 돌아와 'Enter'를 누르세요.")
        print("-" * 50)

        input("👉 조회가 완료되어 화면에 내역이 보이면 엔터를 누르세요: ")

        # [C] 모든 창과 프레임에서 진짜 데이터 긁어오기
        print("🔍 모든 창(Window)과 프레임(Iframe)을 뒤져서 데이터를 찾습니다...")

        found_data = False
        all_windows = driver.window_handles

        for window in all_windows:
            driver.switch_to.window(window) # 창 전환
            
            # 현재 창에서 프레임들 조사
            frames = driver.find_elements(By.TAG_NAME, "iframe")
            # 메인 컨텐츠(프레임 밖) 먼저 확인
            if "tb_row" in driver.page_source or "거래일자" in driver.page_source:
                html_source = driver.page_source
                found_data = True
                break
                
            # 각 프레임 내부 확인
            for frame in frames:
                try:
                    driver.switch_to.frame(frame)
                    if "tb_row" in driver.page_source or "거래일자" in driver.page_source:
                        html_source = driver.page_source
                        found_data = True
                        print("✅ 프레임 내부에서 데이터를 발견했습니다!")
                        break
                except:
                    pass
                finally:
                    driver.switch_to.parent_frame() # 상위로 복귀
            
            if found_data: break

        # [D] 결과 출력 및 저장
        if found_data:
            print("🎯 진짜 거래내역 데이터를 성공적으로 추출했습니다!")
            # 텍스트가 너무 많으면 보기 힘드니 핵심 표 부분만 파싱해서 출력
            parse_and_save(html_source) 
        else:
            print("⚠️ 모든 곳을 뒤졌지만 표를 찾지 못했습니다.")
            print("현재 화면에 보이는 텍스트 일부:", driver.find_element(By.TAG_NAME, "body").text[:100])

    except Exception as e:
        print(f"❌ 오류 발생: {e}")
    finally:
        # 결과를 확인해야 하므로 잠시 대기 후 종료
        time.sleep(5)
        driver.quit()


def parse_and_save(html):
    soup = BeautifulSoup(html, 'html.parser')

    # 1. HTML 구조에 따라 id="listTable"을 우선적으로 찾습니다.
    table = soup.find('table', id='listTable')

    # 만약 ID로 못 찾으면 '거래일자' 텍스트가 포함된 테이블을 찾습니다.
    if not table:
        for t in soup.find_all('table'):
            if "거래일자" in t.text:
                table = t
                break

    if not table:
        print("⚠️ [오류] 거래내역 테이블(listTable)을 찾지 못했습니다.")
        # 분석을 위해 현재 수집된 HTML의 div 구조 일부 출력
        print("현재 상위 div 구조:", soup.find('div', class_='fixed_table_mb_mypage_inner'))
        return
    
    # 2. 데이터 추출
    # 농협 listTable은 보통 <thead>(제목)와 <tbody>(본문)로 나뉩니다.
    rows = table.find_all('tr')
    extracted_data = []

    print("\n" + "="*85)
    print(f"{'거래일자':<12} | {'거래내용':<18} | {'출금액':>12} | {'입금액':>12} | {'잔액':>12}")
    print("-" * 85)

    for row in rows:
        # th(제목)와 td(데이터) 모두 추출
        cols = row.find_all(['td', 'th'])
        col_text = [c.get_text(strip=True).replace(',', '') for c in cols]
        
        # 데이터가 있는 줄인지 확인 (보통 날짜가 들어있는 0번 열이 비어있지 않아야 함)
        if len(col_text) >= 5 and "거래일자" not in col_text[0] and col_text[0] != "":
            extracted_data.append(col_text)
            
            # 농협 listTable 표준 인덱스 (날짜, 시간, 내용, 출금, 입금, 잔액 순)
            date = col_text[0]
            desc = col_text[2] if len(col_text) > 2 else "내용없음"
            out_m = col_text[3] if len(col_text) > 3 else "0"
            in_m = col_text[4] if len(col_text) > 4 else "0"
            bal = col_text[5] if len(col_text) > 5 else "0"
            
            # 숫자가 비어있으면 0으로 표시
            out_m = out_m if out_m else "0"
            in_m = in_m if in_m else "0"
            
            print(f"{date:<12} | {desc[:15]:<18} | {out_m:>12} | {in_m:>12} | {bal:>12}")

    print("="*85)

    # 3. CSV 파일 저장
    if extracted_data:
        filename = "nh_bank_history.csv"
        try:
            with open(filename, 'w', newline='', encoding='utf-8-sig') as f:
                writer = csv.writer(f)
                writer.writerow(['거래일자', '시간/번호', '거래내용', '출금액', '입금액', '잔액', '거래지점'])
                writer.writerows(extracted_data)
            print(f"✅ CSV 저장 성공! 파일 위치: {os.path.abspath(filename)}")
        except Exception as e:
            print(f"❌ 파일 저장 오류: {e}")
    else:
        print("⚠️ 테이블은 찾았으나, 내부 데이터 행(tr/td)을 읽어오지 못했습니다.")


if __name__ == "__main__":
    run_automation()
