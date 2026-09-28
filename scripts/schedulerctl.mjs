#!/usr/bin/env node
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createInitialState,
  migrateLoadedState,
  parseState,
  serializeState,
  WEEKDAYS,
} from "../shared/scheduler/scheduler.js";
import {
  executeSchedulerCommand,
  resolveBlock,
  resolveRotator,
  summarizeSchedulerState,
} from "../shared/scheduler/commands.js";
import { allSchemas } from "../shared/contracts/v1/index.js";

const STATE_FILENAME = "scheduler-state.json";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function makeAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const schema of allSchemas) ajv.addSchema(schema);
  return ajv;
}

const ajv = makeAjv();
const validateSchedulerState = ajv.getSchema("scheduler-state.v1");

function assertValidState(state) {
  if (validateSchedulerState(state)) return;
  const detail = (validateSchedulerState.errors || [])
    .map((error) => `${error.instancePath || "<root>"} ${error.message}`)
    .join("; ");
  throw new Error(`state failed scheduler-state.v1 validation: ${detail}`);
}

function defaultDataDir() {
  return join(homedir(), ".local", "share", "pedi_scheduler");
}

function defaultStatePath() {
  return join(defaultDataDir(), STATE_FILENAME);
}

function normalizeApiBase(rawUrl) {
  const url = new URL(rawUrl);
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("schedulerctl API targets must be loopback-only (localhost, 127.0.0.1, or ::1).");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

class FileStateStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async load() {
    if (!existsSync(this.filePath)) {
      return createInitialState();
    }
    return migrateLoadedState(parseState(readFileSync(this.filePath, "utf8")));
  }

  async save(state) {
    assertValidState(state);
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      writeFileSync(tmpPath, serializeState(state), "utf8");
      renameSync(tmpPath, this.filePath);
    } catch (error) {
      if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
      throw error;
    }
  }

  describe() {
    return this.filePath;
  }
}

class ApiStateStore {
  constructor(baseUrl) {
    this.baseUrl = normalizeApiBase(baseUrl);
  }

  async load() {
    const response = await fetch(`${this.baseUrl}/api/scheduler/state`);
    if (!response.ok) {
      throw new Error(`GET /api/scheduler/state returned ${response.status}`);
    }
    return migrateLoadedState(await response.json());
  }

  async save(state) {
    assertValidState(state);
    const response = await fetch(`${this.baseUrl}/api/scheduler/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: serializeState(state),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`POST /api/scheduler/state returned ${response.status}${body ? `: ${body}` : ""}`);
    }
  }

  describe() {
    return this.baseUrl;
  }
}

function usage() {
  return `Usage:
  schedulerctl [--file PATH | --data-dir DIR | --api URL] state show [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] state validate
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block list [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block show (--id ID | --name NAME) [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block add --name NAME --start YYYY-MM-DD --end YYYY-MM-DD
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block use (--id ID | --name NAME)
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block update --block NAME_OR_ID [--name NAME] [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--status STATUS]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] block delete (--id ID | --name NAME | --block NAME_OR_ID)
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rotator list [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rotator show --rotator NAME_OR_ID [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rotator add --name NAME --program PROGRAM --level LEVEL --start YYYY-MM-DD --end YYYY-MM-DD [--phase inpatient|outpatient] [--day-off WEEKDAY[,WEEKDAY...]] [--unavailable START:END[:LABEL]]...
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rotator update --rotator NAME_OR_ID [--name NAME] [--program PROGRAM] [--level LEVEL] [--continuity-clinic TEXT] [--day-off WEEKDAY[,WEEKDAY...]] [--unavailable START:END[:LABEL]]...
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rotator delete --rotator NAME_OR_ID
  schedulerctl [--file PATH | --data-dir DIR | --api URL] assign range --rotator NAME_OR_ID --from YYYY-MM-DD --to YYYY-MM-DD --phase inpatient|outpatient|off|clear [--role ROLE] [--clinic CLINIC] [--block NAME_OR_ID]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] assign inpatient --rotator NAME_OR_ID --date YYYY-MM-DD [--role ROLE]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] assign outpatient --rotator NAME_OR_ID --date YYYY-MM-DD --period AM|PM [--clinic CLINIC] [--provider NAME]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] roster dedupe
  schedulerctl [--file PATH | --data-dir DIR | --api URL] inpatient drop --rotator NAME_OR_ID --date YYYY-MM-DD [--role ROLE]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] inpatient delete --assignment ID
  schedulerctl [--file PATH | --data-dir DIR | --api URL] inpatient resolve-fellow --rotator NAME_OR_ID --date YYYY-MM-DD [--date YYYY-MM-DD]...
  schedulerctl [--file PATH | --data-dir DIR | --api URL] outpatient delete --session ID
  schedulerctl [--file PATH | --data-dir DIR | --api URL] clinic assign --occurrence ID --rotator NAME_OR_ID --date YYYY-MM-DD --session AM|PM
  schedulerctl [--file PATH | --data-dir DIR | --api URL] clinic delete (--assignment ID | --occurrence ID --rotator NAME_OR_ID)
  schedulerctl [--file PATH | --data-dir DIR | --api URL] methodist auto [--block NAME_OR_ID]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] attending add --name NAME
  schedulerctl [--file PATH | --data-dir DIR | --api URL] attending remove --name NAME
  schedulerctl [--file PATH | --data-dir DIR | --api URL] attending update --name NAME --patch JSON
  schedulerctl [--file PATH | --data-dir DIR | --api URL] expected-source add --program PROGRAM
  schedulerctl [--file PATH | --data-dir DIR | --api URL] expected-source remove --program PROGRAM
  schedulerctl [--file PATH | --data-dir DIR | --api URL] source add --file-name NAME [--program PROGRAM] [--file-type TYPE] [--status STATUS] [--id ID]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] source delete --source ID_OR_FILENAME
  schedulerctl [--file PATH | --data-dir DIR | --api URL] rules patch --patch JSON
  schedulerctl [--file PATH | --data-dir DIR | --api URL] poster patch --patch JSON
  schedulerctl [--file PATH | --data-dir DIR | --api URL] grid show [--json] [--block NAME_OR_ID] [--peek-before] [--peek-past]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] export package [--json]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] draft generate
  schedulerctl [--file PATH | --data-dir DIR | --api URL] conflicts list [--json] [--date YYYY-MM-DD]
  schedulerctl [--file PATH | --data-dir DIR | --api URL] report daily --date YYYY-MM-DD

