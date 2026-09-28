// Clinic category color system for the poster export (2026-05-28 poster feature).
//
// The data model has no explicit clinic "category" field, so we derive one from
// the clinic name via keyword matching. Colors mirror the reference poster's
// pastel key, expressed as jsPDF-native [r,g,b] tuples (fill + border).
//
// Matching is MOST-SPECIFIC-FIRST: several labels share substrings
// ("General Neurology" vs "Neuromuscular" both contain "neuro"; "Epilepsy" and
// "Headache" are distinct but order still matters for compound names like
// "Epilepsy/Headache"). The first keyword that appears in the lowercased clinic
// name wins; anything unmatched falls through to "Other / Specialty".

// Category definitions, in match-precedence order. `keywords` are lowercase
// substrings tested against the lowercased clinic name.
export const CLINIC_CATEGORIES = [
  {
    key: "tsc",
    label: "TSC Clinic",
    keywords: ["tsc", "tuberous", "genetics"],
    fill: [243, 250, 240],
    border: [168, 214, 162]
  },
  {
    key: "epilepsy",
    label: "Epilepsy Clinic",
    keywords: ["epilepsy", "seizure", "eeg"],
    fill: [234, 244, 255],
    border: [125, 183, 245]
  },
  {
    key: "movement",
    label: "Movement Disorders",
    keywords: ["movement", "ataxia", "dystonia", "tic"],
    fill: [244, 232, 250],
    border: [201, 160, 221]
  },
  {
    key: "headache",
    label: "Headache",
    keywords: ["headache", "migraine"],
    fill: [234, 249, 250],
    border: [120, 201, 208]
  },
  {
    key: "neuromuscular",
    label: "Neuromuscular",
    keywords: ["neuromuscular", "muscle", "myopathy", "nerve", "emg"],
    fill: [253, 235, 244],
    border: [231, 167, 196]
  },
  {
    key: "general",
    label: "General Neurology",
    keywords: ["general neuro", "general", "continuity", "resident clinic", "neurology"],
    fill: [255, 248, 232],
    border: [244, 190, 85]
  }
];

export const OTHER_CATEGORY = {
  key: "other",
  label: "Other / Specialty",
  keywords: [],
  fill: [228, 229, 231],
  border: [169, 173, 180]
};

/**
 * Resolve a clinic name to its category descriptor. Returns OTHER_CATEGORY when
 * nothing matches (including empty/blank names). Matching is most-specific-first
 * per CLINIC_CATEGORIES ordering.
 */
export function categoryForClinic(clinicName) {
  const name = String(clinicName || "").trim().toLowerCase();
  if (!name) return OTHER_CATEGORY;
  for (const category of CLINIC_CATEGORIES) {
    if (category.keywords.some((kw) => name.includes(kw))) return category;
  }
  return OTHER_CATEGORY;
}

/** Full ordered legend (categories + Other) for rendering the poster KEY box. */
export function clinicCategoryLegend() {
  return [...CLINIC_CATEGORIES, OTHER_CATEGORY];
}
