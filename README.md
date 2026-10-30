# Deako Lights (KaiOS)

Control Deako smart switches from a KaiOS feature phone.

The phone is a thin client. It does **not** talk to the switches directly —
it makes HTTP calls to the small **light controller** (`~/deako-app/app.py`,
Flask + `pydeako`) running on a machine on the same Wi-Fi, which drives the
Deako mesh over its local TCP API. No cloud, no Deako account.

```
KaiOS app  --HTTP-->  controller (home machine :8099)  --TCP-->  Deako switch .59  --mesh-->  all lights
```

## Controls

- **Up / Down** — move the highlight
- **OK** — toggle the highlighted light
- **1–9** — toggle the Nth light directly
- **Left soft key** — All Off
- **Right soft key** — Menu (All On, All Off, Refresh, Controller address, Exit)

## Prerequisites

1. Controller running on the home machine:
   ```
   cd ~/deako-app && ~/.deako-venv/bin/python app.py
   ```
2. Phone on the same Wi-Fi.
3. App points at the controller's `IP:port` (default `192.168.1.60:8099`).
   Change it in Menu > Controller address if the machine's IP changes.

## Build & host

Same flow as kaios-tvremote:

```
./build.sh                 # repackages src/ -> Apps-directory/Deako-Lights/application.zip
SIGN=1 ./build.sh          # same, plus self-signed zigbert signature (sign.py)
```

`build.sh` refreshes `packaged_size`/`size` in `update.webmanifest` and
`sha256` in `webapps.json`. Commit and push to the `kaios-deako` GitHub Pages
repo, then open `index.html` from the repo's Pages URL in the phone browser and
follow the two staging steps.

## Layout

- `src/` — the packaged app (`manifest.webmanifest`, `index.html`, `style.css`,
  `app.js` UI, `api.js` HTTP backend, `icons/`)
- `Apps-directory/Deako-Lights/` — hosted package + `update.webmanifest`
- `index.html`, `installer.js`, `appsmanager.js` — the browser-staged sideload installer
- `build.sh`, `sign.py` — packaging
