# AGENTS.md — Developer & Agent Handoff Guide (v0.3.2)

Welcome to **Monstrum Fan Game :D** (`GAME_VERSION = '0.3.2'` in `src/game/types.ts`).  
Since `0.3.0`, the renderer has migrated from Canvas 2D to a **Three.js WebGPU/WebGL2 + TSL** 3D pipeline (`three/webgpu`) while preserving exact 2D tile-grid collision, AI, visibility, and `#000000` occlusion invariants. `0.3.2` adds **locked pre-run Dual Perspective** (`TOP_DOWN` vs `FIRST_PERSON`), **First-Person Deck 1/2 & indoor Deck 3 ceilings + open Deck 3 night sky dome**, **unified Three.js 3D raycast interactability**, and the **Deck 1 Submarine Bay 1-tile West relocation**.

---

## 1. Stack & Essential Commands

- **Runtime / Build**: React 19 + TypeScript + Three.js (`three/webgpu` + `three/tsl` with WebGL2 fallback) + Vite 8 + Tailwind CSS v4 (100% client-side procedural 3D meshes/textures and Web Audio synthesis).
- **Important scripts** (`package.json`):
  - `npm run dev` — Vite dev server on port `3000` (`--host=0.0.0.0`).
  - `npm run build` — Production Vite bundle (`dist/`).
  - `npm run lint` — TypeScript typecheck (`tsc --noEmit`).
  - `npm run debug:screenshots` — Legacy `0.1.2` Playwright suite (`scripts/captureVisionDebug.ts`). *Stale for `0.3.x`; see Section 2.5 before running.*
  - `npx tsx scripts/inspectShips.ts` — Legacy `0.1.x` ship audit (`src/game/shipAnalyzer.ts`). *Also pre-`0.2.0`; see Section 2.5.*

---

## 2. Debug Tools & How to Use Them

### 2.1 Instant Debug Boot (`?debug=1`, `?view=fp` / `?fp=1`)
- Append `?debug=1` (e.g. `http://127.0.0.1:3000/?debug=1`) in `src/App.tsx`:
  - Unlocks **Dev Mode** automatically (`devModeUnlocked = true`).
  - Auto-starts a deterministic run with **seed `100000`** on `STANDARD` difficulty.
  - Opens the right-hand **`DebugPanel`** (`debugOpen = true`) and activates `engine.debugConfig.enabled = true`.
- Append `?view=fp` or `?fp=1` (e.g. `/?debug=1&view=fp`) to auto-boot directly into `FIRST_PERSON` perspective.

### 2.2 Title Menu, Perspective Selection & Secret Unlocks (`src/components/TitleMenu.tsx`)
`TitleMenu` is a Monstrum-inspired security booth with live green-phosphor Canvas CRT feeds (`CrtMonitorFeed.tsx`): `NEW GAME`, `OPTIONS` (`GraphicsSettingsPanel.tsx`), `FIELD GUIDE`, `BRUTE INTEL`, and desk `CREDITS`.
- Clicking **`NEW GAME`** (`data-testid="crt-new-game"`) opens the **Expedition Setup Dossier**:
  - **Perspective Lock (`GameViewMode`)**: Choose **`TOP_DOWN`** (`data-testid="viewmode-top-down"`) or **`FIRST_PERSON`** (`data-testid="viewmode-first-person"`) before starting. Switching perspective mid-game is intentionally disallowed (Pause & End modals never expose a perspective switch; only `DebugPanel` can launch a fresh run in the other mode).
- **Unlock Dev Mode**: Click the `:D` smiley face (`aria-label="happy face"` or `aria-label="dev mode accent"`) **3 consecutive times**.
  - Reveals **Dev Mode: Internal Brute Numbers** (`BruteTuningNumbers`), the HUD **Debug** toggle button, **`F9`** / **`` ` ``** hotkeys, and all-deck tabs inside `PaperMapModal`.
- **Unlock Extreme Difficulty**: Click **`High`** **3 times** on any Brute axis (`data-testid="axis-intelligence-high"`, `axis-senses-high`, `axis-speed-high`) or **`Nightmare`** (`data-testid="preset-nightmare"`) **3 times**.

### 2.3 Live 3D & Vision Debug Drawer (`src/components/DebugPanel.tsx`)
Toggle in-game with **`F9`**, **`` ` ``**, or the HUD Debug button (automatically releases Pointer Lock in First-Person):
1. **3D Visual Inspector (TD / FP)**:
   - **`New Run: Top-Down` / `New Run: First-Person`**: Starts a fresh deterministic/seeded run in the chosen perspective.
   - **Render Modes**: `Normal`, `Fullbright`, `LoS Only`, `LoS Mask`, `Light Mask`.
   - **Camera Controls**: Pitch / Yaw / FOV sliders, Zoom (Top-Down), presets (`15°`, `Top 0°`, `Iso 38°`, `Low 58°`, `FreeCam`), **`Ceilings`** toggle, `Wireframe`, `Hide Caps`, `Gizmos`, and Deck override (`Auto`, `D3`, `D2`, `D1`).
   - **Navigation Helpers**: `Next Door`, `Toggle Door`, `Next Stair ↓ / ↑`.
