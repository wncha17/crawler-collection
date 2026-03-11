# crawler-collection
Intellisys Crawler 모음

---

### Crawler 추가 및 관리 
#### Crawler 추가
crawler 대상 사이트 별 directory 생성 
사이트 directory 내 src, scripts directory 생성 
```
{target_website}
└─ {target_project} 
   └─ README.md
   └─ {src}
   └─ {scripts}
      └─ test.sh
      └─ run.sh
```
#### 필수 항목
- 프로젝트 별 directory 내 README.md
  - 개요
  - 수집 대상 항목 
  - 업데이트 이력 (ticket)
- Crawling 수행용 shell script
  - test.sh : 기능 테스트를 위한 test script
  - run.sh : 실 수집 수행을 위한 run script

---

### 브랜치 규칙 
#### 추가 
```
add/{target_website}/{target_project} 
```
#### 업데이트
```
update/{target_website}/{target_project}/{ticket}
```
