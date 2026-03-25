import requests

def get_login_info(file_path):
    """파일에서 아이디와 비밀번호를 읽어오는 함수"""
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f.readlines() if line.strip()]
        user_id = lines[0].split(': ')[-1].strip()
        user_pw = lines[1].split(': ')[-1].strip()
    return user_id, user_pw

def crawl_bbq_cart():
    # 세션 객체 생성 - 쿠키를 자동으로 주고 받음
    session = requests.Session()

    # 기본 헤더 설정
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://bbq.co.kr",
        "Referer": "https://bbq.co.kr/member/login"
    })

    try:
        # STEP 0: 세션 초기화 및 CSRF 토큰 획득
        session.get("https://bbq.co.kr/member/login")
        csrf_res = session.get("https://bbq.co.kr/api/auth/csrf")
        csrf_token = csrf_res.json().get('csrfToken')

        # STEP 1: 로그인 수행 (수동 쿠키를 만드는 과정)
        login_url = "https://bbq.co.kr/api/auth/callback/member"
        user_id, user_pw = get_login_info('login_info.txt')
        login_payload = { 
            "username": user_id,
            "password": user_pw,
            "redirect": "false",
            "csrfToken": csrf_token,
            "callbackUrl": "https://bbq.co.kr/member/login",
            "json": "true"
        }

        login_res = session.post(login_url, data=login_payload)

        if login_res.status_code == 200:
            # STEP 3: 장바구니 데이터 가져오기
            print("🔑 로그인 성공! 장바구니 데이터를 가져옵니다.")
            
            # [1] 장바구니 API 설정
            cart_url = "https://bbq.co.kr/api/delivery/cart/list"
            
            # 장바구니 요청은 다시 JSON 형식을 사용하므로 헤더를 업데이트합니다.
            session.headers.update({
                "Content-Type": "application/json",
                "Referer": "https://bbq.co.kr/cart"
            })
            
            # [2] 장바구니 페이로드
            cart_payload = {
                "branchId": "",
                "mealType": "DELIVERY",
                "latitude": 37.388291,
                "longitude": 126.971175,
                "legalDongId": "4117310300",
                "administrativeDongId": "4117357800",
                "ecouponList": []
            }
            
            # [3] 요청 전송
            cart_res = session.post(cart_url, json=cart_payload)
            
            if cart_res.status_code == 200:
                cart_json = cart_res.json()
                print(f"\n✅ [{cart_json['familyInfoResponse']['branchName']}] 장바구니 조회 성공!")
                
                for menu in cart_json['responseList']:
                    name = menu['mainMenuName']
                    base_price = menu['price']
                    quantity = menu['quantity']
                    final_price = menu['totalMenuWithSubOptionAndQuantityPrice']
                    
                    print(f"🍗 상품명: {name}")
                    print(f"   기본가격: {base_price:,}원 | 수량: {quantity}개")
                    
                    # 옵션 순회
                    for head in menu['subOptionHeadList']:
                        opt_group = head['subOptionName']
                        for detail in head['subOptionDetailList']:
                            opt_name = detail['subOptionDetailName']
                            opt_price = detail['price']
                            print(f"   └ {opt_group}: {opt_name} (+{opt_price:,}원)")
                    
                    print(f"   💰 항목 총 합계: {final_price:,}원\n")

                print(f"------------------------------------")
                print(f"🛒 전체 주문 금액: {cart_json['totalPrice']:,}원")
                print(f"🚚 배달비: {cart_json['deliveryFee']:,}원")
            else:
                print(f"❌ 장바구니 조회 실패: {cart_res.status_code}")
                print(f"응답 내용: {cart_res.text}")

    except Exception as e:
        print(f"오류: {e}")
    return None

crawl_bbq_cart()
