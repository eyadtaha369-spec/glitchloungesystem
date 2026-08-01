// Bridges to the real silent-printing capability exposed by the Electron
// shell's preload script (see electron/preload.js) when this app is
// running inside the desktop app. In an ordinary browser tab,
// window.electronAPI simply doesn't exist, so this transparently falls
// back to the normal print dialog — no environment-detection branching
// needed anywhere that calls this.
declare global {
  interface Window {
    electronAPI?: {
      isElectron: true;
      printSilent: (options?: { deviceName?: string }) => Promise<{ ok: boolean; error?: string }>;
      listPrinters: () => Promise<unknown[]>;
    };
  }
}

export async function printSmart(): Promise<void> {
  if (window.electronAPI) {
    const result = await window.electronAPI.printSilent();
    if (!result.ok) {
      // Fall back rather than leave the user with nothing printed and no
      // explanation — a misconfigured/offline printer shouldn't strand them.
      console.error("Silent print failed, falling back to dialog:", result.error);
      window.print();
    }
    return;
  }
  window.print();
}
