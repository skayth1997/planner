import type { Canvas } from "fabric";

type Actions = {
  moveLayer: (dir: "up" | "down", toEdge: boolean) => void;
  nudgeSelected: (dx: number, dy: number, skipClamp?: boolean) => void;
  copySelected: () => void;
  paste: () => void;
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
};

type Args = {
  canvas: Canvas;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  isShiftPressedRef: React.MutableRefObject<boolean>;
  isAltPressedRef: React.MutableRefObject<boolean>;
  getGridSize: () => number;
  actions: Actions;
};

function isEditableTarget(target: any) {
  const el = target as HTMLElement | null;
  if (!el) return false;

  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;

  // contenteditable (incl. tiptap etc.)
  if ((el as any).isContentEditable) return true;

  return false;
}

function isMacPlatform() {
  // good enough for shortcuts behavior
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  );
}

export function attachKeyboardController(args: Args) {
  const {
    canvas,
    isSpacePressedRef,
    isShiftPressedRef,
    isAltPressedRef,
    getGridSize,
    actions,
  } = args;

  const isMac = isMacPlatform();

  const clearMods = () => {
    isSpacePressedRef.current = false;
    isShiftPressedRef.current = false;
    isAltPressedRef.current = false;
  };

  const onWindowBlur = () => {
    // important: prevents “stuck Space/Shift/Alt”
    clearMods();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isEditableTarget(e.target)) return;

    // track modifier refs (global, consistent)
    if (e.key === " " || e.code === "Space") isSpacePressedRef.current = true;
    if (e.key === "Shift") isShiftPressedRef.current = true;
    if (e.key === "Alt") isAltPressedRef.current = true;

    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    const anyCtrlCmd = e.ctrlKey || e.metaKey; // allow both, feels nicer

    // ===== Shortcuts (Ctrl/⌘ behavior only) =====
    if (anyCtrlCmd) {
      const k = e.key.toLowerCase();

      // copy
      if (k === "c") {
        e.preventDefault();
        actions.copySelected();
        return;
      }

      // paste
      if (k === "v") {
        e.preventDefault();
        actions.paste();
        return;
      }

      // undo
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        actions.undo();
        return;
      }

      // redo (⌘+Shift+Z on mac / ctrl+shift+z on win)
      if (k === "z" && e.shiftKey) {
        e.preventDefault();
        actions.redo();
        return;
      }

      // redo (ctrl+y on windows)
      if (k === "y") {
        e.preventDefault();
        actions.redo();
        return;
      }

      // let other ctrl/cmd combos pass through
      return;
    }

    // ===== Delete =====
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      actions.deleteSelected();
      return;
    }

    // ===== Layers ([ ]) =====
    // ] => up, [ => down
    if (e.code === "BracketRight" || e.key === "]") {
      e.preventDefault();
      const toEdge = e.shiftKey; // Shift+] => bring to front
      actions.moveLayer("up", toEdge);
      return;
    }

    if (e.code === "BracketLeft" || e.key === "[") {
      e.preventDefault();
      const toEdge = e.shiftKey; // Shift+[ => send to back
      actions.moveLayer("down", toEdge);
      return;
    }

    // ===== Nudging (arrows) =====
    const isArrow =
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight";

    if (isArrow) {
      e.preventDefault();

      const step = e.shiftKey ? getGridSize() : 1;
      const skipClamp = e.altKey; // Alt => bypass constraints

      let dx = 0;
      let dy = 0;

      if (e.key === "ArrowUp") dy = -step;
      if (e.key === "ArrowDown") dy = step;
      if (e.key === "ArrowLeft") dx = -step;
      if (e.key === "ArrowRight") dx = step;

      actions.nudgeSelected(dx, dy, skipClamp);
      return;
    }

    if (e.key === "Escape") {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " " || e.code === "Space") isSpacePressedRef.current = false;
    if (e.key === "Shift") isShiftPressedRef.current = false;
    if (e.key === "Alt") isAltPressedRef.current = false;
  };

  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp);

  return () => {
    window.removeEventListener("blur", onWindowBlur);
    window.removeEventListener("keydown", onKeyDown as any);
    window.removeEventListener("keyup", onKeyUp as any);
    clearMods();
  };
}
