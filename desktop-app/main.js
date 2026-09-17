const { app, BrowserWindow, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

autoUpdater.logger = console;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const APP_URL = "https://beauty-site-crm.vercel.app";

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: "예약관리",
    autoHideMenuBar: true,
    backgroundColor: "#faf9fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);

  // 앱 도메인 밖으로 나가는 링크(외부 사이트 등)는 창 안이 아니라
  // 기본 브라우저에서 열리도록 한다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(APP_URL)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const OFFLINE_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
    <html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:'Malgun Gothic',sans-serif;background:#faf9fb;color:#1a1a2e;">
      <div style="text-align:center;">
        <h2>인터넷 연결을 확인해주세요</h2>
        <p style="color:#6b7280;">네트워크가 연결되면 자동으로 다시 시도합니다.</p>
      </div>
    </body></html>
  `)}`;

  let retryTimer = null;

  function loadApp() {
    win.loadURL(APP_URL);
  }

  win.webContents.on("did-fail-load", (_event, errorCode) => {
    if (errorCode === -3) return; // 사용자가 클릭으로 중단시킨 로드는 무시
    win.loadURL(OFFLINE_HTML);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(loadApp, 3000);
  });

  win.webContents.on("did-finish-load", () => {
    clearTimeout(retryTimer);
  });

  loadApp();
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 앱 껍데기(아이콘/창 설정 등) 업데이트 확인. 웹 화면 내용은 이 업데이트와
  // 무관하게 항상 최신(APP_URL을 그대로 불러오므로).
  checkForUpdates();
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000); // 4시간마다 재확인
});

function checkForUpdates() {
  autoUpdater.checkForUpdates().catch((err) => {
    console.log("update check failed (offline이거나 아직 release가 없을 수 있음):", err.message);
  });
}

autoUpdater.on("update-downloaded", () => {
  // 다음에 프로그램을 완전히 종료했다가 다시 켤 때 자동으로 새 버전이 적용된다.
  console.log("업데이트 다운로드 완료 - 다음 재시작 시 자동 적용");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
