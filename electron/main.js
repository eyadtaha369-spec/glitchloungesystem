// GLITCH Lounge OS — Electron Desktop Shell
//
// This gives you a real desktop app (taskbar icon, its own window, no
// browser chrome) with genuine SILENT thermal printing — no print
// dialog, ever, once your printer is set as the default.
//
// By default this now points at your LOCAL server (Phase 2 — see
// server/README.md), the fully offline setup. Set GLITCH_APP_URL to
// override it, e.g. back to the cloud-deployed site if you ever want
// this shell to run against that instead.

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

const APP_URL = process.env.GLITCH_APP_URL || "http://localhost:3000";

let mainWindow;

const WEB_PREFERENCES = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true, // security: renderer can't touch Node directly
  nodeIntegration: false,
  spellcheck: false,
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, "assets", "icon.png"),
    title: "GLITCH Lounge OS",
    autoHideMenuBar: true, // no File/Edit/View menu bar cluttering a POS screen
    webPreferences: WEB_PREFERENCES,
  });

  // Report/Inventory/Procurement/Voids print-outs open via window.open()
  // into a plain popup by default — without this, that popup gets NO
  // preload script and therefore no window.electronAPI, so those
  // printouts would silently fall back to the normal dialog even
  // inside the desktop app. Attaching the SAME preload here means
  // every popup gets real silent printing too, not just the 4 primary
  // receipt/ticket types.
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: "allow",
    overrideBrowserWindowOptions: {
      autoHideMenuBar: true,
      webPreferences: WEB_PREFERENCES,
    },
  }));

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(APP_URL);

  // Uncomment while debugging a printer/layout issue:
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---- Silent printing bridge ----
// This is the actual fix for the print-dialog problem: Electron's
// webContents.print() supports { silent: true }, which no ordinary
// website can ever do (that's a real browser security boundary, not a
// bug — see the app's own printer-setup notes). Renderer calls this via
// the preload bridge (window.electronAPI.printSilent()). Works
// identically for the main window and for popups, since both share the
// same preload via setWindowOpenHandler above.
ipcMain.handle("print-silent", async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: "No window" };
  return new Promise((resolve) => {
    win.webContents.print(
      {
        silent: true,
        printBackground: true,
        deviceName: options.deviceName || "", // "" = current OS default printer
        margins: { marginType: "none" },
      },
      (success, failureReason) => {
        resolve(success ? { ok: true } : { ok: false, error: failureReason });
      },
    );
  });
});

// Lets the Setup page's "Printer Setup" panel list actual installed
// printers instead of you guessing a device name.
ipcMain.handle("list-printers", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return [];
  try {
    return await win.webContents.getPrintersAsync();
  } catch {
    return [];
  }
});
