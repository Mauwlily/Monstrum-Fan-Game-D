import { useCallback, useEffect, useRef, useState } from 'react';
import { DebugPanel, DebugTelemetry, ProbeReading } from './components/DebugPanel';
import { EscapeCutsceneModal } from './components/EscapeCutsceneModal';
import { EscapeJournalModal } from './components/EscapeJournalModal';
import { GameHud } from './components/GameHud';
import { EndModal, PauseModal } from './components/GameModals';
import { TitleMenu } from './components/TitleMenu';
import { HorrorAudioEngine } from './game/audio';
import { MonstrumGameEngine } from './game/engine';
import { GameRenderer } from './game/renderer';
import {
  DIFFICULTY_PRESETS,
  DebugOverlayConfig,
  DebugScenarioId,
  DifficultyConfig,
  GameStatus,
  HudSnapshot,
  ItemId,
  RunStats,
} from './game/types';

declare global {
  interface Window {
    __monstrumDebug?: {
      loadScenario: (id: DebugScenarioId) => void;
      setOverlays: (patch: Partial<DebugOverlayConfig>) => void;
      step: (dtSec?: number) => void;
      tryInteract: () => void;
      holdInteract: (holding: boolean) => void;
      toggleFlashlight: () => void;
      toggleJournal: () => void;
      dropSelectedItem: () => void;
      selectSlot: (idx: number) => void;
      getEscapeInfo: () => {
        heliPos: { tx: number; ty: number };
        lifeboatPos: { tx: number; ty: number };
        tileDist: number;
        inventory: ItemId[];
        maxInventorySlots: number;
        hasBackpack: boolean;
        journalOpen: boolean;
        worldPickupsCount: number;
        heliParts: ItemId[];
        lifeboatParts: ItemId[];
        heliState: string;
        lifeboatState: string;
      } | null;
      getTelemetry: () => DebugTelemetry | null;
      getStatus: () => GameStatus;
      probePixels: () => ProbeReading[];
      captureCanvasDataUrl: () => string | null;
    };
  }
}

