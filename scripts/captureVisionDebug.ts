import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROMIUM_EXECUTABLE = '/ms-playwright/chrome-headless-shell-linux64/chrome-headless-shell';
const OUTPUT_DIR = path.resolve(
  '.aistudio/artifacts/brain/bfb3d133-521f-43d5-bdad-af2c75633220/vision_debug'
);

function checkServerReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkServerReady(url)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for Vite server at ${url}`);
}

async function ensureViteServer(): Promise<{ url: string; proc: ChildProcess | null }> {
  const existingUrl = 'http://127.0.0.1:3000';
  if (await checkServerReady(existingUrl)) {
    return { url: existingUrl, proc: null };
  }

  const port = 3099;
  const spawnedUrl = `http://127.0.0.1:${port}`;
  const proc = spawn('npx', ['vite', `--port=${port}`, '--host=127.0.0.1', '--strictPort'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  await waitForServer(spawnedUrl, 25000);
  return { url: spawnedUrl, proc };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const { url, proc } = await ensureViteServer();

  const browser = await chromium.launch({
    executablePath: CHROMIUM_EXECUTABLE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    console.log(`Connecting to ${url}/?debug=1 ...`);

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.error('[browser console.error]', msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
      console.error('[browser pageerror]', err.message);
    });

    await page.goto(`${url}/?debug=1`, { waitUntil: 'domcontentloaded' });
    try {
      await page.waitForFunction(() => Boolean(window.__monstrumDebug), undefined, { timeout: 15000 });
    } catch (err) {
      const title = await page.title();
      const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
      console.error('Debug hook missing. Title:', title, 'Body:', bodyText);
      throw err;
    }

    const failures: string[] = [];
    const check = (condition: unknown, message: string) => {
      if (!condition) {
        console.error(`CHECK FAILED: ${message}`);
        failures.push(message);
      }
    };

    // 0. Check v0.1.2 Main Menu, F11 Fullscreen, Triple-Click Extreme, secret 3-click :D Dev Mode, & custom Brute numbers
    const normalPage = await context.newPage();
    normalPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[normal] ${msg.text()}`);
      }
    });
    normalPage.on('pageerror', (err) => {
      pageErrors.push(`[normal] ${err.message}`);
    });

    await normalPage.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    await normalPage.waitForSelector('h1');
    const menuTextLocked = await normalPage.evaluate(() => document.body.innerText);
    check(menuTextLocked.includes('v0.1.2'), 'Expected Main Menu to display v0.1.2');
    check(
      !menuTextLocked.includes('Dev Mode: Internal Brute Numbers'),
      'Expected Dev Mode panel hidden before 3-click :D unlock'
    );

    // Verify F11 triggers fullscreen handler cleanly
    await normalPage.evaluate(() => {
      (window as unknown as { __f11Calls: number }).__f11Calls = 0;
      document.documentElement.requestFullscreen = async () => {
        (window as unknown as { __f11Calls: number }).__f11Calls++;
      };
    });
    await normalPage.keyboard.press('F11');
    const f11Calls = await normalPage.evaluate(
      () => (window as unknown as { __f11Calls: number }).__f11Calls
    );
    check(f11Calls === 1, `Expected F11 to trigger requestFullscreen once, got ${f11Calls}`);

    // Verify triple-click High unlocks Extreme for individual axes & Intelligence matches High
    await normalPage.getByTestId('axis-intelligence-high').click();
    await normalPage.getByTestId('axis-intelligence-high').click();
    await normalPage.getByTestId('axis-intelligence-high').click();
    const intelExtText = await normalPage.getByTestId('axis-intelligence-high').innerText();
    check(
      intelExtText.trim() === 'Extreme',
      `Expected 3 clicks on Intelligence High to flip to Extreme, got "${intelExtText}"`
    );

    // Start with Extreme Intelligence + Standard Senses/Speed to confirm Extreme Intelligence == High
    await normalPage.getByRole('button', { name: 'Start Game' }).click();
    await normalPage.waitForFunction(() => Boolean(window.__monstrumDebug?.getRuntimeDetails()));
    const intelExtDetails = await normalPage.evaluate(() =>
      window.__monstrumDebug!.getRuntimeDetails()
    );
    check(
      intelExtDetails?.difficulty.intelligence === 'EXTREME' &&
        intelExtDetails.bruteTuning.sweepCoverage === 1.0 &&
        intelExtDetails.bruteTuning.overshootDist === 250 &&
        intelExtDetails.bruteTuning.clueRoomDepth === 4,
      `Expected EXTREME intelligence to match HIGH internals, got ${JSON.stringify(intelExtDetails?.bruteTuning)}`
    );

    // Reload menu and verify clicking Extreme reverts to High, plus triple-click Nightmare unlocks all Extreme
    await normalPage.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    await normalPage.waitForSelector('[data-testid="axis-senses-high"]');
    await normalPage.getByTestId('axis-senses-high').click();
    await normalPage.getByTestId('axis-senses-high').click();
    await normalPage.getByTestId('axis-senses-high').click();
    check(
      (await normalPage.getByTestId('axis-senses-high').innerText()).trim() === 'Extreme',
      'Expected 3 clicks on Senses High to unlock Extreme'
    );
    await normalPage.getByTestId('axis-senses-high').click();
    check(
      (await normalPage.getByTestId('axis-senses-high').innerText()).trim() === 'High',
      'Expected clicking Extreme axis once to revert to High'
    );

    // Triple-click Nightmare -> flips all 3 axes to Extreme
    await normalPage.getByTestId('preset-nightmare').click();
    await normalPage.getByTestId('preset-nightmare').click();
    await normalPage.getByTestId('preset-nightmare').click();
    const extremeMenuText = await normalPage.evaluate(() => document.body.innerText);
    check(
      extremeMenuText.includes('Extreme Preset') &&
        (await normalPage.getByTestId('preset-nightmare').innerText()).trim() === 'Extreme' &&
        (await normalPage.getByTestId('axis-speed-high').innerText()).trim() === 'Extreme' &&
        (await normalPage.getByTestId('axis-senses-high').innerText()).trim() === 'Extreme',
      'Expected 3 clicks on Nightmare preset to flip preset and all axes to Extreme'
    );
    await normalPage.screenshot({ path: path.join(OUTPUT_DIR, '17_title_menu_extreme.png') });
    console.log(`Saved ${path.join(OUTPUT_DIR, '17_title_menu_extreme.png')}`);

    // Clicking Extreme preset once reverts back to Nightmare
    await normalPage.getByTestId('preset-nightmare').click();
    check(
      (await normalPage.getByTestId('preset-nightmare').innerText()).trim() === 'Nightmare' &&
        (await normalPage.getByTestId('axis-speed-high').innerText()).trim() === 'High',
      'Expected clicking Extreme preset once to revert to Nightmare'
    );

    // Flip back to Extreme preset and verify escalated Speed & Senses in-engine + hidden Debug button
    await normalPage.getByTestId('preset-nightmare').click();
    await normalPage.getByTestId('preset-nightmare').click();
    await normalPage.getByTestId('preset-nightmare').click();
    await normalPage.getByRole('button', { name: 'Start Game' }).click();
    await normalPage.waitForFunction(() => Boolean(window.__monstrumDebug?.getRuntimeDetails()));
    const extRuntime = await normalPage.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    check(
      extRuntime?.difficulty.speed === 'EXTREME' &&
        extRuntime.difficulty.senses === 'EXTREME' &&
        extRuntime.bruteTuning.chaseSpeed === 316 &&
        extRuntime.bruteTuning.halfFovDeg === 100 &&
        extRuntime.bruteTuning.sightMult === 1.42 &&
        extRuntime.bruteTuning.hearingMult === 1.52,
      `Expected escalated EXTREME Speed/Senses internals, got ${JSON.stringify(extRuntime?.bruteTuning)}`
    );
    const debugBtnCountLocked = await normalPage.getByRole('button', { name: 'Toggle debug panel' }).count();
    check(debugBtnCountLocked === 0, `Expected Debug HUD button hidden when locked, found ${debugBtnCountLocked}`);

    // Reload clean menu & verify non-consecutive clicks do NOT unlock Dev Mode
    await normalPage.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    await normalPage.waitForSelector('[aria-label="happy face"]');
    const smiley = normalPage.getByLabel('happy face');
    await smiley.click();
    await normalPage.locator('h1').click({ position: { x: 10, y: 10 } }); // breaks streak
    await smiley.click();
    await smiley.click();
    const menuTextBrokenStreak = await normalPage.evaluate(() => document.body.innerText);
    check(
      !menuTextBrokenStreak.includes('Dev Mode: Internal Brute Numbers'),
      'Expected non-consecutive clicks on :D NOT to unlock Dev Mode'
    );

    // Click :D 3 times in a row -> unlocks Dev Mode panel
    await smiley.click();
    await smiley.click();
    await smiley.click();
    await normalPage.waitForSelector('#dev-chaseSpeed');
    const menuTextUnlocked = await normalPage.evaluate(() => document.body.innerText);
    check(
      menuTextUnlocked.includes('Dev Mode: Internal Brute Numbers') &&
        menuTextUnlocked.includes('Dev Mode Active'),
      'Expected 3 consecutive clicks on :D to unlock Dev Mode panel'
    );

    // Modify Brute internal numbers (Speed & Senses) and capture screenshot
    await normalPage.fill('#dev-chaseSpeed', '310');
    await normalPage.fill('#dev-halfFovDeg', '96');
    await normalPage.screenshot({ path: path.join(OUTPUT_DIR, '15_title_menu_dev_mode.png') });
    console.log(`Saved ${path.join(OUTPUT_DIR, '15_title_menu_dev_mode.png')}`);

    // Start Game with Dev Mode unlocked -> Debug HUD button visible + custom tuning active + blood streaks generated
    await normalPage.getByRole('button', { name: 'Start Game' }).click();
    await normalPage.waitForFunction(() => Boolean(window.__monstrumDebug?.getRuntimeDetails()));
    const debugBtnCountUnlocked = await normalPage
      .getByRole('button', { name: 'Toggle debug panel' })
      .count();
    check(
      debugBtnCountUnlocked === 1,
      `Expected Debug HUD button visible when Dev Mode unlocked, found ${debugBtnCountUnlocked}`
    );

    const runtimeDetails = await normalPage.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    console.log('0.1.1 runtime details:', runtimeDetails);
    check(
      runtimeDetails?.customBruteTuning === true &&
        runtimeDetails.bruteTuning.chaseSpeed === 310 &&
        runtimeDetails.bruteTuning.halfFovDeg === 96,
      `Expected custom Brute numbers (chaseSpeed=310, halfFovDeg=96) in engine, got ${JSON.stringify(runtimeDetails?.bruteTuning)}`
    );
    check(
      (runtimeDetails?.bloodStreakCount ?? 0) >= 8,
      `Expected crew blood streaks spawned across ship (>=8), got ${runtimeDetails?.bloodStreakCount}`
    );

    // Verify Door anti-stick push-through (both forward +6px and backward -6px)
    const fwdStart = await normalPage.evaluate(() =>
      window.__monstrumDebug!.testPositionInNearestDoor(6)
    );
    check(fwdStart !== null, 'Expected a nearby unlocked door for forward push-through test');
    if (fwdStart) {
      await normalPage.evaluate(() => {
        window.__monstrumDebug!.tryInteract(); // close door while overlapping +6px past center
        for (let i = 0; i < 12; i++) window.__monstrumDebug!.step(0.05);
      });
      const fwdEnd = await normalPage.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
      const axisDeltaFwd =
        fwdStart.orientation === 'H'
          ? (fwdEnd?.playerY ?? 0) - fwdStart.doorCenterY
          : (fwdEnd?.playerX ?? 0) - fwdStart.doorCenterX;
      console.log('Door forward push-through delta:', axisDeltaFwd, 'door:', fwdEnd?.nearestDoor);
      check(
        axisDeltaFwd >= 18,
        `Expected player pushed cleanly forward (>=18px past center) without sticking, got ${axisDeltaFwd.toFixed(1)}`
      );
    }

    const bwdStart = await normalPage.evaluate(() =>
      window.__monstrumDebug!.testPositionInNearestDoor(-6)
    );
    if (bwdStart) {
      await normalPage.evaluate(() => {
        window.__monstrumDebug!.tryInteract(); // close door while overlapping -6px before center
        for (let i = 0; i < 12; i++) window.__monstrumDebug!.step(0.05);
      });
      const bwdEnd = await normalPage.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
      const axisDeltaBwd =
        bwdStart.orientation === 'H'
          ? (bwdEnd?.playerY ?? 0) - bwdStart.doorCenterY
          : (bwdEnd?.playerX ?? 0) - bwdStart.doorCenterX;
      console.log('Door backward push-through delta:', axisDeltaBwd);
      check(
        axisDeltaBwd <= -18,
        `Expected player pushed cleanly backward (<=-18px past center) without sticking, got ${axisDeltaBwd.toFixed(1)}`
      );
    }
    await normalPage.close();

    // Disable automatic RAF drift during deterministic scenario checks by keeping freezeAi true where needed
    const shot = async (filename: string) => {
      const target = path.join(OUTPUT_DIR, filename);
      await page.screenshot({ path: target });
      console.log(`Saved ${target}`);
    };

    // 1. WALL_OCCLUSION: Strict inner-wall edge + pure #000000 behind walls + Brute invisible
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('WALL_OCCLUSION');
      window.__monstrumDebug!.setOverlays({
        showBlackProbes: true,
        showPlayerLos: false,
        showBruteFov: false,
        showWallSegments: false,
      });
    });
    await page.waitForTimeout(100);
    const wallProbes = await page.evaluate(() => window.__monstrumDebug!.probePixels());
    console.log('WALL_OCCLUSION probes:', wallProbes);
    check(wallProbes.length >= 2, 'Expected >=2 probes in WALL_OCCLUSION');
    for (const pr of wallProbes) {
      check(
        pr.isPureBlack,
        `WALL_OCCLUSION leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`
      );
    }
    await shot('01_wall_occlusion.png');

    // Also capture an overlay version showing exact wall segments & LoS polygon
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({
        showWallSegments: true,
        showPlayerLos: true,
        showBruteFov: true,
      });
    });
    await page.waitForTimeout(80);
    await shot('01b_wall_occlusion_overlays.png');
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({
        showWallSegments: false,
        showPlayerLos: false,
        showBruteFov: false,
      });
    });

    // 2. LIT_ROOM_DOOR_SPILL: Lit room open door spills warm light cone into corridor; occluded corner stays #000000
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('LIT_ROOM_DOOR_SPILL');
    });
    await page.waitForTimeout(100);
    const spillProbes = await page.evaluate(() => window.__monstrumDebug!.probePixels());
    console.log('LIT_ROOM_DOOR_SPILL probes:', spillProbes);
    for (const pr of spillProbes) {
      check(
        pr.isPureBlack,
        `LIT_ROOM_DOOR_SPILL leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`
      );
    }
    await shot('02_lit_room_door_spill.png');

    // 3. LIT_ROOM_CLOSED_DOOR: Lit room behind closed door must be completely #000000
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('LIT_ROOM_CLOSED_DOOR');
    });
    await page.waitForTimeout(100);
    const closedProbes = await page.evaluate(() => window.__monstrumDebug!.probePixels());
    console.log('LIT_ROOM_CLOSED_DOOR probes:', closedProbes);
    check(closedProbes.length >= 1, 'Expected probes in LIT_ROOM_CLOSED_DOOR');
    for (const pr of closedProbes) {
      check(
        pr.isPureBlack,
        `LIT_ROOM_CLOSED_DOOR leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`
      );
    }
    await shot('03_lit_room_closed_door.png');

    // 4. HIDING_FLASHLIGHT_PEEK: Enter turns OFF -> Peek turns ON -> Stop peek turns OFF -> Exit stays OFF
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('HIDING_FLASHLIGHT_PEEK');
    });
    await page.waitForTimeout(100);
    const hideInit = await page.evaluate(() => ({
      tel: window.__monstrumDebug!.getTelemetry(),
      probes: window.__monstrumDebug!.probePixels(),
    }));
    console.log('HIDING_FLASHLIGHT_PEEK init:', hideInit);
    check(hideInit.tel?.hidingSpotId !== null, 'Expected player inside hiding spot');
    check(hideInit.tel?.flashlightOn === false, 'Expected flashlight OFF on entering hiding spot');
    for (const pr of hideInit.probes) {
      check(pr.isPureBlack, `Expected outside locker #000000 while unpeeked, got rgb(${pr.r},${pr.g},${pr.b})`);
    }
    await shot('04a_hiding_off.png');

    // Vent peek ON
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({ forceVentPeek: true });
      window.__monstrumDebug!.step(0.05);
    });
    await page.waitForTimeout(80);
    const hidePeek = await page.evaluate(() => window.__monstrumDebug!.getTelemetry());
    console.log('HIDING_FLASHLIGHT_PEEK peeking:', hidePeek);
    check(hidePeek?.peekingSpotId !== null, 'Expected peekingSpotId non-null during vent peek');
    check(hidePeek?.flashlightOn === true, 'Expected flashlight ON while vent peeking');
    await shot('04b_hiding_vent_peek_on.png');

    // Vent peek OFF -> flashlight turns OFF
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({ forceVentPeek: false });
      window.__monstrumDebug!.step(0.05);
    });
    await page.waitForTimeout(80);
    const hideStopPeek = await page.evaluate(() => window.__monstrumDebug!.getTelemetry());
    console.log('HIDING_FLASHLIGHT_PEEK stop peek:', hideStopPeek);
    check(hideStopPeek?.peekingSpotId === null, 'Expected peekingSpotId null after stopping peek');
    check(hideStopPeek?.flashlightOn === false, 'Expected flashlight OFF after stopping vent peek');

    // Exit hiding spot -> flashlight stays OFF until manually toggled
    await page.evaluate(() => {
      window.__monstrumDebug!.tryInteract();
    });
    await page.waitForTimeout(80);
    const hideExit = await page.evaluate(() => window.__monstrumDebug!.getTelemetry());
    console.log('HIDING_FLASHLIGHT_PEEK exit:', hideExit);
    check(hideExit?.hidingSpotId === null, 'Expected player exited hiding spot');
    check(hideExit?.flashlightOn === false, 'Expected flashlight to STAY OFF after exiting hiding spot');
    await shot('04c_hiding_exit_off.png');

    // 5. BRUTE_HIDING_KILL: Brute watches player hide, charges spot, and kills player reliably
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('BRUTE_HIDING_KILL');
    });
    await page.waitForTimeout(60);
    await shot('05a_brute_hiding_charge.png');

    let killed = false;
    for (let i = 0; i < 120; i++) {
      const status = await page.evaluate(() => {
        window.__monstrumDebug!.step(0.05);
        return window.__monstrumDebug!.getStatus();
      });
      if (status === 'GAME_OVER') {
        killed = true;
        break;
      }
    }
    const killTel = await page.evaluate(() => window.__monstrumDebug!.getTelemetry());
    console.log('BRUTE_HIDING_KILL result:', { killed, killTel });
    check(killed, `Expected Brute to kill hiding player, final status & tel: ${JSON.stringify(killTel)}`);
    await page.waitForTimeout(100);
    await shot('05b_brute_hiding_kill.png');

    // 6. DOOR_KEYHOLE_AND_FLARE: Closed-door keyhole cone + raycasted flare shadows
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('DOOR_KEYHOLE_AND_FLARE');
    });
    await page.waitForTimeout(100);
    const keyholeTel = await page.evaluate(() => window.__monstrumDebug!.getTelemetry());
    console.log('DOOR_KEYHOLE_AND_FLARE telemetry:', keyholeTel);
    await shot('06_door_keyhole_flare.png');

    // 7. BRUTE_BEAM_CORNER: Iconic Monstrum Brute orange beam spills around open corner while walls stay #000000
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('BRUTE_BEAM_CORNER');
      window.__monstrumDebug!.setOverlays({
        showBlackProbes: true,
        showPlayerLos: false,
        showBruteFov: false,
        showWallSegments: false,
      });
    });
    await page.waitForTimeout(100);
    const beamCornerCheck = await page.evaluate(() => {
      const probes = window.__monstrumDebug!.probePixels();
      const canvas = document.querySelector('canvas');
      let orangeBeamPixels = 0;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const cx = Math.floor(canvas.width / 2);
          const cy = Math.floor(canvas.height / 2);
          const r = 240;
          const x0 = Math.max(0, cx - r);
          const y0 = Math.max(0, cy - r);
          const data = ctx.getImageData(x0, y0, Math.min(canvas.width - x0, r * 2), Math.min(canvas.height - y0, r * 2)).data;
          for (let i = 0; i < data.length; i += 16) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];
            if (red > 45 && red > green + 10 && green >= blue) {
              orangeBeamPixels++;
            }
          }
        }
      }
      return { probes, orangeBeamPixels };
    });
    console.log('BRUTE_BEAM_CORNER check:', beamCornerCheck);
    check(beamCornerCheck.probes.length >= 2, 'Expected >=2 probes in BRUTE_BEAM_CORNER');
    for (const pr of beamCornerCheck.probes) {
      check(pr.isPureBlack, `BRUTE_BEAM_CORNER leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`);
    }
    check(
      beamCornerCheck.orangeBeamPixels > 15,
      `Expected visible orange Brute beam corner-spill pixels (>15), got ${beamCornerCheck.orangeBeamPixels}`
    );
    await shot('07_brute_beam_corner.png');

    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({
        showWallSegments: true,
        showPlayerLos: true,
        showBruteFov: true,
      });
    });
    await page.waitForTimeout(80);
    await shot('07b_brute_beam_corner_overlays.png');
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({
        showWallSegments: false,
        showPlayerLos: false,
        showBruteFov: false,
      });
    });

    // 8. STAIR_BRUTE_GLOW: Enlarged companionway hatch glows pulsing orange when Brute climbs through
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('STAIR_BRUTE_GLOW');
    });
    await page.waitForTimeout(100);
    const stairGlowPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const r = 220;
      const x0 = Math.max(0, cx - r);
      const y0 = Math.max(0, cy - r);
      const data = ctx.getImageData(x0, y0, Math.min(canvas.width - x0, r * 2), Math.min(canvas.height - y0, r * 2)).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 16) {
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];
        if (red > 80 && red > green + 15 && red > blue + 30) {
          count++;
        }
      }
      return count;
    });
    console.log('STAIR_BRUTE_GLOW orange pixels:', stairGlowPixels);
    check(stairGlowPixels > 25, `Expected visible orange stairwell climbing glow (>25), got ${stairGlowPixels}`);
    await shot('08_stair_brute_glow.png');

    // 9. Ship textures & beveled bulkheads showcase (lit room + corridor with flashlight ON, no debug probes)
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('LIT_ROOM_DOOR_SPILL');
      window.__monstrumDebug!.setOverlays({ showBlackProbes: false });
      window.__monstrumDebug!.toggleFlashlight();
    });
    await page.waitForTimeout(100);
    await shot('09_ship_textures_showcase.png');

    // 10. Remade maritime crew survivor + flickering unmaintained ship light compartment
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('FLICKER_AND_SURVIVOR');
      window.__monstrumDebug!.setOverlays({ showBlackProbes: true });
    });
    await page.waitForTimeout(120);
    const flickerProbes = await page.evaluate(() => window.__monstrumDebug!.probePixels());
    console.log('FLICKER_AND_SURVIVOR probes:', flickerProbes);
    check(flickerProbes.length >= 1, 'Expected >=1 behind-wall probe in FLICKER_AND_SURVIVOR');
    for (const pr of flickerProbes) {
      check(pr.isPureBlack, `FLICKER_AND_SURVIVOR leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`);
    }
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({ showBlackProbes: false });
    });
    await page.waitForTimeout(80);
    await shot('10_flicker_and_survivor.png');

    // 11. ESCAPE_HELI_OVERHAUL: Verify spatial separation (>= 40 tiles), 6-slot backpack, louder repairs, sight-only bias, & [J] Journal
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('ESCAPE_HELI_OVERHAUL');
    });
    await page.waitForTimeout(100);
    const heliInfo = await page.evaluate(() => window.__monstrumDebug!.getEscapeInfo());
    console.log('ESCAPE_HELI_OVERHAUL info:', heliInfo);
    check(heliInfo !== null, 'Expected escape info in ESCAPE_HELI_OVERHAUL');
    if (heliInfo) {
      check(
        heliInfo.tileDist >= 40,
        `Expected Helideck & Bow Lifeboat >= 40 tiles apart, got ${heliInfo.tileDist.toFixed(1)}`
      );
      check(
        heliInfo.maxInventorySlots === 6 && heliInfo.hasBackpack === true,
        `Expected 6 slots with Backpack, got ${heliInfo.maxInventorySlots}`
      );
    }
    await shot('11_escape_heli_overhaul.png');

    // Verify Louder Escape Repairs + Sight-Only Escape Bias
    if (heliInfo) {
      await page.evaluate(
        ({ bx, by }) => {
          window.__monstrumDebug!.setBrutePose(bx, by, Math.PI);
          window.__monstrumDebug!.setOverlays({ freezeAi: false });
          window.__monstrumDebug!.holdInteract(true);
        },
        { bx: heliInfo.lifeboatPos.x, by: heliInfo.lifeboatPos.y }
      );
      // engine clamps dt to 0.05s per update(), so 106 steps = 5.3s (> 5.0s install duration)
      for (let i = 0; i < 106; i++) {
        await page.evaluate(() => {
          window.__monstrumDebug!.step(0.05);
        });
      }
      await page.evaluate(() => {
        window.__monstrumDebug!.holdInteract(false);
      });
      const postRepairInfo = await page.evaluate(() => ({
        esc: window.__monstrumDebug!.getEscapeInfo(),
        det: window.__monstrumDebug!.getRuntimeDetails(),
      }));
      const maxAcousticRadius = postRepairInfo.det?.maxAcousticRadius ?? 0;
      console.log('Louder repair & sight bias check:', {
        maxAcousticRadius,
        heliParts: postRepairInfo.esc?.heliParts.length,
        observedEscape: postRepairInfo.det?.observedEscape,
      });
      check(
        maxAcousticRadius >= 900,
        `Expected louder escape repair acoustic noise radius (>=900px), got ${maxAcousticRadius}`
      );
      check(
        (postRepairInfo.esc?.heliParts.length ?? 0) === 3 &&
          postRepairInfo.det?.observedEscape.heliRepairs === 0,
        `Expected heliParts=3 & Brute observedHeliRepairs=0 while out of LoS, got heliParts=${postRepairInfo.esc?.heliParts.length}, observed=${JSON.stringify(postRepairInfo.det?.observedEscape)}`
      );

      // Move player clear and place Brute onto open Helideck facing Helicopter -> observedHeliRepairs updates
      await page.evaluate(
        ({ hx, hy, lx, ly }) => {
          window.__monstrumDebug!.setPlayerPose(lx, ly);
          window.__monstrumDebug!.setBrutePose(hx + 95, hy, Math.PI);
          for (let i = 0; i < 4; i++) {
            window.__monstrumDebug!.step(0.05);
          }
          window.__monstrumDebug!.setOverlays({ freezeAi: true });
        },
        {
          hx: heliInfo.heliPos.x,
          hy: heliInfo.heliPos.y,
          lx: heliInfo.lifeboatPos.x,
          ly: heliInfo.lifeboatPos.y,
        }
      );
      const sightedInfo = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
      check(
        (sightedInfo?.observedEscape.heliRepairs ?? 0) === 3,
        `Expected Brute observedHeliRepairs === 3 after sighting repaired Helicopter, got ${JSON.stringify(sightedInfo?.observedEscape)}`
      );
    }

    // Verify floor drop [G] without consuming item & Journal [J] modal
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('ESCAPE_HELI_OVERHAUL');
      window.__monstrumDebug!.selectSlot(1); // FLARE
      window.__monstrumDebug!.dropSelectedItem();
    });
    await page.waitForTimeout(60);
    const afterDrop = await page.evaluate(() => window.__monstrumDebug!.getEscapeInfo());
    console.log('After G drop info:', afterDrop);
    check(
      afterDrop?.inventory.length === 3 && afterDrop.worldPickupsCount === 2,
      `Expected flare dropped onto deck (inv=3, pickups=2), got ${JSON.stringify(afterDrop)}`
    );

    await page.evaluate(() => {
      window.__monstrumDebug!.toggleJournal();
    });
    await page.waitForTimeout(100);
    const journalText = await page.evaluate(() => document.body.innerText);
    check(
      journalText.includes('Crew Escape Field Journal') &&
        journalText.includes('INSTALLED') &&
        journalText.includes('IN PACK') &&
        journalText.includes('MISSING'),
      'Expected Escape Journal to show INSTALLED / IN PACK / MISSING badges'
    );
    await shot('13_escape_journal.png');
    await page.evaluate(() => {
      window.__monstrumDebug!.toggleJournal();
    });

    // Confirm old always-visible HUD counters are removed
    const hudText = await page.evaluate(() => document.body.innerText);
    check(
      !hudText.includes('Lifeboat (Main Deck):') && !hudText.includes('Helicopter (Helideck):'),
      'Expected always-visible escape part counters to be removed from main HUD'
    );

    // 11b. STAIR_PEEK: Hold Q circular raycasted landing portal + anti-leak probes
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('STAIR_PEEK');
      window.__monstrumDebug!.setOverlays({ showBlackProbes: true });
    });
    await page.waitForTimeout(100);
    const stairPeekDet = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    const stairProbes = await page.evaluate(() => window.__monstrumDebug!.probePixels());
    console.log('STAIR_PEEK telemetry & probes:', {
      peekingStairId: stairPeekDet?.peekingStairId,
      probes: stairProbes,
    });
    check(
      stairPeekDet?.peekingStairId !== null,
      `Expected peekingStairId non-null in STAIR_PEEK scenario`
    );
    for (const pr of stairProbes) {
      check(pr.isPureBlack, `STAIR_PEEK leak at "${pr.label}": rgb(${pr.r},${pr.g},${pr.b})`);
    }
    await shot('16_stair_peek_portal.png');

    // Verify releasing forceStairPeek and holding real KeyQ works cleanly
    await page.evaluate(() => {
      window.__monstrumDebug!.setOverlays({ forceStairPeek: false });
      window.__monstrumDebug!.step(0.05);
    });
    const afterForceOff = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    check(
      afterForceOff?.peekingStairId === null,
      `Expected peekingStairId null after disabling forceStairPeek, got ${afterForceOff?.peekingStairId}`
    );
    await page.keyboard.down('KeyQ');
    await page.evaluate(() => {
      window.__monstrumDebug!.step(0.05);
    });
    const duringKeyQ = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    await page.keyboard.up('KeyQ');
    await page.evaluate(() => {
      window.__monstrumDebug!.step(0.05);
    });
    const afterKeyQ = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails());
    check(
      duringKeyQ?.peekingStairId !== null && afterKeyQ?.peekingStairId === null,
      `Expected KeyQ down/up to toggle stair peek (during=${duringKeyQ?.peekingStairId}, after=${afterKeyQ?.peekingStairId})`
    );

    // 11c. Uniform Window Resolution Scaling & Small Window HUD Non-Overlap Check
    const zoom1440 = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails()!.effectiveZoom);
    const area1440 = (1440 / zoom1440) * (900 / zoom1440);

    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.waitForTimeout(80);
    const zoom2560 = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails()!.effectiveZoom);
    const area2560 = (2560 / zoom2560) * (1440 / zoom2560);
    const diff2560 = Math.abs(area2560 - area1440) / area1440;
    console.log('Resolution scaling 2560x1440:', { zoom1440, zoom2560, area1440, area2560, diff2560 });
    check(
      diff2560 < 0.03,
      `Expected 2560x1440 visible world area to match 1440x900 (diff=${(diff2560 * 100).toFixed(2)}%)`
    );

    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(80);
    const zoom800 = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails()!.effectiveZoom);
    const area800 = (800 / zoom800) * (600 / zoom800);
    const diff800 = Math.abs(area800 - area1440) / area1440;
    const hudBoxes800 = await page.evaluate(() => {
      const panels = Array.from(document.querySelectorAll('[data-hud-panel]'));
      return panels.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.getAttribute('data-hud-panel'),
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
        };
      });
    });
    console.log('Resolution scaling 800x600:', { zoom800, area800, diff800, hudBoxes800 });
    check(
      diff800 < 0.03,
      `Expected 800x600 visible world area to match 1440x900 (diff=${(diff800 * 100).toFixed(2)}%)`
    );
    check(hudBoxes800.length === 4, `Expected 4 HUD panels measured at 800x600, got ${hudBoxes800.length}`);
    for (let i = 0; i < hudBoxes800.length; i++) {
      const a = hudBoxes800[i];
      check(
        a.left >= 0 && a.top >= 0 && a.right <= 800 && a.bottom <= 600,
        `HUD panel "${a.name}" clipped outside 800x600: ${JSON.stringify(a)}`
      );
      for (let j = i + 1; j < hudBoxes800.length; j++) {
        const b = hudBoxes800[j];
        const overlaps = !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        check(!overlaps, `HUD panels "${a.name}" and "${b.name}" overlap at 800x600`);
      }
    }
    await shot('18_small_window_hud.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(80);

    // 11d. Brute Pathfinding Anti-Stuck Check (navigates through doorways without snagging)
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('LIT_ROOM_DOOR_SPILL');
      window.__monstrumDebug!.setOverlays({ freezeAi: false });
    });
    const navStart = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails()!.brutePos);
    for (let i = 0; i < 45; i++) {
      await page.evaluate(() => {
        window.__monstrumDebug!.step(0.05);
      });
    }
    const navEnd = await page.evaluate(() => window.__monstrumDebug!.getRuntimeDetails()!.brutePos);
    const bruteMoved = Math.hypot(navEnd.x - navStart.x, navEnd.y - navStart.y);
    console.log('Brute anti-stuck movement distance over 2.25s:', bruteMoved);
    check(
      bruteMoved >= 80,
      `Expected Brute to navigate smoothly without getting stuck (>=80px), moved ${bruteMoved.toFixed(1)}px`
    );

    // 12. ESCAPE_LIFEBOAT_CRANE: Verify 4-slot base inventory, swung crane boat visual, & E victory cutscene
    await page.evaluate(() => {
      window.__monstrumDebug!.loadScenario('ESCAPE_LIFEBOAT_CRANE');
    });
    await page.waitForTimeout(100);
    const boatInfo = await page.evaluate(() => window.__monstrumDebug!.getEscapeInfo());
    console.log('ESCAPE_LIFEBOAT_CRANE info:', boatInfo);
    check(
      boatInfo?.maxInventorySlots === 4 && boatInfo?.hasBackpack === false,
      `Expected base 4-slot pack before Backpack pickup, got ${JSON.stringify(boatInfo)}`
    );
    await shot('12_escape_lifeboat_crane.png');

    // Press E near READY bow lifeboat -> triggers VICTORY_CUTSCENE
    await page.evaluate(() => {
      window.__monstrumDebug!.tryInteract();
    });
    await page.waitForTimeout(160);
    const cutsceneStatus = await page.evaluate(() => window.__monstrumDebug!.getStatus());
    console.log('After Press E on READY Lifeboat status:', cutsceneStatus);
    check(
      cutsceneStatus === 'VICTORY_CUTSCENE',
      `Expected VICTORY_CUTSCENE after pressing E at READY lifeboat, got ${cutsceneStatus}`
    );
    await shot('14_noir_escape_cutscene.png');

    // Advance 3 noir frames via Space -> transitions to VICTORY EndModal
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    await page.waitForTimeout(140);
    const finalStatus = await page.evaluate(() => window.__monstrumDebug!.getStatus());
    const finalText = await page.evaluate(() => document.body.innerText);
    console.log('After 3 cutscene frames status:', finalStatus);
    check(
      finalStatus === 'VICTORY' &&
        finalText.includes('You Escaped Alive :D') &&
        finalText.includes('v0.1.2'),
      `Expected VICTORY EndModal with v0.1.2 after noir cutscene, got status=${finalStatus}`
    );

    check(consoleErrors.length === 0, `Console errors detected: ${consoleErrors.join('; ')}`);
    check(pageErrors.length === 0, `Page errors detected: ${pageErrors.join('; ')}`);

    assert(failures.length === 0, `${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);

    console.log('ALL 0.1.2 STAIR PEEK, F11, EXTREME, SCALING, PATHING & ESCAPE ASSERTIONS PASSED.');
  } finally {
    await browser.close();
    if (proc) {
      proc.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