2. **Dummy Player Scenarios (`DEBUG_SCENARIOS` in `src/game/debugScenarios.ts`)** — 12 instant test rigs (`WALL_OCCLUSION`, `LIT_ROOM_DOOR_SPILL`, `LIT_ROOM_CLOSED_DOOR`, `HIDING_FLASHLIGHT_PEEK`, `BRUTE_HIDING_KILL`, `DOOR_KEYHOLE_AND_FLARE`, `BRUTE_BEAM_CORNER`, `STAIR_BRUTE_GLOW`, `STAIR_PEEK`, `FLICKER_AND_SURVIVOR`, `ESCAPE_HELI_OVERHAUL`, `ESCAPE_LIFEBOAT_CRANE`).
3. **Simulation & Vision Overlays**: `Freeze AI` / `Resume AI`, `Step 50ms`, `forceVentPeek` / `forceDoorPeek` / `forceStairPeek`, `showPlayerLos`, `showBruteFov`, `showWallSegments`, `showBlackProbes`.
4. **3D Raycast & Telemetry**: Live perspective telemetry (`viewMode`, `fpYawDeg`, `fpPitchDeg`, `fpEyeZ`, `pointerLocked`), active deck ceiling stats (`tiles`, `visible`), and live Three.js 3D raycast target / occlusion (`hitKind`, `targetId`, `blockedBy`, `hitDist`, `occDist`, `hitZ`, `dist2d`).
5. **Async GPU Pixel Probes & PNG Capture**: `Sample Pixels` / `Capture Screenshot PNG` use async WebGPU/WebGL2 render-target readback (`probeBehindWallPixelsAsync`).

### 2.4 Browser / Playwright Automation Bridge (`window.__monstrumDebug`)
Exposed globally by `src/App.tsx`:
- **Run & Perspective**: `startWithViewMode(mode, seed?)`, `getViewMode()`, `getStatus()`, `loadScenario(id)`, `setOverlays(patch)`, `step(dtSec = 0.05)`
- **First-Person & Raycast**: `setFirstPersonPose(x, y, yawDeg, pitchDeg?)`, `getRaycastDebugState()`, `getCeilingStats()`, `aimAtInteractable(kind, targetId, subTarget?)`
- **Player & Brute**: `setPlayerPose(x, y)`, `setBrutePose(x, y, angle?)`, `tryInteract()`, `holdInteract(holding)`, `toggleFlashlight()`, `toggleJournal()`, `dropSelectedItem()`, `selectSlot(idx)`
- **Inspection & Readback**: `getEscapeInfo()`, `getRuntimeDetails()`, `getStructureSummary()`, `getContainersState()`, `getTelemetry()`, `getRendererBackend()`, `setGraphicsSettings(patch)`, `getGraphicsInfo()`, `probePixels()`, `probePixelsAsync()`, `captureCanvasDataUrl()`, `captureCanvasDataUrlAsync()`.

### 2.5 CLI Script Caveats + Headless Audit
1. **`scripts/captureVisionDebug.ts`** and **`scripts/inspectShips.ts` / `src/game/shipAnalyzer.ts`** remain from `0.1.x` and are stale against `0.3.2` UI/rendering (`?view=fp`, `viewmode-*` testids, 3D raycast interactables, Submarine Bay West shift).
2. **Headless Playwright / Chromium Note**: If running Playwright headless on Linux containers where default `chromium.executablePath()` version differs, pass `executablePath: '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell'` with `['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader']`. Remember `npm run dev` disables HMR, so call `restart_dev_server` after modifying source modules before re-running browser tests.

---

## 3. Codebase Map (`0.3.2`)

