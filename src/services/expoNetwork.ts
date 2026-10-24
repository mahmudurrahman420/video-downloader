import * as Network from 'expo-network';
import { setNetworkChecker } from './networkStatus';

/** Register expo-network as the app's network checker. Call once at startup. */
export function installExpoNetworkChecker(): void {
  setNetworkChecker({
    async isOnline() {
      try {
        const state = await Network.getNetworkStateAsync();
        return state.isConnected !== false && state.isInternetReachable !== false;
      } catch {
        return true; // Unknown — let the request itself decide.
      }
    },
    async isOnWifi() {
      try {
        const state = await Network.getNetworkStateAsync();
        return state.type === Network.NetworkStateType.WIFI || state.type === Network.NetworkStateType.ETHERNET;
      } catch {
        return false;
      }
    },
  });
}
