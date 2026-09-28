import {
  activeBlock,
  addSource,
  addRotator,
  addServiceBlock,
  applyMethodistAutoAssign,
  applyPreassignments,
  applyRangeAssignment,
  buildExportPackage,
  buildPlanningGrid,
  chooseMethodistStartSide,
  methodistRotationWindow,
  dedupeRotatorsByName,
  detectConflicts,
  extendBlockEnd,
  extendBlockStart,
  generateDailyReport,
  isRotatorActiveOn,
  isRotatorUnavailable,
  removeSource,
  removeRotator,
  removeRotators,
  removeServiceBlock,
  scheduleInpatientAssignment,
  scheduleOutpatientSession,
  setActiveBlock,
  setAttendings,
  setExpectedSourcePrograms,
  updateBlock,
  updateRotator,
  updateRules,
  updatePosterSettings,
  validateDrop,
  weekdayName,
} from "./scheduler.js";
import {
  classifyRotatorSchoolType,
  generateDraft,
} from "./program-rules.js";
import {
  assignClinic,
  unassignClinic,
} from "./clinic-validation.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ASSIGNMENT_PHASES = new Set(["inpatient", "outpatient", "off", "clear"]);
const PERIODS = new Set(["AM", "PM"]);
const PEEK_BUFFER_DAYS = 14;
const POST_FINAL_LEDGER_EXEMPT_COMMANDS = new Set(["block.add", "block.use", "block.delete"]);

function inputOf(command) {
  const { type, input, ...rest } = command || {};
  return { ...(input || {}), ...rest };
}

function ok(type, state, nextState, message, data = {}, warnings = []) {
  return {
    ok: true,
    type,
    state: nextState,
    changed: nextState !== state,
    message,
    data,
    ...(warnings.length ? { warnings } : {}),
  };
}

