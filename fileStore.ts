import type { StoreShape } from "./storage";
type PickerWindow = Window & {
  showSaveFilePicker?: (options?: any) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options?: any) => Promise<FileSystemFileHandle[]>;
};

function hasFSAccessAPI(): boolean {
  const w = window as PickerWindow;
  return typeof w.showSaveFilePicker === "function" && typeof w.showOpenFilePicker === "function";
}

export function fsSupported() {
  return hasFSAccessAPI();
}

export async function pickSaveFile(): Promise<FileSystemFileHandle> {
  const w = window as PickerWindow;
  if (!w.showSaveFilePicker) throw new Error("File save picker not supported in this browser.");

  return await w.showSaveFilePicker({
    suggestedName: "expense-tracker.json",
    types: [
      {
        description: "JSON",
        accept: { "application/json": [".json"] },
      },
    ],
  });
}

export async function pickOpenFile(): Promise<FileSystemFileHandle> {
  const w = window as PickerWindow;
  if (!w.showOpenFilePicker) throw new Error("File open picker not supported in this browser.");

  const [handle] = await w.showOpenFilePicker({
    types: [
      {
        description: "JSON",
        accept: { "application/json": [".json"] },
      },
    ],
    multiple: false,
  });

  return handle;
}

export async function writeStoreToFile(handle: FileSystemFileHandle, store: StoreShape) {
  const perm = await(handle as any).requestPermission?.({ mode: "readwrite" });
  if (perm === "denied") throw new Error("Write permission denied.");

  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(store, null, 2));
  await writable.close();
}

export async function readStoreFromFile(handle: FileSystemFileHandle): Promise<StoreShape> {
  const perm = await(handle as any).requestPermission?.({ mode: "read" });
  if (perm === "denied") throw new Error("Read permission denied.");

  const file = await handle.getFile();
  const text = await file.text();
  const data = JSON.parse(text);

  // ✅ Correct validation for your app
  if (!data || typeof data !== "object") throw new Error("Invalid backup file format.");
  if (!Array.isArray((data as any).expenses) || !Array.isArray((data as any).budgets)) {
    throw new Error("Invalid backup file format: expected { expenses: [], budgets: [] }");
  }

  return data as StoreShape;
}
