"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PlannerCanvas from "@/components/canvas/planner-canvas/planner-canvas";
import type {
  PlannerCanvasHandle,
  SelectedInfo,
} from "@/components/canvas/planner-canvas/core/planner-types";
import { GRID_SIZE } from "@/components/canvas/planner-canvas/core/planner-constants";

function cls(...x: Array<string | false | undefined>) {
  return x.filter(Boolean).join(" ");
}

const btnBase =
  "px-3 py-2 rounded border text-sm transition-colors select-none";

const btnPrimary =
  "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 active:bg-blue-200";

const btnNeutral =
  "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 active:bg-neutral-200";

const btnDanger =
  "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200";

const btnDark =
  "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800 active:bg-neutral-700";

const btnDisabled =
  "opacity-40 cursor-not-allowed hover:bg-inherit hover:border-inherit active:bg-inherit";

export default function HomePage() {
  const canvasRef = useRef<PlannerCanvasHandle | null>(null);
  const [selected, setSelected] = useState<SelectedInfo | null>(null);

  const [w, setW] = useState<string>("");
  const [h, setH] = useState<string>("");
  const [a, setA] = useState<string>("");

  const [importText, setImportText] = useState("");

  const [roomW, setRoomW] = useState<string>("600");
  const [roomH, setRoomH] = useState<string>("400");

  const [gridVisible, setGridVisible] = useState(true);
  const [gridSize, setGridSize] = useState<number>(GRID_SIZE);

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

  const applyRoom = () => {
    const wNum = Number(roomW);
    const hNum = Number(roomH);
    if (!Number.isFinite(wNum) || !Number.isFinite(hNum)) return;

    canvasRef.current?.setRoomSize({
      width: wNum,
      height: hNum,
    });
  };

  const syncRoomFromCanvas = () => {
    const size = canvasRef.current?.getRoomSize();
    if (!size) return;
    setRoomW(String(Math.round(size.width)));
    setRoomH(String(Math.round(size.height)));
  };

  useEffect(() => {
    const v = localStorage.getItem("planner:gridVisible");
    const s = localStorage.getItem("planner:gridSize");

    if (v != null) setGridVisible(v === "true");
    if (s != null) setGridSize(Number(s) || 50);
  }, []);

  useEffect(() => {
    localStorage.setItem("planner:gridVisible", String(gridVisible));
    localStorage.setItem("planner:gridSize", String(gridSize));
  }, [gridVisible, gridSize]);

  useEffect(() => {
    canvasRef.current?.setGridVisible(gridVisible);
    canvasRef.current?.setGridSize(gridSize);
  }, [gridVisible, gridSize]);

  return (
    <main className="w-screen h-screen grid grid-cols-[340px_1fr] bg-neutral-100">
      <aside className="p-4 border-r border-neutral-300 bg-white flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Planner</h1>
          <p className="text-sm text-neutral-500">
            Scroll = zoom • Hold <b>Space</b> = pan • Shift = step move • [ ]
            layers • Hold Shift = free move
          </p>
        </div>

        {/* ROOM */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">
            Room
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-600">
              Width
              <input
                value={roomW}
                onChange={(e) => setRoomW(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                inputMode="numeric"
              />
            </label>

            <label className="text-xs text-neutral-600">
              Height
              <input
                value={roomH}
                onChange={(e) => setRoomH(e.target.value)}
                className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                inputMode="numeric"
              />
            </label>
          </div>

          <div className="flex gap-2 mt-2">
            <button className={cls(btnBase, btnDark)} onClick={applyRoom}>
              Apply
            </button>
            <button
              className={cls(btnBase, btnNeutral)}
              onClick={syncRoomFromCanvas}
            >
              Read
            </button>
          </div>
        </div>

        {/* GRID */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">
            Grid
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input
              type="checkbox"
              checked={gridVisible}
              onChange={(e) => {
                const v = e.target.checked;
                setGridVisible(v);
                canvasRef.current?.setGridVisible(v);
              }}
            />
            Show grid
          </label>

          <label className="text-xs text-neutral-600 mt-3 block">
            Grid size
            <select
              className="mt-1 w-full rounded border border-neutral-300 px-2 py-2 text-sm"
              value={gridSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setGridSize(size);
                canvasRef.current?.setGridSize(size);
              }}
            >
              {[10, 20, 25, 50, 100].map((s) => (
                <option key={s} value={s}>
                  {s}px
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ACTIONS */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <div className="text-sm font-semibold text-neutral-700 mb-2">
            Actions
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.undo()}
            >
              Undo
            </button>
            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.redo()}
            >
              Redo
            </button>

            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.save()}
            >
              Save
            </button>
            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.load()}
            >
              Load
            </button>

            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.exportJson()}
            >
              Export JSON
            </button>
            <button
              className={cls(btnBase, btnNeutral)}
              onClick={() => canvasRef.current?.importJsonString(importText)}
            >
              Import JSON
            </button>
          </div>

          <button
            className={cls(btnBase, btnDark, "w-full mt-2")}
            onClick={() => canvasRef.current?.fitRoom()}
          >
            Fit room to view
          </button>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste JSON here to import…"
            className="mt-2 w-full h-24 rounded border border-neutral-300 p-2 text-xs font-mono text-neutral-900"
          />
        </div>

        {/* ADD */}
        <div className="flex flex-col gap-2">
          <div className="text-sm font-semibold text-neutral-700">
            Add furniture
          </div>

          <button
            className={cls(btnBase, btnPrimary, "w-full")}
            onClick={() => canvasRef.current?.addFurniture("sofa")}
          >
            Add Sofa
          </button>
          <button
            className={cls(btnBase, btnPrimary, "w-full")}
            onClick={() => canvasRef.current?.addFurniture("table")}
          >
            Add Table
          </button>
          <button
            className={cls(btnBase, btnPrimary, "w-full")}
            onClick={() => canvasRef.current?.addFurniture("chair")}
          >
            Add Chair
          </button>
          <button
            className={cls(btnBase, btnPrimary, "w-full")}
            onClick={() => canvasRef.current?.addWindow()}
          >
            Add Window
          </button>
          <button
            className={cls(btnBase, btnPrimary, "w-full")}
            onClick={() => canvasRef.current?.addDoor()}
          >
            Add door
          </button>
        </div>

        {/* SELECTION */}
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
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
                  className={cls(btnBase, btnDark, !canEdit && btnDisabled)}
                  disabled={!canEdit}
                  onClick={applyProps}
                >
                  Apply
                </button>

                <button
                  className={cls(btnBase, btnNeutral, !canEdit && btnDisabled)}
                  disabled={!canEdit}
                  onClick={() => canvasRef.current?.duplicateSelected()}
                >
                  Duplicate
                </button>

                <button
                  className={cls(
                    btnBase,
                    btnDanger,
                    "ml-auto",
                    !canEdit && btnDisabled
                  )}
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
          Pro tip: Ctrl/⌘+C/V copy/paste • Arrows nudge • Shift+Arrows grid step
          • Alt bypass clamp
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
    </main>
  );
}
