# AGENTS.md — Developer & Agent Handoff Guide

Welcome to **Monstrum Fan Game :D** (currently `GAME_VERSION = '0.2.0'` in `src/game/types.ts`).  
This guide explains the **debug tools**, **how to run and test the game**, **architecture & invariants**, and **known pitfalls** so you can pick up development smoothly.

---

## 1. Stack & Essential Commands

- **Runtime / Build**: React 19 + TypeScript + Vite 8 + Tailwind CSS v4 (100% client-side; all visuals are procedural Canvas 2D and all audio is synthesized via Web Audio API — no external image/sound asset files).
- **Important scripts** (`package.json`):
  - `npm run dev` — Vite dev server on port `3000` (`--host=0.0.0.0`).
  - `npm run build` — Production Vite bundle (`dist/`).
  - `npm run lint` — TypeScript typecheck (`tsc --noEmit`).
  - `npm run debug:screenshots` — Headless Playwright Chromium suite (`scripts/captureVisionDebug.ts`). *See Section 2.5 for `0.2.0` staleness caveats before trusting its assertions.*
  - `npx tsx scripts/inspectShips.ts` — 100-seed procedural ship audit + PNG blueprint renderer (`src/game/shipAnalyzer.ts`). *Also pre-`0.2.0`; see Section 2.5.*

---

## 2. Debug Tools & How to Use Them

### 2.1 Instant Debug Boot (`?debug=1`)
Append `?debug=1` to the app URL (e.g. `http://127.0.0.1:3000/?debug=1`). In `src/App.tsx`:
- Unlocks **Dev Mode** automatically (`devModeUnlocked = true`).
- Auto-starts a deterministic run with **seed `100000`** on `STANDARD` difficulty.
- Opens the right-hand **`DebugPanel`** (`debugOpen = true`) and activates `engine.debugConfig.enabled = true`.

### 2.2 Secret Unlocks on the Title Menu (`src/components/TitleMenu.tsx`)
When starting normally from `/`:
- **Unlock Dev Mode**: Click the `:D` smiley face (`aria-label="happy face"`) **3 consecutive times** (clicking anything else resets the streak).
  - Reveals the **Dev Mode: Internal Brute Numbers** panel (`BruteTuningNumbers`: `#dev-roamSpeed`, `#dev-chaseSpeed`, `#dev-halfFovDeg`, `#dev-sightMult`, `#dev-hearingMult`, `#dev-sweepCoverage`, etc.) with live edits (`customBruteTuning = true`) and a reset button.
  - Reveals the in-game HUD **Debug** toggle button (`aria-label="Toggle debug panel"`).
  - Enables **`F9`** and **`` ` ``** (`Backquote`) hotkeys during `'PLAYING'` to toggle `DebugPanel`.
  - Unlocks **all-deck switcher tabs** inside `PaperMapModal` (`devModeUnlocked ? viewDeck : standPos.deck`). Normally, Paper Maps only display the deck the stand sits on.
- **Unlock Extreme Difficulty**:
  - Click **`High`** **3 times** on any single axis (`data-testid="axis-intelligence-high"`, `axis-senses-high`, `axis-speed-high`) to flip that axis to `Extreme`.
  - Or click **`Nightmare`** (`data-testid="preset-nightmare"`) **3 times** to flip all three axes to `EXTREME`.
  - Clicking an `Extreme` axis/preset once reverts it to `High` / `Nightmare`.
  - Note: In `buildBruteTuningFromDifficulty` (`src/game/types.ts`), `EXTREME` Intelligence intentionally matches `HIGH` (`sweepCoverage: 1.0`, `overshootDist: 250`, `clueRoomDepth: 4`), whereas `EXTREME` Speed and Senses escalate sharply.

### 2.3 Live Debug Drawer (`src/components/DebugPanel.tsx`)
Toggle in-game with **`F9`**, **`` ` ``**, or the HUD Debug button (when Dev Mode is unlocked):
1. **Dummy Player Scenarios (`DEBUG_SCENARIOS` in `src/game/debugScenarios.ts`)** — 12 instant test rigs that reposition the player, Brute, doors, room lights, items, and `debugProbePoints`:
   - `WALL_OCCLUSION` — Flashlight aimed across a multi-tile bulkhead; Brute behind wall (OLED `#000000` test).
   - `LIT_ROOM_DOOR_SPILL` — Room light ON, door OPEN; checks warm corridor spill cone.
   - `LIT_ROOM_CLOSED_DOOR` — Room light ON behind closed door; checks interior stays `#000000`.
   - `HIDING_FLASHLIGHT_PEEK` — Player inside hiding spot with flashlight OFF; toggles Q vent-peek.
   - `BRUTE_HIDING_KILL` — Brute observes hide event, charges spot, executes rip-open kill.
   - `DOOR_KEYHOLE_AND_FLARE` — Closed-door peek into room with raycasted flare shadows & Brute.
   - `BRUTE_BEAM_CORNER` — Brute orange searchlight spilling around an open corner.
   - `STAIR_BRUTE_GLOW` — Brute climbing companionway hatch; stairwell warning glow.
   - `STAIR_PEEK` — Circular raycasted landing portal (`Q` / `forceStairPeek`) looking into target deck.
   - `FLICKER_AND_SURVIVOR` — Player silhouette inside a flickering lit compartment.
   - `ESCAPE_HELI_OVERHAUL` — Stern Helideck (`Deck 3`) with partial repairs + 6-slot Backpack.
   - `ESCAPE_LIFEBOAT_CRANE` — Bow Lifeboat Davit (`Deck 2`) swung over rail + floor Backpack pickup.
   - *(Note: Deck 1 Submarine and Deck 1 Steam Pipes currently do not have dedicated entries in `DEBUG_SCENARIOS`; test them via `window.__monstrumDebug` or headless engine runs.)*
