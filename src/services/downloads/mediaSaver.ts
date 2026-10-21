import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { AppError } from '../http';

export const ALBUM_NAME = 'Video Downloader';

/**
 * Ask for permission to add videos to the shared media library.
 * On Android 13+ this is the granular "Videos" permission; on older
 * versions it is storage access. Write-only is enough for saving.
 */
export async function ensureMediaPermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(true, ['video']);
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const req = await MediaLibrary.requestPermissionsAsync(true, ['video']);
  return req.granted;
}

export async function permissionCanBeRequested(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(true, ['video']);
  return current.granted || current.canAskAgain;
}

/**
 * Copy a finished download into the device's shared Movies storage, inside a
 * "Video Downloader" album, so it shows up in Gallery and file managers.
 */
export async function saveToLibrary(localUri: string): Promise<{ assetId: string; location: string }> {
  const granted = await ensureMediaPermission();
  if (!granted) {
    throw new AppError(
      'storage-permission',
      'Permission to save videos was denied. Allow "Photos and videos" access for Video Downloader in Android Settings, then tap Retry.',
    );
  }
  try {
    const asset = await MediaLibrary.createAssetAsync(localUri);
    let finalAsset = asset;
    try {
      const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync(ALBUM_NAME, asset, false);
      }
      // Moving can change the asset's entry; look it up again by name.
      finalAsset = (await findAssetByName(asset.filename)) ?? asset;
    } catch {
      // Album organisation is a nicety; the file is already saved.
    }
    const location = Platform.OS === 'android' ? `Movies/${ALBUM_NAME}/${finalAsset.filename}` : finalAsset.filename;
    return { assetId: finalAsset.id, location };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/space|ENOSPC/i.test(msg)) {
      throw new AppError('storage-space', 'Not enough storage space to save the video.');
    }
    throw new AppError('unknown', `Could not save the video to your device: ${msg}`);
  }
}

async function findAssetByName(filename: string): Promise<MediaLibrary.Asset | undefined> {
  const album = await MediaLibrary.getAlbumAsync(ALBUM_NAME);
  if (!album) return undefined;
  const page = await MediaLibrary.getAssetsAsync({
    album,
    mediaType: MediaLibrary.MediaType.video,
    first: 200,
    sortBy: [[MediaLibrary.SortBy.creationTime, false]],
  });
  return page.assets.find((a) => a.filename === filename);
}

/** Confirm a saved asset still exists (the user may have deleted it in Gallery). */
export async function assetExists(assetId: string): Promise<boolean> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    return !!info;
  } catch {
    return false;
  }
}

/** Open a saved video in the user's default video player. */
export async function openSavedVideo(assetId: string, mimeType = 'video/*'): Promise<void> {
  if (Platform.OS !== 'android') return;
  const contentUri = await MediaLibrary.getAssetContentUriAsync(assetId);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: mimeType,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}

export async function deleteSavedVideo(assetId: string): Promise<boolean> {
  try {
    return await MediaLibrary.deleteAssetsAsync([assetId]);
  } catch {
    return false;
  }
}