Notes:
  rotator delete accepts --rotator more than once (bulk delete).
  export.pdfs and export.word are Python-backend-only commands; use the
  native app's Reports screen (or POST /api/scheduler/command) for those.
`;
}

function parseJsonOption(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a JSON object`);
  }
}

function take(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  args.splice(index, 2);
  return value;
}

function takeAll(args, name) {
  const values = [];
  let value = take(args, name);
  while (value != null) {
    values.push(value);
    value = take(args, name);
  }
  return values;
}

function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}

function requireOption(args, name) {
  const value = take(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseGlobalOptions(argv) {
  const args = [...argv];
  const options = {};
  while (args[0]?.startsWith("--")) {
    const key = args.shift();
    if (key === "--file" || key === "--data-dir" || key === "--api") {
      const value = args.shift();
      if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
      options[key.slice(2).replace("-", "_")] = value;
    } else {
      throw new Error(`unknown global option: ${key}`);
    }
  }
  if ([options.file, options.data_dir, options.api].filter(Boolean).length > 1) {
    throw new Error("choose only one state target: --file, --data-dir, or --api");
  }
  return { options, args };
}

function stateStoreFromOptions(options) {
  if (options.api) return new ApiStateStore(options.api);
  if (options.file) return new FileStateStore(resolve(options.file));
  if (options.data_dir) return new FileStateStore(resolve(options.data_dir, STATE_FILENAME));
  return new FileStateStore(defaultStatePath());
}

function requireIsoDate(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
  return value;
}

function parseDayOffList(value, label = "--day-off") {
  const days = value.split(",").map((day) => day.trim()).filter(Boolean);
  const invalid = days.find((day) => !WEEKDAYS.includes(day));
  if (invalid) throw new Error(`${label} contains unknown weekday: ${invalid}`);
  return WEEKDAYS.filter((day) => days.includes(day));
}

function parseUnavailableRange(value) {
  const [startRaw, endRaw, ...labelParts] = value.split(":");
  if (!startRaw || !endRaw) {
    throw new Error("--unavailable must be START:END or START:END:LABEL");
  }
  const start = requireIsoDate(startRaw, "--unavailable start");
  const end = requireIsoDate(endRaw, "--unavailable end");
  if (end < start) throw new Error("--unavailable end must be on or after start");
  const range = { start, end };
  const label = labelParts.join(":").trim();
  if (label) range.label = label;
  return range;
}

async function runCommand(store, args, stdout) {
  const command = args.shift();
  const subcommand = args.shift();

  if (command === "state" && subcommand === "show") {
    const asJson = flag(args, "--json");
    if (args.length) throw new Error(`unknown state show args: ${args.join(" ")}`);
    const state = await store.load();
    stdout.write(asJson ? `${serializeState(state)}\n` : `${summarizeSchedulerState(state, store.describe())}\n`);
    return;
  }

  if (command === "state" && subcommand === "validate") {
    if (args.length) throw new Error(`unknown state validate args: ${args.join(" ")}`);
    const state = await store.load();
    assertValidState(state);
    stdout.write(`State is valid (${store.describe()}).\n`);
    return;
  }

  if (command === "block" && subcommand === "list") {
    const asJson = flag(args, "--json");
    if (args.length) throw new Error(`unknown block list args: ${args.join(" ")}`);
    const state = await store.load();
    stdout.write(asJson
      ? `${JSON.stringify(state.serviceBlocks || [], null, 2)}\n`
      : `${(state.serviceBlocks || []).map((block) => `${block.id}\t${block.name}\t${block.startDate} to ${block.endDate}`).join("\n")}\n`);
    return;
  }

  if (command === "block" && subcommand === "show") {
    const asJson = flag(args, "--json");
    const blockId = take(args, "--id");
    const blockName = take(args, "--name");
    if (!blockId && !blockName) throw new Error("block show requires --id or --name");
    if (blockId && blockName) throw new Error("block show accepts only one of --id or --name");
    if (args.length) throw new Error(`unknown block show args: ${args.join(" ")}`);
    const state = await store.load();
    const block = resolveBlock(state, blockId || blockName);
    stdout.write(asJson ? `${JSON.stringify(block, null, 2)}\n` : `${block.name} (${block.id}) ${block.startDate} to ${block.endDate}\n`);
    return;
  }

  if (command === "block" && subcommand === "add") {
    const name = requireOption(args, "--name");
    const startDate = requireIsoDate(requireOption(args, "--start"), "--start");
    const endDate = requireIsoDate(requireOption(args, "--end"), "--end");
    if (args.length) throw new Error(`unknown block add args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "block.add", input: { name, startDate, endDate } });
    return;
  }

  if (command === "block" && subcommand === "use") {
    const blockId = take(args, "--id");
    const blockName = take(args, "--name");
    if (!blockId && !blockName) throw new Error("block use requires --id or --name");
    if (blockId && blockName) throw new Error("block use accepts only one of --id or --name");
    if (args.length) throw new Error(`unknown block use args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "block.use", input: { blockRef: blockId || blockName } });
    return;
  }

  if (command === "block" && subcommand === "update") {
    const blockRef = requireOption(args, "--block");
    const patch = {};
    const name = take(args, "--name");
    const startDate = take(args, "--start");
    const endDate = take(args, "--end");
    const status = take(args, "--status");
    if (name) patch.name = name;
    if (startDate) patch.startDate = requireIsoDate(startDate, "--start");
    if (endDate) patch.endDate = requireIsoDate(endDate, "--end");
    if (status) patch.status = status;
    if (args.length) throw new Error(`unknown block update args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "block.update", input: { blockRef, patch } });
    return;
  }

  if (command === "block" && subcommand === "delete") {
    const blockRef = take(args, "--block") || take(args, "--id") || take(args, "--name");
    if (!blockRef) throw new Error("block delete requires --block, --id, or --name");
    if (args.length) throw new Error(`unknown block delete args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "block.delete", input: { blockRef } });
    return;
  }

  if (command === "rotator" && subcommand === "list") {
    const asJson = flag(args, "--json");
    if (args.length) throw new Error(`unknown rotator list args: ${args.join(" ")}`);
    const state = await store.load();
    stdout.write(asJson
      ? `${JSON.stringify(state.rotators || [], null, 2)}\n`
      : `${(state.rotators || []).map((rotator) => `${rotator.id}\t${rotator.fullName}\t${rotator.program}\t${rotator.level}`).join("\n")}\n`);
    return;
  }

  if (command === "rotator" && subcommand === "show") {
    const asJson = flag(args, "--json");
    const rotatorRef = requireOption(args, "--rotator");
    if (args.length) throw new Error(`unknown rotator show args: ${args.join(" ")}`);
    const state = await store.load();
    const rotator = resolveRotator(state, rotatorRef);
    stdout.write(asJson ? `${JSON.stringify(rotator, null, 2)}\n` : `${rotator.fullName} (${rotator.id}) ${rotator.program} ${rotator.level}\n`);
    return;
  }

  if (command === "rotator" && subcommand === "add") {
    const fullName = requireOption(args, "--name");
    const program = requireOption(args, "--program");
    const level = requireOption(args, "--level");
    const start = requireIsoDate(requireOption(args, "--start"), "--start");
    const end = requireIsoDate(requireOption(args, "--end"), "--end");
    const phase = take(args, "--phase");
    const dayOffInput = take(args, "--day-off");
    const unavailableInputs = takeAll(args, "--unavailable");
    if (phase && phase !== "inpatient" && phase !== "outpatient") {
      throw new Error("--phase must be inpatient or outpatient");
    }
    if (args.length) throw new Error(`unknown rotator add args: ${args.join(" ")}`);
    const state = await store.load();
    const segment = phase ? { start, end, defaultPhase: phase } : { start, end };
    const input = { fullName, program, level, segments: [segment] };
    if (dayOffInput != null) input.dayOff = parseDayOffList(dayOffInput);
    if (unavailableInputs.length) input.unavailableRanges = unavailableInputs.map(parseUnavailableRange);
    await runSchedulerCommand(store, stdout, state, {
      type: "rotator.add",
      input,
    });
    return;
  }

  if (command === "rotator" && subcommand === "update") {
    const rotatorRef = requireOption(args, "--rotator");
    const patch = {};
    const fullName = take(args, "--name");
    const program = take(args, "--program");
    const level = take(args, "--level");
    const continuityClinic = take(args, "--continuity-clinic");
    const dayOffInput = take(args, "--day-off");
    const unavailableInputs = takeAll(args, "--unavailable");
    if (fullName) {
      patch.fullName = fullName;
      patch.displayName = fullName;
    }
    if (program) patch.program = program;
    if (level) patch.level = level;
    if (continuityClinic) patch.continuityClinic = continuityClinic;
    if (dayOffInput != null) patch.dayOff = parseDayOffList(dayOffInput);
    if (unavailableInputs.length) patch.unavailableRanges = unavailableInputs.map(parseUnavailableRange);
    if (args.length) throw new Error(`unknown rotator update args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "rotator.update", input: { rotatorRef, patch } });
    return;
  }

  if (command === "rotator" && subcommand === "delete") {
    const rotatorRefs = takeAll(args, "--rotator");
    if (!rotatorRefs.length) throw new Error("--rotator is required");
    if (args.length) throw new Error(`unknown rotator delete args: ${args.join(" ")}`);
    const state = await store.load();
    // One ref uses the single-delete command; several use the bulk command,
    // matching the native Rotators bulk action.
    await runSchedulerCommand(store, stdout, state, rotatorRefs.length === 1
      ? { type: "rotator.delete", input: { rotatorRef: rotatorRefs[0] } }
      : { type: "rotators.delete", input: { rotatorRefs } });
    return;
  }

  if (command === "roster" && subcommand === "dedupe") {
    if (args.length) throw new Error(`unknown roster dedupe args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "roster.dedupe" });
    return;
  }

  if (command === "assign" && subcommand === "range") {
    const rotatorRef = requireOption(args, "--rotator");
    const startDate = requireIsoDate(requireOption(args, "--from"), "--from");
    const endDate = requireIsoDate(requireOption(args, "--to"), "--to");
    const phase = requireOption(args, "--phase");
    const role = take(args, "--role");
    const clinic = take(args, "--clinic");
    const blockRef = take(args, "--block");
    if (!["inpatient", "outpatient", "off", "clear"].includes(phase)) {
      throw new Error("--phase must be inpatient, outpatient, off, or clear");
    }
    if (args.length) throw new Error(`unknown assign range args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "assign.range",
      input: {
        rotatorRef,
        blockRef,
        startDate,
        endDate,
        phase,
        role,
        clinic,
      },
    });
    return;
  }

  if (command === "assign" && subcommand === "inpatient") {
    const rotatorRef = requireOption(args, "--rotator");
    const date = requireIsoDate(requireOption(args, "--date"), "--date");
    const role = take(args, "--role");
    if (args.length) throw new Error(`unknown assign inpatient args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "inpatient.assign",
      input: { rotatorRef, date, role },
    });
    return;
  }

  if (command === "assign" && subcommand === "outpatient") {
    const rotatorRef = requireOption(args, "--rotator");
    const date = requireIsoDate(requireOption(args, "--date"), "--date");
    const period = requireOption(args, "--period");
    const clinic = take(args, "--clinic");
    const provider = take(args, "--provider");
    if (args.length) throw new Error(`unknown assign outpatient args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "outpatient.assign",
      input: { rotatorRef, date, period, clinic, provider },
    });
    return;
  }

  if (command === "inpatient" && subcommand === "drop") {
    const rotatorRef = requireOption(args, "--rotator");
    const date = requireIsoDate(requireOption(args, "--date"), "--date");
    const role = take(args, "--role");
    if (args.length) throw new Error(`unknown inpatient drop args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "inpatient.drop",
      input: role ? { rotatorRef, date, role } : { rotatorRef, date },
    });
    return;
  }

  if (command === "inpatient" && subcommand === "delete") {
    const assignmentRef = requireOption(args, "--assignment");
    if (args.length) throw new Error(`unknown inpatient delete args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "inpatient.delete", input: { assignmentRef } });
    return;
  }

  if (command === "inpatient" && subcommand === "resolve-fellow") {
    const rotatorRef = requireOption(args, "--rotator");
    const dates = takeAll(args, "--date").map((date) => requireIsoDate(date, "--date"));
    if (!dates.length) throw new Error("--date is required");
    if (args.length) throw new Error(`unknown inpatient resolve-fellow args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "inpatient.fellow.resolve", input: { rotatorRef, dates } });
    return;
  }

  if (command === "outpatient" && subcommand === "delete") {
    const sessionRef = requireOption(args, "--session");
    if (args.length) throw new Error(`unknown outpatient delete args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "outpatient.delete", input: { sessionRef } });
    return;
  }

  if (command === "clinic" && subcommand === "assign") {
    const clinicOccurrenceId = requireOption(args, "--occurrence");
    const rotatorRef = requireOption(args, "--rotator");
    const date = requireIsoDate(requireOption(args, "--date"), "--date");
    const session = requireOption(args, "--session");
    if (session !== "AM" && session !== "PM") throw new Error("--session must be AM or PM");
    if (args.length) throw new Error(`unknown clinic assign args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "clinic.assign",
      input: { clinicOccurrenceId, rotatorRef, date, session },
    });
    return;
  }

  if (command === "clinic" && subcommand === "delete") {
    const assignmentRef = take(args, "--assignment");
    const clinicOccurrenceId = take(args, "--occurrence");
    const rotatorRef = take(args, "--rotator");
    if (!assignmentRef && !(clinicOccurrenceId && rotatorRef)) {
      throw new Error("clinic delete requires --assignment, or --occurrence with --rotator");
    }
    if (args.length) throw new Error(`unknown clinic delete args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "clinic.delete",
      input: assignmentRef ? { assignmentRef } : { clinicOccurrenceId, rotatorRef },
    });
    return;
  }

  if (command === "methodist" && subcommand === "auto") {
    const blockRef = take(args, "--block");
    if (args.length) throw new Error(`unknown methodist auto args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, {
      type: "methodist.auto",
      input: blockRef ? { blockRef } : {},
    });
    return;
  }

  if (command === "attending" && (subcommand === "add" || subcommand === "remove")) {
    const name = requireOption(args, "--name");
    if (args.length) throw new Error(`unknown attending ${subcommand} args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: `attending.${subcommand}`, input: { name } });
    return;
  }

  if (command === "attending" && subcommand === "update") {
    const name = requireOption(args, "--name");
    const patch = parseJsonOption(requireOption(args, "--patch"), "--patch");
    if (args.length) throw new Error(`unknown attending update args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "attending.update", input: { name, patch } });
    return;
  }

  if (command === "expected-source" && (subcommand === "add" || subcommand === "remove")) {
    const program = requireOption(args, "--program");
    if (args.length) throw new Error(`unknown expected-source ${subcommand} args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: `expectedSource.${subcommand}`, input: { program } });
    return;
  }

  if (command === "source" && subcommand === "add") {
    const fileName = requireOption(args, "--file-name");
    const program = take(args, "--program");
    const fileType = take(args, "--file-type");
    const status = take(args, "--status");
    const id = take(args, "--id");
    if (args.length) throw new Error(`unknown source add args: ${args.join(" ")}`);
    const input = { fileName };
    if (program) input.program = program;
    if (fileType) input.fileType = fileType;
    if (status) input.status = status;
    if (id) input.id = id;
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "source.add", input });
    return;
  }

  if (command === "source" && subcommand === "delete") {
    const sourceRef = requireOption(args, "--source");
    if (args.length) throw new Error(`unknown source delete args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "source.delete", input: { sourceRef } });
    return;
  }

  if (command === "rules" && subcommand === "patch") {
    const patch = parseJsonOption(requireOption(args, "--patch"), "--patch");
    if (args.length) throw new Error(`unknown rules patch args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "rules.patch", input: { patch } });
    return;
  }

  if (command === "poster" && subcommand === "patch") {
    const patch = parseJsonOption(requireOption(args, "--patch"), "--patch");
    if (args.length) throw new Error(`unknown poster patch args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "posterSettings.patch", input: { patch } });
    return;
  }

  if (command === "grid" && subcommand === "show") {
    const asJson = flag(args, "--json");
    const blockRef = take(args, "--block");
    const peekBeforeBlock = flag(args, "--peek-before");
    const peekPastBlock = flag(args, "--peek-past");
    if (args.length) throw new Error(`unknown grid show args: ${args.join(" ")}`);
    const state = await store.load();
    const result = executeSchedulerCommand(state, {
      type: "grid.show",
      input: { blockRef, peekBeforeBlock, peekPastBlock },
    });
    if (!result.ok) throw new Error(result.error.message);
    if (asJson) {
      stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    } else {
      const grid = result.data.grid || {};
      const rows = grid.rows || [];
      const dates = grid.dates || [];
      stdout.write(`${result.message} ${rows.length} rows x ${dates.length} dates (${result.data.effectiveStartDate} to ${result.data.effectiveEndDate}).\n`);
    }
    return;
  }

  if (command === "export" && subcommand === "package") {
    const asJson = flag(args, "--json");
    if (args.length) throw new Error(`unknown export package args: ${args.join(" ")}`);
    const state = await store.load();
    const result = executeSchedulerCommand(state, { type: "export.package" });
    if (!result.ok) throw new Error(result.error.message);
    stdout.write(asJson
      ? `${JSON.stringify(result.data.package, null, 2)}\n`
      : `${JSON.stringify(result.data.package.manifest, null, 2)}\n`);
    return;
  }

  if (command === "draft" && subcommand === "generate") {
    if (args.length) throw new Error(`unknown draft generate args: ${args.join(" ")}`);
    const state = await store.load();
    await runSchedulerCommand(store, stdout, state, { type: "draft.generate" });
    return;
  }

  if (command === "conflicts" && subcommand === "list") {
    const asJson = flag(args, "--json");
    const date = take(args, "--date");
    if (date) requireIsoDate(date, "--date");
    if (args.length) throw new Error(`unknown conflicts list args: ${args.join(" ")}`);
    const state = await store.load();
    const result = executeSchedulerCommand(state, { type: "conflicts.list", input: { date } });
    if (!result.ok) throw new Error(result.error.message);
    stdout.write(asJson
      ? `${JSON.stringify(result.data.conflicts, null, 2)}\n`
      : `${result.data.conflicts.map((item) => `${item.date}\t${item.severity}\t${item.title}`).join("\n")}\n`);
    return;
  }

  if (command === "report" && subcommand === "daily") {
    const date = requireIsoDate(requireOption(args, "--date"), "--date");
    if (args.length) throw new Error(`unknown report daily args: ${args.join(" ")}`);
    const state = await store.load();
    const result = executeSchedulerCommand(state, { type: "report.daily", input: { date } });
    if (!result.ok) throw new Error(result.error.message);
    stdout.write(`${result.data.report}\n`);
    return;
  }

  throw new Error(`unknown command: ${[command, subcommand].filter(Boolean).join(" ") || "(none)"}`);
}

async function runSchedulerCommand(store, stdout, state, command) {
  const result = executeSchedulerCommand(state, command);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  if (result.changed) {
    await store.save(result.state);
  }
  stdout.write(`${result.message}\n`);
}

export async function main(argv = process.argv.slice(2), stdout = process.stdout, stderr = process.stderr) {
  try {
    if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
      stdout.write(usage());
      return 0;
    }
    const { options, args } = parseGlobalOptions(argv);
    const store = stateStoreFromOptions(options);
    await runCommand(store, args, stdout);
    return 0;
  } catch (error) {
    stderr.write(`${error.message}\n\n${usage()}`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
