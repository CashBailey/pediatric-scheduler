# Pediatric Neurology Scheduler React App For Coordinator

This folder contains the React version of the Pediatric Neurology Scheduler.
It runs fully on your Mac through Docker Desktop.

You do not need Python, Node, npm, Git, or the source code.

## What You Need

1. Docker Desktop for Mac installed.
2. Docker Desktop open and running.
3. This whole `CoordinatorPediSchedulerReact` folder.

## First-Time Launch (One Extra Step)

The very first time you launch the app on a Mac, macOS will block the
script with a message like:

> "run-on-mac.command cannot be opened because Apple cannot check it
> for malicious software."

This is normal — Apple shows this for any script downloaded from the
internet, not just this one. To get past it once:

1. **Right-click** (or two-finger click) on `run-on-mac.command`.
2. Choose **Open** from the menu.
3. In the warning dialog, click **Open** again.

After this one-time approval, you can double-click `run-on-mac.command`
normally for every future launch. The same trick works for
`stop-app.command` if Mac asks about it too.

## Start The App

Double-click:

```text
run-on-mac.command
```

Then open this local browser page:

```text
http://localhost:6173
```

The script tries to open that page automatically.

## Stop The App

Press `Ctrl+C` in the Terminal window running the app, or double-click:

```text
stop-app.command
```

## Data And Privacy

This is a local-only app. It runs entirely on your Mac inside Docker and never
contacts a remote server — no cloud, no telemetry, and no internet connection is
needed once the image is loaded.

Your data stays on your machine. It is saved in your browser and also mirrored to
a local file inside the app's private Docker volume, so your schedule can be
recovered if the browser storage is ever cleared. Exports download as local files.

Everything — the app and its local helper service — is served only at `localhost`
on your own computer.

## If Port 6173 Is Busy

Run this from Terminal inside this folder:

```bash
PORT=6174 ./run-on-mac.command
```

Then open:

```text
http://localhost:6174
```
