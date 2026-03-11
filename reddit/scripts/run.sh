#!/bin/bash

# 프로젝트 루트의 가상환경 활성화
if [ -d "../.venv" ]; then
    source ../.venv/bin/activate
else
    echo "에러: 가상환경(.venv)을 찾을 수 없습니다."
    exit 1
fi

echo "===== [RUN] Reddit 데이터 수집 시작 ====="

# 인자 없이 실행하여 전체 수집 및 CSV 저장 모드로 작동
python3 ../src/crawler.py

deactivate
echo "===== [RUN] 작업 완료 (CSV 파일이 생성되었습니다) ====="

