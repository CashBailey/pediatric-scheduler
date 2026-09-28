// Tests for src/storage.js Phase 8.1 additions: hydrateFromBackend +
// isBackendStateAuthoritative. The fetch-backed function is exercised
// with stubbed globalThis.fetch so the test never tries real network.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hydrateFromBackend,
  isBackendStateAuthoritative,
  saveSchedulerState
} from "./storage.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isBackendStateAuthoritative", () => {
  it("returns false for null / undefined / non-object input", () => {
    expect(isBackendStateAuthoritative(null)).toBe(false);
    expect(isBackendStateAuthoritative(undefined)).toBe(false);
    expect(isBackendStateAuthoritative("not-an-object")).toBe(false);
  });

  it("returns false for a fresh initial state (default 1 block, no rotators)", () => {
    const state = {
      version: 2,
      activeBlockId: "block-new",
      serviceBlocks: [{ id: "block-new" }],
      rotators: [],
      attendings: [],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    expect(isBackendStateAuthoritative(state)).toBe(false);
  });

  it("returns true when state has rotators", () => {
    const state = {
      serviceBlocks: [{ id: "block-1" }],
      rotators: [{ id: "r1" }],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    expect(isBackendStateAuthoritative(state)).toBe(true);
  });

  it("returns true when state has inpatient assignments", () => {
    const state = {
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [{ id: "in-1" }],
      outpatientSessions: []
    };
    expect(isBackendStateAuthoritative(state)).toBe(true);
  });

  it("returns true when state has outpatient sessions", () => {
    const state = {
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [{ id: "out-1" }]
    };
    expect(isBackendStateAuthoritative(state)).toBe(true);
  });

  it("returns true when state has more than one service block", () => {
    const state = {
      serviceBlocks: [{ id: "block-1" }, { id: "block-2" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: []
    };
    expect(isBackendStateAuthoritative(state)).toBe(true);
  });

  it("returns true when state only has reviewed source records", () => {
    const state = {
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      sources: [{ id: "source-manual-note", fileName: "Manual note" }]
    };
    expect(isBackendStateAuthoritative(state)).toBe(true);
  });

  it("returns true when state only has clinic assignments or half-day facts", () => {
    expect(isBackendStateAuthoritative({
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      clinicAssignments: [{ id: "clinic-1" }]
    })).toBe(true);
    expect(isBackendStateAuthoritative({
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      halfDayFacts: [{ id: "half-1" }]
    })).toBe(true);
  });

  it("returns true for customized expected sources or poster settings", () => {
    expect(isBackendStateAuthoritative({
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      expectedSourcePrograms: ["Methodist"]
    })).toBe(true);
    expect(isBackendStateAuthoritative({
      serviceBlocks: [{ id: "block-1" }],
      rotators: [],
      inpatientAssignments: [],
      outpatientSessions: [],
      posterSettings: { programName: "Custom Poster" }
    })).toBe(true);
  });
});

describe("hydrateFromBackend", () => {
  it("returns migrated state on successful response", async () => {
    const payload = { version: 2, serviceBlocks: [], rotators: [{ id: "r1" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload)
    }));
    const result = await hydrateFromBackend();
    expect(result.rotators[0]).toMatchObject({ id: "r1", segments: [], schoolType: "other" });
    expect(result.sources).toEqual([]);
    expect(result.clinicAssignments).toEqual([]);
    expect(result.posterSettings).toBeTruthy();
  });

  it("returns null on non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({})
    }));
    const result = await hydrateFromBackend();
    expect(result).toBe(null);
  });

  it("returns null on fetch network error (no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await hydrateFromBackend();
    expect(result).toBe(null);
  });

  it("returns null when fetch is not defined", async () => {
    vi.stubGlobal("fetch", undefined);
    const result = await hydrateFromBackend();
    expect(result).toBe(null);
  });
});

describe("saveSchedulerState", () => {
  it("serializes the migrated shape before saving", () => {
    vi.stubGlobal("fetch", undefined);
    const writes = {};
    const storage = {
      setItem: vi.fn((key, value) => {
        writes[key] = value;
      })
    };
    const result = saveSchedulerState({
      version: 2,
      serviceBlocks: [],
      rotators: [{ id: "r1" }]
    }, storage);
    expect(result.ok).toBe(true);
    const saved = JSON.parse(Object.values(writes)[0]);
    expect(saved.sources).toEqual([]);
    expect(saved.clinicAssignments).toEqual([]);
    expect(saved.rotators[0]).toMatchObject({ segments: [], schoolType: "other" });
  });
});
