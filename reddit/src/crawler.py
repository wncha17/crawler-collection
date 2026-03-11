import sys
import random
import pandas as pd
from tqdm import tqdm
import requests
from datetime import datetime
import time


def get_headers():
    # 랜덤 숫자를 조합해 매번 다른 브라우저인 것처럼 User-Agent를 생성하여 차단을 방지합니다.
    return {"User-Agent": f"RedditScraper_{random.randint(1, 9999)}/1.0"}


def parse_replies(replies_data, parent_id, post_permalink, is_test=False):
    """대댓글을 재귀적으로 탐색하여 리스트로 반환"""
    reply_list = []
    if not replies_data or replies_data == "":
        return reply_list

    # 'data' -> 'children' 구조 안에 답글들이 들어있음
    children = replies_data.get('data', {}).get('children', [])

    if is_test:
        children = children[:2]

    for child in children:
        if child['kind'] == 't1':
            data = child['data']
            c_id = data.get('id')
            body = data.get('body', '').replace('\n', ' ')

            reply_list.append({
                'id': c_id,
                'parent_id': parent_id,
                'author': data.get('author'),
                'body': body,
                'score': data.get('score'),
                'permalink': f"https://www.reddit.com{post_permalink}{c_id}/"
            })

            # 대댓글의 대댓글(더 깊은 층위)이 있는지 확인
            if 'replies' in data and data['replies']:
                reply_list.extend(parse_replies(data['replies'], c_id, post_permalink, is_test=is_test))

    return reply_list


def get_all_comments(permalink, is_test=False):
    """게시물의 모든 댓글과 대댓글을 개별 행 데이터로 변환"""
    url = f"https://www.reddit.com{permalink}.json"
    rows = []
    try:
        time.sleep(random.uniform(1.0, 1.5)) # 차단 방지
        response = requests.get(url, headers=get_headers(), timeout=15)
        if response.status_code == 200:
            comments_data = response.json()[1]['data']['children']

            if is_test:
                comments_data = comments_data[:2]

            for c in comments_data:
                if c['kind'] == 't1': # 최상위 댓글들 순회
                    data = c['data']
                    c_id = data.get('id')
                    body = data.get('body', '').replace('\n', ' ')

                    # 1차 댓글 추가 (부모 ID는 게시물: 'Root')
                    rows.append({
                        'id': c_id,
                        'parent_id': 'Root',
                        'author': data.get('author'),
                        'body': body,
                        'score': data.get('score'),
                        'permalink': f"https://www.reddit.com{permalink}{c_id}/"
                    })

                    # 대댓글 탐색 및 추가
                    if 'replies' in data and data['replies']:
                        rows.extend(parse_replies(data['replies'], c_id, permalink, is_test=is_test))
    except:
        pass
    return rows


def fetch_reddit(search_key, reddit_query, limit, must_include=[], must_exclude=[], is_test=False):
    all_rows = []
    after = None
    headers = get_headers()

    pbar = tqdm(total=limit, desc=f"Target: {search_key}", unit="post")

    post_count = 0
    # 찾은 게시물 수가 설정한 limit값만큼 찰 때까지 페이지를 넘겨가며 30개씩 게시물 탐색
    while post_count < limit:
        url = f"https://www.reddit.com/search.json?q={reddit_query}&limit=30&sort=relevance"
        if after: url += f"&after={after}"

        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code != 200: break

        data = response.json().get('data', {})
        children = data.get('children', [])
        if not children: break

        for post in children:
            if post_count >= limit: break
            item = post['data']
            title = item.get('title', '').lower()

            # 정밀 필터링 로직
            if search_key.lower() not in title: continue
            if must_include and not any(inc.lower() in title for inc in must_include): continue
            if any(exc.lower() in title for exc in must_exclude): continue

            # 시간 표시 형식 수정 및 링크 추출
            created_utc = datetime.fromtimestamp(item.get('created_utc')).strftime('%Y-%m-%d %I:%M:%S %p')
            permalink = item.get('permalink')

            # 게시물을 하나의 행으로 저장
            post_info = {
                'type': 'POST',
                'search_key': search_key,
                'id': item.get('id'),
                'parent_id': '-',
                'title': item.get('title'),
                'author': item.get('author'),
                'created_utc': created_utc,
                'score': item.get('score'),
                'body_or_comment': item.get('selftext', '').replace('\n', ' '),
                'permalink': f"https://www.reddit.com{permalink}"
            }
            all_rows.append(post_info)

            # 해당 게시물의 모든 댓글/대댓글 가져오기
            comments = get_all_comments(permalink, is_test=is_test)
            for comment in comments:
                all_rows.append({
                    'type': 'COMMENT/REPLY',
                    'search_key': search_key,
                    'id': comment['id'],
                    'parent_id': comment['parent_id'],
                    'title': f"Re: {item.get('title')[:30]}...",
                    'author': comment['author'],
                    'created_utc': '-',
                    'score': comment['score'],
                    'body_or_comment': comment['body'],
                    'permalink': comment['permalink']
                })

            post_count += 1
            pbar.update(1)
            time.sleep(2)

        after = data.get('after')
        if not after: break

    pbar.close()
    return all_rows


