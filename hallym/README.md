# 개요

### [Function 1]  
'crawl_doctor_info(hospital, doctor_id)'  
-> '교수 이름, 진료과, 전문진료분야, 기본정보(학력, 경력, 학회활동, 수상이력), 논문/저서' 추출  
-> 병원 한글 이름 매칭  
<br>


### [Function 2]  
'search_each_dept(hospital, scode)'  
-> 교수진 리스트 페이지에서 모든 Doctor_Id 추출  
-> 교수 이름도 함께 추출해서 실행시 ID 대신 이름으로 보여주기  
-> 루프를 돌며 상세 정보 수집  
<br>


### [Function 3]  
'search_each_hospital(hospital)'  
-> 진료과 페이지에서 모든 scode 추출  
-> 진료과 이름도 함께 추출해서 실행시 scode 대신 과이름으로 보여주기  
-> 루프를 돌며 각 진료과 탐색  
<br>


### [메인 실행부]  
hospitals = ['hallym', 'kangnam', 'chuncheon', 'hangang', 'dongtan']  
-> 각 병원별 진료과별 의사들의 정보 추출 (Function 3 -> Function 2 -> Function 1)  
-> 최종 통합 CSV 저장  
<br>


#### + (걸리는 시간)
'2026-01-26'  
-> (한림대성심병원) 가정의학과(3명): 3.89s  
-> (한림대성심병원) 감염내과(3명): 3.89s   
-> (한림대성심병원) 내분비내과(3명): 5.8s  
<br><br>


# 수집 대상 항목  
'교수 이름, 진료과, 전문진료분야, 기본정보(학력, 경력, 학회활동, 수상이력), 논문/저서'  
<br><br>


# 업데이트 이력 (ticket)