2. **Simulation Controls**:
   - `Freeze AI` / `Resume AI` (`debugConfig.freezeAi`) — freezes Brute updates while allowing inspection.
   - `Step 50ms` — temporarily unfreezes AI for one `0.05s` simulation tick, re-renders, and refreshes telemetry.
   - Peek overrides: `forceVentPeek`, `forceDoorPeek`, `forceStairPeek`.
3. **Vision Overlays**:
   - `showPlayerLos` — draws player raycasted line-of-sight polygon.
   - `showBruteFov` — draws Brute vision cone + peripheral sensing circle.
   - `showWallSegments` — outlines raycast occluder segments.
   - `showBlackProbes` — draws crosshair markers for `engine.debugProbePoints`.
4. **Live Telemetry & Behind-Wall OLED Black Probe**:
   - Shows player coords, flashlight/battery, hiding/peek state, Brute AI state/goal (`engine.brain.activeGoal`), watched hide spot, inspect spot/timer.
   - **Sample Pixels** calls `probeBehindWallPixels()` (`ctx.getImageData` in `src/App.tsx`) at each `debugProbePoints` world coordinate and verifies `rgb(0,0,0)` (`#000000` vs `LEAK`).
5. **Capture Screenshot PNG**:
   - Captures `canvas.toDataURL('image/png')`, shows an inline preview, and triggers a browser download (`monstrum_debug_<scenario>_<timestamp>.png`).

### 2.4 Browser / Playwright Automation Bridge (`window.__monstrumDebug`)
Exposed globally by `src/App.tsx` whenever mounted, allowing DevTools console scripts or Playwright tests to drive and inspect the engine deterministically:

