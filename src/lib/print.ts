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
      listPrinters: () => Promise<{ name: string; displayName?: string; description?: string; isDefault?: boolean }[]>;
    };
  }
}

const PRINTER_STORAGE_KEY = "glitch-preferred-printer";

// Device-specific choice (which physical printer this particular till
// should use) — deliberately NOT part of the shared app state, same
// reasoning as the language preference: it describes this machine, not
// the business, so it lives in localStorage instead of syncing anywhere.
export function getPreferredPrinter(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PRINTER_STORAGE_KEY) || "";
}
export function setPreferredPrinter(name: string): void {
  if (name) window.localStorage.setItem(PRINTER_STORAGE_KEY, name);
  else window.localStorage.removeItem(PRINTER_STORAGE_KEY);
}

export async function printSmart(): Promise<void> {
  if (window.electronAPI) {
    const result = await window.electronAPI.printSilent({ deviceName: getPreferredPrinter() });
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
