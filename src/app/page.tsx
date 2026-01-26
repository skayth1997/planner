"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import PlannerCanvas, {
  PlannerCanvasHandle,
  SelectedInfo,
} from "@/components/canvas/planner-canvas/planner-canvas";

const btnAdd =
  "px-3 py-2 rounded border border-blue-300 bg-blue-600 text-white hover:bg-blue-500 active:bg-blue-700 transition-colors text-sm";

const btnPrimary =
  "px-3 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700 transition-colors text-sm";

const btnSecondaryEnabled =
  "px-3 py-2 rounded border border-neutral-400 bg-white text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200 transition-colors text-sm";

const btnSecondaryDisabled =
  "px-3 py-2 rounded border border-neutral-300 bg-white text-neutral-400 opacity-50 cursor-not-allowed text-sm";

const btnDangerEnabled =
  "px-3 py-2 rounded border border-red-300 bg-red-600 text-white hover:bg-red-500 active:bg-red-700 transition-colors text-sm";

const btnDangerDisabled =
  "px-3 py-2 rounded border border-red-200 bg-red-50 text-red-300 opacity-50 cursor-not-allowed text-sm";

export default function HomePage() {
  const canvasRef = useRef<PlannerCanvasHandle | null>(null);
  const [selected, setSelected] = useState<SelectedInfo | null>(null);

  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [a, setA] = useState("");

  const onSelectionChange = useCallback((info: SelectedInfo | null) => {
    setSelected(info);

    if (!info) {
      setW("");
      setH("");
      setA("");
      return;
    }

    setW(String(Math.round(info.width)));
    setH(String(Math.round(info.height)));
    setA(String(Math.round(info.angle)));
  }, []);

  const applyProps = () => {
    if (!selected) return;

    const nextW = Number(w);
    const nextH = Number(h);
    const nextA = Number(a);

    canvasRef.current?.setSelectedProps({
      width: Number.isFinite(nextW) ? nextW : undefined,
      height: Number.isFinite(nextH) ? nextH : undefined,
      angle: Number.isFinite(nextA) ? nextA : undefined,
    });
  };

  const header = useMemo(() => {
    if (!selected) return "No selection";
    return `${selected.type.toUpperCase()} • ${selected.id}`;
  }, [selected]);

  const isDisabled = selected === null;

  return (
    <main className="w-screen h-screen grid grid-cols-[320px_1fr] bg-neutral-100">
      <aside className="p-4 border-r border-neutral-300 bg-white flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-700">Planner</h1>
          <p className="text-sm text-neutral-500">
            Scroll = zoom • Hold <b>Space</b> = pan • Select item to edit
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-neutral-700">Add furniture</div>
          <div className="flex flex-col gap-2">
            <button type="button" className={btnAdd} onClick={() => canvasRef.current?.addFurniture("sofa")}>
              Add Sofa
            </button>
            <button type="button" className={btnAdd} onClick={() => canvasRef.current?.addFurniture("table")}>
              Add Table
            </button>
            <button type="button" className={btnAdd} onClick={() => canvasRef.current?.addFurniture("chair")}>
              Add Chair
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">Selection</div>
          <div className="text-sm text-neutral-800">{header}</div>

          {!selected ? (
            <p className="text-sm text-neutral-500 mt-2">
              Click an item on the canvas to see properties here.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs text-neutral-600">
                  Width
                  <input
                    value={w}
                    onChange={(e) => setW(e.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm bg-white"
                    inputMode="numeric"
                  />
                </label>

                <label className="text-xs text-neutral-600">
                  Height
                  <input
                    value={h}
                    onChange={(e) => setH(e.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm bg-white"
                    inputMode="numeric"
                  />
                </label>

                <label className="text-xs text-neutral-600">
                  Angle
                  <input
                    value={a}
                    onChange={(e) => setA(e.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm bg-white"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  className={isDisabled ? btnSecondaryDisabled : btnPrimary}
                  disabled={isDisabled}
                  onClick={applyProps}
                >
                  Apply
                </button>

                <button
                  type="button"
                  className={isDisabled ? btnSecondaryDisabled : btnSecondaryEnabled}
                  disabled={isDisabled}
                  onClick={() => canvasRef.current?.duplicateSelected()}
                >
                  Duplicate
                </button>

                <button
                  type="button"
                  className={`ml-auto ${isDisabled ? btnDangerDisabled : btnDangerEnabled}`}
                  disabled={isDisabled}
                  onClick={() => canvasRef.current?.deleteSelected()}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Always enabled + clearly visible */}
        <button type="button" className={btnPrimary} onClick={() => canvasRef.current?.fitRoom()}>
          Fit room to view
        </button>

        <div className="mt-auto text-xs text-neutral-500">
          Pro tip: Use Delete / Backspace to remove selected item.
        </div>
      </aside>

      <section className="p-4">
        <div className="w-full h-full">
          <PlannerCanvas ref={canvasRef} onSelectionChange={onSelectionChange} />
        </div>
      </section>
    </main>
  );
}
