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

## App updates (GitHub Releases)

Manual only (Updates tab):
1. User clicks **Check for updates**
2. If newer, **Update** button appears — user must click it
3. Browser opens the ZIP download; user extracts over their Macro folder

Nothing installs or downloads on its own. Publishing: bump `package.json` version → `npm run dist:zip` → upload ZIP to a new GitHub Release tag (`vX.Y.Z`). Repo should be public so checks work.

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

Developers build once; users just run the app.

```bash
npm install
npm run dist        # single portable .exe (simpler share, slower first/every unpack)
npm run dist:zip    # ZIP of unpacked app (extract once → Macro.exe opens fast)
```

### Why portable `.exe` feels slow
The portable build is a self-extracting archive. Each launch unpacks ~90MB into a temp folder before the UI opens. That is normal for Electron portable apps, not a bug in Macro.

### What to share
| File | Pros | Cons |
|------|------|------|
| `Macro-0.0.1.exe` | One file to send | Slow to open (unpacks every time) |
| `Macro-0.0.1-fast.zip` | Opens fast after extract | User must unzip once |

**Recommended for players:** share `Macro-0.0.1-fast.zip`. They extract the folder, then double‑click `Macro.exe`.

Ignore `dist/win-unpacked/` as a share target by itself unless you zip it.

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
