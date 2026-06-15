/// <reference types="vite/client" />

import type { HostStartResult, UpdateStatus } from "./shared/types";

declare global {
  interface Window {
    cursewords?: {
      startHost: () => Promise<HostStartResult>;
      stopHost: () => Promise<void>;
      getHostInfo: () => Promise<HostStartResult | null>;
      updates: {
        getStatus: () => Promise<UpdateStatus>;
        check: () => Promise<UpdateStatus>;
        download: () => Promise<UpdateStatus>;
        install: () => Promise<void>;
        onStatus: (callback: (status: UpdateStatus) => void) => () => void;
      };
    };
  }
}
