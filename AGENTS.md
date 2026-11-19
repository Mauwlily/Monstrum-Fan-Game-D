# AGENTS.md — Developer & Agent Handoff Guide (0.2.x → 0.3.x)

Welcome to **Monstrum Fan Game :D** (currently `GAME_VERSION = '0.2.3'`, the final **0.2.x** 2D top-down milestone in `src/game/types.ts`).  
This guide summarizes the **completed 0.2.x architecture**, **debug tools**, **invariants**, **gameplay systems**, and **known script caveats** so the `0.3.x` agent can pick up seamlessly.

---

## 1. Stack & Essential Commands

- **Runtime / Build**: React 19 + TypeScript + Vite 8 + Tailwind CSS v4 (100% client-side; all visuals are procedural Canvas 2D and all audio is synthesized via Web Audio API — no external image/sound asset files).
- **Important scripts** (`package.json`):
  - `npm run dev` — Vite dev server on port `3000` (`--host=0.0.0.0`).
  - `npm run build` — Production Vite bundle (`dist/`).
  - `npm run lint` — TypeScript typecheck (`tsc --noEmit`).
  - `npm run debug:screenshots` — Legacy `0.1.2` Playwright suite (`scripts/captureVisionDebug.ts`). *Stale for `0.2.x`; see Section 2.5 before running.*
  - `npx tsx scripts/inspectShips.ts` — Legacy `0.1.x` 100-seed ship audit (`src/game/shipAnalyzer.ts`). *Also pre-`0.2.0`; see Section 2.5.*

---

## 2. Debug Tools & How to Use Them

### 2.1 Instant Debug Boot (`?debug=1`)
Append `?debug=1` to the app URL (e.g. `http://127.0.0.1:3000/?debug=1`). In `src/App.tsx`:
- Unlocks **Dev Mode** automatically (`devModeUnlocked = true`).
- Auto-starts a deterministic run with **seed `100000`** on `STANDARD` difficulty.
- Opens the right-hand **`DebugPanel`** (`debugOpen = true`) and activates `engine.debugConfig.enabled = true`.

### 2.2 Title Menu & Secret Unlocks (`src/components/TitleMenu.tsx`)
In `0.2.2+`, `TitleMenu` is a **Monstrum-inspired security booth** with a 2×2 quad-array of live green-phosphor Canvas CCTV monitors (`NEW GAME`, `OPTIONS`, `FIELD GUIDE`, `BRUTE INTEL`) and a vintage desk CRT (`CREDITS`).
- Clicking **`NEW GAME`** opens the **Expedition Setup Dossier**, which houses presets, the 3×3 Brute matrix, ship seed (`#ship-seed`), and Start Game.
- **Unlock Dev Mode**: Click the `:D` smiley face (`aria-label="happy face"`, present inside the Setup Dossier header or `aria-label="dev mode accent"` next to `MONSTRUM` wall sign) **3 consecutive times** (clicking anything else resets the streak).
  - Reveals **Dev Mode: Internal Brute Numbers** (`BruteTuningNumbers`: `#dev-roamSpeed`, `#dev-chaseSpeed`, `#dev-halfFovDeg`, `#dev-sightMult`, `#dev-hearingMult`, `#dev-sweepCoverage`, etc.) with live edits (`customBruteTuning = true`) and a reset button.
  - Reveals the in-game HUD **Debug** toggle button (`aria-label="Toggle debug panel"`).
  - Enables **`F9`** and **`` ` ``** (`Backquote`) hotkeys during `'PLAYING'` to toggle `DebugPanel`.
  - Unlocks **all-deck switcher tabs** inside `PaperMapModal` (`devModeUnlocked ? viewDeck : standPos.deck`). Normally, Paper Maps only display the deck the stand sits on.
- **Unlock Extreme Difficulty**:
  - Inside the Setup Dossier, click **`High`** **3 times** on any single axis (`data-testid="axis-intelligence-high"`, `axis-senses-high`, `axis-speed-high`) to flip that axis to `Extreme`.
  - Or click **`Nightmare`** (`data-testid="preset-nightmare"`) **3 times** to flip all three axes to `EXTREME`.
  - Clicking an `Extreme` axis/preset once reverts it to `High` / `Nightmare`.
  - Note: Numerical `BruteTuningNumbers` for `EXTREME` Intelligence match `HIGH` (`sweepCoverage: 1.0`, `overshootDist: 250`, `clueRoomDepth: 4`), while behavioral AI (`bruteAi.ts` / `engine.ts`) gives `EXTREME` instant Master-Fuse hallway-power deduction (`0` switch clicks).

### 2.3 Live Debug Drawer (`src/components/DebugPanel.tsx`)
Toggle in-game with **`F9`**, **`` ` ``**, or the HUD Debug button (when Dev Mode is unlocked):
1. **Dummy Player Scenarios (`DEBUG_SCENARIOS` in `src/game/debugScenarios.ts`)** — 12 instant test rigs:
   - `WALL_OCCLUSION`, `LIT_ROOM_DOOR_SPILL`, `LIT_ROOM_CLOSED_DOOR`, `HIDING_FLASHLIGHT_PEEK`, `BRUTE_HIDING_KILL`, `DOOR_KEYHOLE_AND_FLARE`, `BRUTE_BEAM_CORNER`, `STAIR_BRUTE_GLOW`, `STAIR_PEEK`, `FLICKER_AND_SURVIVOR`, `ESCAPE_HELI_OVERHAUL` (now spawns with 2/3 parts + `heliChainsRemaining: 4` + reusable `BOLT_CUTTERS`), and `ESCAPE_LIFEBOAT_CRANE`.
   - *(Deck 1 Submarine, Deck 1 Steam Pipes, Master Fuse panels, and Locked-Only Vaults are tested via `window.__monstrumDebug` or headless engine runs.)*
