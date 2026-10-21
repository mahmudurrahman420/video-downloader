import * as FileSystem from 'expo-file-system/legacy';
import { base64ToBytes } from './mediaSniff';

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

/** Read the first bytes of a file (for verifying it is really a video). */
export async function readHeader(uri: string, length = 512): Promise<Uint8Array> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length,
    });
    return base64ToBytes(b64);
  } catch {
    return new Uint8Array();
  }
}

export { FileSystem };