| File | Responsibility |
| :--- | :--- |
| `src/main.tsx` | Mounts React app + global `F11` fullscreen toggle. |
| `src/App.tsx` | Lifecycle, input (Top-Down cursor aiming + First-Person Pointer Lock mouse look / drag fallback / `WASD` / `Click` or `E`), RAF loop, `?debug=1` / `?view=fp`, `window.__monstrumDebug`. |
| `src/game/types.ts` | `GAME_VERSION = '0.3.2'`, `GameViewMode`, `RaycastInteractTarget`, `RaycastDebugInfo`, `WALL_HEIGHT_RATIO`, `DOOR_HEIGHT_PX`, difficulty presets & tuning, `ITEM_CATALOG`, `ShipMap`, `HudSnapshot`. |
| `src/game/mapGen.ts` | `generateCargoShip(seed?)`: 3-deck `126x114` vessel (`tileSize = 44`), Deck 1 Submarine Bay (`SUB_POOL_TX = 101`, `subTx = 98`, `subLeverTx = 95`), anti-thicc-wall solver, 3 `Fuse Control` panels, 2–4 padlocked vaults, `corridorLights`, steam pipes, paper maps, loot & clues. |
| `src/game/pathfinding.ts` | Multi-deck A* (`canSmashLocked` true only during active Brute `CHASE`). |
| `src/game/engine.ts` | `MonstrumGameEngine`: movement (TD & camera-relative FP), battery, lit/dark peeking, `MASTER_FUSE` power, reusable `BOLT_CUTTERS`, Helicopter 6 chains, 3 escapes, unified `tryInteract` accepting 3D raycast target (`DOOR`, `SWITCH`, `CONTAINER`, `ITEM`, `STAIR`, `HIDE`, `PAPER_MAP`, `FUSE_PANEL`, `ESCAPE_HELI`, `ESCAPE_LIFEBOAT`, `ESCAPE_SUB_LEVER`, `ESCAPE_SUB_HULL`). |
| `src/game/bruteAi.ts` | `BruteBrain`: utility AI, room/door/light/container memory, sight-only escape tracking, door-peek & Master-Fuse Intelligence reactions. |
| `src/game/visibility.ts` | 2D raycasting, wall occluder extraction, `computeVisibilityPolygon` (collinear sliver pruning), `buildVisibilityFanBuffers` (continuous corner curtains + `canCapCeiling` Deck 3 doorway clamping), Brute FOV, peek checks. |
| `src/game/lighting.ts` | Room light flicker, door spill cones, flares/glowsticks, Brute beam falloff. |
| `src/game/textures.ts` | Procedural textures for decks, walls, props, items, and blood/drag streaks. |
| `src/game/graphicsSettings.ts` | Presets, FOV/pitch/yaw defaults, resolution scaling, tone mapping, AO, bloom, HDR settings persistence. |
| `src/game/threeTsl.ts` | TSL node materials for ocean, batched radial light/LoS fans, darkness composite + contact AO, stair peek portal, bloom extract/blur, screen blit, sRGB readback. |
| `src/game/threeAssets.ts` | Dynamic 2D sprite texture library + baked per-deck floor/chunk textures. |
| `src/game/threeStructure.ts` | 3D walls, `EXTERIOR_DECK3_ROOMS`, per-deck ceilings (Deck 1/2 full minus stairwells; Deck 3 indoor rooms only), `polygonOffset` mask occlusion (`maskFrontMat`/`blackBackMat`), doors, stairwells, Deck 3 hull wedges & railings, and structure raycast hit/occluder meshes. |
| `src/game/threeObjects.ts` | 3D containers/lids/items, world pickups, light switches, paper maps, steam pipes, fuse panels, hiding vents, dropped lights, and interactable raycast hit proxies (`userData.raycastMeta`). |
| `src/game/threeEscapes.ts` | 3D Stern Helicopter (+ 6 chains & bollards), Lifeboat davit/crane, Deck 1 Submarine hull/gangway/floodgate lever, and escape raycast proxies. |
| `src/game/threeCharacters.ts` | 3D Player & Brute articulated rigs, visors, limbs, flashlight/searchlight emitters. |
| `src/game/renderer.ts` | Three.js `GameRenderer`: multi-pass render targets (`sceneTarget`, `losTarget`, `lightMaskTarget`, `finalTarget`, bloom, stair portal), Top-Down & First-Person camera/lighting, Deck 3 sky dome & exterior moonlit pass, unified 3D raycaster (`raycastInteractable`), async GPU probe readback. |
| `src/game/audio.ts` | `HorrorAudioEngine`: Web Audio procedural footsteps, spatial/occluded switches, fuses, chains, steam pipes, door smashes, machinery. |
| `src/game/debugScenarios.ts` | `DEBUG_SCENARIOS` metadata and `applyDebugScenarioToEngine(...)`. |
| `src/components/TitleMenu.tsx` | Monstrum security booth CCTV menu (`CrtMonitorFeed.tsx`), Setup Dossier with locked `TOP_DOWN` / `FIRST_PERSON` selector, Options (`GraphicsSettingsPanel.tsx`), Field Guide, Brute Intel, Credits, secret unlocks. |
| `src/components/GameHud.tsx` | HUD (perspective badge, FP center crosshair reticle & raycast interaction prompt, 1–6 slots, stamina/battery, Paper Map & Debug buttons). |
| `src/components/PaperMapModal.tsx` | Per-deck schematic with `"YOU ARE HERE"` pin and Fuse Control `[F]` markers. |
| `src/components/EscapeJournalModal.tsx` | `[J]` Escape Routes, parts checklist, and Helicopter Steel Chains (`0/6`) tracker. |
| `src/components/EscapeCutsceneModal.tsx` | Noir victory cutscene prior to `VICTORY` summary screen. |
| `src/components/GameModals.tsx` | Pause, Game Over, and Victory run stats (no mid-game perspective switching). |

