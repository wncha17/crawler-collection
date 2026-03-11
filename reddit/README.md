# 개요

### [Function 1]  
'parse_replies(replies_data, parent_id, post_permalink, is_test=False)'  
-> 대댓글을 재귀적으로 탐색하여 리스트로 반환  
-> 'data' -> 'children' 구조 안에 답글들이 들어있음  
<br>


### [Function 2]  
'get_all_comments(permalink, is_test=False)'  
-> 게시물의 모든 댓글과 대댓글을 개별 행 데이터로 변환  
-> 1차 댓글 추가 (부모 ID는 게시물: 'Root')  
-> 대댓글 탐색 및 추가  
<br>


### [Function 3]  
'fetch_reddit(search_key, reddit_query, limit, must_include=[], must_exclude=[], is_test=False)'  
-> while문: 설정한 limit값보다 찾은 게시물 수가 적을 때까지 페이지를 넘겨가며 30개씩 게시물 탐색  
-> for문: 30개 게시물 중 조건에 맞는 게시물 필터링 후 하나의 행으로 저장  
-> 해당 게시물의 모든 댓글/대댓글 가져오기 (get_all_comments 호출)  
<br>


### [메인 실행부]  
'file_name, target_model, model_variant': 사용자 입력 부분  
'config['key'], config['query'], limit=target_limit, must_include=config['include'], must_exclude=config['exclude'], is_test=is_test'  
-> key, query, 설정한 limit값, 필수, 배제 항목 등의 인자를 fetch_reddit함수에 보내 값을 받아옴  
-> 최종 통합 CSV 저장  
<br>


#### + (걸리는 시간)
'2026-01-27'  
-> iphone 17 (30개): 2.13s  
-> iphone air (30개): 2.09s  
-> iphone 17 pro max (30개): 2.25s  
<br><br>


# 수집 대상 항목  
'type, search_key, id, parent_id, title, author, created_utc, score, body_or_comment, permalink'  
<br><br>


# 업데이트 이력 (ticket)  




