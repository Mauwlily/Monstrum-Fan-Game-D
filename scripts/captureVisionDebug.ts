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

    check(consoleErrors.length === 0, `Console errors detected: ${consoleErrors.join('; ')}`);
    check(pageErrors.length === 0, `Page errors detected: ${pageErrors.join('; ')}`);

    assert(failures.length === 0, `${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`);

    console.log('ALL VISION, GRAPHICS, SURVIVOR, FLICKER & HIDING-KILL DEBUG ASSERTIONS PASSED.');
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
