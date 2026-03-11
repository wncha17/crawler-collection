#!/bin/bash

# 가상환경 활성화
if [ -d "../.venv" ]; then
    source ../.venv/bin/activate
else
    echo "에러: 프로젝트 루트에 .venv 가상환경이 없습니다."
    exit 1
fi

echo "===== [TEST] 환경 점검 및 샘플 데이터 출력 시작 ====="

# --test 인자 전달 (파일 저장 안함, 1개병원/3개과/3명교수)
python3 ../src/crawler.py --test

deactivate
echo "===== [TEST] 검증 완료 ====="
