# 예약관리 데스크톱 앱

`crm/`에 있는 예약관리 웹앱(https://app.manion.kr)을 감싸는
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

1. `package.json`(과 `package-lock.json`)의 `version`을 올린다 (예: 1.0.1 → 1.0.2)
2. master에 반영한다.
3. GitHub Actions의 **Desktop release** 워크플로를 수동 실행(Run workflow)한다.
   윈도우 러너가 `npm ci` → `electron-builder --win --publish always`로 설치파일을
   만들고, Release `v<버전>`(설치파일 + `.blockmap` + `latest.yml`)을 바로 공개한다.
   같은 버전 Release가 이미 있으면 실패하므로 반드시 버전을 먼저 올린다.
   - PC에서 직접 할 때: `npm run dist` 후 `gh release create v<버전>`으로 위 파일 3개를 올린다.
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

`main.js` 상단의 `APP_URL`(처음 여는 주소)과 `APP_ORIGINS`(창 안에서 열어도
되는 주소 목록)를 바꾼다. 목록 밖 주소는 기본 브라우저로 열린다.
v1.0.0은 `https://beauty-site-crm.vercel.app`만 열기 때문에, 그 주소는 옛 버전이
남아 있는 동안 유지해야 한다.
