"use client";

import { useSyncExternalStore } from "react";

// A store that never changes: the whole signal is that React reads the server
// snapshot during hydration and the client snapshot everywhere else.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * `false` during the server render and during the hydration render that has to
 * match it; `true` from the commit after hydration onwards — **and on the very
 * first render of a component that mounts client-side**, which never had a
 * server render to match.
 *
 * That last clause is the reason this is `useSyncExternalStore` and not the
 * usual `useState(false)` + `useEffect(() => setMounted(true))`. A mounted flag
 * is false on the first render of *every* instance, so it would cost every
 * click-opened panel in the app an extra commit before it appears. React only
 * takes `getServerSnapshot` while it is hydrating, so a panel opened by a click
 * — which is all of them except the Outreach workspace on a direct `?item=`
 * load — renders on its first pass exactly as it did before this hook existed.
 *
 * Use it to gate anything that cannot exist in server HTML (a `createPortal`,
 * a `window` measurement) on a component that can be *open on first render*.
 * A component that is only ever opened by a later interaction does not need it.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