- `loadScenario(id: DebugScenarioId)` — calls `engine.applyDebugScenario(id)`, renders frame, syncs telemetry.
- `setOverlays(patch: Partial<DebugOverlayConfig>)` — updates overlay/freeze/peek flags, steps `0.016s`, renders.
- `step(dtSec = 0.05)` — advances `engine.update(dtSec, window.innerWidth, window.innerHeight)` and renders.
- `tryInteract()` — triggers `engine.tryInteract()`, steps `0.016s`, renders.
- `holdInteract(holding: boolean)` — sets `engine.holdingInteract` (loop with `step(0.05)` to complete held repairs, locker searches, cut padlocks, or launches).
- `toggleFlashlight()`, `toggleJournal()`, `dropSelectedItem()`, `selectSlot(idx)` — direct player actions.
- `setPlayerPose(x, y)` / `setBrutePose(x, y, angle?)` — teleport player/camera or Brute (clears Brute path).
- `testPositionInNearestDoor(offsetFromCenterPx = 6)` — places player inside nearest unlocked door to verify smooth doorway push-through.
- `getEscapeInfo()` — returns `heliPos`, `lifeboatPos`, `submarinePos` (including floodgate `leverTx`/`leverTy`/`leverX`/`leverY`), `tileDist`, inventory, `journalOpen`, `openPaperMapDeck`, installed parts & states (`heliState`, `lifeboatState`, `submarineState`).
- `getRuntimeDetails()` — returns `bruteTuning`, `customBruteTuning`, `difficulty`, `effectiveZoom`, `baseZoom`, `bloodStreakCount`, `steamPipesCount`, `paperMapsCount`, player/Brute coords, `steamStaggerTimer`, `peekingStairId`, `bruteState`, `brutePathLength`, `investigateTarget`, `observedEscape`, `activeNoiseRipples`, `maxAcousticRadius`, `nearestDoor`.
- `getTelemetry()` / `getStatus()` — current `DebugTelemetry` snapshot / `GameStatus`.
- `probePixels()` — renders and returns `ProbeReading[]` for `debugProbePoints`.
- `captureCanvasDataUrl()` — renders and returns canvas PNG data URL.

### 2.5 CLI Audit & Screenshot Scripts (and What Is Stale in `0.2.0`)
Two repo scripts exist, **both authored during `0.1.x` and needing updates if you want them green for `0.2.0+`**:

1. **`scripts/captureVisionDebug.ts` (`npm run debug:screenshots`)**:
   - Launches headless Playwright Chromium (`/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell`), attaches to `:3000` (or spawns Vite on `:3099`), runs menu + `window.__monstrumDebug` assertions, and saves PNGs to `.aistudio/artifacts/brain/bfb3d133-521f-43d5-bdad-af2c75633220/vision_debug/`.
   - **Stale checks to update**:
     - Asserts `'v0.1.2'` in the Title Menu (now `'v0.2.0'`).
     - Asserts `0.1.2` `EXTREME` senses (`sightMult === 1.42`, `halfFovDeg === 100`, `hearingMult === 1.52`); in `0.2.0`, senses were buffed across all tiers (`EXTREME` is `sightMult: 1.54`, `halfFovDeg: 105`, `hearingMult: 1.68`).
     - Does not yet cover Deck 1 Submarine, Deck 1 Steam Pipes, or Paper Maps.
2. **`scripts/inspectShips.ts` + `src/game/shipAnalyzer.ts`**:
   - Samples 100 seeds, prints ASCII maps and door/stub/reachability stats, and renders raw RGBA PNG blueprints to `.aistudio/artifacts/brain/e5cc8ba5-d298-4762-80a7-fcddc0bf69d0/ship_snapshots`.
   - **Stale checks**: `shipAnalyzer.ts` predates `0.2.0` (`submarinePos`, `SUBMARINE_PART` items, `paperMaps`, `steamPipes`, and Deck 1 thick-wall checks are absent).
3. **Recommended headless map/engine smoke check** (fast pattern using `npx tsx -e`):
   - Call `generateCargoShip(seed)` across multiple seeds to assert `0` enclosed walkable components via BFS across `stairwells` (`findPath(map, startTx, startTy, goalTx, goalTy, map.doors, true)`), `0` `3x3` `WALL` slabs on `DECK_1`, `stairwells.length === 12` (3 connections per deck transition = 6 endpoints on `DECK_2`, 3 on `DECK_3`, 3 on `DECK_1`), `paperMaps.length === 3` (1 per deck), and `steamPipes.length > 0` on `DECK_1`.
   - Note signatures carefully: `findPath` takes **tile** coordinates `(map, startTx, startTy, goalTx, goalTy, map.doors, canSmashLocked)`, `generateCargoShip` is in `src/game/mapGen.ts`, and `MonstrumGameEngine` takes `onHudUpdate` in its callbacks.

