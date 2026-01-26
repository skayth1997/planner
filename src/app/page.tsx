"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import PlannerCanvas, {
  PlannerCanvasHandle,
  SelectedInfo,
} from "@/components/canvas/planner-canvas/planner-canvas";

const buttonClass =
  "px-3 py-2 rounded border border-blue-200 bg-blue-50 text-blue-700 " +
  "hover:bg-blue-100 hover:border-blue-300 active:bg-blue-200 transition-colors text-sm";

const buttonNeutral =
  "px-3 py-2 rounded border border-neutral-300 bg-white text-neutral-900 " +
  "hover:bg-neutral-100 active:bg-neutral-200 transition-colors text-sm " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

export default function HomePage() {
  const canvasRef = useRef<PlannerCanvasHandle | null>(null);
  const [selected, setSelected] = useState<SelectedInfo | null>(null);

  // local edit fields
  const [w, setW] = useState<string>("");
  const [h, setH] = useState<string>("");
  const [a, setA] = useState<string>("");

  // import modal
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

  const onSelectionChange = useCallback((info: SelectedInfo | null) => {
    setSelected(info);

    if (!info) {
      setW("");
      setH("");
      setA("");
      return;
    }

    setW(Math.round(info.width).toString());
    setH(Math.round(info.height).toString());
    setA(Math.round(info.angle).toString());
  }, []);

  const canEdit = !!selected;

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

  const openImport = () => {
    setImportText("");
    setIsImportOpen(true);
  };

  const runImport = () => {
    try {
      canvasRef.current?.importJsonString(importText);
      setIsImportOpen(false);
      setImportText("");
    } catch {
      alert("Invalid JSON. Please paste exported planner JSON.");
    }
  };

  return (
    <main className="w-screen h-screen grid grid-cols-[360px_1fr] bg-neutral-100">
      <aside className="p-4 border-r border-neutral-300 bg-white flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold">Planner</h1>
          <p className="text-sm text-neutral-500">
            Scroll = zoom • Hold <b>Space</b> = pan • Select item to edit
          </p>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">
            Actions
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={buttonNeutral}
              onClick={() => canvasRef.current?.undo()}
            >
              Undo
            </button>
            <button
              className={buttonNeutral}
              onClick={() => canvasRef.current?.redo()}
            >
              Redo
            </button>

            <button
              className={buttonNeutral}
              onClick={() => canvasRef.current?.save()}
            >
              Save
            </button>
            <button
              className={buttonNeutral}
              onClick={() => canvasRef.current?.load()}
            >
              Load
            </button>

            <button
              className={buttonNeutral}
              onClick={() => canvasRef.current?.exportJson()}
            >
              Export JSON
            </button>
            <button
              className={buttonNeutral}
              onClick={() => setIsImportOpen(true)}
            >
              Import JSON
            </button>
          </div>

          <button
            className={`${buttonNeutral} w-full mt-2`}
            onClick={() => canvasRef.current?.fitRoom()}
          >
            Fit room to view
          </button>
        </div>

        {/* Add furniture */}
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-neutral-700">
            Add furniture
          </div>
          <div className="flex flex-col gap-2">
            <button
              className={buttonClass}
              onClick={() => canvasRef.current?.addFurniture("sofa")}
            >
              Add Sofa
            </button>
            <button
              className={buttonClass}
              onClick={() => canvasRef.current?.addFurniture("table")}
            >
              Add Table
            </button>
            <button
              className={buttonClass}
              onClick={() => canvasRef.current?.addFurniture("chair")}
            >
              Add Chair
            </button>
          </div>
        </div>

        {/* Selection panel */}
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">
            Selection
          </div>
          <div className="text-sm text-neutral-700">{header}</div>

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
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                    inputMode="numeric"
                  />
                </label>

                <label className="text-xs text-neutral-600">
                  Height
                  <input
                    value={h}
                    onChange={(e) => setH(e.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                    inputMode="numeric"
                  />
                </label>

                <label className="text-xs text-neutral-600">
                  Angle
                  <input
                    value={a}
                    onChange={(e) => setA(e.target.value)}
                    className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  disabled={!canEdit}
                  className="px-3 py-2 rounded bg-neutral-900 text-white
                             hover:bg-neutral-800 transition-colors text-sm
                             disabled:opacity-40"
                  onClick={applyProps}
                >
                  Apply
                </button>

                <button
                  className={`${buttonNeutral} disabled:opacity-40`}
                  disabled={!canEdit}
                  onClick={() => canvasRef.current?.duplicateSelected()}
                >
                  Duplicate
                </button>

                <button
                  className="ml-auto px-3 py-2 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200 transition-colors text-sm disabled:opacity-40"
                  disabled={!canEdit}
                  onClick={() => canvasRef.current?.deleteSelected()}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mt-auto text-xs text-neutral-500">
          Pro tip: Ctrl/Cmd+Z undo • Ctrl/Cmd+Shift+Z redo • Delete removes
          selection
        </div>
      </aside>

      <section className="p-4">
        <div className="w-full h-full">
          <PlannerCanvas
            ref={canvasRef}
            onSelectionChange={onSelectionChange}
          />
        </div>
      </section>

      {/* Import modal */}
      {isImportOpen && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-neutral-200 shadow-lg p-4">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">Import JSON</div>
              <button
                className={buttonNeutral}
                onClick={() => setIsImportOpen(false)}
              >
                Close
              </button>
            </div>

            <p className="text-sm text-neutral-500 mt-2">
              Paste JSON that you exported from Planner.
            </p>

            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              className="mt-3 w-full h-64 rounded border border-neutral-300 p-3 font-mono text-xs"
              placeholder='[{"left":...}]'
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                className={buttonNeutral}
                onClick={() => setIsImportOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700 transition-colors text-sm"
                onClick={runImport}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
