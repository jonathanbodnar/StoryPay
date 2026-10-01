'use client';

/**
 * Browser side of the secret Realtime topics (lib/realtime/topic.ts): turns a
 * logical channel name ("venue:<id>:leads") into the secret topic the server
 * broadcasts on. Lookups made in the same moment share one request, and
 * answers are kept for the life of the page (a topic never changes).
 */

import { useEffect, useState } from 'react';

const known = new Map<string, string | null>();
const waiting = new Map<string, Array<(topic: string | null) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  flushTimer = null;
  const names = [...waiting.keys()];
  if (!names.length) return;
  const callbacks = new Map(waiting);
  waiting.clear();
  let topics: Record<string, string> = {};
  let failed = false;
  try {
    const res = await fetch('/api/realtime/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
      cache: 'no-store',
    });
    if (res.ok) topics = ((await res.json()) as { topics?: Record<string, string> }).topics ?? {};
    else failed = true;
  } catch {
    failed = true;
  }
  for (const name of names) {
    const topic = topics[name] ?? null;
    // A refusal is remembered; a network failure isn't, so the next mount retries.
    if (!failed) known.set(name, topic);
    for (const cb of callbacks.get(name) ?? []) cb(topic);
  }
}

/** The secret topic for a logical channel name, or null when this user may not listen on it. */
export function resolveTopic(name: string): Promise<string | null> {
  if (known.has(name)) return Promise.resolve(known.get(name) ?? null);
  return new Promise((resolve) => {
    const list = waiting.get(name);
    if (list) list.push(resolve);
    else waiting.set(name, [resolve]);
    if (!flushTimer) flushTimer = setTimeout(() => { void flush(); }, 0);
  });
}

/** Hook form: null until resolved (or when not allowed). */
export function useResolvedTopic(name: string | null): string | null {
  const [resolved, setResolved] = useState<{ name: string; topic: string | null } | null>(
    () => (name && known.has(name) ? { name, topic: known.get(name) ?? null } : null),
  );
  useEffect(() => {
    if (!name) return;
    let live = true;
    void resolveTopic(name).then((topic) => { if (live) setResolved({ name, topic }); });
    return () => { live = false; };
  }, [name]);
  return name && resolved?.name === name ? resolved.topic : null;
}

/** Several names at once; the result lists only the ones this user may listen on. */
export function useResolvedTopics(names: string[]): string[] {
  const key = names.slice().sort().join('|');
  const [resolved, setResolved] = useState<{ key: string; topics: string[] }>({ key: '', topics: [] });
  useEffect(() => {
    if (!key) return;
    let live = true;
    const list = key.split('|');
    void Promise.all(list.map(resolveTopic)).then((topics) => {
      if (live) setResolved({ key, topics: topics.filter((t): t is string => !!t) });
    });
    return () => { live = false; };
  }, [key]);
  return resolved.key === key ? resolved.topics : [];
}
