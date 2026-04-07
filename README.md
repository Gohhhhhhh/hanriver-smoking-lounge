# 온라인 벚꽃 한강 흡연소

멀티플레이어 픽셀아트 브라우저 게임. Node.js + Socket.io 기반.

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000
```

---

## Railway 배포 절차

### 1. GitHub 저장소 준비

```bash
cd hanriver-smoking-lounge
git init
git add .
git commit -m "initial commit"
```

GitHub에서 새 저장소 생성 후:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Railway 프로젝트 생성

1. [railway.app](https://railway.app) 접속 → 로그인
2. **New Project** → **Deploy from GitHub repo** 선택
3. 위에서 만든 저장소 선택
4. Railway가 자동으로 `package.json`의 `start` 스크립트를 감지해 배포

### 3. 환경변수 (자동 처리)

Railway는 `PORT` 환경변수를 자동으로 주입합니다.
`server.js`에 이미 `const PORT = process.env.PORT || 3000`으로 설정되어 있어 별도 설정 불필요.

### 4. 도메인 확인

배포 완료 후 Railway 대시보드 → **Settings** → **Domains**에서
자동 생성된 URL(예: `https://xxx.up.railway.app`) 확인.

### 5. WebSocket 연결

클라이언트는 Socket.io `io()`를 사용하며, 페이지를 서빙한 서버에 **자동으로 연결**됩니다.
로컬(`ws://localhost:3000`)과 배포(`wss://xxx.up.railway.app`) 모두 별도 설정 없이 동작합니다.

---

## 프로젝트 구조

```
hanriver-smoking-lounge/
├── server.js          # Express + Socket.io 서버
├── package.json
├── .gitignore
└── public/
    ├── index.html
    ├── client.js      # 게임 클라이언트
    ├── style.css
    └── assets/        # 이미지, 스프라이트 등
```
