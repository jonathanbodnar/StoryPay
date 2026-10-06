import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Setup Guide's state in the browser. Opening the guide starts a load;
// ticking a step sends the tick and then reloads. Until Oct 6 2026 that reload
// shared the load already on its way, which the server had answered before the
// tick was saved: the step was ticked and the screen said it wasn't (the guide
// stayed at "7 of 8 done" after the last step was ticked).

interface Call { method: string; answer: (done: number) => void }

function serverThatWaits() {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (_url: string, init?: { method?: string }) => new Promise((resolve) => {
    calls.push({
      method: init?.method ?? 'GET',
      answer: (done) => resolve({ ok: true, json: async () => ({ display: { done } }) }),
    });
  }));
  return calls;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the Setup Guide on screen after a step is ticked', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a load that was already on its way doesn’t stand in for the reload after the tick', async () => {
    const calls = serverThatWaits();
    const guide = await import('@/lib/setup-guide-client');

    void guide.refreshSetupGuide();           // the guide opens
    const ticking = guide.tickSetupStep('follow_up'); // and the step is ticked straight away
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);

    calls[1].answer(8);                       // the tick is saved
    await settle();
    expect(calls.map((c) => c.method), 'a new load is asked for once the tick is saved').toEqual(['GET', 'POST', 'GET']);

    calls[2].answer(8);                       // the new load: every step done
    calls[0].answer(7);                       // the old one arrives last, from before the tick
    await ticking;
    await settle();
    expect((guide.getSetupGuideStatus() as unknown as { display: { done: number } }).display.done).toBe(8);
  });

  it('the old load’s answer isn’t shown even when it arrives first', async () => {
    const calls = serverThatWaits();
    const guide = await import('@/lib/setup-guide-client');

    void guide.refreshSetupGuide();
    const ticking = guide.tickSetupStep('follow_up');
    calls[0].answer(7);                       // from before the tick: not shown
    await settle();
    expect(guide.getSetupGuideStatus()).toBeNull();

    calls[1].answer(8);
    await settle();
    calls[2].answer(8);
    await ticking;
    expect((guide.getSetupGuideStatus() as unknown as { display: { done: number } }).display.done).toBe(8);
  });

  it('loads asked for at the same moment still share one request', async () => {
    const calls = serverThatWaits();
    const guide = await import('@/lib/setup-guide-client');

    const a = guide.refreshSetupGuide();
    const b = guide.refreshSetupGuide();
    expect(calls).toHaveLength(1);
    calls[0].answer(3);
    await Promise.all([a, b]);
    expect((guide.getSetupGuideStatus() as unknown as { display: { done: number } }).display.done).toBe(3);

    await guide.refreshSetupGuide(60_000);    // loaded a moment ago: no new request
    expect(calls).toHaveLength(1);
  });
});
