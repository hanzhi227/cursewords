import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { HostStartResult, UpdateStatus } from "../src/shared/types";

contextBridge.exposeInMainWorld("cursewords", {
  startHost: (): Promise<HostStartResult> => ipcRenderer.invoke("host:start"),
  stopHost: (): Promise<void> => ipcRenderer.invoke("host:stop"),
  getHostInfo: (): Promise<HostStartResult | null> => ipcRenderer.invoke("host:info"),
  updates: {
    getStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke("updates:get-status"),
    check: (): Promise<UpdateStatus> => ipcRenderer.invoke("updates:check"),
    download: (): Promise<UpdateStatus> => ipcRenderer.invoke("updates:download"),
    install: (): Promise<void> => ipcRenderer.invoke("updates:install"),
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
      ipcRenderer.on("updates:status", listener);
      return () => ipcRenderer.removeListener("updates:status", listener);
    }
  }
});