---

## 3. Codebase Map

| File | Responsibility |
| :--- | :--- |
| `src/main.tsx` | Mounts React app + global `F11` fullscreen toggle (`e.preventDefault()`, `requestFullscreen`/`exitFullscreen`). |
| `src/App.tsx` | Lifecycle (`TITLE_MENU` → `PLAYING` → `PAUSED` / `VICTORY_CUTSCENE` → `VICTORY` / `GAME_OVER`), input handling, `requestAnimationFrame` loop, `?debug=1` boot, `window.__monstrumDebug`. |
| `src/game/types.ts` | `GAME_VERSION`, `getViewportResolutionScale`, `DifficultyConfig`, `BruteTuningNumbers`, `ROOM_CATEGORIES` (`UNIQUE`/`GENERIC`/`CIRCULATION`), `ITEM_CATALOG`, `ShipMap`, `HudSnapshot`. |
| `src/game/mapGen.ts` | `generateCargoShip(seed?)`: 3-deck `126x114` procedural vessel (`CONTAINER_FREIGHTER`, `BULK_CARRIER`, `ICEBREAKER`), Z-bend corridors, small+anchor room packing, stub/enclosed-room repair, Deck 1 anti-thicc-wall solver, stairwells, steam pipes, paper maps, loot & clues. |
| `src/game/pathfinding.ts` | `findPath(...)`: Multi-deck A* across `DECK_3`, `DECK_2`, `DECK_1` using 1-hop and 2-hop stairwell cost heuristics. |
| `src/game/engine.ts` | `MonstrumGameEngine`: movement, stamina, flashlight battery, acoustic ripples (`emitNoise`), hiding/peeking (`Q` / `E`), `SteamPipe` telegraph/burst/stagger/fog, 3 escape routes (`ESCAPE_HELI`, `ESCAPE_LIFEBOAT`, `ESCAPE_SUBMARINE` + floodgate lever), Paper Map stand proximity auto-close. |
| `src/game/bruteAi.ts` | `BruteBrain`: utility AI (`PURSUIT`, `SMASH_DOOR`, `CHECK_HIDING`, `STALK_CLUE`, `INVESTIGATE_NOISE`, `UNLEASHED_ROAM`), room/door/light/container memory, sight-only escape progress tracking (`observedHeliRepairs`, `observedLifeboatRepairs`, `observedSubRepairs`, `*Active`). |
| `src/game/visibility.ts` | 2D raycasting, wall occluder extraction, player LoS, Brute FOV + peripheral checks, stair/door/vent peek visibility helpers. |
| `src/game/lighting.ts` | Room light flicker, light spill cones, flares/glowsticks, Brute beam falloff. |
| `src/game/renderer.ts` | Procedural Canvas 2D top-down renderer, OLED `#000000` fog-of-war masking, stair peek circular portal, steam jet & fog FX, debug overlays. |
| `src/game/textures.ts` | Procedural offscreen canvas textures for decks, bulkheads, props, and environmental blood/drag streaks. |
| `src/game/audio.ts` | `HorrorAudioEngine`: Web Audio procedural footsteps, Brute thuds, steam pipe clanks/hisses, door creaks/smashes, escape machinery. |
| `src/game/debugScenarios.ts` | `DEBUG_SCENARIOS` metadata and `applyDebugScenarioToEngine(...)`. |
| `src/components/TitleMenu.tsx` | Difficulty axes/presets, seed input, triple-click `:D` Dev Mode + triple-click `High`/`Nightmare` Extreme unlocks, `BruteTuningNumbers` form. |
| `src/components/GameHud.tsx` | Minimalist HUD (inventory slots 1–6, stamina/battery, contextual `[E]`/`[Q]` prompts, Paper Map & Debug triggers). |
| `src/components/PaperMapModal.tsx` | Stationary deck schematic modal with fixed `"YOU ARE HERE"` pin; locked to stand's deck unless `devModeUnlocked`. |
| `src/components/EscapeJournalModal.tsx` | `[J]` Escape Routes & Parts Checklist (Helicopter, Lifeboat, Submarine). |
| `src/components/EscapeCutsceneModal.tsx` | Noir victory cutscene prior to `VICTORY` summary screen. |
| `src/components/GameModals.tsx` | Pause, Game Over, and Victory run stats (`RunStats`). |

