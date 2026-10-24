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

const APPEND_CHUNK = 3 * 512 * 1024; // 1.5 MB, a multiple of 3 so base64 chunks have no padding

/** Append the bytes of `src` to the end of `dest`, in chunks to keep memory low. */
export async function appendFile(src: string, dest: string): Promise<void> {
  const size = await fileSize(src);
  const destInfo = await FileSystem.getInfoAsync(dest);
  let first = !destInfo.exists;
  for (let pos = 0; pos < size; pos += APPEND_CHUNK) {
    const chunk = await FileSystem.readAsStringAsync(src, {
      encoding: FileSystem.EncodingType.Base64,
      position: pos,
      length: Math.min(APPEND_CHUNK, size - pos),
    });
    await FileSystem.writeAsStringAsync(dest, chunk, {
      encoding: FileSystem.EncodingType.Base64,
      append: !first,
    });
    first = false;
  }
}

export function segmentUriFor(id: string): string {
  return `${DOWNLOAD_DIR}${id}.segment`;
}

export { FileSystem };

/** Files in the app's private download folder (partial downloads, segments). */
export async function listWorkingFiles(): Promise<{ name: string; uri: string; size: number }[]> {
  try {
    await ensureDownloadDir();
    const names = await FileSystem.readDirectoryAsync(DOWNLOAD_DIR);
    return Promise.all(
      names.map(async (name) => {
        const uri = `${DOWNLOAD_DIR}${name}`;
        return { name, uri, size: await fileSize(uri) };
      }),
    );
  } catch {
    return [];
  }
}