function fail(type, state, code, message, extra = {}) {
  return {
    ok: false,
    type,
    state,
    changed: false,
    error: { code, message, ...extra },
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalPatchObject(type, state, input) {
  if (!Object.prototype.hasOwnProperty.call(input, "patch")) {
    return { value: {} };
  }
  if (!isPlainObject(input.patch)) {
    return {
      error: fail(type, state, "invalid_type", "patch must be an object", {
        field: "patch",
        value: input.patch,
      }),
    };
  }
  return { value: input.patch };
}

function invalidType(type, state, field, message, value) {
  return fail(type, state, "invalid_type", message, { field, value });
}

function isFinalBlock(block) {
  return String(block?.status || "").toLowerCase() === "final";
}

function ledgerBlockId(state, input) {
  const blockRef = input.blockRef || input.blockId || input.name;
  if (blockRef) {
    try {
      return resolveBlock(state, blockRef)?.id || null;
    } catch {
      return null;
    }
  }
  return activeBlock(state)?.id || null;
}

function postFinalReason(type, input) {
  const explicit = input.postFinalReason || input.changeReason || input.reason;
  const reason = String(explicit || "").trim();
  return reason || `${type} after finalization`;
}

function withPostFinalChange(state, type, input, result) {
  if (!result.ok || !result.changed) return result;
  if (POST_FINAL_LEDGER_EXEMPT_COMMANDS.has(type)) return result;
  const blockId = ledgerBlockId(state, input);
  const beforeBlock = (state.serviceBlocks || []).find((block) => block.id === blockId);
  if (!blockId || !isFinalBlock(beforeBlock)) return result;
  if (!(result.state?.serviceBlocks || []).some((block) => block.id === blockId)) return result;

  const existing = Array.isArray(beforeBlock.postFinalChanges) ? beforeBlock.postFinalChanges : [];
  const changedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const entry = {
    id: `post-final-${existing.length + 1}-${changedAt.replace(/[:-]/g, "")}`,
    blockId,
    changedAt,
    changedBy: String(input.changedBy || "scheduler-command"),
    command: type,
    reason: postFinalReason(type, input),
    summary: result.message || "",
  };
  const serviceBlocks = (result.state.serviceBlocks || []).map((block) =>
    block.id === blockId
      ? {
          ...block,
          postFinalChanges: [
            ...(Array.isArray(block.postFinalChanges) ? block.postFinalChanges : []),
            entry,
          ],
        }
      : block,
  );
  return {
    ...result,
    state: { ...result.state, serviceBlocks },
    data: { ...(result.data || {}), postFinalChange: entry },
  };
}

function requireValue(type, state, input, field) {
  const value = input[field];
  if (value === undefined || value === null || value === "") {
    return fail(type, state, "missing_field", `${field} is required`, { field });
  }
  return null;
}

function requireIsoDate(type, state, input, field) {
  const missing = requireValue(type, state, input, field);
  if (missing) return missing;
  if (!ISO_DATE.test(String(input[field]))) {
    return fail(type, state, "invalid_date", `${field} must be YYYY-MM-DD`, {
      field,
      value: input[field],
    });
  }
  return null;
}

function firstError(...checks) {
  return checks.find(Boolean) || null;
}

export function resolveBlock(state, blockRef) {
  if (!blockRef) return activeBlock(state);
  const match = (state.serviceBlocks || []).find(
    (block) => block.id === blockRef || block.name === blockRef,
  );
  if (!match) {
    const error = new Error(`block not found: ${blockRef}`);
    error.code = "block_not_found";
    error.field = "blockRef";
    error.value = blockRef;
    throw error;
  }
  return match;
}

export function resolveRotator(state, rotatorRef) {
  const match = (state.rotators || []).find(
    (rotator) =>
      rotator.id === rotatorRef ||
      rotator.fullName === rotatorRef ||
      rotator.displayName === rotatorRef,
  );
  if (!match) {
    const error = new Error(`rotator not found: ${rotatorRef}`);
    error.code = "rotator_not_found";
    error.field = "rotatorRef";
    error.value = rotatorRef;
    throw error;
  }
  return match;
}

export function summarizeSchedulerState(state, target = "local state") {
  return [
    `Scheduler state (${target})`,
    `Blocks: ${(state.serviceBlocks || []).length}`,
    `Active block: ${resolveBlock(state)?.name || "(none)"}`,
    `Rotators: ${(state.rotators || []).length}`,
    `Inpatient assignments: ${(state.inpatientAssignments || []).length}`,
    `Outpatient sessions: ${(state.outpatientSessions || []).length}`,
  ].join("\n");
}

function resolveError(type, state, error) {
  return fail(type, state, error.code || "invalid_reference", error.message, {
    field: error.field,
    value: error.value,
  });
}

function commandBlockAdd(state, type, input) {
  const hasAnyOverride = Boolean(input.name || input.startDate || input.endDate);
  if (hasAnyOverride) {
    const error = firstError(
      requireValue(type, state, input, "name"),
      requireIsoDate(type, state, input, "startDate"),
      requireIsoDate(type, state, input, "endDate"),
    );
    if (error) return error;
  }
  const next = addServiceBlock(state, {
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
  });
  const block = activeBlock(next);
  return ok(type, state, next, `Created block ${block.name} (${block.id}) and set it active.`, {
    blockId: block.id,
  });
}

function commandBlockUse(state, type, input) {
  const blockRef = input.blockRef || input.blockId || input.name;
  if (!blockRef) return fail(type, state, "missing_field", "blockRef is required", { field: "blockRef" });
  try {
    const block = resolveBlock(state, blockRef);
    const next = setActiveBlock(state, block.id);
    return ok(type, state, next, `Active block is now ${block.name} (${block.id}).`, {
      blockId: block.id,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandBlockUpdate(state, type, input) {
  const blockRef = input.blockRef || input.blockId || input.name;
  const parsedPatch = optionalPatchObject(type, state, input);
  if (parsedPatch.error) return parsedPatch.error;
  const patch = parsedPatch.value;
  if (!blockRef) return fail(type, state, "missing_field", "blockRef is required", { field: "blockRef" });
  if (patch.startDate && !ISO_DATE.test(String(patch.startDate))) {
    return fail(type, state, "invalid_date", "startDate must be YYYY-MM-DD", { field: "startDate" });
  }
  if (patch.endDate && !ISO_DATE.test(String(patch.endDate))) {
    return fail(type, state, "invalid_date", "endDate must be YYYY-MM-DD", { field: "endDate" });
  }
  try {
    const block = resolveBlock(state, blockRef);
    const next = state.activeBlockId === block.id
      ? updateBlock(state, patch)
      : {
          ...state,
          serviceBlocks: (state.serviceBlocks || []).map((item) =>
            item.id === block.id ? { ...item, ...patch } : item,
          ),
        };
    return ok(type, state, next, `Updated block ${patch.name || block.name}.`, {
      blockId: block.id,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandBlockDelete(state, type, input) {
  const blockRef = input.blockRef || input.blockId || input.name;
  if (!blockRef) return fail(type, state, "missing_field", "blockRef is required", { field: "blockRef" });
  try {
    const block = resolveBlock(state, blockRef);
    const result = removeServiceBlock(state, block.id);
    if (!result.ok) {
      return fail(type, state, "no_effect", result.reason || `Could not delete ${block.name}`, {
        blockId: block.id,
      });
    }
    return ok(type, state, result.state, `Deleted block ${block.name}.`, { blockId: block.id });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandRotatorAdd(state, type, input) {
  const error = firstError(
    requireValue(type, state, input, "fullName"),
    requireValue(type, state, input, "program"),
    requireValue(type, state, input, "level"),
  );
  if (error) return error;
  const next = addRotator(state, input);
  const rotator = next.rotators.at(-1);
  return ok(type, state, next, `Added rotator ${rotator.fullName} (${rotator.id}).`, {
    rotatorId: rotator.id,
  });
}

function commandRotatorUpdate(state, type, input) {
  const parsedPatch = optionalPatchObject(type, state, input);
  if (parsedPatch.error) return parsedPatch.error;
  const patch = parsedPatch.value;
  if (!input.rotatorRef && !input.rotatorId) {
    return fail(type, state, "missing_field", "rotatorRef is required", { field: "rotatorRef" });
  }
  try {
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const next = updateRotator(state, rotator.id, patch);
    return ok(type, state, next, `Updated rotator ${patch.fullName || rotator.fullName}.`, {
      rotatorId: rotator.id,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandRotatorDelete(state, type, input) {
  if (!input.rotatorRef && !input.rotatorId) {
    return fail(type, state, "missing_field", "rotatorRef is required", { field: "rotatorRef" });
  }
  try {
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const next = removeRotator(state, rotator.id);
    return ok(type, state, next, `Deleted rotator ${rotator.fullName}.`, {
      rotatorId: rotator.id,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandRotatorsDelete(state, type, input) {
  const refs = input.rotatorRefs || input.rotatorIds || [];
  if (!Array.isArray(refs) || refs.length === 0) {
    return fail(type, state, "missing_field", "rotatorRefs is required", { field: "rotatorRefs" });
  }
  try {
    const rotatorIds = refs.map((ref) => resolveRotator(state, ref).id);
    const next = removeRotators(state, rotatorIds);
    return ok(type, state, next, `Deleted ${rotatorIds.length} rotators.`, { rotatorIds });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandSourceDelete(state, type, input) {
  const sourceRef = input.sourceId || input.sourceRef || input.id;
  if (!sourceRef) {
    return fail(type, state, "missing_field", "sourceId is required", { field: "sourceId" });
  }
  const source = (state.sources || []).find(
    (item) => item?.id === sourceRef || item?.fileName === sourceRef,
  );
  if (!source) {
    return fail(type, state, "source_not_found", `source not found: ${sourceRef}`, {
      field: "sourceId",
      value: sourceRef,
    });
  }
  const next = removeSource(state, source.id);
  const fileName = source.fileName || source.id;
  return ok(type, state, next, `Removed source ${fileName}.`, {
    sourceId: source.id,
    fileName,
  });
}

function normalizeSourceForAdd(type, state, input) {
  const source = input.source && isPlainObject(input.source) ? input.source : { ...input };
  const stringFields = ["id", "fileName", "fileType", "program", "status", "content", "importedAt"];
  for (const field of stringFields) {
    if (source[field] != null && typeof source[field] !== "string") {
      return {
        error: invalidType(type, state, field, `${field} must be a string`, source[field]),
      };
    }
  }
  for (const field of ["importedRotatorCount", "importWarningCount"]) {
    if (
      source[field] != null &&
      (!Number.isInteger(source[field]) || source[field] < 0)
    ) {
      return {
        error: invalidType(type, state, field, `${field} must be a non-negative integer`, source[field]),
      };
    }
  }
  if (
    source.importWarnings != null &&
    (!Array.isArray(source.importWarnings) ||
      source.importWarnings.some((warning) => typeof warning !== "string"))
  ) {
    return {
      error: invalidType(type, state, "importWarnings", "importWarnings must be an array of strings", source.importWarnings),
    };
  }
  if (source.parsedRows != null && !Array.isArray(source.parsedRows)) {
    return {
      error: invalidType(type, state, "parsedRows", "parsedRows must be an array", source.parsedRows),
    };
  }
  return { value: source };
}

function commandSourceAdd(state, type, input) {
  const normalized = normalizeSourceForAdd(type, state, input);
  if (normalized.error) return normalized.error;
  const source = normalized.value;
  const fileName = String(source.fileName || "Manual source").trim() || "Manual source";
  const sourceId = String(source.id || "").trim();
  if (sourceId && (state.sources || []).some((item) => item?.id === sourceId)) {
    return fail(type, state, "duplicate_source", `source already exists: ${sourceId}`, {
      field: "id",
      value: sourceId,
    });
  }
  const next = addSource(state, {
    ...source,
    fileName,
    fileType: source.fileType || "manual",
    program: source.program || "Other",
    status: source.status || "Reviewed",
    content: source.content || "",
    parsedRows: Array.isArray(source.parsedRows) ? source.parsedRows : [],
  });
  const added = (next.sources || []).at(-1);
  return ok(type, state, next, `Added source ${added.fileName}.`, {
    sourceId: added.id,
    fileName: added.fileName,
  });
}

function commandRosterDedupe(state, type) {
  const result = dedupeRotatorsByName(state);
  return ok(type, state, result.state, `Removed ${result.removedCount} duplicate rotators.`, {
    removedCount: result.removedCount,
  });
}

function commandAssignRange(state, type, input) {
  const error = firstError(
    requireValue(type, state, input, "rotatorRef"),
    requireIsoDate(type, state, input, "startDate"),
    requireIsoDate(type, state, input, "endDate"),
    requireValue(type, state, input, "phase"),
  );
  if (error) return error;
  if (!ASSIGNMENT_PHASES.has(input.phase)) {
    return fail(type, state, "invalid_enum", "phase must be inpatient, outpatient, off, or clear", {
      field: "phase",
      value: input.phase,
    });
  }
  try {
    const block = resolveBlock(state, input.blockRef || input.blockId);
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const next = applyRangeAssignment(state, block, {
      rotatorId: rotator.id,
      startDate: input.startDate,
      endDate: input.endDate,
      phase: input.phase,
      role: input.role,
      clinic: input.clinic,
    });
    const label = rotator.displayName || rotator.fullName;
    const message = next === state
      ? `No changes for ${label}: no applicable days from ${input.startDate} to ${input.endDate}.`
      : `Assigned ${label} ${input.phase} from ${input.startDate} to ${input.endDate} in ${block.name}.`;
    return ok(
      type,
      state,
      next,
      message,
      {
        blockId: block.id,
        rotatorId: rotator.id,
        phase: input.phase,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    );
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandInpatientDrop(state, type, input) {
  const error = firstError(
    requireValue(type, state, input, "rotatorRef"),
    requireIsoDate(type, state, input, "date"),
  );
  if (error) return error;
  try {
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const check = validateDrop(state, rotator.id, input.date);
    if (!check.valid) {
      return fail(type, state, "invalid_drop", check.reason || "Drop is not allowed.", {
        rotatorId: rotator.id,
        date: input.date,
      });
    }
    const role = input.role || "Resident";
    const next = scheduleInpatientAssignment(state, {
      date: input.date,
      rotatorId: rotator.id,
      role,
      source: "Drag-Drop",
    });
    return ok(type, state, next, `Dropped ${rotator.displayName || rotator.fullName} onto inpatient ${input.date}.`, {
      rotatorId: rotator.id,
      date: input.date,
      role,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function invalidInpatientReason(block, state, rotator, date) {
  if (!block || date < block.startDate || date > block.endDate) {
    return `Date ${date} is outside the active block.`;
  }
  const check = validateDrop(state, rotator.id, date);
  return check.valid ? null : (check.reason || "Inpatient assignment is not allowed.");
}

function commandInpatientAssign(state, type, input) {
  const error = firstError(
    requireValue(type, state, input, "rotatorRef"),
    requireIsoDate(type, state, input, "date"),
  );
  if (error) return error;
  try {
    const block = resolveBlock(state, input.blockRef || input.blockId);
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const invalidReason = invalidInpatientReason(block, state, rotator, input.date);
    if (invalidReason) {
      return fail(type, state, "invalid_inpatient_assignment", invalidReason, {
        rotatorId: rotator.id,
        date: input.date,
      });
    }
    const next = scheduleInpatientAssignment(state, {
      date: input.date,
      rotatorId: rotator.id,
      role: input.role || "Resident",
      source: input.source,
    });
    return ok(type, state, next, `Assigned ${rotator.displayName || rotator.fullName} inpatient on ${input.date}.`, {
      rotatorId: rotator.id,
      date: input.date,
      role: input.role || "Resident",
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandInpatientFellowResolve(state, type, input) {
  const error = requireValue(type, state, input, "rotatorRef");
  if (error) return error;
  const dates = Array.isArray(input.dates) ? input.dates : (input.date ? [input.date] : []);
  if (dates.length === 0) {
    return fail(type, state, "missing_field", "dates is required", { field: "dates" });
  }
  const invalidDate = dates.find((date) => !ISO_DATE.test(String(date)));
  if (invalidDate) {
    return fail(type, state, "invalid_date", "dates must contain YYYY-MM-DD values", {
      field: "dates",
      value: invalidDate,
    });
  }
  try {
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    let next = state;
    for (const date of dates) {
      const check = validateDrop(next, rotator.id, date, { requiredRole: "Fellow" });
      if (!check.valid) {
        return fail(type, state, "invalid_fellow_resolution", check.reason || "Fellow resolution is not allowed.", {
          rotatorId: rotator.id,
          date,
        });
      }
      next = scheduleInpatientAssignment(next, {
        date,
        rotatorId: rotator.id,
        role: "Fellow",
        source: "Manual",
      });
    }
    return ok(
      type,
      state,
      next,
      `Resolved ${dates.length} fellow assignment${dates.length === 1 ? "" : "s"} for ${rotator.displayName || rotator.fullName}.`,
      {
        rotatorId: rotator.id,
        dates,
        role: "Fellow",
      },
    );
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandInpatientDelete(state, type, input) {
  const assignmentRef = input.assignmentRef || input.assignmentId || input.id;
  if (!assignmentRef) {
    return fail(type, state, "missing_field", "assignmentRef is required", { field: "assignmentRef" });
  }
  const assignment = (state.inpatientAssignments || []).find((item) => item.id === assignmentRef);
  if (!assignment) {
    return fail(type, state, "assignment_not_found", `inpatient assignment not found: ${assignmentRef}`, {
      field: "assignmentRef",
      value: assignmentRef,
    });
  }
  const next = {
    ...state,
    inpatientAssignments: (state.inpatientAssignments || []).filter((item) => item.id !== assignmentRef),
  };
  return ok(type, state, next, `Removed inpatient assignment on ${assignment.date}.`, {
    assignmentId: assignmentRef,
  });
}

function invalidOutpatientReason(block, rotator, date) {
  if (!block || !block.startDate || !block.endDate || date < block.startDate || date > block.endDate) {
    return "Outpatient date must be inside the active block.";
  }
  const weekday = weekdayName(date);
  if (weekday === "Saturday" || weekday === "Sunday") {
    return `Outpatient clinics are closed on ${weekday}.`;
  }
  const holiday = (block.holidays || []).find((item) => item && item.noClinic && item.date === date);
  if (holiday) {
    return `Outpatient clinics are closed on ${holiday.label || date}.`;
  }
  if (!isRotatorActiveOn(rotator, date)) {
    return `${rotator.displayName || rotator.fullName || "Rotator"} is not active on ${date}.`;
  }
  const unavailable = isRotatorUnavailable(rotator, date);
  if (unavailable) {
    return `${rotator.displayName || rotator.fullName || "Rotator"} is unavailable on ${date} (${unavailable.label || unavailable.reason}).`;
  }
  return null;
}

function commandOutpatientAssign(state, type, input) {
  const error = firstError(
    requireValue(type, state, input, "rotatorRef"),
    requireIsoDate(type, state, input, "date"),
    requireValue(type, state, input, "period"),
  );
  if (error) return error;
  if (!PERIODS.has(input.period)) {
    return fail(type, state, "invalid_enum", "period must be AM or PM", {
      field: "period",
      value: input.period,
    });
  }
  try {
    const rotator = resolveRotator(state, input.rotatorRef || input.rotatorId);
    const block = resolveBlock(state, input.blockRef || input.blockId);
    const invalidReason = invalidOutpatientReason(block, rotator, input.date);
    if (invalidReason) {
      return fail(type, state, "invalid_outpatient_assignment", invalidReason, {
        rotatorId: rotator.id,
        date: input.date,
      });
    }
    const next = scheduleOutpatientSession(state, {
      date: input.date,
      period: input.period,
      clinic: input.clinic,
      provider: input.provider,
      rotatorId: rotator.id,
      details: input.details,
    });
    return ok(type, state, next, `Assigned ${rotator.displayName || rotator.fullName} outpatient ${input.period} on ${input.date}.`, {
      rotatorId: rotator.id,
      date: input.date,
      period: input.period,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandOutpatientDelete(state, type, input) {
  const sessionRef = input.sessionRef || input.sessionId || input.id;
  if (!sessionRef) {
    return fail(type, state, "missing_field", "sessionRef is required", { field: "sessionRef" });
  }
  const session = (state.outpatientSessions || []).find((item) => item.id === sessionRef);
  if (!session) {
    return fail(type, state, "session_not_found", `outpatient session not found: ${sessionRef}`, {
      field: "sessionRef",
      value: sessionRef,
    });
  }
  const next = {
    ...state,
    outpatientSessions: (state.outpatientSessions || []).filter((item) => item.id !== sessionRef),
  };
  return ok(type, state, next, `Removed outpatient ${session.period} session on ${session.date}.`, {
    sessionId: sessionRef,
  });
}

function commandClinicAssign(state, type, input) {
  const session = input.session || input.period;
  const normalized = { ...input, session };
  const rotatorRef = normalized.rotatorRef || normalized.rotatorId;
  const error = firstError(
    requireValue(type, state, normalized, "clinicOccurrenceId"),
    requireIsoDate(type, state, normalized, "date"),
    requireValue(type, state, normalized, "session"),
  );
  if (error) return error;
  if (!rotatorRef) return fail(type, state, "missing_field", "rotatorRef is required", { field: "rotatorRef" });
  if (!PERIODS.has(session)) {
    return fail(type, state, "invalid_enum", "session must be AM or PM", {
      field: "session",
      value: session,
    });
  }
  try {
    const rotator = resolveRotator(state, rotatorRef);
    const result = assignClinic(state, {
      clinicOccurrenceId: normalized.clinicOccurrenceId,
      rotatorId: rotator.id,
      date: normalized.date,
      session,
      source: normalized.source || "manual",
    });
    if (!result.ok) {
      return fail(type, state, result.reason || "invalid_clinic_assignment", result.message || "Clinic assignment is not allowed.");
    }
    const assignmentId = `clinic-assign::${normalized.clinicOccurrenceId}::${rotator.id}`;
    return ok(type, state, result.state, `Assigned ${rotator.displayName || rotator.fullName} to clinic ${session} on ${normalized.date}.`, {
      assignmentId,
      clinicOccurrenceId: normalized.clinicOccurrenceId,
      rotatorId: rotator.id,
      date: normalized.date,
      session,
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function commandClinicDelete(state, type, input) {
  const assignmentRef = input.assignmentRef || input.assignmentId || input.id;
  let clinicOccurrenceId = input.clinicOccurrenceId;
  let rotatorId = input.rotatorId;
  if (assignmentRef && (!clinicOccurrenceId || !rotatorId)) {
    const match = (state.clinicAssignments || []).find((item) => item.id === assignmentRef);
    if (!match) {
      return fail(type, state, "assignment-not-found", `clinic assignment not found: ${assignmentRef}`, {
        field: "assignmentRef",
        value: assignmentRef,
      });
    }
    clinicOccurrenceId = match.clinicOccurrenceId;
    rotatorId = match.rotatorId;
  }
  if (!assignmentRef) {
    const rotatorRef = input.rotatorRef || input.rotatorId;
    const error = firstError(
      requireValue(type, state, input, "clinicOccurrenceId"),
    );
    if (error) return error;
    if (!rotatorRef) return fail(type, state, "missing_field", "rotatorRef is required", { field: "rotatorRef" });
    try {
      rotatorId = resolveRotator(state, rotatorRef).id;
    } catch (error) {
      return resolveError(type, state, error);
    }
  }
  const next = unassignClinic(state, { clinicOccurrenceId, rotatorId });
  if (next === state) {
    return fail(type, state, "assignment-not-found", "clinic assignment not found", {
      field: assignmentRef ? "assignmentRef" : "clinicOccurrenceId",
      value: assignmentRef || clinicOccurrenceId,
    });
  }
  return ok(type, state, next, "Removed clinic assignment.", assignmentRef ? {
    assignmentId: assignmentRef,
  } : {
    clinicOccurrenceId,
    rotatorId,
  });
}

function commandRulesPatch(state, type, input) {
  const parsedPatch = optionalPatchObject(type, state, input);
  if (parsedPatch.error) return parsedPatch.error;
  const patch = parsedPatch.value;
  const next = updateRules(state, patch);
  return ok(type, state, next, "Updated scheduler rules.", { patch });
}

function validatePosterPatch(type, state, patch) {
  for (const field of ["programName", "chief", "tagline"]) {
    if (patch[field] != null && typeof patch[field] !== "string") {
      return invalidType(type, state, field, `${field} must be a string`, patch[field]);
    }
  }
  if (
    patch.notes != null &&
    (!Array.isArray(patch.notes) || patch.notes.some((note) => typeof note !== "string"))
  ) {
    return invalidType(type, state, "notes", "notes must be an array of strings", patch.notes);
  }
  if (patch.locations != null) {
    if (!Array.isArray(patch.locations)) {
      return invalidType(type, state, "locations", "locations must be an array", patch.locations);
    }
    const invalidLocation = patch.locations.find(
      (location) =>
        !isPlainObject(location) ||
        (location.name != null && typeof location.name !== "string") ||
        (location.address != null && typeof location.address !== "string"),
    );
    if (invalidLocation) {
      return invalidType(
        type,
        state,
        "locations",
        "locations must contain objects with string name/address fields",
        invalidLocation,
      );
    }
  }
  return null;
}

function commandPosterSettingsPatch(state, type, input) {
  const parsedPatch = optionalPatchObject(type, state, input);
  if (parsedPatch.error) return parsedPatch.error;
  const patch = parsedPatch.value;
  const invalidPatch = validatePosterPatch(type, state, patch);
  if (invalidPatch) return invalidPatch;
  const next = updatePosterSettings(state, patch);
  return ok(type, state, next, "Updated poster settings.", { patch });
}

function commandAttendingAdd(state, type, input) {
  const error = requireValue(type, state, input, "name");
  if (error) return error;
  const name = String(input.name).trim();
  if (!name) return fail(type, state, "missing_field", "name is required", { field: "name" });
  const existing = state.attendings || [];
  if (existing.some((attending) => attending.name.toLowerCase() === name.toLowerCase())) {
    return fail(type, state, "no_effect", `${name} is already in the attendings list.`, { field: "name", value: name });
  }
  const next = setAttendings(state, [
    ...existing,
    { name, recurringClinics: [], oneOffDates: [] },
  ]);
  return ok(type, state, next, `Added ${name} to the attendings list.`, { name });
}

function commandAttendingRemove(state, type, input) {
  const error = requireValue(type, state, input, "name");
  if (error) return error;
  const name = String(input.name);
  const next = setAttendings(
    state,
    (state.attendings || []).filter((attending) => attending.name !== name),
  );
  return ok(type, state, next, `Removed ${name} from the attendings list.`, { name });
}

function commandAttendingUpdate(state, type, input) {
  const error = requireValue(type, state, input, "name");
  if (error) return error;
  const parsedPatch = optionalPatchObject(type, state, input);
  if (parsedPatch.error) return parsedPatch.error;
  const patch = parsedPatch.value;
  const name = String(input.name);
  const next = setAttendings(
    state,
    (state.attendings || []).map((attending) =>
      attending.name === name ? { ...attending, ...patch } : attending,
    ),
  );
  return ok(type, state, next, `Updated attending ${patch.name || name}.`, { name });
}

function commandExpectedSourceAdd(state, type, input) {
  const error = requireValue(type, state, input, "program");
  if (error) return error;
  const program = String(input.program).trim();
  if (!program) return fail(type, state, "missing_field", "program is required", { field: "program" });
  const programs = state.expectedSourcePrograms || [];
  const next = setExpectedSourcePrograms(state, programs.includes(program) ? programs : [...programs, program]);
  return ok(type, state, next, `Added expected source ${program}.`, { program });
}

function commandExpectedSourceRemove(state, type, input) {
  const error = requireValue(type, state, input, "program");
  if (error) return error;
  const program = String(input.program);
  const next = setExpectedSourcePrograms(
    state,
    (state.expectedSourcePrograms || []).filter((item) => item !== program),
  );
  return ok(type, state, next, `Removed expected source ${program}.`, { program });
}

function commandConflictsList(state, type, input) {
  const conflicts = detectConflicts(state).filter((conflict) => !input.date || conflict.date === input.date);
  return ok(type, state, state, `Found ${conflicts.length} conflicts.`, { conflicts });
}

function commandDailyReport(state, type, input) {
  const error = requireIsoDate(type, state, input, "date");
  if (error) return error;
  return ok(type, state, state, `Generated daily report for ${input.date}.`, {
    report: generateDailyReport(state, input.date),
  });
}

function commandGridShow(state, type, input) {
  try {
    const block = resolveBlock(state, input.blockRef || input.blockId);
    const effectiveBlock = planningGridEffectiveBlock(state, block, input);
    return ok(type, state, state, `Built planning grid for ${block.name}.`, {
      blockId: block.id,
      rawStartDate: block.startDate,
      rawEndDate: block.endDate,
      effectiveStartDate: effectiveBlock.startDate,
      effectiveEndDate: effectiveBlock.endDate,
      peekBeforeBlock: Boolean(input.peekBeforeBlock),
      peekPastBlock: Boolean(input.peekPastBlock),
      grid: buildPlanningGrid(state, effectiveBlock),
    });
  } catch (error) {
    return resolveError(type, state, error);
  }
}

function planningGridEffectiveBlock(state, block, input) {
  if (!input.peekBeforeBlock && !input.peekPastBlock) return block;
  let out = block;
  if (input.peekBeforeBlock) {
    out = extendBlockStart(out, PEEK_BUFFER_DAYS);
  }
  if (input.peekPastBlock) {
    out = extendBlockEnd(out, PEEK_BUFFER_DAYS);
  }

  // Preserve holiday styling from any block that overlaps the fixed peek
  // window without letting neighboring block lengths widen that window.
  const holidays = [];
  const seenHolidayDates = new Set();
  for (const sourceBlock of [block, ...(state.serviceBlocks || [])]) {
    for (const holiday of sourceBlock.holidays || []) {
      const date = String(holiday?.date || "");
      if (!date || seenHolidayDates.has(date) || date < out.startDate || date > out.endDate) {
        continue;
      }
      seenHolidayDates.add(date);
      holidays.push(holiday);
    }
  }
  return { ...out, holidays };
}

function commandExportPackage(state, type) {
  return ok(type, state, state, "Built export package.", {
    package: buildExportPackage(state),
  });
}

function commandDraftGenerate(state, type) {
  const block = activeBlock(state);
  if (!block) {
    return fail(type, state, "block_not_found", "No active block is available.");
  }
  const preassigned = applyPreassignments(state, block);
  const result = generateDraft(preassigned, block, state);
  const next = result.state;
  const report = result.report;
  const summary = report?.summary || {};
  const inpatientAdded = summary.inpatientAdded || 0;
  const outpatientAdded = summary.outpatientAdded || 0;
  const totalAdded = inpatientAdded + outpatientAdded;
  const unmet = report?.unmet || [];
  let message;
  if (totalAdded) {
    message = `Generated draft schedule: added ${inpatientAdded} inpatient and ${outpatientAdded} outpatient assignment${totalAdded === 1 ? "" : "s"}.`;
  } else if (unmet.length) {
    message = "Draft schedule could not fill all required inpatient coverage.";
  } else {
    message = "Draft schedule already has required inpatient coverage.";
  }
  return ok(type, state, next, message, {
    inpatientAdded,
    outpatientAdded,
    unmet,
    report,
  });
}

function commandMethodistAuto(state, type, input) {
  let block;
  try {
    block = resolveBlock(state, input.blockRef || input.blockId);
  } catch (error) {
    return resolveError(type, state, error);
  }
  if (!block) {
    return fail(type, state, "block_not_found", "No active block is available.");
  }

  const methodistRotators = (state.rotators || []).filter(
    (rotator) => classifyRotatorSchoolType(rotator) === "methodist",
  );
  const methodistCount = methodistRotators.length;
  if (methodistCount === 0) {
    return ok(type, state, state, "No Methodist rotators are in the roster.", {
      methodistCount: 0,
      inpatientAdded: 0,
      outpatientAdded: 0,
      startSidesSet: 0,
    });
  }

  let startSidesSet = 0;
  const rotators = (state.rotators || []).map((rotator) => {
    if (
      classifyRotatorSchoolType(rotator) === "methodist" &&
      methodistRotationWindow(rotator) &&
      !rotator.methodistStartSide
    ) {
      startSidesSet += 1;
      return {
        ...rotator,
        methodistStartSide: chooseMethodistStartSide(rotator, block),
      };
    }
    return rotator;
  });

  const working = startSidesSet > 0 ? { ...state, rotators } : state;
  const next = applyMethodistAutoAssign(working, block);
  const inpatientAdded =
    (next.inpatientAssignments || []).length - (state.inpatientAssignments || []).length;
  const outpatientAdded =
    (next.outpatientSessions || []).length - (state.outpatientSessions || []).length;
  const totalAdded = inpatientAdded + outpatientAdded;
  let message;
  if (totalAdded > 0) {
    message = `Generated Methodist 14/14 schedule for ${methodistCount} provider${methodistCount === 1 ? "" : "s"}.`;
  } else if (startSidesSet > 0) {
    message = `Computed Methodist start side for ${startSidesSet} provider${startSidesSet === 1 ? "" : "s"}.`;
  } else {
    message = "Methodist 14/14 schedule is already up to date.";
  }

  return ok(type, state, next, message, {
    methodistCount,
    inpatientAdded,
    outpatientAdded,
    startSidesSet,
  });
}

const COMMAND_HANDLERS = Object.freeze({
  "block.add": commandBlockAdd,
  "block.use": commandBlockUse,
  "block.update": commandBlockUpdate,
  "block.delete": commandBlockDelete,
  "rotator.add": commandRotatorAdd,
  "rotator.update": commandRotatorUpdate,
  "rotator.delete": commandRotatorDelete,
  "rotators.delete": commandRotatorsDelete,
  "source.add": commandSourceAdd,
  "source.delete": commandSourceDelete,
  "source.remove": commandSourceDelete,
  "roster.dedupe": commandRosterDedupe,
  "assign.range": commandAssignRange,
  "clinic.assign": commandClinicAssign,
  "clinic.delete": commandClinicDelete,
  "inpatient.fellow.resolve": commandInpatientFellowResolve,
  "inpatient.drop": commandInpatientDrop,
  "inpatient.assign": commandInpatientAssign,
  "inpatient.delete": commandInpatientDelete,
  "outpatient.assign": commandOutpatientAssign,
  "outpatient.delete": commandOutpatientDelete,
  "rules.patch": commandRulesPatch,
  "posterSettings.patch": commandPosterSettingsPatch,
  "attending.add": commandAttendingAdd,
  "attending.remove": commandAttendingRemove,
  "attending.update": commandAttendingUpdate,
  "expectedSource.add": commandExpectedSourceAdd,
  "expectedSource.remove": commandExpectedSourceRemove,
  "conflicts.list": commandConflictsList,
  "report.daily": commandDailyReport,
  "grid.show": commandGridShow,
  "methodist.auto": commandMethodistAuto,
  "draft.generate": commandDraftGenerate,
  "inpatient.draft": commandDraftGenerate,
  "export.package": commandExportPackage,
});

export function executeSchedulerCommand(state, command) {
  const type = command?.type;
  const input = inputOf(command);
  const handler = Object.hasOwn(COMMAND_HANDLERS, type) ? COMMAND_HANDLERS[type] : null;
  if (!handler) {
    return fail(type || "(none)", state, "unknown_command", `unknown command: ${type || "(none)"}`, {
      field: "type",
      value: type,
    });
  }
  const result = handler(state, type, input);
  return withPostFinalChange(state, type, input, result);
}