2. **Simulation Controls**: `Freeze AI` / `Resume AI`, `Step 50ms`, and `forceVentPeek` / `forceDoorPeek` / `forceStairPeek`.
3. **Vision Overlays**: `showPlayerLos`, `showBruteFov`, `showWallSegments`, `showBlackProbes`.
4. **Live Telemetry & Behind-Wall OLED Black Probe**: `Sample Pixels` calls `probeBehindWallPixels()` (`ctx.getImageData` in `src/App.tsx`) to verify exact `rgb(0,0,0)` occlusion behind walls/closed doors.
5. **Capture Screenshot PNG**: Captures `canvas.toDataURL('image/png')`, previews inline, and downloads PNG.

### 2.4 Browser / Playwright Automation Bridge (`window.__monstrumDebug`)
Exposed globally by `src/App.tsx` whenever mounted:
- `loadScenario(id)`, `setOverlays(patch)`, `step(dtSec = 0.05)`, `tryInteract()`, `holdInteract(holding)`
- `toggleFlashlight()`, `toggleJournal()`, `dropSelectedItem()`, `selectSlot(idx)`
- `setPlayerPose(x, y)`, `setBrutePose(x, y, angle?)`, `testPositionInNearestDoor(offsetFromCenterPx = 6)`
- `getEscapeInfo()` — returns `heliPos`, `lifeboatPos`, `submarinePos` (with floodgate `lever*`), `tileDist`, `inventory`, `maxInventorySlots`, `hasBackpack`, `journalOpen`, `openPaperMapDeck`, `worldPickupsCount`, `heliParts`, `lifeboatParts`, `submarineParts`, `heliState`, `lifeboatState`, `submarineState`, `heliChainsRemaining`, `poweredDecks`, and `fuseSockets`.
- `getRuntimeDetails()` — returns `bruteTuning`, `customBruteTuning`, `difficulty`, `effectiveZoom`, `baseZoom` (1.0x–2.5x zoom range), `bloodStreakCount`, `steamPipesCount`, `paperMapsCount`, `playerX/Y`, `steamStaggerTimer`, `peekingStairId`, `bruteState`, `brutePos`, `brutePathLength`, `investigateTarget`, `observedEscape`, `activeNoiseRipples`, `maxAcousticRadius`, `lockedOnlyRoomIds`, `poweredDecks`, `bruteKnownFuseDecks`, `bruteFiddleSwitchId`, and `nearestDoor`.
- `getTelemetry()`, `getStatus()`, `probePixels()`, `captureCanvasDataUrl()`.

### 2.5 CLI Audit & Screenshot Scripts (Staleness Caveats + Fast Smoke Check)
1. **`scripts/captureVisionDebug.ts` (`npm run debug:screenshots`)** and **`scripts/inspectShips.ts` + `src/game/shipAnalyzer.ts`** both date back to `0.1.x`:
   - `captureVisionDebug.ts` asserts old `'v0.1.2'` text, pre-`0.2.2` button layout on the title screen, and old `0.1.2` `EXTREME` senses tuning (`sightMult: 1.42` vs current `1.54`).
   - `shipAnalyzer.ts` omits `0.2.x` `submarinePos`, `steamPipes`, `paperMaps`, `fuseSockets`, `lockedOnlyRoomIds`, and Deck 1 thick-wall checks.
