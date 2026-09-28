import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const root = process.cwd();
const graphDir = join(root, "graphify-out");
const graphPath = join(graphDir, "graph.json");
const reportPath = join(graphDir, "GRAPH_REPORT.md");
const manifestPath = join(graphDir, "manifest.json");
const rootPath = join(graphDir, ".graphify_root");
const analysisPath = join(graphDir, ".graphify_analysis.json");
const answersPath = join(root, "docs", "PROJECT_GRAPH_ANSWERS.md");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(message) {
  console.error(`Graphify check failed: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(graphDir)) {
  console.log("Graphify output not found; skipping graph consistency check.");
  process.exit(0);
}

if (!existsSync(graphPath) || !existsSync(reportPath)) {
  fail("graphify-out exists but graph.json or GRAPH_REPORT.md is missing.");
  process.exit();
}

const graph = readJson(graphPath);
const report = readFileSync(reportPath, "utf8");
const links = Array.isArray(graph.links) ? graph.links : graph.edges;
if (!Array.isArray(graph.nodes) || !Array.isArray(links)) {
  fail("graph.json must expose nodes plus links/edges arrays.");
  process.exit();
}

const actual = {
  nodes: graph.nodes.length,
  edges: links.length,
  communities: new Set(graph.nodes.map((node) => node.community).filter((value) => value !== undefined && value !== null)).size,
  inferred: links.filter((link) => link.confidence === "INFERRED" || link._origin === "INFERRED").length
};

const summaryMatch = report.match(/- (\d+) nodes · (\d+) edges · (\d+) communities/);
if (!summaryMatch) {
  fail("GRAPH_REPORT.md does not contain the expected summary count line.");
} else {
  const [, nodes, edges, communities] = summaryMatch.map(Number);
  if (nodes !== actual.nodes || edges !== actual.edges || communities !== actual.communities) {
    fail(
      `GRAPH_REPORT.md summary (${nodes}/${edges}/${communities}) does not match graph.json (${actual.nodes}/${actual.edges}/${actual.communities}).`
    );
  }
}

const inferredMatch = report.match(/INFERRED: (\d+) edges/);
if (inferredMatch && Number(inferredMatch[1]) !== actual.inferred) {
  fail(`GRAPH_REPORT.md inferred edge count (${inferredMatch[1]}) does not match graph.json (${actual.inferred}).`);
}

for (const staleSidecar of [".graphify_detect.json", ".graphify_extract.json"]) {
  if (existsSync(join(graphDir, staleSidecar))) {
    fail(`${staleSidecar} is a transient extraction sidecar; remove or regenerate it so stale cache data is not mistaken for current graph truth.`);
  }
}

if (existsSync(analysisPath)) {
  const analysis = readJson(analysisPath);
  const communities = analysis.communities && typeof analysis.communities === "object"
    ? Object.keys(analysis.communities).length
    : null;
  if (communities !== null && communities !== actual.communities) {
    fail(`.graphify_analysis.json community count (${communities}) does not match graph.json (${actual.communities}).`);
  }
}

if (existsSync(rootPath)) {
  const rawRoot = readFileSync(rootPath, "utf8").trim();
  const resolvedRoot = isAbsolute(rawRoot) ? resolve(rawRoot) : resolve(root, rawRoot || ".");
  if (resolvedRoot !== resolve(root)) {
    fail(`.graphify_root points at ${rawRoot || "(empty)"}, not the current project root ${root}.`);
  }
}

if (existsSync(manifestPath)) {
  const manifest = readJson(manifestPath);
  const stale = [];
  for (const [relativePath, entry] of Object.entries(manifest)) {
    const absolutePath = join(root, relativePath);
    if (!existsSync(absolutePath)) {
      stale.push(`${relativePath} (missing)`);
      continue;
    }
    const hash = createHash("md5").update(readFileSync(absolutePath)).digest("hex");
    if (entry?.ast_hash && entry.ast_hash !== hash) {
      stale.push(relativePath);
    }
  }
  if (stale.length > 0) {
    fail(`graphify-out/manifest.json is stale for ${stale.length} file(s): ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? " ..." : ""}. Re-run graphify update.`);
  }
}

if (existsSync(answersPath)) {
  const answers = readFileSync(answersPath, "utf8");
  const answersMatch = answers.match(/current Graphify report says the graph has (\d+) nodes, (\d+) edges, (\d+) communities, and (\d+) inferred edges/);
  if (answersMatch) {
    const [, nodes, edges, communities, inferred] = answersMatch.map(Number);
    if (
      nodes !== actual.nodes ||
      edges !== actual.edges ||
      communities !== actual.communities ||
      inferred !== actual.inferred
    ) {
      fail(
        `docs/PROJECT_GRAPH_ANSWERS.md cites ${nodes}/${edges}/${communities}/${inferred}, but graph.json has ${actual.nodes}/${actual.edges}/${actual.communities}/${actual.inferred}.`
      );
    }
  }
}

if (process.exitCode) {
  process.exit();
}

console.log(
  `Graphify outputs agree: ${actual.nodes} nodes, ${actual.edges} edges, ${actual.communities} communities, ${actual.inferred} inferred edges.`
);
