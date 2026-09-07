# Macro Project — Agent Memory

> **Phase: MACRO FUNCTIONAL** — Core fishing loop is wired.  
> **Gate:** Requirements must install successfully before the macro app unlocks.

## Goal

Clone **OpenMacro XTernal** — an external memory-based macro for the Roblox game **Fisch**.

This repo (`d:\macro`) is the Electron rebuild. Creator: **@CodingForLife123**.

## Reference Source

**Path:**
```
D:\Downloads\OpenMacro-XTernal-0.2.51\OpenMacro-XTernal-0.2.51\OpenMacro-XTernal-0.2.51
```

**Original app:** OpenMacro XTernal (AutoHotkey v2) by @anorexc  
**Original repo:** https://github.com/termx3/OpenMacro-XTernal  
**License:** GNU AGPL-3.0-only — derivatives must comply with AGPL. See `LICENSE` + `NOTICE`.  
**UI credits:** About tab must credit OpenMacro XTernal (@anorexc) and link the original repo.

## Launch flow

1. **Requirements setup** — install & verify packages (blocked until ready)  
2. Macro UI unlocks  

## App updates (in-app, no browser)

Users install **Macro Setup** once (NSIS). Then:

1. Updates tab → **Check for updates**
2. If newer → **Update**
3. App downloads + installs inside Macro and restarts

No GitHub UI, no ZIP extract for end users.

### Publish a release (you)
**Recommended:** from the project folder run:

```powershell
npm run release
```

It bumps the version (asks, default = next patch), asks for your `GH_TOKEN` (or uses `$env:GH_TOKEN` if already set), then commit → push → tag → publish Setup, and repairs missing release assets when needed.

Shortcuts:
- `npm run release:auto` — auto patch bump + default commit message (still prompts for token unless set)
- `npm run update` — alias of `npm run release`
- `release.bat` — double-click wrapper that runs the same npm script

**Manual way:**
1. Bump `package.json` version  
2. Create a GitHub Personal Access Token with `repo` scope  
3. In PowerShell:
```powershell
$env:GH_TOKEN = "your_token"
npm run publish
```
Never paste a real token into `PROJECT.md` or any tracked file. That uploads `Macro-Setup-x.y.z.exe`, `latest.yml`, and blockmap to GitHub Releases.

Old ZIP releases do **not** support in-app update. Users must install from the Setup exe once.

## How to use the macro

1. Open Roblox Fisch and equip a rod  
2. Start this app (`npm start` while developing, or the built `.exe` for users) and finish setup if needed  
3. **Fishing hotkey** (`start_macro`, default Num1) — start/stop fishing cycle  
4. **Appraise hotkey** (`start_appraise`, default Num4) — start/stop auto-appraise (requires enable in Appraise tab)  
5. **Fix Roblox** (`fix_roblox`, default Num7) — reattach + reload/auto-download offsets  
6. **Reload UI** (`reload`, default Num8)  

**Auto-fix offsets** (Settings → Roblox, on by default): when attach fails after a Roblox update, Macro downloads a fresh dump from `https://offsets.imtheo.lol/offsets.json`, saves it under userData (and refreshes `settings/offsets.json` when writable), then retries attach. Fix Roblox always force-refreshes when auto-fix is enabled.

Hotkeys are user-configurable in Settings. **Never hardcode F1/F2/F7 in user-facing messages** — use `{start_macro}`, `{start_appraise}`, `{fix_roblox}` placeholders via `src/hotkeys.js`.

Default fresh-install map (creator defaults):
| Action | Default |
|--------|---------|
| Fishing | Num1 |
| Spear assist | Num2 |
| Harpoon assist | Num3 |
| Appraise | Num4 |
| Fix Roblox | Num7 |
| Reload | Num8 |

## Build / distribute (no npm for end users)

Developers build once; users install the Setup app.

```bash
npm install
npm run dist          # Macro-Setup-x.y.z.exe (supports in-app updates)
npm run publish       # build + upload to GitHub Releases (needs GH_TOKEN)
npm run dist:zip      # optional ZIP (NO in-app updates)
```

**Recommended for players:** share / Release the **Setup installer**. Anyone can install once from your public GitHub Release, then Updates works inside the app.

### Windows “Company” property
Explorer always labels that field **Company** (Windows fixed label). The value comes from `package.json` → `author` / `build.win.publisherName` (currently **CodingForLife123**). You cannot rename the label to “Developer”.

Packaged builds skip the npm requirements gate because `koffi` is bundled.  

**AGPL note:** distributing the built app still requires AGPL compliance (source offer / LICENSE + NOTICE).

Fishing phases: `CASTING` → `CASTED` → `SHAKE` → `FISHING` → `DONE` (loops while running).

