# Browser Test README - Pediatric Neurology Scheduler

This catalog covers **Layer A** only: behavior that can be driven and observed
from a real browser session. It intentionally does not claim backend truth such
as JSON persistence, loopback exposure, schema validation, release packaging, or
offline/privacy guarantees. Those are **Layer B** checks in
`docs/PROJECT_VERIFICATION.md` and `docs/VERIFICATION_MAP.md`.

Run the browser-auditable suite after a frontend build:

```bash
npm run build
npm run e2e:audit
```

The project-wide entrypoint runs this browser audit together with the CLI truth
probes:

```bash
make verify-project
```

For scheduler state changes driven from the command line, use `schedulerctl`
through `npm run ctl -- ...` or `make ctl ARGS='...'`. Those checks are Layer B
because the command path proves file/API state effects rather than browser
rendering.

Shared command/CLI/GUI parity IDs (`T-SCH-CMD-*`, `T-SCH-PARITY-*`) are also
Layer B. They prove that command-created state is valid and hydratable; the
browser audit still owns only the visible render/hydration proof.

## Browser-Auditable IDs

| ID | Flow | Expected browser evidence | Artifact |
| --- | --- | --- | --- |
| `T-SCH-BROWSER-001` | Open the locally served Scheduler app. | The app shell renders the Pediatric Neurology brand plus primary navigation such as Block Setup and Planning Grid. | `verification/results/browser-audit-*.html` |
| `T-SCH-BROWSER-002` | Let React hydrate from an empty profile. | The default dark theme is applied and the local-save status is visible. | `verification/results/browser-audit-*.html` |
| `T-SCH-BROWSER-003` | Capture the hydrated UI. | Headless Chrome writes a screenshot of the rendered app. | `verification/results/browser-audit-*.png` |

## Scope Boundary

The browser audit proves that the UI can be served, hydrated, and rendered in a
real browser. It does not prove:

- backend JSON writes or reads
- schema validation failures
- loopback-only network exposure
- Docker compose port binding
- release bundle freshness
- absence of off-machine communication
- nonexistent surfaces such as email, queues, object storage, database rows,
  RBAC, or HTTPS headers

Those checks either live in the CLI-backed verification layer or are explicitly
marked not applicable for the current single-user local-only scheduler.