---

## 4. Critical Architecture Invariants & Gotchas

1. **Single 2D Grid Partitioned Vertically by Deck (`map.deckBounds`)**:
   - `DECK_3` (`y: 0..37`), `DECK_2` (`y: 38..75`), and `DECK_1` (`y: 76..113`) share one `126x114` matrix (`tileSize = 44`).
   - Walkable tiles on different decks NEVER touch directly; they connect strictly via `map.stairwells` (`targetStairId`).
   - Any flood-fill, room-packing, wall-carving, or neighbor check must clamp to the active deck's `deckBounds[deck]` (or check `deckGrid[y][x]`), and never strip outer hull `WALL` borders adjacent to `VOID` (except open rails around Deck 2 `Lifeboat Davit` / Deck 3 exterior).
   - **Deck Stair Topology (`0.2.0`)**: 3 stairwell links total connect adjacent decks (`DECK_3 <-> DECK_2` and `DECK_2 <-> DECK_1`) at offset `x,y` coordinates so transit between Deck 3 and Deck 1 requires crossing Deck 2.

2. **Procedural Generation Pass Ordering (`src/game/mapGen.ts`)**:
   - **Zero enclosed rooms & zero `3x3` thick walls on Deck 1** depend on pass order:
     - Dead-end corridor stub pruning (Section `5b`) **must run before** `runAntiThiccWallPass` (Section `5c`), because turning corridor dead-ends back into `WALL` can otherwise recreate `3x3` `WALL` slabs on Deck 1.
     - Both `packCompactRooms` and `fillGreedyPocketRooms` require `tiles[y][x] === 'WALL'` on the 1-tile perimeter around new rooms so compartments always keep a 1-tile bulkhead separating them from corridors and neighbors.
   - `ROOM_CATEGORIES` (`src/game/types.ts`) separates `UNIQUE` rooms (at most once per ship, e.g., `Bridge`, `Engine Room`, `Submarine Bay`) from `GENERIC` rooms (`Crew Quarters`, `Storage Room`, etc.) and `CIRCULATION`. Keep `roomIdGrid` distinct per room so Brute clue/memory tracking (`BruteBrain`) doesn't merge separate rooms.

3. **OLED Pure `#000000` Occlusion Invariant**:
   - Regions behind closed doors and walls must render at exact `rgb(0, 0, 0)` (no ambient grey bleed), except intentional clues like Brute searchlight bounce or stair-peek portals. Verify with `Black Probes` / `probePixels()` whenever modifying `visibility.ts`, `lighting.ts`, or `renderer.ts`.

4. **Sight-Only Escape Bias (`BruteBrain`)**:
   - The Brute does **not** automatically know when you install a part or start the Helicopter / Lifeboat / Submarine unless it hears the noise ripple (`emitNoise`) or **visually spots** the progress (`observedHeliRepairs`, `observedLifeboatRepairs`, `observedSubRepairs`, `*Active` in `bruteAi.ts`). Keep this fair-play constraint intact when adding future AI or escape mechanics.

5. **Smooth Resolution Scaling**:
   - `getViewportResolutionScale(w, h)` (`Math.sqrt(areaRatio)` clamped `0.45..3.0` around `1440x900`) preserves identical visible world area across small and 4K windows. Always apply zoom changes through `engine.getEffectiveZoom(w, h)` so raycast checks, camera, and mouse aim stay aligned.
