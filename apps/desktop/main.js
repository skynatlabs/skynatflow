// One Platform desktop shell — a thin native wrapper around the web
// dashboard (per the strategic report's desktop-app requirement), not a
// separate app with its own logic. The dashboard needs the Next.js server
// + Postgres behind it regardless of surface, so this just points a real
// native window at wherever that's running — localhost during dev, the
// production URL once deployed.

const { app, BrowserWindow, shell, Menu } = require("electron");

// Point this at your deployed URL once live (Vercel/Hostinger). Overridable
// via env var so a packaged build can be pointed at prod without a rebuild.
const TARGET_URL = process.env.ONE_PLATFORM_URL || "http://localhost:3000";

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "One Platform",
    backgroundColor: "#eef1fa",
    webPreferences: {
      preload: __dirname + "/preload.js",
      contextIsolation: true,
    },
  });

  win.loadURL(TARGET_URL);

  // Open any external links (e.g. WhatsApp click-to-chat) in the system
  // browser rather than inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(TARGET_URL)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  return win;
}

const menuTemplate = [
  {
    label: "One Platform",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  },
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
  {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "close" }],
  },
];

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