export default function App() {
  const [status, setStatus] = useState<GameStatus>('TITLE_MENU');
  const [difficulty, setDifficulty] = useState<DifficultyConfig>({ ...DIFFICULTY_PRESETS.STANDARD });
  const [seedInput, setSeedInput] = useState('');
  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [runStats, setRunStats] = useState<RunStats | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTelemetry, setDebugTelemetry] = useState<DebugTelemetry | null>(null);
  const [lastCaptureUrl, setLastCaptureUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MonstrumGameEngine | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const audioRef = useRef<HorrorAudioEngine | null>(null);
  const statusRef = useRef<GameStatus>('TITLE_MENU');
  const debugOpenRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    debugOpenRef.current = debugOpen;
    if (engineRef.current) {
      engineRef.current.debugConfig.enabled = debugOpen;
    }
  }, [debugOpen]);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new HorrorAudioEngine();
    }
    return audioRef.current;
  }, []);

  const toggleMute = useCallback(() => {
    const audio = getAudio();
    const next = !audio.isMuted();
    audio.setMuted(next);
    setMuted(next);
  }, [getAudio]);

  const startNewRun = useCallback(
    (overrideRandomSeed = false, forcedSeed?: number, openDebugAfter = false) => {
      const audio = getAudio();
      audio.init();
      audio.setMuted(muted);

      if (!rendererRef.current) {
        rendererRef.current = new GameRenderer();
      }

      const parsedSeed =
        forcedSeed !== undefined
          ? forcedSeed
          : !overrideRandomSeed && seedInput.trim().length > 0
            ? Number.parseInt(seedInput.trim(), 10)
            : undefined;

      const engine = new MonstrumGameEngine(
        difficulty,
        audio,
        {
          onHudUpdate: (snapshot) => setHud(snapshot),
          onGameOver: (stats) => {
            setRunStats(stats);
            setStatus('GAME_OVER');
          },
          onVictory: (stats) => {
            setRunStats(stats);
            setStatus('VICTORY_CUTSCENE');
          },
        },
        Number.isFinite(parsedSeed) ? parsedSeed : undefined
      );

      engine.debugConfig.enabled = openDebugAfter || debugOpenRef.current;
      engineRef.current = engine;
      setRunStats(null);
      if (openDebugAfter) {
        setDebugOpen(true);
      }
      setStatus('PLAYING');
    },
    [difficulty, getAudio, muted, seedInput]
  );

  const probeBehindWallPixels = useCallback((): ProbeReading[] => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine || engine.debugProbePoints.length === 0) return [];
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const results: ProbeReading[] = [];

    for (const pt of engine.debugProbePoints) {
      const sx = (pt.x - engine.cameraX) * engine.zoom + w / 2;
      const sy = (pt.y - engine.cameraY) * engine.zoom + h / 2;
      const px = Math.round(sx * dpr);
      const py = Math.round(sy * dpr);
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const data = ctx.getImageData(px, py, 1, 1).data;
      results.push({
        label: pt.label,
        r: data[0],
        g: data[1],
        b: data[2],
        isPureBlack: data[0] === 0 && data[1] === 0 && data[2] === 0,
      });
    }
    return results;
  }, []);

  const syncDebugTelemetry = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      setDebugTelemetry(null);
      return null;
    }
    const probes = probeBehindWallPixels();
    const snap: DebugTelemetry = {
      scenario: engine.debugScenario,
      playerX: engine.player.x,
      playerY: engine.player.y,
      hidingSpotId: engine.player.hidingSpotId,
      peekingSpotId: engine.player.peekingSpotId,
      peekingDoorId: engine.player.peekingDoorId,
      flashlightOn: engine.player.flashlightOn,
      battery: engine.player.battery,
      bruteState: engine.brute.state,
      bruteGoal: engine.brain.activeGoal,
      watchedHideSpotId: engine.brute.watchedPlayerHideSpotId,
      inspectSpotId: engine.brute.currentInspectSpotId,
      inspectTimer: engine.brute.inspectTimer,
      bruteDistance: engine.getEffectiveBruteDistance(),
      probes,
    };
    setDebugTelemetry(snap);
    return snap;
  }, [probeBehindWallPixels]);

  const renderImmediateFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !engine || !renderer) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.save();
    ctx.scale(dpr, dpr);
    renderer.render(ctx, engine, w, h, performance.now() / 1000);
    ctx.restore();
  }, []);

  const handleLoadScenario = useCallback(
    (id: DebugScenarioId) => {
      if (!engineRef.current) {
        startNewRun(false, 100000, true);
      }
      const engine = engineRef.current;
      if (!engine) return;
      if (statusRef.current !== 'PLAYING') {
        setRunStats(null);
        setStatus('PLAYING');
      }
      engine.applyDebugScenario(id);
      renderImmediateFrame();
      syncDebugTelemetry();
    },
    [renderImmediateFrame, startNewRun, syncDebugTelemetry]
  );

  const handleUpdateDebugConfig = useCallback(
    (patch: Partial<DebugOverlayConfig>) => {
      const engine = engineRef.current;
      if (!engine) return;
      Object.assign(engine.debugConfig, patch);
      engine.update(0.016, window.innerWidth, window.innerHeight);
      renderImmediateFrame();
      syncDebugTelemetry();
    },
    [renderImmediateFrame, syncDebugTelemetry]
  );

  const handleStepDebugFrame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const prevFreeze = engine.debugConfig.freezeAi;
    engine.debugConfig.freezeAi = false;
    engine.update(0.05, window.innerWidth, window.innerHeight);
    engine.debugConfig.freezeAi = prevFreeze;
    renderImmediateFrame();
    syncDebugTelemetry();
  }, [renderImmediateFrame, syncDebugTelemetry]);

  const handleCaptureScreenshot = useCallback(() => {
    renderImmediateFrame();
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const url = canvas.toDataURL('image/png');
    setLastCaptureUrl(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = `monstrum_debug_${engineRef.current?.debugScenario ?? 'live'}_${Date.now()}.png`;
    a.click();
    syncDebugTelemetry();
    return url;
  }, [renderImmediateFrame, syncDebugTelemetry]);

  const returnToTitle = useCallback(() => {
    engineRef.current = null;
    setHud(null);
    setDebugOpen(false);
    setStatus('TITLE_MENU');
  }, []);

  // Main animation loop
  useEffect(() => {
    if (status === 'TITLE_MENU') return;

    let rafId = 0;
    let lastTime = performance.now();

    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const frame = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const canvas = canvasRef.current;
      const engine = engineRef.current;
      const renderer = rendererRef.current;

      if (canvas && engine && renderer) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (statusRef.current === 'PLAYING') {
          engine.update(dt, w, h);
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          ctx.save();
          ctx.scale(dpr, dpr);
          renderer.render(ctx, engine, w, h, now / 1000);
          ctx.restore();
        }
        if (debugOpenRef.current) {
          syncDebugTelemetry();
        }
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [status, syncDebugTelemetry]);

  // Auto-boot into deterministic debug mode when ?debug=1 is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1' && statusRef.current === 'TITLE_MENU') {
      startNewRun(false, 100000, true);
    }
  }, [startNewRun]);

  // Expose live debug bridge on window for automated headless verification & screenshots
  useEffect(() => {
    window.__monstrumDebug = {
      loadScenario: (id) => handleLoadScenario(id),
      setOverlays: (patch) => handleUpdateDebugConfig(patch),
      step: (dtSec = 0.05) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.update(dtSec, window.innerWidth, window.innerHeight);
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      tryInteract: () => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.tryInteract();
        engine.update(0.016, window.innerWidth, window.innerHeight);
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      holdInteract: (holding: boolean) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.holdingInteract = holding;
      },
      toggleFlashlight: () => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.toggleFlashlight();
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      toggleJournal: () => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.toggleJournal();
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      dropSelectedItem: () => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.dropSelectedItem();
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      selectSlot: (idx: number) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.selectSlot(idx);
        renderImmediateFrame();
      },
      getEscapeInfo: () => {
        const engine = engineRef.current;
        if (!engine) return null;
        const h = engine.map.heliPos;
        const b = engine.map.lifeboatPos;
        return {
          heliPos: { tx: h.tx, ty: h.ty },
          lifeboatPos: { tx: b.tx, ty: b.ty },
          tileDist: Math.hypot(h.tx - b.tx, h.ty - b.ty),
          inventory: [...engine.player.inventory],
          maxInventorySlots: engine.player.maxInventorySlots,
          hasBackpack: engine.player.hasBackpack,
          journalOpen: engine.journalOpen,
          worldPickupsCount: engine.worldPickups.length,
          heliParts: [...engine.escape.heliParts],
          lifeboatParts: [...engine.escape.lifeboatParts],
          heliState: engine.escape.heliState,
          lifeboatState: engine.escape.lifeboatState,
        };
      },
      getTelemetry: () => syncDebugTelemetry(),
      getStatus: () => statusRef.current,
      probePixels: () => {
        renderImmediateFrame();
        return probeBehindWallPixels();
      },
      captureCanvasDataUrl: () => {
        renderImmediateFrame();
        return canvasRef.current?.toDataURL('image/png') ?? null;
      },
    };
    return () => {
      delete window.__monstrumDebug;
    };
  }, [
    handleLoadScenario,
    handleUpdateDebugConfig,
    probeBehindWallPixels,
    renderImmediateFrame,
    syncDebugTelemetry,
  ]);

  // Keyboard & mouse handlers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (statusRef.current === 'PLAYING') {
          const eng = engineRef.current;
          if (eng?.journalOpen) {
            eng.toggleJournal();
            return;
          }
          setStatus('PAUSED');
          return;
        }
        if (statusRef.current === 'PAUSED') {
          setStatus('PLAYING');
          return;
        }
      }

      if ((e.code === 'F9' || e.code === 'Backquote') && statusRef.current === 'PLAYING') {
        e.preventDefault();
        setDebugOpen((prev) => !prev);
        return;
      }

      if (e.code === 'KeyM' && statusRef.current !== 'TITLE_MENU') {
        toggleMute();
        return;
      }

      const engine = engineRef.current;
      if (!engine || statusRef.current !== 'PLAYING') return;

      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)
      ) {
        e.preventDefault();
      }

      engine.keys.add(e.code);

      if (!e.repeat) {
        if (e.code === 'KeyJ') {
          engine.toggleJournal();
        } else if (e.code === 'KeyF') {
          engine.toggleFlashlight();
        } else if (e.code === 'KeyC' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
          engine.toggleCrouch();
        } else if (e.code === 'KeyE' || e.code === 'Space') {
          engine.holdingInteract = true;
          engine.tryInteract();
        } else if (e.code === 'KeyG') {
          engine.dropSelectedItem();
        } else if (e.code === 'Digit1') {
          engine.selectSlot(0);
        } else if (e.code === 'Digit2') {
          engine.selectSlot(1);
        } else if (e.code === 'Digit3') {
          engine.selectSlot(2);
        } else if (e.code === 'Digit4') {
          engine.selectSlot(3);
        } else if (e.code === 'Digit5') {
          engine.selectSlot(4);
        } else if (e.code === 'Digit6') {
          engine.selectSlot(5);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.keys.delete(e.code);
      if (e.code === 'KeyE' || e.code === 'Space') {
        engine.holdingInteract = false;
      }
    };

    const onBlur = () => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.keys.clear();
      engine.holdingInteract = false;
    };

    const onWheel = (e: WheelEvent) => {
      const engine = engineRef.current;
      if (!engine || statusRef.current !== 'PLAYING') return;
      e.preventDefault();
      engine.adjustZoom(e.deltaY);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('wheel', onWheel);
    };
  }, [toggleMute]);

  useEffect(() => {
    return () => {
      audioRef.current?.dispose();
    };
  }, []);

  if (status === 'TITLE_MENU') {
    return (
      <TitleMenu
        difficulty={difficulty}
        onSelectDifficulty={setDifficulty}
        seedInput={seedInput}
        onSeedInputChange={setSeedInput}
        muted={muted}
        onToggleMute={toggleMute}
        onStartGame={() => startNewRun(false)}
      />
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onMouseMove={(e) => {
          const engine = engineRef.current;
          if (!engine || statusRef.current !== 'PLAYING') return;
          engine.mouseScreenX = e.clientX;
          engine.mouseScreenY = e.clientY;
          engine.mouseMoved = true;
        }}
        onMouseDown={(e) => {
          const engine = engineRef.current;
          if (!engine || statusRef.current !== 'PLAYING') return;
          if (e.button === 0) {
            engine.useSelectedItem();
          } else if (e.button === 2) {
            engine.toggleFlashlight();
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {hud && status === 'PLAYING' && (
        <GameHud
          hud={hud}
          muted={muted}
          debugOpen={debugOpen}
          onToggleMute={toggleMute}
          onToggleDebug={() => setDebugOpen((prev) => !prev)}
          onToggleJournal={() => engineRef.current?.toggleJournal()}
          onPause={() => setStatus('PAUSED')}
          onSelectSlot={(idx) => engineRef.current?.selectSlot(idx)}
          onUseSelected={() => engineRef.current?.useSelectedItem()}
          onDropSelected={() => engineRef.current?.dropSelectedItem()}
        />
      )}

      {hud && status === 'PLAYING' && hud.journalOpen && (
        <EscapeJournalModal
          hud={hud}
          onClose={() => {
            if (engineRef.current?.journalOpen) {
              engineRef.current.toggleJournal();
            }
          }}
        />
      )}

      {debugOpen && status === 'PLAYING' && engineRef.current && debugTelemetry && (
        <DebugPanel
          config={engineRef.current.debugConfig}
          telemetry={debugTelemetry}
          lastCaptureUrl={lastCaptureUrl}
          onClose={() => setDebugOpen(false)}
          onLoadScenario={handleLoadScenario}
          onUpdateConfig={handleUpdateDebugConfig}
          onStepFrame={handleStepDebugFrame}
          onCaptureScreenshot={handleCaptureScreenshot}
          onRefreshProbes={syncDebugTelemetry}
        />
      )}

      {status === 'PAUSED' && engineRef.current && (
        <PauseModal
          seed={engineRef.current.map.seed}
          onResume={() => setStatus('PLAYING')}
          onRestart={() => startNewRun(true)}
          onMainMenu={returnToTitle}
        />
      )}

      {status === 'VICTORY_CUTSCENE' && runStats && (
        <EscapeCutsceneModal
          stats={runStats}
          onAdvanceFrame={() => getAudio().playCutsceneProjectorClick(true)}
          onComplete={() => setStatus('VICTORY')}
        />
      )}

      {(status === 'GAME_OVER' || status === 'VICTORY') && runStats && (
        <EndModal
          outcome={status}
          stats={runStats}
          onPlayAgain={() => startNewRun(true)}
          onMainMenu={returnToTitle}
        />
      )}
    </div>
  );
}
