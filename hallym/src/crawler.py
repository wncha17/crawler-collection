import sys
import requests
import pandas as pd
from bs4 import BeautifulSoup
import time

def crawl_doctor_info(hospital, doctor_id):
    # 브라우저 차단 방지를 위한 헤더 설정
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'}
    url = f"https://{hospital}.hallym.or.kr/ptm207.asp?Doctor_Id={doctor_id}"

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status() # 접속 오류 시 예외 발생
        # 한글 깨짐 방지를 위해 인코딩 설정
        response.encoding = response.apparent_encoding

        soup = BeautifulSoup(response.text, 'html.parser')

        # 1. 교수 이름 추출
        name_raw = soup.select_one('.name').get_text(strip=True) if soup.select_one('.name') else "N/A"
        name = name_raw.replace("교수", "").strip()

        # 2. 진료과 추출
        dept_tag = soup.find('span', string="진료과").find_next('span')
        dept = dept_tag.find(string=True, recursive=False).strip() if dept_tag else "N/A"

        # 3. 전문진료분야 추출
        specialty_tag = soup.select_one('.denti p') or soup.select_one('.part_txt p')
        specialty = specialty_tag.get_text(strip=True) if specialty_tag else "N/A"

        # 4. 기본 정보 (학력, 경력, 학회활동, 수상이력) 추출
        def get_table_info(title_text):
            section_title = soup.find(['h3','h4'], string=title_text)
            if section_title:
                # h3, h4 바로 다음에 오는 table을 찾음
                table = section_title.find_next('table')
                if table:
                    rows = [p.get_text(" ", strip=True) for p in table.select('td p')]
                return "\n".join(rows) # 엑셀 셀 내에서 줄바꿈 처리
            return ""

        # 5. 논문/저서 추출
        thesis_data = ""
        thesis_title = soup.find('h3', string=lambda t: t and ('논문' in t or '저서' in t))
        if thesis_title:
            thesis_list_div = thesis_title.find_next('div', class_='thesis_list')
            # 텍스트 추출 및 줄바꿈/공백 정규화
            clean_text = " ".join(thesis_list_div.get_text(" ", strip=True).split()) if thesis_list_div else ""
            # 엑셀 셀 용량 제한(32,767자)을 고려한 절삭
            limit = 30000
            if len(clean_text) > limit:
                thesis_data = clean_text[:limit] + " ... (내용이 너무 많아 이하 생략됨)"
            else:
                thesis_data = clean_text


        # 병원 한글 이름 매칭
        hospital_map = {
            'hallym': '한림대성심병원', 'kangnam': '한림대강남성심병원',
            'chuncheon': '한림대춘천성심병원', 'hangang': '한림대한강성심병원', 'dongtan': '한림대동탄성심병원'
        }
        hospital_name = hospital_map.get(hospital, hospital)

        return {
            "병원": hospital_name,
            "진료과": dept,
            "이름": name,
            "전문진료분야": specialty,
            "학력": get_table_info("학력"),
            "경력": get_table_info("경력"),
            "학회활동": get_table_info("학회활동"),
            "수상이력": get_table_info("수상이력"),
            "논문/저서": thesis_data
        }
    
    except Exception as e:
        print(f"ID {doctor_id} 데이터 수집 중 오류: {e}")
        return None
    


def search_each_dept(hospital, scode, is_test=False):
    # 1. 교수진 리스트 페이지에서 모든 Doctor_Id 추출
    list_url = f"https://{hospital}.hallym.or.kr/hallymuniv_sub.asp?left_menu=left_ireserve&screen=ptm212&scode={scode}&stype=OS"
    resp = requests.get(list_url, headers={'User-Agent': 'Mozilla/5.0'})
    resp.encoding = resp.apparent_encoding
    list_soup = BeautifulSoup(resp.text, 'html.parser')

    # '상세보기' 링크(ptm207.asp?Doctor_Id=xxx)에서 ID만 추출
    # 교수 이름도 함께 추출해서 실행시 ID 대신 이름으로 보여주기
    doctor_list = []
    links = list_soup.select('a[href*="Doctor_Id="]')
    for link in links:
        href = link.get('href')
        # href 예: ptm207.asp?Doctor_Id=126
        did = href.split('Doctor_Id=')[-1].split('&')[0]
        prof_name = link.select_one('div')
        if prof_name:
            name = prof_name.get_text(strip=True)
            # 중복 방지 로직 (ID 기준)
            if not any(d['id'] == did for d in doctor_list):
                doctor_list.append({'id': did, 'name': name})

    # 테스트 모드일 때 교수 3명 제한
    if is_test: doctor_list = doctor_list[:3]

    # 2. 루프를 돌며 상세 정보 수집
    dept_results = []
    for doctor in doctor_list:
        info = crawl_doctor_info(hospital, doctor['id'])
        if info:
            dept_results.append(info)
        time.sleep(0.5) # 서버 부하 방지를 위한 간격

    return dept_results # 해당 과의 데이터 리스트 반환



