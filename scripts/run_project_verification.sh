#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RESULTS_DIR="$ROOT_DIR/verification/results"
mkdir -p "$RESULTS_DIR"

SUMMARY_PATH="$RESULTS_DIR/project-verification-${STAMP}.md"
OVERALL_STATUS=0

cat >"$SUMMARY_PATH" <<EOF
# Scheduler Project Verification

- Run at: ${STAMP}
- Working tree: ${ROOT_DIR}
- Philosophy: CLI-first verification with browser-visible proof plus backend/CLI truth probes.

| Step | Layer | Status | Command | Log |
| --- | --- | --- | --- | --- |
EOF

run_step() {
  local slug="$1"
  local layer="$2"
  local label="$3"
  local command="$4"
  local log_path="$RESULTS_DIR/${STAMP}-${slug}.log"
  local status="PASS"

  {
    printf '$ %s\n\n' "$command"
    bash -lc "$command"
  } >"$log_path" 2>&1 || status="FAIL"

  if [[ "$status" != "PASS" ]]; then
    OVERALL_STATUS=1
  fi

  printf '| %s | %s | %s | `%s` | `%s` |\n' \
    "$label" "$layer" "$status" "$command" "$log_path" >>"$SUMMARY_PATH"
}

run_step "frontend-build" "Build" "Frontend Build" "npm run build"
run_step "graphify-consistency" "Knowledge graph" "Graphify Output Consistency" "npm run check:graphify"
run_step "vitest" "Layer A/B unit" "Vitest Frontend and Shared Logic" "npm test"
run_step "offline-contracts" "Layer B contract" "Offline and Contract Tests" "npm run test:offline"
run_step "python-backend" "Layer B backend" "Python Backend Tests" "npm run test:py"
run_step "cli-probes" "Layer B probe" "CLI Truth Probes" "npm run verify:cli -- --results-dir verification/results"
run_step "browser-audit" "Layer A browser" "Headless Browser Audit" "npm run e2e:audit -- --results-dir verification/results"
run_step "native-ui-audit" "Native GUI" "Native UI Audit" "npm run e2e:native -- --results-dir verification/results"
run_step "native-package" "Native release" "Native Release Package" "npm run package:native"

cat >>"$SUMMARY_PATH" <<EOF

## Overall

- Status: $(if [[ "$OVERALL_STATUS" -eq 0 ]]; then echo PASS; else echo FAIL; fi)
- Browser audit artifacts: \`verification/results/browser-audit-*.md\`, \`verification/results/browser-audit-*.json\`, \`verification/results/browser-audit-*.png\`, \`verification/results/browser-audit-*.html\`
- Native UI audit artifacts: \`verification/results/native-ui-audit-*.md\`, \`verification/results/native-ui-audit-*.json\`, \`verification/results/native-ui-audit-data-*\`
- Native package artifact: \`.build/native-release/PediatricScheduler-macOS.zip\`
- CLI probe artifacts: \`verification/results/cli-probes-*.md\`, \`verification/results/cli-probes-*.json\`
- Scope map: \`docs/VERIFICATION_MAP.md\`
- Regression pinboard: \`docs/REGRESSION_PINBOARD.md\`
- Browser-only automation is intentionally limited to UI-paintable behavior. Backend persistence, local-only guarantees, static/API routing, native GUI launch, and release packaging are verified by CLI probes, tests, and native host checks.
EOF

printf 'Wrote %s\n' "$SUMMARY_PATH"
exit "$OVERALL_STATUS"
