import type { Canvas } from "fabric";

type Args = {
  canvas: Canvas;
  storageKey: string;
  scheduleRender: () => void;

  // serialization / restore are injected so controller stays dumb & reusable
  serialize: () => string;
  restore: (json: string) => void;

  // called after restore (restyle, clear guides, restack, etc.)
  onAfterRestore?: () => void;

  // optional: save extra state (ex: room points)
  autosaveExtra?: () => void;

  // autosave debounce
  autosaveMs?: number;

  // history limit
  limit?: number;
};

export function createHistoryController(args: Args) {
  const {
    canvas,
    storageKey,
    scheduleRender,
    serialize,
    restore,
    onAfterRestore,
    autosaveExtra,
    autosaveMs = 350,
    limit = 80,
  } = args;

  let history: string[] = [];
  let index = -1;

  let isApplying = false;

  let autosaveTimer: number | null = null;

  const scheduleAutosave = () => {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }

    autosaveTimer = window.setTimeout(() => {
      try {
        const json = serialize();
        localStorage.setItem(storageKey, json);
        autosaveExtra?.();
      } catch {}
    }, autosaveMs);
  };

  const setHistory = (snapshots: string[], nextIndex: number) => {
    history = snapshots;
    index = nextIndex;
  };

  const pushNow = () => {
    if (isApplying) return;

    const snap = serialize();
    const current = history[index];

    if (current === snap) {
      scheduleAutosave();
      return;
    }

    const next = history.slice(0, index + 1);
    next.push(snap);

    // limit
    if (next.length > limit) {
      next.shift();
      index = Math.max(-1, index - 1);
    }

    index = next.length - 1;
    history = next;

    scheduleAutosave();
  };

  const applySnapshot = (snap: string) => {
    isApplying = true;
    try {
      restore(snap);
    } finally {
      isApplying = false;
    }

    onAfterRestore?.();
    scheduleAutosave();
    scheduleRender();
  };

  const undo = () => {
    if (index <= 0) return;
    index -= 1;
    applySnapshot(history[index]);
  };

  const redo = () => {
    if (index >= history.length - 1) return;
    index += 1;
    applySnapshot(history[index]);
  };

  const initFromStorage = () => {
    const saved = localStorage.getItem(storageKey);

    if (saved) {
      try {
        applySnapshot(saved);
        setHistory([saved], 0);
        return { loaded: true };
      } catch {
        // fallthrough to fresh init
      }
    }

    // fresh init
    const snap = serialize();
    setHistory([snap], 0);
    scheduleAutosave();
    scheduleRender();
    return { loaded: false };
  };

  /**
   * Use this after load/import to reset undo/redo stack
   * to a single known snapshot.
   */
  const setHistoryFromSnapshot = (snap: string) => {
    setHistory([snap], 0);
    scheduleAutosave();
  };

  const dispose = () => {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
  };

  return {
    pushNow,
    undo,
    redo,
    initFromStorage,
    setHistoryFromSnapshot,
    dispose,
  };
}