Shake matches XTernal: enable Roblox UI Navigation with `\`, spam Enter, and also click a shake GUI button if found in PlayerGui.

## Requirements

| Requirement | Purpose |
|-------------|---------|
| Windows (`win32`) | Macro targets Windows Roblox |
| `koffi` | Native FFI for process/memory + input |

## Key files

```
main.js                 # Window, setup IPC, macro IPC, global hotkeys
preload.js              # macroSetup + macro bridges
requirements.js
src/win32.js            # OpenProcess / RPM / mouse / keys
src/offsets.js          # Flatten offsets.json
src/memory.js           # Instance readers
src/roblox.js           # Attach + DataModel / PlayerGui
src/fish.js             # Cast / shake / reel + special phases
src/controllers.js      # Generic + special rod controllers
src/rods.js             # Known rod names + recognition
src/engine.js           # Tick loop + status events
src/notifications.js    # Desktop toast rules (fishing vs appraise)
src/notificationHost.js # Overlay notification window
src/hotkeys.js          # Shared hotkey read/format + {action} placeholders
src/friendlyErrors.js   # Plain-language errors (dynamic hotkeys)
settings/offsets.json
NOTICE / LICENSE        # AGPL attribution
```

## Rod support

Known rods (from XTernal `GetKnownRodNames`) are recognized by name. Most use the
generic reel controller. Special behavior:

| Rod | Behavior |
|-----|----------|
| Tranquility Rod | Rhythm lanes (A/S/D/F) |
| Lullaby | Metronome click windows (`lullaby_mode`) |
| Pinion's Aria | Note + fish targeting |
| Bellona's Waraxe | Dual reel (L+R mouse) |
| Requiem Rod | Forces 165ms action delay |
| Dreambreaker | Inverts hold/release after 40% progress |

Also specially matched: Lullaby / Dreambreaker even if not in the known list.  

## Build rules

1. Do **not** redesign finished UI unless asked.  
2. Do **not** unlock macro features if setup is incomplete.  
3. Add new native/runtime deps to both `package.json` and `requirements.js`.  
4. Respect AGPL-3.0 when porting reference source.  

## Notification rules

1. **Fishing and appraise are separate modes** — fishing uses `start_macro`, appraise uses `start_appraise`.  
2. **Do not treat `appraiseState: 'IDLE'` as appraise running** — only notify appraise when `rawPhase === 'APPRAISE' && cycleEnabled`.  
3. **All user-facing hotkey text must be dynamic** — read from `src/hotkeys.js`, never hardcode F-keys in errors/toasts.  
4. **Do not call `ShowWindow(SW_RESTORE)` on Roblox** unless the window is minimized — it un-maximizes fullscreen Roblox.  
5. Notifications are silent visual toasts only (no sound assets).  
6. Appraise success/failure toasts must still fire when the phase has already moved to `DONE` or `FAILED`; do not gate them on `rawPhase === 'APPRAISE'` only.  
7. Repeated appraise failures should still notify if the failure message changes; do not require a fresh `FAILED` transition only.  

## Appraise rules

1. Appraise should resolve fish data from the equipped fish's `fishinfo -> Info -> Subvalues` path.  
2. Re-resolve `fishinfo -> Info -> Subvalues` every detection pass; do not rely on a previously cached `Subvalues` pointer alone. Descendant fallback under the character is allowed when the exact chain is not found.  
3. If appraise cannot read `Subvalues`, prefer a "re-equip / fish info not found" diagnosis over assuming the player is not holding anything.  
4. A rod, spear, or any other non-fish equipped item must fail appraise immediately with a clear user-facing error toast.  
5. Mutation detection may use fish `Subvalues`, the equipped fish name, and visible Roblox appraise-result UI text (for example `Appraised: ...`) before deciding to continue.  
6. Closing the main window must dispose the notification host and quit the app; otherwise a hidden overlay window keeps the process alive and blocks relaunch via the single-instance lock.  
7. Do not use `window.prompt` / `window.confirm` / `window.alert` in the Electron UI — they often fail silently. Use in-app dialogs instead.  
8. Do not toast "Offsets do not match" just because Roblox is on the home screen or still joining Fisch. DataModel can resolve outside Fisch — require Fisch PlaceId (or a clear structural offset failure) before alarming.  

## Do / Don't (agent memory)

| Do | Don't |
|----|-------|
| Use `{start_macro}` / `{start_appraise}` placeholders in messages | Hardcode F1, F2, F7 in notifications or errors |
| Check `rawPhase === 'APPRAISE'` for appraise notifications | Treat any non-empty `appraiseState` as appraise (IDLE is always set) |
| Keep fishing hotkey and appraise hotkey fully separate | Merge or cross-block without clear user message |
| Focus Roblox with `WinActivate`-style logic only | Restore/maximize Roblox window on every focus |

## User Notes

- Creator: **@CodingForLife123**  
- Scope: XTernal-style Fisch macro  

---
*Last updated: 2026-08-24 — dynamic hotkey notifications, fishing/appraise mode split*
