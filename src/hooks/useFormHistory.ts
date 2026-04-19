import { useCallback, useMemo, useReducer } from 'react';

const MAX = 80;

type State<T> = { past: T[]; present: T; future: T[] };

type Action<T> =
  | { type: 'set'; payload: T | ((prev: T) => T) }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; payload: T };

function reducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'set': {
      const next =
        typeof action.payload === 'function'
          ? (action.payload as (prev: T) => T)(state.present)
          : action.payload;
      if (next === state.present) return state;
      return {
        past: [...state.past.slice(-(MAX - 1)), state.present],
        present: next,
        future: [],
      };
    }
    case 'undo': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        past: [...state.past, state.present],
        present: next!,
        future: rest,
      };
    }
    case 'reset':
      return { past: [], present: action.payload, future: [] };
    default:
      return state;
  }
}

/** Undo/redo for JSON-serializable form editor state. */
export function useFormHistory<T>(initial: T) {
  const [state, dispatch] = useReducer(reducer<T>, {
    past: [],
    present: initial,
    future: [],
  } as State<T>);

  const set = useCallback((next: T | ((prev: T) => T)) => {
    dispatch({ type: 'set', payload: next });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: 'redo' });
  }, []);

  const reset = useCallback((value: T) => {
    dispatch({ type: 'reset', payload: value });
  }, []);

  return useMemo(
    () => ({
      present: state.present,
      set,
      undo,
      redo,
      reset,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state.present, state.past.length, state.future.length, set, undo, redo, reset],
  );
}
