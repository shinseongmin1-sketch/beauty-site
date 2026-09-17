# 예약관리 데스크톱 앱

`crm/`에 있는 예약관리 웹앱(https://beauty-site-crm.vercel.app)을 감싸는
Electron 데스크톱 클라이언트. 실제 데이터/로그인/기능은 전부 웹앱과 동일하고
(같은 계정, 같은 DB), 브라우저 주소창 없이 바탕화면 아이콘으로 실행되는
전용 창만 제공한다. 인터넷 연결이 필요하다 (오프라인 프로그램 아님).

## 개발/실행

```bash
npm install
npm start
```

## 설치 파일(.exe) 만들기

```bash
npm run dist
```

`dist/yeyakgwanri-Setup-<버전>.exe`가 생성된다. 더블클릭하면 설치 마법사가
뜨고, 설치가 끝나면 바탕화면/시작메뉴에 "예약관리" 아이콘이 생긴다.

로컬에서 서명 없이 빌드한 설치파일이라 처음 실행할 때 Windows
SmartScreen이 "PC를 보호했습니다" 경고를 띄울 수 있다 — "추가 정보" →
"실행" 클릭하면 정상 설치된다.

## 새 버전 배포하기 (자동 업데이트)

앱 껍데기(main.js, 아이콘, 창 설정 등)를 고친 뒤 새 버전을 설치된 사용자
전체에게 자동으로 내려보내려면:

1. `package.json`의 `version`을 올린다 (예: 1.0.0 → 1.0.1)
2. `npm run dist`로 다시 빌드 — `dist/`에 새 설치파일 + `latest.yml`이 생긴다
3. GitHub Release로 올린다 (버전 태그는 `v` + package.json의 version과 동일해야 함):
   ```bash
   gh release create v1.0.1 \
     "dist/yeyakgwanri-Setup-1.0.1.exe" \
     "dist/yeyakgwanri-Setup-1.0.1.exe.blockmap" \
     "dist/latest.yml" \
     --repo shinseongmin1-sketch/beauty-site \
     --title "예약관리 데스크톱 v1.0.1" \
     --notes "변경 내용"
   ```
4. 이미 설치되어 있는 프로그램들은 실행 중 자동으로(최대 4시간 안에) 새
   버전을 감지해서 백그라운드로 내려받고, 사용자가 프로그램을 재시작하면
   자동 적용된다. 별도로 재설치를 안내할 필요 없음.

주의: 예약/고객/결제 등 **웹 화면 자체의 기능/디자인 변경은 이 절차와
무관하다** — `crm/`을 배포하기만 하면 웹이든 데스크톱이든 즉시 반영된다.
이 배포 절차는 오직 Electron 껍데기(아이콘, 창 동작 등)를 바꿀 때만
필요하다.

## 앱 아이콘 변경

지금은 기본 Electron 아이콘을 쓴다. 로고 이미지가 있으면 `.ico` 파일로
변환해서 `package.json`의 `build.win.icon`에 경로를 지정하면 된다.

## 접속 주소 바꾸기

`main.js` 상단의 `APP_URL` 상수만 바꾸면 다른 배포 주소를 가리키게 할 수
있다.