2. **Recommended headless `0.2.3` audit (`npx tsx -e`)**:
   - Across 30+ seeds via `generateCargoShip(seed)`: assert `map.fuseSockets.length === 3` (1 unlocked `'Fuse Control'` per deck), `map.lockedOnlyRoomIds.length` in `2..4` (all border doors `isLocked`, player/Brute never spawn inside), `1` `MASTER_FUSE` + `>=3` `BOLT_CUTTERS` + `1` `BACKPACK` strictly in unlocked containers, `stairwells.length === 12` (all walkable), `0` interior `3x3 WALL` slabs on `DECK_1` (excluding outer hull `VOID`-border within 2 tiles), and `0` isolated non-vault walkable tiles via `runReachabilityBfs`-style unlocked BFS.
   - Note: `Container` holds its loot in `container.item` (not `.loot`).
   - Note: `RoomLightSwitch` stores `tx/ty` without `.deck`; resolve deck via `map.deckGrid[sw.ty][sw.tx]`.

---

## 3. Codebase Map (End of 0.2.x)

| File | Responsibility |
| :--- | :--- |
| `src/main.tsx` | Mounts React app + global `F11` fullscreen toggle. |
| `src/App.tsx` | Lifecycle (`TITLE_MENU` → `PLAYING` → `PAUSED` / `VICTORY_CUTSCENE` → `VICTORY` / `GAME_OVER`), input, RAF loop, `?debug=1`, `window.__monstrumDebug`. |
| `src/game/types.ts` | `GAME_VERSION = '0.2.3'`, viewport resolution scaling, difficulty presets & tuning, `ROOM_CATEGORIES`, `ITEM_CATALOG` (`MASTER_FUSE`, reusable `BOLT_CUTTERS`, etc.), `FuseSocket`, `CorridorLightFixture`, `ShipMap`, `BruteState`, `EscapeProgress`, `HudSnapshot`. |
| `src/game/mapGen.ts` | `generateCargoShip(seed?)`: 3-deck `126x114` vessel (`CONTAINER_FREIGHTER`, `BULK_CARRIER`, `ICEBREAKER`), Deck 1 anti-thicc-wall solver, zero-isolation repair, 3 unlocked `'Fuse Control'` panels, 2–4 padlocked-only vault rooms, `corridorLights`, steam pipes, paper maps, loot & clues. |
| `src/game/pathfinding.ts` | Multi-deck A* (`findPath(map, startTx, startTy, goalTx, goalTy, doors, canSmashLocked)`). `canSmashLocked` is ONLY `true` during active Brute `CHASE`. |
| `src/game/engine.ts` | `MonstrumGameEngine`: movement, battery, `isHidingSpotRoomLit`, `isDoorFarSideLit`, lit/dark peeking, `MASTER_FUSE` deck power & switch lock, Brute switch-fiddle loop, reusable `BOLT_CUTTERS` + Helicopter 6-chain cutting, 3 escapes, Paper Map auto-close. |
| `src/game/bruteAi.ts` | `BruteBrain`: utility AI, room/door/light/container memory, sight-only escape tracking, door-peek reactions by Intelligence, Master-Fuse `knownFuseDecks` & `lowForgetTimers` (Extreme 0 clicks / High 1 click / Med 3s / Low 10s + forget). |
| `src/game/visibility.ts` | 2D raycasting, wall occluder extraction, player LoS, Brute FOV + `poweredDecks` lit hallway sight boost (`485 * sightMult`), peek helpers. |
| `src/game/lighting.ts` | Room light flicker, door spill cones, flares/glowsticks, Brute beam falloff. |
| `src/game/renderer.ts` | Canvas 2D top-down renderer, OLED `#000000` fog-of-war, powered deck ceiling lights (`corridorLights`), lit/dark door peek cones, 6-chain Helicopter bollards, Fuse Control panels, stair peek portal, debug overlays. |
| `src/game/textures.ts` | Procedural textures for decks, bulkheads, props, and blood/drag streaks. |
| `src/game/audio.ts` | `HorrorAudioEngine`: Web Audio procedural footsteps, spatial/occluded switches (`playBreakerSwitch`), `playMasterFuseInsert`, `playHeliChainSnap`, steam pipes, door smashes, machinery. |
| `src/game/debugScenarios.ts` | `DEBUG_SCENARIOS` metadata and `applyDebugScenarioToEngine(...)`. |
| `src/components/TitleMenu.tsx` | Monstrum security booth CCTV menu, live green-phosphor feeds, Setup/Options/Field Guide/Brute Intel/Credits dossiers, secret `:D` & `Extreme` unlocks. |
| `src/components/GameHud.tsx` | HUD (1–6 slots, stamina/battery, prompts, Paper Map & Debug buttons). |
| `src/components/PaperMapModal.tsx` | Per-deck schematic with fixed `"YOU ARE HERE"` pin and Fuse Control `[F]` markers. |
| `src/components/EscapeJournalModal.tsx` | `[J]` Escape Routes, parts checklist, and Helicopter Steel Chains (`0/6`) tracker. |
| `src/components/EscapeCutsceneModal.tsx` | Noir victory cutscene prior to `VICTORY` summary screen. |
| `src/components/GameModals.tsx` | Pause, Game Over, and Victory run stats. |

