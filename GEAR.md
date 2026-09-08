# Gear equip rules (Fisch)

Remember these rules for agents and future changes.

## Rod — auto equip with **T**

- Fisch’s default **T** key **only equips / unequips the rod** (the player’s selected fishing rod).
- When the fishing macro starts and hands are empty, Macro may press **T** to equip a rod.
- Never press **T** if anything is already in hand (that toggles unequip).
- Never use a hardcoded hotbar slot (`1`, `2`, …) for rod equip — **T** is the Fisch bind.

## Harpoon / guns — **manual only**

- **Harpoon Guns** are a separate Fisch gear class (Steady Harpoon Gun, Frost Biter, Relic Piercer, …).
- Many gun titles **do not** include the word “harpoon” — detection uses:
  1. `KNOWN_HARPOON_NAMES` in `src/rods.js` (explicit list)
  2. Pattern `harpoon` / `harpoon gun` (future names with that word)
  3. Style patterns for known naming tropes (Piercer, Striker, Crasher, …)
- When Fisch adds a new gun **without** “harpoon” in the name and it isn’t matched by style patterns, **add it to `KNOWN_HARPOON_NAMES`**.
- Players **equip harpoons manually**. Macro must **not** auto-equip them (no **T**).
- Macro **does** detect harpoon equip / unequip in the activity log, e.g.  
  `Equipped harpoon: Frost Biter` / `Unequipped harpoon: …`
- If the player already holds a harpoon and starts fishing, leave it alone — do not press **T**.

## Spears

- Treat like other non-rod gear unless product rules change: do not auto-equip with **T**.

## Quick checklist

| Gear     | Detect equip/unequip | Auto-equip on start | Catch detection |
|----------|----------------------|---------------------|-----------------|
| Rod      | Yes                  | Yes — **T** if empty hands | Yes (reel cycle) |
| Harpoon  | Yes                  | **No** — manual     | Yes (PULL UI end) |
| Spear    | Yes                  | **No**              | Not yet |

## Harpoon catch detection

- While a **harpoon gun** is equipped, Macro watches for an active pull session (`src/harpoon.js`):
  1. Enabled/visible PlayerGui with real `PULL` / `PULL! (n)` text
  2. Large visible hooked-fish banner like `[Flounder]` (templates excluded)
- Pixel/screen capture fallback was **removed** — it false-fired on idle HUD and spammed catches (also slowed the PC).
- Needs ~2 consecutive hits, pull held ≥ ~700ms, then gone ≥ ~450ms, plus a 2s cooldown after each counted catch.
- This is **detection only** — it does not click PULL or fire the gun (Harpoon Assist is separate / future work).

## Code touchpoints

- `src/roblox.js` → `ensureRodEquipped()` — **T** for rods only
- `src/engine.js` → `startFishing()` / `activityWatchTick()` — rod equip + harpoon catch poll
- `src/harpoon.js` → `HarpoonCatchWatcher` — PULL UI → catch count
- `src/rods.js` → `resolveGearType()` — `rod` | `harpoon` | `spear`
- Activity log labels use `equippedKind` / `lastCatchSource` from status
