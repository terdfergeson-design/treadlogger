import { useSyncExternalStore } from "react";

import {
  isSecureContextForBluetooth,
  isWebBluetoothAvailable,
} from "@/lib/ble/web-bluetooth-treadmill";

/** Browser capability never changes for the life of the page. */
const noopSubscribe = () => () => {};

export interface BluetoothSupport {
  /** Null during server rendering and the hydrating pass, when it is unknown. */
  supported: boolean | null;
  secureContext: boolean;
}

/**
 * Reports whether this browser can use Web Bluetooth.
 *
 * `navigator.bluetooth` cannot be read while rendering on the server, so this
 * goes through `useSyncExternalStore` with a server snapshot of "unknown". React
 * hydrates with the server value and immediately re-renders with the real one,
 * which avoids both a hydration mismatch and a wrongly-flashed warning.
 */
export function useBluetoothSupport(): BluetoothSupport {
  const supported = useSyncExternalStore<boolean | null>(
    noopSubscribe,
    isWebBluetoothAvailable,
    () => null,
  );

  const secureContext = useSyncExternalStore(
    noopSubscribe,
    isSecureContextForBluetooth,
    () => true,
  );

  return { supported, secureContext };
}
