import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  downloads: 'vd.downloads.v1',
  history: 'vd.history.v1',
  settings: 'vd.settings.v1',
} as const;

export type StorageKey = keyof typeof KEYS;

export async function loadJSON<T>(key: StorageKey, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(KEYS[key]);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJSON(key: StorageKey, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS[key], JSON.stringify(value));
  } catch {
    // Persistence is best effort; in-memory state remains correct.
  }
}
