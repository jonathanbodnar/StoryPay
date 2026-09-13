'use client';

/**
 * useAutoSaveDoc — shared auto-save state machine for the Wedding Planner editors
 * (checklist / vendors / budget). Mirrors the hand-rolled logic in
 * InspirationBoard: everything auto-saves, discrete actions save immediately,
 * continuous typing is debounced, and a `rev` token drives optimistic
 * concurrency so a venue + couple editing the same doc never silently clobber.
 *
 * Refs (not state) back the async/debounced path so it always reads the latest
 * values regardless of React's render/batch timing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoSaveResult<T> {
  ok: boolean;
  conflict?: boolean;
  doc?: T;
}

export function useAutoSaveDoc<T extends { rev: number }>(
  initial: T,
  onSave: (next: T) => Promise<AutoSaveResult<T>>,
  debounceMs = 900,
) {
  const [doc, setDocState] = useState<T>(initial);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');

  const docRef = useRef<T>(initial);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const rerunRef = useRef(false);

  const persist = useCallback(async () => {
    if (savingRef.current) {
      rerunRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const res = await onSaveRef.current(docRef.current);
      if (res.conflict) {
        if (res.doc) {
          docRef.current = res.doc;
          setDocState(res.doc);
        }
        setConflict(true);
        return;
      }
      if (!res.ok) {
        setError('Could not save. Please try again.');
        return;
      }
      if (res.doc) {
        docRef.current = res.doc;
        setDocState(res.doc);
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } finally {
      setSaving(false);
      savingRef.current = false;
      if (rerunRef.current) {
        rerunRef.current = false;
        void persist();
      }
    }
  }, []);

  /** Apply a local change and auto-save it. `immediate` for discrete actions
   * (add/remove/toggle), debounced for continuous typing. Pass `save: false` to
   * update local state WITHOUT persisting yet — used when adding an empty row
   * that a tolerant server reader would otherwise strip on save (e.g. a blank
   * vendor). The next real edit to that row will persist it. */
  const update = useCallback(
    (updater: (prev: T) => T, opts?: { immediate?: boolean; save?: boolean }) => {
      const next = updater(docRef.current);
      docRef.current = next;
      setDocState(next);
      setConflict(false);
      if (opts?.save === false) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (opts?.immediate) {
        void persist();
      } else {
        timerRef.current = setTimeout(() => void persist(), debounceMs);
      }
    },
    [persist, debounceMs],
  );

  // Flush a pending debounced save if the editor unmounts.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void persist();
      }
    },
    [persist],
  );

  return { doc, update, saving, savedFlash, conflict, error };
}
