import PlannerCanvas from "@/components/canvas/planner-canvas/planner-canvas";

export default function HomePage() {
  const buttonClass =
    "px-3 py-2 rounded border border-blue-200 bg-blue-50 text-blue-700 " +
    "hover:bg-blue-100 hover:border-blue-300 active:bg-blue-200 " +
    "transition-colors";

  return (
    <main className="w-screen h-screen grid grid-cols-[260px_1fr] bg-neutral-100">
      <aside className="p-4 border-r border-neutral-300 bg-white">
        <h1 className="text-lg font-semibold mb-4">Furniture</h1>

        <div className="flex flex-col gap-2">
          <button id="add-sofa" className={buttonClass}>
            Add Sofa
          </button>
          <button id="add-table" className={buttonClass}>
            Add Table
          </button>
          <button id="add-chair" className={buttonClass}>
            Add Chair
          </button>
        </div>

        <p className="text-sm text-neutral-500 mt-4">
          Tip: Hold <b>Space</b> to pan, scroll to zoom.
        </p>
      </aside>

      <section className="p-6">
        <PlannerCanvas />
      </section>
    </main>
  );
}
