# Regression Pinboard

Use this file to keep bug fixes tied to the tests and commands that guard them.
Every shipped regression fix should add or update a row.

| Bug / risk | Fix commit | Guard ID(s) | Verification command | Evidence artifact |
| --- | --- | --- | --- | --- |
| BE-001: streamed or chunked `POST /api/scheduler/state` could bypass the body cap. | `36417ec` | `T-SCH-BACKEND-001` | `npm run test:py` | `verification/results/*-python-backend.log` |
| BE-004: persistence failure details could leak an absolute server path. | `36417ec` | `T-SCH-BACKEND-001` | `npm run test:py` | `verification/results/*-python-backend.log` |
| TEST-001: backend Excel route test claimed a route that the shipped Python backend does not implement. | `f36f470` | `T-SCH-UNIT-001`, `T-SCH-CONTRACT-001` | `npm test && npm run test:offline` | `verification/results/*-vitest.log`, `verification/results/*-offline-contracts.log` |
| REL-001: release launcher/compose tag could drift from the shipped image tag. | `2c70bff` | `T-SCH-CONTRACT-002` | `npm run test:offline` | `verification/results/*-offline-contracts.log` |
| Roster import preview Dates/Clinic column offset was wrong for Coordinator's import workflow. | `87a6ab4` | `T-SCH-UNIT-001` | `npm test` | `verification/results/*-vitest.log` |
| CLI-first verification system itself must not drift out of the repo or omit the native Desktop/package export-import gates. | pending current commit | `T-SCH-CONTRACT-003`, `T-SCH-BROWSER-001..003`, `T-SCH-CLI-001..005`, `T-SCH-NATIVE-001`, `T-SCH-NATIVE-011`, `T-SCH-NATIVE-014` | `make verify-project` | `verification/results/project-verification-*.md`, `verification/results/native-ui-audit-*.md`, `.build/native-release/PediatricScheduler-macOS.zip` |
| Product state must be controllable from CLI and GUI without schema drift or off-machine API targets. | pending current commit | `T-SCH-CTL-001..005`, `T-SCH-CONTRACT-003` | `npm run test:offline` | `verification/results/*-offline-contracts.log` |
| Shared command/CLI/GUI parity can drift if GUI handlers or schedulerctl bypass `executeSchedulerCommand`. | pending current commit | `T-SCH-CMD-001..005`, `T-SCH-PARITY-001..005` | `npm run test:offline && npm run build` | `verification/results/*-offline-contracts.log`, `verification/results/*-frontend-build.log` |
| Native compact-window editors could clip or crowd lower controls without scrollable and wrapping panes. | pending current commit | `T-SCH-CMD-002`, `T-SCH-CMD-006`, `T-SCH-NATIVE-003`, `T-SCH-BACKEND-005` | `npm run test:offline && swift build && npm run e2e:native` | `verification/results/*-offline-contracts.log`, `verification/results/native-ui-audit-*.md` |

## Rule

If a future change fixes a behavior bug, add the bug, commit, guard ID, command,
and artifact path here before calling the fix complete.
