import { describe, expect, it } from "vitest";
import {
  normalizeOutpatientDetail,
  normalizeOutpatientDetails,
  outpatientDetailsForSession
} from "./outpatient-details.js";

describe("outpatient detail normalization", () => {
  it("normalizes clinic, attending, task, and notes labels without adding schedule meaning", () => {
    expect(normalizeOutpatientDetail({
      clinic: "  Continuity   Clinic  ",
      attending: "  Dr.  Alder ",
      task: "  new patients ",
      notes: "  use room 3 "
    })).toEqual({
      clinic: "Continuity Clinic",
      attending: "Dr. Alder",
      task: "new patients",
      notes: "use room 3"
    });
  });

  it("drops empty future details but keeps filled ones in order", () => {
    expect(normalizeOutpatientDetails([
      { clinic: " " },
      { clinic: "TCH", attending: "Dogwood" },
      null,
      { task: "Inbasket" }
    ])).toEqual([
      { clinic: "TCH", attending: "Dogwood", task: "", notes: "" },
      { clinic: "", attending: "", task: "Inbasket", notes: "" }
    ]);
  });

  it("turns a legacy flat outpatient session into one synthetic detail", () => {
    expect(outpatientDetailsForSession({
      id: "out-1",
      clinic: "Continuity (12) @South",
      provider: "Alder"
    })).toEqual([
      {
        clinic: "Continuity (12) @South",
        attending: "Alder",
        task: "",
        notes: "",
        synthetic: true
      }
    ]);
  });

  it("uses real details when present instead of inferring them from the parent label", () => {
    expect(outpatientDetailsForSession({
      id: "out-2",
      clinic: "Outpatient (clinic TBD)",
      provider: "",
      details: [
        { clinic: "Resident Continuity", attending: "Birch", notes: "Room 4" },
        { task: "Inbox follow-up" }
      ]
    })).toEqual([
      {
        clinic: "Resident Continuity",
        attending: "Birch",
        task: "",
        notes: "Room 4",
        synthetic: false
      },
      {
        clinic: "",
        attending: "",
        task: "Inbox follow-up",
        notes: "",
        synthetic: false
      }
    ]);
  });
});
