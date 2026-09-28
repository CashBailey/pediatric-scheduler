// U3 — undo/redo history (Ctrl+Z). The reducer-ish logic is pure and lives in
// App.jsx as recordUndo/applyUndo/applyRedo so it can be tested in isolation.
import { describe, it, expect } from "vitest";
import { recordUndo, applyUndo, applyRedo, MAX_UNDO_HISTORY } from "./App.jsx";

describe("U3 — undo/redo history helpers", () => {
  const empty = { past: [], future: [] };

  it("recordUndo pushes the current state and clears the redo stack", () => {
    const h1 = recordUndo(empty, "A", "B");
    expect(h1.past).toEqual(["A"]);
    expect(h1.future).toEqual([]);
    // A fresh change invalidates any pending redo.
    const h2 = recordUndo({ past: ["A"], future: ["C"] }, "B", "D");
    expect(h2.past).toEqual(["A", "B"]);
    expect(h2.future).toEqual([]);
  });

  it("recordUndo ignores no-op changes (next === current) — same reference back", () => {
    const h = { past: ["A"], future: [] };
    expect(recordUndo(h, "B", "B")).toBe(h);
  });

  it("recordUndo is StrictMode-safe: same input → same output (no double push)", () => {
    const h = { past: ["A"], future: [] };
    expect(recordUndo(h, "B", "C")).toEqual(recordUndo(h, "B", "C"));
  });

  it("recordUndo caps the past at MAX_UNDO_HISTORY", () => {
    let h = empty;
    for (let i = 0; i < MAX_UNDO_HISTORY + 10; i++) h = recordUndo(h, `s${i}`, `s${i + 1}`);
    expect(h.past.length).toBe(MAX_UNDO_HISTORY);
    expect(h.past[h.past.length - 1]).toBe(`s${MAX_UNDO_HISTORY + 9}`);
  });

  it("applyUndo restores the previous state and stacks the current for redo", () => {
    const r = applyUndo({ past: ["A", "B"], future: [] }, "C");
    expect(r.state).toBe("B");
    expect(r.history.past).toEqual(["A"]);
    expect(r.history.future).toEqual(["C"]);
  });

  it("applyUndo / applyRedo return null when their stack is empty", () => {
    expect(applyUndo(empty, "A")).toBe(null);
    expect(applyRedo(empty, "A")).toBe(null);
  });

  it("undo then redo round-trips back to the original state and history", () => {
    const start = { past: ["A"], future: [] };
    const undone = applyUndo(start, "B");
    expect(undone.state).toBe("A");
    const redone = applyRedo(undone.history, undone.state);
    expect(redone.state).toBe("B");
    expect(redone.history).toEqual(start);
  });
});
