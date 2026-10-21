import * as FileSystem from 'expo-file-system/legacy';

/** App-private working folder for in-progress downloads. */
export const DOWNLOAD_DIR = `${FileSystem.documentDirectory}downloads/`;

export async function ensureDownloadDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
  }
}

export function tempUriFor(id: string, fileName: string): string {
  const ext = fileName.match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? '.mp4';
  return `${DOWNLOAD_DIR}${id}${ext}`;
}

export async function fileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

export async function deleteFile(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Already gone.
  }
}

export async function freeSpace(): Promise<number | undefined> {
  try {
    return await FileSystem.getFreeDiskStorageAsync();
  } catch {
    return undefined;
  }
}

export { FileSystem };