---

## 4. Critical Architecture Invariants & Gotchas

1. **Single 2D Grid Partitioned Vertically by Deck (`map.deckBounds`)**:
   - `DECK_3` (`y: 0..37`), `DECK_2` (`y: 38..75`), and `DECK_1` (`y: 76..113`) share one `126x114` matrix (`tileSize = 44`). Decks only connect via `map.stairwells`.
   - Deck 1 Submarine Bay moonpool sits 1 tile West (`SUB_POOL_TX = 101`, `subTx = 98`, `subLeverTx = 95`) so the East perimeter doors/walkway stay unobstructed.

2. **Locked Pre-Run Perspective (`TOP_DOWN` vs `FIRST_PERSON`)**:
   - Selected in `TitleMenu` before clicking `Start Game`; cannot be toggled during an active run (`PauseModal` / `EndModal` have no view-mode UI).
   - First-Person controls: Pointer Lock mouse look (`fpYawDeg`, `fpPitchDeg` clamped `-75°..+75°`) + unlocked drag fallback, camera-relative `WASD`, `Shift` sprint, `C`/`Ctrl` sneak/crouch (`fpEyeZ` drops from `34` to `21`), `Q` peek, and `Click` / `E` / `Space` interact. Opening Pause, Modals, or `DebugPanel` auto-releases Pointer Lock.

3. **Unified Three.js 3D Raycast Interactability**:
   - In both perspectives (screen center reticle in `FIRST_PERSON`, mouse pointer in `TOP_DOWN`), `GameRenderer.raycastInteractable` intersects active-deck interactable proxies (`threeStructure`, `threeObjects`, `threeEscapes`) against 3D occluders (`worldSides`, `worldCaps`, `worldCeilings`, `doorRigs`, `propOcc`, `escapeOcc`).
   - Interactions require an unobstructed 3D hit (with `0.5px` tolerance for thin door/container proxies), valid 2D reach, and `hasLineOfSightToEntity`.

4. **Pure `#000000` Wall/Closed-Door Occlusion & Deck 3 Open Sky**:
   - `threeStructure.ts` builds ceilings across `DECK_1` and `DECK_2` (excluding stair openings) and ONLY indoor rooms on `DECK_3` (excluding `EXTERIOR_DECK3_ROOMS`: `'Helideck'`, `'Weather Deck'`, `'Container Bay'`, `'Forecastle'`).
   - Mask meshes (`losCaps`, `maskCaps`, `losSides`, `maskSides`, `losCeilings`, `maskCeilings`, door blockers) use `polygonOffset` (`maskFrontMat` / `blackBackMat`) so coplanar visibility/light curtains never Z-fight or tear at wall corners (`pushInwardPx = 0`).
   - `visibility.ts` collapses collinear sub-pixel wall slivers (`< 12px` on same `segId`), seals adjacent corner transitions (`<= 12px`), and clamps `lightMaskScene` indoor Deck 3 ceiling caps to open exterior doorways via `canCapCeiling`, while `populateLosScene` omits `canCapCeiling` so indoor doorways stay unbroken and `mask:deck3Moon` illuminates distant Deck 3 superstructures out to `2600px`.

5. **Lit-Side Peeking Stealth & Brute Intelligence Tiers**:
   - Lit-room vent peeks (`Q`) and lit-far-side closed-door peeks (`isDoorFarSideLit`) drain `0` battery, work at `0%`, and never alert the Brute.
   - Dark-side door peeks require `>0%` battery and trigger Intelligence-tiered Brute reactions (`LOW` ignores, `MEDIUM` stalks, `HIGH`/`EXTREME` smash & chase).
   - Master-Fuse powered decks (`poweredDecks[deck]`) lock switches ON (`EXTREME` 0 clicks / `HIGH` 1 click / `MEDIUM` 3s fiddle / `LOW` 10s fiddle + forget timer).

6. **Bolt Cutters, Chained Chopper, Chase-Only Padlock Smash & Fair AI**:
   - `BOLT_CUTTERS` are reusable; Helicopter starts bound by **6 chains** (`heliChainsRemaining = 6`, `2.0s/chain`, `950px` snap ripple).
   - Outside active `CHASE`/`PURSUIT`, Brute uses `canSmashLocked = false` and never smashes padlocked doors. Brute never tracks escape progress omnisciently (sight + acoustic ripples only).