def generate_configs(model_name, variants):
    configs = []

    # 상위 모델 키워드 정의 (일반형 검색 시 제외하기 위함)
    all_upper_keywords = ["+", "plus", "ultra", "pro", "max"]

    for variant in variants:
        # 1. 수식어 특성에 따른 이름 조합 (공백 처리)
        if not variant:
            key_name = model_name
        elif variant == "+":
            key_name = f"{model_name}{variant}"
        else:
            key_name = f"{model_name} {variant}"
        
        # 2. 쿼리 및 포함 키워드 설정
        if variant == "":
            query = f"{model_name}"
            include = [f"{model_name}"]
            exclude = all_upper_keywords
        elif variant == "+":
            query = f'"{model_name}+" OR "{model_name} Plus" OR "{model_name}Plus"'
            include = [f"{model_name}+", f"{model_name} Plus", f"{model_name}Plus"]
            exclude = ["ultra", "pro max"]
        else:
            query = f'"{model_name} {variant}" OR "{model_name}{variant}"'
            include = [f"{model_name} {variant}", f"{model_name}{variant}"]
            exclude = []

        configs.append({
            "key": key_name,
            "query": query,
            "include": include,
            "exclude": exclude
        })

    return configs


# --- 메인 실행부 ---
if __name__ == "__main__":
    is_test = "--test" in sys.argv

    # 사용자 입력 부분
    file_name = 'iphone_17_series'
    target_model = "iphone"
    model_variant = ["17", "air", "17 pro max"]

    search_configs = generate_configs(target_model, model_variant)

    final_list = []
    for config in search_configs:
        target_limit = 1 if is_test else 30
        result = fetch_reddit(config['key'], config['query'], limit=target_limit,
                            must_include=config['include'], must_exclude=config['exclude'],
                            is_test=is_test)
        final_list.extend(result)

    if final_list:
        df = pd.DataFrame(final_list)

        if is_test:
            print("\n" + "="*35 + " REDDIT TEST RESULT " + "="*35)

            # 출력용 컬럼 5개 선택
            view_df = df[['type', 'search_key', 'author', 'score', 'body_or_comment']].copy()

            # 텍스트 가공 (가독성 증대)
            for col in view_df.columns:
                view_df[col] = view_df[col].apply(
                    lambda x: str(x).replace("\n", " ").strip()[:30] + "..."
                    if len(str(x)) > 30 else str(x)
                )

            pd.set_option('display.max_columns', None)
            pd.set_option('display.expand_frame_repr', False)
            pd.set_option('display.unicode.east_asian_width', True)

            print(view_df)
            print("="*100)
            print(f"테스트 완료: 총 {len(df)}개 데이터(게시물+댓글) 수집됨.")

        else:
            df.to_csv(f'reddit_{file_name}.csv', index=False, encoding='utf-8-sig')
            print(f"\n ** 수집 완료! 총 {len(df)}개 행(게시물+댓글+답글)이 저장되었습니다.")


