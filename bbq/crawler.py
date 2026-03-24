import json, time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

def crawl_bbq_cart():
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()))
    driver.get("https://bbq.co.kr/member/login")
    print("브라우저에서 로그인을 완료하고 '장바구니' 화면으로 이동해 주세요...")

    wait = WebDriverWait(driver, 40)
    try:
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "div.sc-9ecd31b7-0.ionhvO")))
        print("페이지 감지 완료. 크롤링을 시작합니다.")
        time.sleep(5)
    except Exception as e:
        print(e)
        driver.quit()
        return []
    
    cart_items = []

    # 두 가지 상품을 담은 div 추출 (class="sc-e8ba6a60-0 uTCJm")
    items = driver.find_elements(By.CSS_SELECTOR, "div.sc-e8ba6a60-0.uTCJm")

    for item in items: # 상품(2개) 각각에 대해 실행 
        try:
            # 1. 상품명, 기본가격 (class="sc-9ecd31b7-0 gAsNUh")
            origins = item.find_elements(By.CSS_SELECTOR, "div.sc-9ecd31b7-0.gAsNUh")[1].find_elements(By.CSS_SELECTOR, "span")
            product_name, base_price = origins[0].text, origins[1].text

            # 2. 옵션 각각에 대해 실행 (class="sc-9ecd31b7-0 dMLHDK")
            options = item.find_elements(By.CSS_SELECTOR, "div.sc-9ecd31b7-0.dMLHDK")
            options_list = []
            for option in options:
                opt_elemts = option.find_elements(By.CSS_SELECTOR, "span")
                opt_name1 = opt_elemts[1].text.strip()
                opt_name2 = opt_elemts[0].text.replace("• ", "").replace(opt_elemts[1].text, "").strip()
                opt_name = f"{opt_name1}: {opt_name2}"
                opt_price = opt_elemts[2].text.strip()

                options_list.append({
                    "옵션명": opt_name,
                    "추가가격": opt_price
                })

            # 3. 수량 (class="sc-1d8721d3-0 eCFMVc")
            quantity = item.find_element(By.CSS_SELECTOR, "input").get_attribute("value")

            # 4. 최종 주문 금액 (class="sc-857a90a8-0 iNqgqQ")
            total_price = item.find_elements(By.CSS_SELECTOR, "span")[-1].text.strip()

            cart_items.append({
                "상품명": product_name,
                "기본가격": base_price,
                "선택옵션": options_list,
                "수량": f"{quantity}개",
                "주문금액": total_price
            })

        except Exception as e:
            continue

    driver.quit()
    return cart_items

# 실행
data = crawl_bbq_cart()
print(json.dumps(data, ensure_ascii=False, indent=4))