---

## 4. Critical Architecture Invariants & Gotchas

1. **Single 2D Grid Partitioned Vertically by Deck (`map.deckBounds`)**:
   - `DECK_3` (`y: 0..37`), `DECK_2` (`y: 38..75`), and `DECK_1` (`y: 76..113`) share one `126x114` matrix (`tileSize = 44`). Decks only connect via `map.stairwells`.
   - Never call `clear` directly on `reserved` around props/stairs, and note `buildDeck3Annex` in `mapGen.ts`: keep temporary `annexGuard` keys deleted before `buildDeck3Annex` populates interior rooms so switches/fuse panels/containers can spawn inside Deck 3 annexes.

2. **Procedural Generation Ordering (`src/game/mapGen.ts`)**:
   - Dead-end corridor stub pruning (Section `5b`) runs before `runAntiThiccWallPass` (Section `5c`).
   - `lockedOnlyRoomIds` selection (`2..4` interior rooms) locks all bordering doors **and** skips `lockedDoorKeysNow` when checking unlocked BFS reachability of non-vault tiles. Player and Brute spawns exclude `lockedOnlyRoomIds`; `MASTER_FUSE`, 3× `BOLT_CUTTERS`, and `BACKPACK` stay strictly outside locked vaults.

3. **OLED Pure `#000000` Occlusion & Powered Decks (`0.2.3`)**:
   - Behind walls and closed doors must stay exact `rgb(0, 0, 0)`. Even when a deck is powered via `MASTER_FUSE` (`poweredDecks[deck] = true`), `corridorLights` fixtures raycast against walls/closed doors inside active camera deck or `peekingStairId` portal so light never bleeds across bulkheads.

4. **Lit-Side Peeking Stealth & Brute Intelligence Tiers (`0.2.2–0.2.3`)**:
   - Holding `Q` in a **lit room** (hiding vent peek) OR peering through a closed door when the **far side** (`isDoorFarSideLit`) is illuminated (`sw.isOn || poweredDecks[farDeck]`) drains `0` battery, works at `0%` battery, skips fake flashlight cone visuals, and **never alerts the Brute**.
   - Dark-side door peeks require `>0%` battery, drain `1.35/s` when flashlight is off, and trigger Intelligence-tiered reactions: `LOW` ignores, `MEDIUM` logs `DOOR_PEEK_BEAM` stalk clue, `HIGH`/`EXTREME` roar, smash door, and `CHASE`.
   - On Master-Fuse powered decks (`poweredDecks[deck]`), wall switches lock ON (`cannot toggle off`) and Brute reacts by Intelligence: `EXTREME` (`0` clicks -> immediately `knownFuseDecks.add(deck)`), `HIGH` (`1` click -> learns deck), `MEDIUM` (`3s` fiddle loop -> learns deck), `LOW` (`10s` fiddle loop -> learns deck, then `lowForgetTimers` expires after `48–72s` so it forgets and tries switches again).

5. **Bolt Cutters, Chained Chopper & Chase-Only Padlock Smash (`0.2.3`)**:
   - `BOLT_CUTTERS` are **reusable** (infinite uses on locked vault doors, normal padlocks, and Helicopter chains).
   - Stern Helicopter begins bound by **6 heavy chains** (`heliChainsRemaining = 6`). Cutting takes `2.0s/chain` with `BOLT_CUTTERS` in pack and emits a `950px` snap noise ripple (`urgency = 0.92`). Parts (`3/3`) may be installed anytime, but turbine spin-up (`ACTIVATING`) requires `heliChainsRemaining === 0`.
   - Outside active `CHASE`/`PURSUIT`, Brute uses `canSmashLocked = false` and **never** smashes padlocked doors (`!door.isLocked` guard in `followTarget`). Only active `CHASE` can breach locked vault rooms.

6. **Sight-Only Escape Bias (`BruteBrain`)**:
   - Keep Brute fair-play intact: Brute only learns of escape progress via acoustic ripples or direct visual observation (`observedHeliRepairs`, etc.), never omnisciently.

