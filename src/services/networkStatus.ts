/**
 * Network status checks, injectable so that provider/HTTP code has no native
 * imports and can run in Node tests. The app registers the Expo implementation
 * at startup (see services/networkStatus.native.ts → App.tsx).
 */
export interface NetworkChecker {
  isOnline(): Promise<boolean>;
  isOnWifi(): Promise<boolean>;
}

let checker: NetworkChecker = {
  isOnline: async () => true,
  isOnWifi: async () => true,
};

export function setNetworkChecker(c: NetworkChecker): void {
  checker = c;
}

export const isOnline = () => checker.isOnline();
export const isOnWifi = () => checker.isOnWifi();
