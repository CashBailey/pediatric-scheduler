# Pediatric Scheduler Native Mac App

This is the primary desktop handoff for the Pediatric Neurology Scheduler. It is
a native macOS app with the local Python scheduler engine bundled inside the
`.app`.

You do not need Docker, Node, npm, Python, Git, or the source code.

## What You Need

1. A Mac running macOS 13 or newer.
2. The `PediatricScheduler-macOS.zip` file.

## First-Time Launch

1. Double-click `PediatricScheduler-macOS.zip` to unzip it.
2. Move `Pediatric Scheduler.app` to your Desktop or Applications folder.
3. The first time only, right-click `Pediatric Scheduler.app` and choose Open.
4. In the macOS warning dialog, click Open again.

This extra first-launch step is normal for local ad-hoc signed builds that have
not been notarized with an Apple Developer ID certificate. After approval, you
can open the app normally.

## Data And Privacy

This is a local-only app. It runs the scheduler engine on your own Mac at
`127.0.0.1` and does not contact a remote server, cloud service, telemetry
endpoint, or analytics service.

Your schedule data stays on your machine. The native app saves its scheduler
state under:

```text
~/Library/Application Support/PediatricScheduler/scheduler-state.json
```

Exports are written as local files from the Reports screen.

## Package Files

The native package command writes these files under `.build/native-release/`:

```text
PediatricScheduler-macOS.zip
PediatricScheduler-macOS.SHA256.txt
PediatricScheduler-macOS-MANIFEST.json
README.md
```

The manifest records the app version, bundle id, minimum macOS version, zip
size, SHA-256 hash, signing mode, and packaging checks. The SHA file can be used
to confirm the zip was not changed after packaging.
