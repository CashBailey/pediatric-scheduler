import { describe, it, expect } from "vitest";
import { categoryForClinic, clinicCategoryLegend, OTHER_CATEGORY } from "./clinic-categories.js";

describe("categoryForClinic — keyword precedence", () => {
  it("maps clear category names to distinct buckets", () => {
    expect(categoryForClinic("TSC Clinic").key).toBe("tsc");
    expect(categoryForClinic("Epilepsy Clinic").key).toBe("epilepsy");
    expect(categoryForClinic("Movement Disorders").key).toBe("movement");
    expect(categoryForClinic("Headache Clinic").key).toBe("headache");
    expect(categoryForClinic("Neuromuscular Clinic").key).toBe("neuromuscular");
    expect(categoryForClinic("General Neurology").key).toBe("general");
  });

  it("does not collapse overlapping substrings (neuro/neuromuscular/general)", () => {
    // 'Neuromuscular' must NOT fall into the general 'neuro' bucket.
    expect(categoryForClinic("Neuromuscular").key).toBe("neuromuscular");
    // 'General Neurology' contains 'neuro' but must land in general.
    expect(categoryForClinic("General Neurology").key).toBe("general");
    // A bare 'Neurology' clinic is general (the broad fallback within neuro).
    expect(categoryForClinic("Pediatric Neurology").key).toBe("general");
  });

  it("is case-insensitive", () => {
    expect(categoryForClinic("epilepsy clinic").key).toBe("epilepsy");
    expect(categoryForClinic("TSC GENETICS").key).toBe("tsc");
  });

  it("returns Other for unknown or blank names", () => {
    expect(categoryForClinic("Botox Procedure").key).toBe(OTHER_CATEGORY.key);
    expect(categoryForClinic("").key).toBe(OTHER_CATEGORY.key);
    expect(categoryForClinic(null).key).toBe(OTHER_CATEGORY.key);
    expect(categoryForClinic(undefined).key).toBe(OTHER_CATEGORY.key);
  });

  it("every category exposes jsPDF-native rgb fill + border tuples", () => {
    for (const cat of clinicCategoryLegend()) {
      expect(cat.fill).toHaveLength(3);
      expect(cat.border).toHaveLength(3);
      expect(cat.fill.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)).toBe(true);
    }
  });

  it("legend includes Other as the final entry", () => {
    const legend = clinicCategoryLegend();
    expect(legend.at(-1).key).toBe(OTHER_CATEGORY.key);
  });
});
