import type { Canvas } from "fabric";

type BoolRef = { current: boolean };

type AttachKeyboardArgs = {
  canvas: Canvas;

  // key state refs (shared with mouse/pan etc.)
  isSpacePressedRef: BoolRef;
  isShiftPressedRef: BoolRef;
  isAltPressedRef: BoolRef;

  // for arrow step
  getGridSize: () => number;

  // actions implemented in planner-canvas.tsx
  actions: {
    moveLayer: (dir: "up" | "down", toEdge: boolean) => void;
    nudgeSelected: (dx: number, dy: number, skipClamp: boolean) => void;
    copySelected: () => void;
    paste: () => void;
    undo: () => void;
    redo: () => void;
    deleteSelected: () => void;
  };
};

function isTypingTarget(target: EventTarget | null) {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

function isMac() {
  return navigator.platform.toLowerCase().includes("mac");
}

export function attachKeyboardController(args: AttachKeyboardArgs) {
  const {
    canvas,
    isSpacePressedRef,
    isShiftPressedRef,
    isAltPressedRef,
    getGridSize,
    actions,
  } = args;

  const handleKeyDown = (e: KeyboardEvent) => {
    // modifier state
    if (e.code === "Space") {
      isSpacePressedRef.current = true;
      canvas.defaultCursor = "grab";
    }
    if (e.key === "Shift") isShiftPressedRef.current = true;
    if (e.key === "Alt") isAltPressedRef.current = true;

    const mod = isMac() ? e.metaKey : e.ctrlKey;

    // Layers: [ ] (Shift => to edge)
    if (e.key === "[" || e.key === "]") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();

      const toEdge = e.shiftKey;
      if (e.key === "]") actions.moveLayer("up", toEdge);
      if (e.key === "[") actions.moveLayer("down", toEdge);
      return;
    }

    // Arrow nudge
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();

      const grid = getGridSize();
      const step = e.shiftKey ? grid : 1;
      const skipClamp = isAltPressedRef.current;

      if (e.key === "ArrowLeft") actions.nudgeSelected(-step, 0, skipClamp);
      if (e.key === "ArrowRight") actions.nudgeSelected(step, 0, skipClamp);
      if (e.key === "ArrowUp") actions.nudgeSelected(0, -step, skipClamp);
      if (e.key === "ArrowDown") actions.nudgeSelected(0, step, skipClamp);
      return;
    }

    // Copy / paste
    if (mod && e.key.toLowerCase() === "c") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      actions.copySelected();
      return;
    }

    if (mod && e.key.toLowerCase() === "v") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      actions.paste();
      return;
    }

    // Undo / redo
    if (mod && e.key.toLowerCase() === "z") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      if (e.shiftKey) actions.redo();
      else actions.undo();
      return;
    }

    if (mod && e.key.toLowerCase() === "y") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      actions.redo();
      return;
    }

    // Delete
    if (e.key === "Delete" || e.key === "Backspace") {
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      actions.deleteSelected();
      return;
    }
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      isSpacePressedRef.current = false;
      canvas.defaultCursor = "default";
    }
    if (e.key === "Shift") isShiftPressedRef.current = false;
    if (e.key === "Alt") isAltPressedRef.current = false;
  };

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);

  // cleanup
  return () => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
  };
}
