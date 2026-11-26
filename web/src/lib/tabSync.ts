/**
 * Messages between open Arc40 tabs in this browser (BroadcastChannel: same origin and port only,
 * never leaves the browser). The user keeps several tabs open, so when one tab switches between real
 * and demo data, every other tab reloads into the new mode instead of showing the old data.
 */
export type TabMessage = { type: 'mode-changed' } | { type: 'theme-changed'; theme: string };

const channel: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('arc40');

export function broadcast(msg: TabMessage): void {
  channel?.postMessage(msg);
}

/** Subscribes to messages from OTHER tabs (a tab never receives its own). Returns an unsubscribe function. */
export function onTabMessage(fn: (msg: TabMessage) => void): () => void {
  if (!channel) return () => {};
  const handler = (e: MessageEvent<TabMessage>) => fn(e.data);
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}
