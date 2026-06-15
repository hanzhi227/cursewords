import { app, BrowserWindow, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import path from "path";
import { GameHost } from "./gameHost";
import type { UpdateStatus } from "../src/shared/types";

let mainWindow: BrowserWindow | null = null;
let host: GameHost | null = null;
let updaterConfigured = false;
let updateStatus: UpdateStatus = {
  type: app.isPackaged ? "idle" : "disabled",
  updatedAt: Date.now(),
  message: app.isPackaged ? undefined : "Updates are only available in packaged builds."
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#120d18",
    title: "Cursewords",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

ipcMain.handle("host:start", async () => {
  if (!host) host = new GameHost();
  return host.start();
});

ipcMain.handle("host:stop", async () => {
  if (!host) return;
  await host.stop();
  host = null;
});

ipcMain.handle("host:info", async () => {
  return host?.info() ?? null;
});

ipcMain.handle("updates:get-status", async () => updateStatus);

ipcMain.handle("updates:check", async () => checkForUpdates());

ipcMain.handle("updates:download", async () => downloadUpdate());

ipcMain.handle("updates:install", async () => {
  if (!app.isPackaged) return;
  autoUpdater.quitAndInstall(false, true);
});

app.whenReady().then(() => {
  createWindow();
  configureUpdater();
});

app.on("window-all-closed", async () => {
  if (host) await host.stop();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function configureUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  if (!app.isPackaged) {
    setUpdateStatus({
      type: "disabled",
      message: "Updates are only available in packaged builds."
    });
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({ type: "checking", message: "Checking for updates..." });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateStatus({
      type: "available",
      version: info.version,
      message: `Version ${info.version} is available.`
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    setUpdateStatus({
      type: "not-available",
      version: info.version,
      message: "Cursewords is up to date."
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateStatus({
      type: "downloading",
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      message: `Downloading update: ${Math.round(progress.percent)}%`
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateStatus({
      type: "downloaded",
      version: info.version,
      message: `Version ${info.version} is ready to install.`
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({ type: "error", message: errorMessage(error) });
  });
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    return setUpdateStatus({
      type: "disabled",
      message: "Updates are only available in packaged builds."
    });
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    setUpdateStatus({ type: "error", message: errorMessage(error) });
  }
  return updateStatus;
}

async function downloadUpdate() {
  if (!app.isPackaged) {
    return setUpdateStatus({
      type: "disabled",
      message: "Updates are only available in packaged builds."
    });
  }

  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    setUpdateStatus({ type: "error", message: errorMessage(error) });
  }
  return updateStatus;
}

function setUpdateStatus(status: Omit<UpdateStatus, "updatedAt">) {
  updateStatus = {
    ...status,
    updatedAt: Date.now()
  };
  mainWindow?.webContents.send("updates:status", updateStatus);
  return updateStatus;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Update check failed.";
}
