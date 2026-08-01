// GLITCH Lounge OS — Electron Desktop Shell
//
// PHASE 1 of the offline roadmap: this gives you a real desktop app
// (taskbar icon, its own window, no browser chrome, launches like any
// other Windows program) with genuine SILENT thermal printing — no
// print dialog, ever, once your printer is set as the default.
//
// IMPORTANT — read this before assuming it's fully offline: this shell
// currently loads the app from its deployed URL (APP_URL below), which
// still talks to Google Sheets/Apps Script over the internet for every
// action, same as it does in a normal browser tab today. Wrapping it in
// Electron does not, by itself, make the POS logic or data local — that
// is Phase 2 (a full local SQLite + ported business-logic migration),
// a separate and much larger project. This file is honestly scoped to
// what Electron packaging + native printing actually solve on their own.

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");

// Point this at your deployed app. If/when Phase 2 ships a local
// server, this becomes "http://localhost:PORT" instead.
const APP_URL = process.env.GLITCH_APP_URL || "https://glitchloungesystem.vercel.app";

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    icon: path.join(__dirname, "assets", "icon.png"),
    title: "GLITCH Lounge OS",
    autoHideMenuBar: true, // no File/Edit/View menu bar cluttering a POS screen
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // security: renderer can't touch Node directly
      nodeIntegration: false,
      spellcheck: false,
    },
  });

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
// the preload bridge (window.electronAPI.printSilent()).
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
