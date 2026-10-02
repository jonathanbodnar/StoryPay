import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/** True when rendering in the browser, false during server rendering. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}