def search_each_hospital(hospital, is_test=False):
    # 0. 진료과 페이지에서 모든 scode 추출
    list_url1 = f"https://{hospital}.hallym.or.kr/hallymuniv_sub.asp?left_menu=left_ireserve&screen=ptm211"
    resp1 = requests.get(list_url1, headers={'User-Agent': 'Mozilla/5.0'})
    resp1.encoding = resp1.apparent_encoding
    list_soup1 = BeautifulSoup(resp1.text, 'html.parser')

    # '진료과' 각각(ptm212&scode=xxxxxxxx)에서 scode만 추출
    # 진료과 이름도 함께 추출해서 실행시 scode 대신 과이름으로 보여주기
    scodes = []
    seen_ids = set() # 중복 체크를 위한 집합(set) 추가
    links1 = list_soup1.select('a[href*="scode="]')
    for link1 in links1:
        scd = link1.get('href').split('scode=')[-1].split('&')[0]
        dept_name = link1.select_one('span')
        if dept_name:
            name = dept_name.get_text(strip=True)
            # ID가 set에 없는 경우에만 추가 (중복 원천 차단)
            if scd not in seen_ids:
                scodes.append({'id':scd, 'name':name})
                seen_ids.add(scd)

    # 테스트 모드일 때 진료과 3개 제한
    if is_test: scodes = scodes[:3]

    # 루프를 돌며 각 진료과 탐색
    hospital_results = []
    for scode in scodes:
        print(f"[한림대{hospital}성심병원] {scode['name']} 탐색 중...")
        dept_info = search_each_dept(hospital, scode['id'], is_test)
        hospital_results.extend(dept_info) # 과별 리스트를 병원 리스트에 합침
    
    return hospital_results



# --- 메인 실행부 ---
if __name__ == "__main__":
    is_test = "--test" in sys.argv
    target_hospitals = ['hallym', 'kangnam', 'chuncheon', 'hangang', 'dongtan']

    if is_test:
        target_hospitals = target_hospitals[:1] # 테스트 시 병원 1개만
        print("[TEST MODE] 병원 1개, 과 3개, 교수 3명 샘플 수집을 시작합니다.")

    final_all_data = [] # 모든 병원의 데이터를 담는 리스트
    for hospital in target_hospitals:
        print(f"\n======== {hospital} 탐색 시작 ========")
        hospital_data = search_each_hospital(hospital, is_test)
        final_all_data.extend(hospital_data)

    # 4. 최종 통합 CSV 저장
    if final_all_data:
        df = pd.DataFrame(final_all_data)
        if is_test:
            print("\n" + "="*45 + " TEST RESULT " + "="*45)

            # 1. 출력할 핵심 컬럼만 선택
            test_cols = ["병원", "진료과", "이름", "전문진료분야", "학력", "경력"]
            view_df = df[test_cols].copy()

            # 2. 모든 컬럼의 줄바꿈(\n)을 공백으로 바꾸고 길이를 25자로 제한
            for col in view_df.columns:
                view_df[col] = view_df[col].apply(lambda x: str(x).replace("\n", " ").strip()[:25]
                + "..." if len(str(x)) > 25 else str(x))

            # 3. pandas 출력 옵션 설정
            pd.set_option('display.max_columns', None) # 모든 컬럼 표시
            pd.set_option('display.expand_frame_repr', False) # 표 쪼개기 방지
            pd.set_option('display.max_colwidth', True) # 한글 정렬 도움
            pd.set_option('display.unicode.east_asian_width', True) # 한글 너비 맞춤

            print(view_df)
            print("="*115)
        else:
            df.to_csv("한림대의료원_전체_교수진_통합정보.csv", index=False, encoding="utf-8-sig")
            print(f"\n 총 {len(final_all_data)}명의 데이터 통합 저장 완료!")
    else:
        print("수집된 데이터가 없습니다.")


