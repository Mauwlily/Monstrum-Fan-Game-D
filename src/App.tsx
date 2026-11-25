import { useCallback, useEffect, useRef, useState } from 'react';
import { DebugPanel, DebugTelemetry, ProbeReading } from './components/DebugPanel';
import { EscapeCutsceneModal } from './components/EscapeCutsceneModal';
import { EscapeJournalModal } from './components/EscapeJournalModal';
import { GameHud } from './components/GameHud';
import { EndModal, PauseModal } from './components/GameModals';
import { PaperMapModal } from './components/PaperMapModal';
import { TitleMenu } from './components/TitleMenu';
import { HorrorAudioEngine } from './game/audio';
import { MonstrumGameEngine } from './game/engine';
import {
  getDefaultGraphicsSettings,
  GraphicsSettings,
  loadGraphicsSettings,
  saveGraphicsSettings,
} from './game/graphicsSettings';
import { GameRenderer } from './game/renderer';
import {
  BruteTuningNumbers,
  buildBruteTuningFromDifficulty,
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
      setEscapeState: (patch: Partial<{
        heliParts: ItemId[];
        heliChainsRemaining: number;
        heliState: 'IDLE' | 'ACTIVATING' | 'READY';
        heliActivationProgress: number;
        lifeboatParts: ItemId[];
        lifeboatState: 'IDLE' | 'ACTIVATING' | 'READY';
        lifeboatActivationProgress: number;
        submarineParts: ItemId[];
        submarineState: 'IDLE' | 'ACTIVATING' | 'READY';
        submarineActivationProgress: number;
      }>) => void;
      step: (dtSec?: number) => void;
      tryInteract: () => void;
      holdInteract: (holding: boolean) => void;
      toggleFlashlight: () => void;
      toggleJournal: () => void;
      dropSelectedItem: () => void;
      selectSlot: (idx: number) => void;
      getEscapeInfo: () => {
        heliPos: { tx: number; ty: number; x: number; y: number };
        lifeboatPos: { tx: number; ty: number; x: number; y: number };
        submarinePos: {
          tx: number;
          ty: number;
          x: number;
          y: number;
          leverTx: number;
          leverTy: number;
          leverX: number;
          leverY: number;
        };
        tileDist: number;
        inventory: ItemId[];
        maxInventorySlots: number;
        hasBackpack: boolean;
        journalOpen: boolean;
        openPaperMapDeck: string | null;
        worldPickupsCount: number;
        heliParts: ItemId[];
        lifeboatParts: ItemId[];
        submarineParts: ItemId[];
        heliState: string;
        lifeboatState: string;
        submarineState: string;
        heliChainsRemaining: number;
        poweredDecks: Record<string, boolean>;
        fuseSockets: Array<{ id: string; deck: string; x: number; y: number; hasFuse: boolean }>;
      } | null;
      getRuntimeDetails: () => {
        bruteTuning: BruteTuningNumbers;
        customBruteTuning: boolean;
        difficulty: DifficultyConfig;
        effectiveZoom: number;
        baseZoom: number;
        bloodStreakCount: number;
        steamPipesCount: number;
        paperMapsCount: number;
        playerX: number;
        playerY: number;
        steamStaggerTimer: number;
        peekingStairId: string | null;
        bruteState: string;
        brutePos: { x: number; y: number };
        brutePathLength: number;
        investigateTarget: { x: number; y: number } | null;
        observedEscape: {
          heliRepairs: number;
          heliActive: boolean;
          lifeboatRepairs: number;
          lifeboatActive: boolean;
          subRepairs: number;
          subActive: boolean;
        };
        activeNoiseRipples: Array<{ x: number; y: number; maxRadius: number }>;
        maxAcousticRadius: number;
        lockedOnlyRoomIds: number[];
        poweredDecks: Record<string, boolean>;
        bruteKnownFuseDecks: string[];
        bruteFiddleSwitchId: string | null;
        nearestDoor: {
          id: string;
          x: number;
          y: number;
          orientation: 'H' | 'V';
          isOpen: boolean;
          openProgress: number;
        } | null;
      } | null;
      setBrutePose: (x: number, y: number, angle?: number) => void;
      setPlayerPose: (x: number, y: number) => void;
      testPositionInNearestDoor: (offsetFromCenterPx?: number) => {
        doorId: string;
        orientation: 'H' | 'V';
        doorCenterX: number;
        doorCenterY: number;
        playerX: number;
        playerY: number;
      } | null;
      focusDoor: (idxOrId?: number | string) => {
        id: string;
        orientation: 'H' | 'V';
        isLocked: boolean;
        isWatertight: boolean;
        isBroken: boolean;
        isOpen: boolean;
        x: number;
        y: number;
        deck: string;
      } | null;
      focusStair: (directionOrId?: 'UP' | 'DOWN' | string, index?: number) => {
        id: string;
        direction: 'UP' | 'DOWN';
        deck: string;
        x: number;
        y: number;
      } | null;
      toggleNearestDoor: () => {
        id: string;
        isOpen: boolean;
        openProgress: number;
        isLocked: boolean;
      } | null;
      getStructureSummary: () => {
        doorsTotal: number;
        doorsByKind: { normal: number; locked: number; watertight: number; broken: number };
        stairwellsTotal: number;
        doors: Array<{
          id: string;
          deck: string;
          orientation: 'H' | 'V';
          isLocked: boolean;
          isWatertight: boolean;
          isBroken: boolean;
          isOpen: boolean;
          x: number;
          y: number;
        }>;
        stairwells: Array<{
          id: string;
          deck: string;
          direction: 'UP' | 'DOWN';
          x: number;
          y: number;
        }>;
      } | null;
      getTelemetry: () => DebugTelemetry | null;
      getStatus: () => GameStatus;
      getRendererBackend: () => string;
      setGraphicsSettings: (patch: Partial<GraphicsSettings>) => void;
      getGraphicsInfo: () => {
        settings: GraphicsSettings;
        display: ReturnType<GameRenderer['getDisplayTelemetry']> | null;
      };
      getContainersState: () => {
        cursorTarget: unknown;
        containers: Array<{
          id: string;
          type: string;
          deck: string;
          x: number;
          y: number;
          isOpen: boolean;
          openProgress: number;
          searched: boolean;
          item: ItemId | null;
        }>;
      } | null;
      aimAtContainer: (
        containerId: string,
        targetPart?: 'CONTAINER' | 'CONTAINER_ITEM'
      ) => {
        screenX: number;
        screenY: number;
        cursorTarget: unknown;
      } | null;
      probePixels: () => ProbeReading[];
      probePixelsAsync: () => Promise<ProbeReading[]>;
      captureCanvasDataUrl: () => string | null;
      captureCanvasDataUrlAsync: () => Promise<string | null>;
    };
  }
}

export default function App() {
  const [status, setStatus] = useState<GameStatus>('TITLE_MENU');
  const [difficulty, setDifficulty] = useState<DifficultyConfig>({ ...DIFFICULTY_PRESETS.STANDARD });
  const [devModeUnlocked, setDevModeUnlocked] = useState<boolean>(
    () => new URLSearchParams(window.location.search).get('debug') === '1'
  );
  const [bruteTuning, setBruteTuning] = useState<BruteTuningNumbers>(() =>
    buildBruteTuningFromDifficulty(DIFFICULTY_PRESETS.STANDARD)
  );
  const [customTuningActive, setCustomTuningActive] = useState(false);
  const [graphicsSettings, setGraphicsSettings] = useState<GraphicsSettings>(() =>
    loadGraphicsSettings()
  );
  const [seedInput, setSeedInput] = useState('');
  const [muted, setMuted] = useState(false);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [runStats, setRunStats] = useState<RunStats | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTelemetry, setDebugTelemetry] = useState<DebugTelemetry | null>(null);
  const [lastCaptureUrl, setLastCaptureUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MonstrumGameEngine | null>(null);
  const rendererRef = useRef<GameRenderer | null>(null);
  const audioRef = useRef<HorrorAudioEngine | null>(null);
  const cachedProbesRef = useRef<ProbeReading[]>([]);
  const probePromiseRef = useRef<Promise<ProbeReading[]> | null>(null);
  const lastProbeTimeRef = useRef(0);
  const lastTelemetryTimeRef = useRef(0);
  const lastRenderedFrameTimeRef = useRef(0);
  const groundScratchRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const graphicsSettingsRef = useRef<GraphicsSettings>(graphicsSettings);
  const statusRef = useRef<GameStatus>('TITLE_MENU');
  const debugOpenRef = useRef(false);
  const devModeUnlockedRef = useRef(devModeUnlocked);
  const doorCycleIdxRef = useRef(-1);
  const stairCycleIdxRef = useRef<{ UP: number; DOWN: number }>({ UP: -1, DOWN: -1 });
  const dragOrbitRef = useRef<{
    active: boolean;
    mode: 'orbit' | 'pan';
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ active: false, mode: 'orbit', startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    devModeUnlockedRef.current = devModeUnlocked;
  }, [devModeUnlocked]);

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

  const handleSelectDifficulty = useCallback((nextCfg: DifficultyConfig) => {
    setDifficulty(nextCfg);
    setBruteTuning(buildBruteTuningFromDifficulty(nextCfg));
    setCustomTuningActive(false);
  }, []);

  const handleChangeBruteTuning = useCallback((next: BruteTuningNumbers) => {
    setBruteTuning(next);
    setCustomTuningActive(true);
  }, []);

  const handleResetBruteTuning = useCallback(() => {
    setBruteTuning(buildBruteTuningFromDifficulty(difficulty));
    setCustomTuningActive(false);
  }, [difficulty]);

  const handleToggleDevMode = useCallback(() => {
    setDevModeUnlocked((prev) => {
      const next = !prev;
      if (!next) {
        setDebugOpen(false);
        setBruteTuning(buildBruteTuningFromDifficulty(difficulty));
        setCustomTuningActive(false);
      }
      return next;
    });
  }, [difficulty]);

  const startNewRun = useCallback(
    (overrideRandomSeed = false, forcedSeed?: number, openDebugAfter = false) => {
      audioRef.current?.dispose();
      audioRef.current = null;

      const audio = getAudio();
      audio.init();
      audio.setMuted(muted);

      if (!rendererRef.current) {
        rendererRef.current = new GameRenderer();
      }
      const gfx = graphicsSettingsRef.current;
      rendererRef.current.applyGraphicsSettings(gfx);

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
        Number.isFinite(parsedSeed) ? parsedSeed : undefined,
        bruteTuning,
        customTuningActive
      );

      engine.setParticleDensity(gfx.particleDensity);
      engine.debugConfig.cameraPitchDeg = gfx.cameraPitchDeg;
      engine.debugConfig.cameraYawDeg = gfx.cameraYawDeg;
      engine.debugConfig.cameraFovDeg = gfx.cameraFovDeg;
      engine.debugConfig.enabled = openDebugAfter || debugOpenRef.current;
      engineRef.current = engine;
      setRunStats(null);
      if (openDebugAfter) {
        setDebugOpen(true);
      }
      setStatus('PLAYING');
    },
    [bruteTuning, customTuningActive, difficulty, getAudio, muted, seedInput]
  );

  const buildDebugTelemetry = useCallback((probes: ProbeReading[]): DebugTelemetry | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    return {
      scenario: engine.debugScenario,
      playerX: engine.player.x,
      playerY: engine.player.y,
      hidingSpotId: engine.player.hidingSpotId,
      peekingSpotId: engine.player.peekingSpotId,
      peekingDoorId: engine.player.peekingDoorId,
      peekingStairId: engine.player.peekingStairId,
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
  }, []);

  const syncDebugTelemetry = useCallback(
    (probesOverride?: ProbeReading[]) => {
      const snap = buildDebugTelemetry(probesOverride ?? cachedProbesRef.current);
      setDebugTelemetry(snap);
      return snap;
    },
    [buildDebugTelemetry]
  );

  const renderImmediateFrame = useCallback(() => {
    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer || !renderer.isInitialized()) return;
    renderer.render(engine, window.innerWidth, window.innerHeight, performance.now() / 1000);
  }, []);

  const applyGraphicsToRuntime = useCallback((next: GraphicsSettings) => {
    saveGraphicsSettings(next);
    graphicsSettingsRef.current = next;
    rendererRef.current?.applyGraphicsSettings(next);
    const eng = engineRef.current;
    if (eng) {
      eng.setParticleDensity(next.particleDensity);
      eng.debugConfig.cameraPitchDeg = next.cameraPitchDeg;
      eng.debugConfig.cameraYawDeg = next.cameraYawDeg;
      eng.debugConfig.cameraFovDeg = next.cameraFovDeg;
    }
  }, []);

  const handleChangeGraphicsSettings = useCallback(
    (next: GraphicsSettings) => {
      setGraphicsSettings(next);
      applyGraphicsToRuntime(next);
      renderImmediateFrame();
    },
    [applyGraphicsToRuntime, renderImmediateFrame]
  );

  const handleResetGraphicsSettings = useCallback(() => {
    handleChangeGraphicsSettings(getDefaultGraphicsSettings());
  }, [handleChangeGraphicsSettings]);

  const refreshProbesAsync = useCallback(async (): Promise<ProbeReading[]> => {
    const engine = engineRef.current;
    const renderer = rendererRef.current;
    if (!engine || !renderer || !renderer.isInitialized() || engine.debugProbePoints.length === 0) {
      cachedProbesRef.current = [];
      return [];
    }
    if (probePromiseRef.current) {
      return probePromiseRef.current;
    }
    lastProbeTimeRef.current = performance.now();
    const pending = (async () => {
      try {
        const probes = await renderer.probePixelsAsync(engine);
        cachedProbesRef.current = probes;
        if (debugOpenRef.current) {
          setDebugTelemetry(buildDebugTelemetry(probes));
        }
        return probes;
      } catch (err) {
        console.warn('GPU pixel probe warning:', err);
        return cachedProbesRef.current;
      } finally {
        probePromiseRef.current = null;
      }
    })();
    probePromiseRef.current = pending;
    return pending;
  }, [buildDebugTelemetry]);

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
      cachedProbesRef.current = [];
      renderImmediateFrame();
      syncDebugTelemetry([]);
      void refreshProbesAsync();
    },
    [refreshProbesAsync, renderImmediateFrame, startNewRun, syncDebugTelemetry]
  );

  const handleUpdateDebugConfig = useCallback(
    (patch: Partial<DebugOverlayConfig>) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (patch.freeCamEnabled && !engine.debugConfig.freeCamEnabled) {
        if (patch.freeCamX === undefined) patch.freeCamX = engine.cameraX;
        if (patch.freeCamY === undefined) patch.freeCamY = engine.cameraY;
        if (patch.freeCamZoom === undefined) patch.freeCamZoom = engine.zoom;
      }
      Object.assign(engine.debugConfig, patch);
      engine.update(0.016, window.innerWidth, window.innerHeight);
      renderImmediateFrame();
      syncDebugTelemetry();
      void refreshProbesAsync();
    },
    [refreshProbesAsync, renderImmediateFrame, syncDebugTelemetry]
  );

  const focusDoorInDebug = useCallback(
    (idxOrId?: number | string) => {
      const engine = engineRef.current;
      if (!engine || engine.map.doors.length === 0) return null;
      const targetDeck =
        engine.debugConfig.debugDeckOverride !== 'AUTO'
          ? engine.debugConfig.debugDeckOverride
          : engine.getCurrentDeck();
      const deckDoors = engine.map.doors.filter(
        (d) => (engine.map.deckGrid[d.ty]?.[d.tx] ?? 'DECK_2') === targetDeck
      );
      let door =
        typeof idxOrId === 'string'
          ? engine.map.doors.find((d) => d.id === idxOrId)
          : typeof idxOrId === 'number'
            ? engine.map.doors[(idxOrId % engine.map.doors.length + engine.map.doors.length) % engine.map.doors.length]
            : undefined;
      if (!door) {
        const list = deckDoors.length > 0 ? deckDoors : engine.map.doors;
        doorCycleIdxRef.current = (doorCycleIdxRef.current + 1) % list.length;
        door = list[doorCycleIdxRef.current];
      }
      const ts = engine.map.tileSize;
      const x = (door.tx + 0.5) * ts;
      const y = (door.ty + 0.5) * ts;
      const deck = engine.map.deckGrid[door.ty]?.[door.tx] ?? 'DECK_2';
      handleUpdateDebugConfig({
        enabled: true,
        freeCamEnabled: true,
        freeCamX: x,
        freeCamY: y,
        freeCamZoom: Math.max(engine.debugConfig.freeCamZoom, 2.1),
        debugDeckOverride: deck,
      });
      return {
        id: door.id,
        orientation: door.orientation,
        isLocked: door.isLocked,
        isWatertight: Boolean(door.isWatertight),
        isBroken: door.isBroken,
        isOpen: door.isOpen,
        x,
        y,
        deck,
      };
    },
    [handleUpdateDebugConfig]
  );

  const focusStairInDebug = useCallback(
    (directionOrId?: 'UP' | 'DOWN' | string, index?: number) => {
      const engine = engineRef.current;
      if (!engine || engine.map.stairwells.length === 0) return null;
      let st =
        directionOrId && directionOrId !== 'UP' && directionOrId !== 'DOWN'
          ? engine.map.stairwells.find((s) => s.id === directionOrId)
          : undefined;
      if (!st) {
        const dir: 'UP' | 'DOWN' = directionOrId === 'UP' ? 'UP' : 'DOWN';
        const targetDeck =
          engine.debugConfig.debugDeckOverride !== 'AUTO'
            ? engine.debugConfig.debugDeckOverride
            : engine.getCurrentDeck();
        const sameDeck = engine.map.stairwells.filter(
          (s) => s.direction === dir && s.deck === targetDeck
        );
        const list = sameDeck.length > 0 ? sameDeck : engine.map.stairwells.filter((s) => s.direction === dir);
        if (list.length === 0) return null;
        if (typeof index === 'number') {
          st = list[(index % list.length + list.length) % list.length];
        } else {
          stairCycleIdxRef.current[dir] = (stairCycleIdxRef.current[dir] + 1) % list.length;
          st = list[stairCycleIdxRef.current[dir]];
        }
      }
      handleUpdateDebugConfig({
        enabled: true,
        freeCamEnabled: true,
        freeCamX: st.x,
        freeCamY: st.y,
        freeCamZoom: Math.max(engine.debugConfig.freeCamZoom, 2.1),
        debugDeckOverride: st.deck,
      });
      return {
        id: st.id,
        direction: st.direction,
        deck: st.deck,
        x: st.x,
        y: st.y,
      };
    },
    [handleUpdateDebugConfig]
  );

  const toggleNearestDoorInDebug = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return null;
    const refX = engine.debugConfig.freeCamEnabled ? engine.debugConfig.freeCamX : engine.player.x;
    const refY = engine.debugConfig.freeCamEnabled ? engine.debugConfig.freeCamY : engine.player.y;
    const targetDeck =
      engine.debugConfig.debugDeckOverride !== 'AUTO'
        ? engine.debugConfig.debugDeckOverride
        : engine.getCurrentDeck();
    const ts = engine.map.tileSize;
    let bestDoor = null;
    let bestD = Infinity;
    for (const d of engine.map.doors) {
      const deck = engine.map.deckGrid[d.ty]?.[d.tx] ?? 'DECK_2';
      if (deck !== targetDeck) continue;
      const dist = Math.hypot((d.tx + 0.5) * ts - refX, (d.ty + 0.5) * ts - refY);
      if (dist < bestD) {
        bestD = dist;
        bestDoor = d;
      }
    }
    if (!bestDoor) return null;
    if (bestDoor.isBroken) {
      return {
        id: bestDoor.id,
        isOpen: bestDoor.isOpen,
        openProgress: bestDoor.openProgress,
        isLocked: bestDoor.isLocked,
      };
    }
    bestDoor.isOpen = !bestDoor.isOpen;
    bestDoor.openProgress = bestDoor.isOpen ? 1 : 0;
    renderImmediateFrame();
    syncDebugTelemetry();
    return {
      id: bestDoor.id,
      isOpen: bestDoor.isOpen,
      openProgress: bestDoor.openProgress,
      isLocked: bestDoor.isLocked,
    };
  }, [renderImmediateFrame, syncDebugTelemetry]);

  const handleStepDebugFrame = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const prevFreeze = engine.debugConfig.freezeAi;
    engine.debugConfig.freezeAi = false;
    engine.update(0.05, window.innerWidth, window.innerHeight);
    engine.debugConfig.freezeAi = prevFreeze;
    renderImmediateFrame();
    syncDebugTelemetry();
    void refreshProbesAsync();
  }, [refreshProbesAsync, renderImmediateFrame, syncDebugTelemetry]);

  const handleCaptureScreenshot = useCallback(async () => {
    renderImmediateFrame();
    const renderer = rendererRef.current;
    if (!renderer || !renderer.isInitialized()) return null;
    try {
      const url = await renderer.capturePngDataUrlAsync();
      if (!url) return null;
      setLastCaptureUrl(url);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monstrum_debug_${engineRef.current?.debugScenario ?? 'live'}_${Date.now()}.png`;
      a.click();
      syncDebugTelemetry();
      return url;
    } catch (err) {
      console.warn('Screenshot capture warning:', err);
      return null;
    }
  }, [renderImmediateFrame, syncDebugTelemetry]);

  const returnToTitle = useCallback(() => {
    try {
      audioRef.current?.dispose();
    } catch (err) {
      console.warn('Audio dispose warning:', err);
    }
    audioRef.current = null;

    try {
      rendererRef.current?.dispose();
    } catch (err) {
      console.warn('Renderer dispose warning:', err);
    }
    rendererRef.current = null;
    activeCanvasRef.current = null;

    engineRef.current = null;
    cachedProbesRef.current = [];
    setHud(null);
    setDebugOpen(false);
    setDebugTelemetry(null);
    setStatus('TITLE_MENU');
  }, []);

  // Ensure initial telemetry populates immediately whenever DebugPanel is toggled open
  useEffect(() => {
    if (debugOpen && status !== 'TITLE_MENU') {
      syncDebugTelemetry();
      void refreshProbesAsync();
    }
  }, [debugOpen, refreshProbesAsync, status, syncDebugTelemetry]);

  // Main Three.js WebGPU / WebGL2 animation loop
  useEffect(() => {
    if (status === 'TITLE_MENU') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let rafId = 0;
    let lastTime = performance.now();

    if (!rendererRef.current || activeCanvasRef.current !== canvas) {
      rendererRef.current?.dispose();
      rendererRef.current = new GameRenderer();
      activeCanvasRef.current = canvas;
    }
    const activeRenderer = rendererRef.current;
    activeRenderer.applyGraphicsSettings(graphicsSettingsRef.current);

    if (!activeRenderer.isInitialized()) {
      void activeRenderer
        .init(canvas)
        .then(() => {
          if (cancelled || activeRenderer !== rendererRef.current) return;
          activeRenderer.applyGraphicsSettings(graphicsSettingsRef.current);
          const eng = engineRef.current;
          if (eng) {
            activeRenderer.render(eng, window.innerWidth, window.innerHeight, performance.now() / 1000);
            if (debugOpenRef.current) {
              syncDebugTelemetry();
              void refreshProbesAsync();
            }
          }
        })
        .catch((err) => {
          console.error('Failed to initialize Three.js WebGPU/WebGL2 renderer:', err);
        });
    }

    const syncCanvasCssSize = () => {
      const target = canvasRef.current;
      if (!target) return;
      target.style.width = `${window.innerWidth}px`;
      target.style.height = `${window.innerHeight}px`;
    };

    syncCanvasCssSize();
    window.addEventListener('resize', syncCanvasCssSize);

    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2') || probe.getContext('webgl');
        if (!gl) return false;
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
        return /SwiftShader|llvmpipe|Software Rasterizer/i.test(r);
      } catch {
        return false;
      }
    })();

    let timerId = 0;
    const afterDraw = (fn: () => void) => {
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      const sync = gl ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      if (gl && sync) gl.flush();
      const poll = () => {
        if (cancelled) return;
        if (gl && sync) {
          const st = gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (st === gl.UNSIGNALED) {
            timerId = window.setTimeout(poll, 5);
            return;
          }
          gl.deleteSync(sync);
        }
        timerId = window.setTimeout(() => {
          if (!cancelled) rafId = requestAnimationFrame(fn);
        }, 80);
      };
      timerId = window.setTimeout(poll, 5);
    };

    const frame = (now: number) => {
      if (cancelled) return;
      const fpsCap = graphicsSettingsRef.current.fpsCap;
      if (
        !isSoftwareGl &&
        fpsCap > 0 &&
        lastRenderedFrameTimeRef.current > 0 &&
        now - lastRenderedFrameTimeRef.current < 1000 / fpsCap - 0.5
      ) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      lastRenderedFrameTimeRef.current = now;

      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const engine = engineRef.current;
      const renderer = rendererRef.current;

      if (engine && renderer) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (statusRef.current === 'PLAYING') {
          if (engine.mouseMoved && renderer.isInitialized()) {
            if (
              renderer.screenToWorldGround(
                engine.mouseScreenX,
                engine.mouseScreenY,
                w,
                h,
                groundScratchRef.current,
                16
              )
            ) {
              engine.setWorldMouse(groundScratchRef.current.x, groundScratchRef.current.y);
            } else {
              engine.clearWorldMouse();
            }
          }
          engine.update(dt, w, h);
        }

        if (renderer.isInitialized()) {
          if (statusRef.current === 'PLAYING') {
            renderer.updatePointerHover(
              engine,
              engine.mouseScreenX,
              engine.mouseScreenY,
              w,
              h
            );
          }
          renderer.render(engine, w, h, now / 1000);
          if (debugOpenRef.current) {
            if (now - lastTelemetryTimeRef.current >= 100) {
              lastTelemetryTimeRef.current = now;
              syncDebugTelemetry();
            }
            if (engine.debugConfig.showBlackProbes && now - lastProbeTimeRef.current >= 500) {
              void refreshProbesAsync();
            }
          }
        }
      }

      if (isSoftwareGl) {
        afterDraw(() => {
          if (!cancelled) frame(performance.now());
        });
      } else {
        rafId = requestAnimationFrame(frame);
      }
    };

    rafId = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      window.removeEventListener('resize', syncCanvasCssSize);
    };
  }, [refreshProbesAsync, status, syncDebugTelemetry]);

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
      setEscapeState: (patch) => {
        const engine = engineRef.current;
        if (!engine) return;
        Object.assign(engine.escape, patch);
        engine.emitHud();
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      step: (dtSec = 0.05) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.update(dtSec, window.innerWidth, window.innerHeight);
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      tryInteract: () => {
        const engine = engineRef.current;
        const renderer = rendererRef.current;
        if (!engine) return;
        if (renderer?.isInitialized()) {
          renderer.updatePointerHover(
            engine,
            engine.mouseScreenX,
            engine.mouseScreenY,
            window.innerWidth,
            window.innerHeight
          );
        }
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
        const s = engine.map.submarinePos;
        return {
          heliPos: { tx: h.tx, ty: h.ty, x: h.x, y: h.y },
          lifeboatPos: { tx: b.tx, ty: b.ty, x: b.x, y: b.y },
          submarinePos: { ...s },
          tileDist: Math.hypot(h.tx - b.tx, h.ty - b.ty),
          inventory: [...engine.player.inventory],
          maxInventorySlots: engine.player.maxInventorySlots,
          hasBackpack: engine.player.hasBackpack,
          journalOpen: engine.journalOpen,
          openPaperMapDeck: engine.player.openPaperMapDeck,
          worldPickupsCount: engine.worldPickups.length,
          heliParts: [...engine.escape.heliParts],
          lifeboatParts: [...engine.escape.lifeboatParts],
          submarineParts: [...engine.escape.submarineParts],
          heliState: engine.escape.heliState,
          lifeboatState: engine.escape.lifeboatState,
          submarineState: engine.escape.submarineState,
          heliChainsRemaining: engine.escape.heliChainsRemaining,
          poweredDecks: { ...engine.poweredDecks },
          fuseSockets: engine.map.fuseSockets.map((f) => ({
            id: f.id,
            deck: f.deck,
            x: f.x,
            y: f.y,
            hasFuse: f.hasFuse,
          })),
        };
      },
      getRuntimeDetails: () => {
        const engine = engineRef.current;
        if (!engine) return null;
        const ts = engine.map.tileSize;
        let nearestDoor: {
          id: string;
          x: number;
          y: number;
          orientation: 'H' | 'V';
          isOpen: boolean;
          openProgress: number;
        } | null = null;
        let bestD = Infinity;
        for (const door of engine.map.doors) {
          if (door.isBroken || door.isLocked) continue;
          const dx = (door.tx + 0.5) * ts;
          const dy = (door.ty + 0.5) * ts;
          const dist = Math.hypot(dx - engine.player.x, dy - engine.player.y);
          if (dist < bestD) {
            bestD = dist;
            nearestDoor = {
              id: door.id,
              x: dx,
              y: dy,
              orientation: door.orientation,
              isOpen: door.isOpen,
              openProgress: door.openProgress,
            };
          }
        }
        return {
          bruteTuning: {
            ...(engine.bruteTuning ?? buildBruteTuningFromDifficulty(engine.difficulty)),
          },
          customBruteTuning: engine.customBruteTuning,
          difficulty: { ...engine.difficulty },
          effectiveZoom: engine.getEffectiveZoom(window.innerWidth, window.innerHeight),
          baseZoom: engine.zoom,
          bloodStreakCount: engine.map.bloodStreaks.length,
          steamPipesCount: engine.map.steamPipes.length,
          paperMapsCount: engine.map.paperMaps.length,
          playerX: engine.player.x,
          playerY: engine.player.y,
          steamStaggerTimer: engine.player.steamStaggerTimer,
          peekingStairId: engine.player.peekingStairId,
          bruteState: engine.brute.state,
          brutePos: { x: engine.brute.x, y: engine.brute.y },
          brutePathLength: engine.brute.path.length,
          investigateTarget: engine.brute.investigateTarget
            ? {
                x: engine.brute.investigateTarget.x,
                y: engine.brute.investigateTarget.y,
              }
            : null,
          observedEscape: {
            heliRepairs: engine.brain.observedHeliRepairs,
            heliActive: engine.brain.observedHeliActive,
            lifeboatRepairs: engine.brain.observedLifeboatRepairs,
            lifeboatActive: engine.brain.observedLifeboatActive,
            subRepairs: engine.brain.observedSubRepairs,
            subActive: engine.brain.observedSubActive,
          },
          activeNoiseRipples: engine.ripples.map((r) => ({
            x: r.x,
            y: r.y,
            maxRadius: r.maxRadius,
          })),
          maxAcousticRadius: engine.maxEmittedAcousticRadius,
          lockedOnlyRoomIds: [...engine.map.lockedOnlyRoomIds],
          poweredDecks: { ...engine.poweredDecks },
          bruteKnownFuseDecks: Array.from(engine.brain.knownFuseDecks),
          bruteFiddleSwitchId: engine.brute.fiddleSwitchId,
          nearestDoor,
        };
      },
      setBrutePose: (x: number, y: number, angle?: number) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.brute.x = x;
        engine.brute.y = y;
        if (angle !== undefined) engine.brute.angle = angle;
        engine.brute.path = [];
        engine.brute.pathRecalcTimer = 0;
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      setPlayerPose: (x: number, y: number) => {
        const engine = engineRef.current;
        if (!engine) return;
        engine.player.x = x;
        engine.player.y = y;
        engine.cameraX = x;
        engine.cameraY = y;
        renderImmediateFrame();
        syncDebugTelemetry();
      },
      testPositionInNearestDoor: (offsetFromCenterPx = 6) => {
        const engine = engineRef.current;
        if (!engine) return null;
        const ts = engine.map.tileSize;
        let bestDoor = null;
        let bestD = Infinity;
        for (const door of engine.map.doors) {
          if (door.isBroken || door.isLocked) continue;
          const dx = (door.tx + 0.5) * ts;
          const dy = (door.ty + 0.5) * ts;
          const dist = Math.hypot(dx - engine.player.x, dy - engine.player.y);
          if (dist < bestD) {
            bestD = dist;
            bestDoor = door;
          }
        }
        if (!bestDoor) return null;
        const cx = (bestDoor.tx + 0.5) * ts;
        const cy = (bestDoor.ty + 0.5) * ts;
        bestDoor.isOpen = true;
        bestDoor.openProgress = 1;
        if (bestDoor.orientation === 'H') {
          engine.player.x = cx;
          engine.player.y = cy + offsetFromCenterPx;
        } else {
          engine.player.x = cx + offsetFromCenterPx;
          engine.player.y = cy;
        }
        engine.player.hidingSpotId = null;
        renderImmediateFrame();
        return {
          doorId: bestDoor.id,
          orientation: bestDoor.orientation,
          doorCenterX: cx,
          doorCenterY: cy,
          playerX: engine.player.x,
          playerY: engine.player.y,
        };
      },
      focusDoor: (idxOrId) => focusDoorInDebug(idxOrId),
      focusStair: (directionOrId, index) => focusStairInDebug(directionOrId, index),
      toggleNearestDoor: () => toggleNearestDoorInDebug(),
      getStructureSummary: () => {
        const engine = engineRef.current;
        if (!engine) return null;
        const ts = engine.map.tileSize;
        let normal = 0;
        let locked = 0;
        let watertight = 0;
        let broken = 0;
        const doors = engine.map.doors.map((d) => {
          if (d.isBroken) broken++;
          else if (d.isLocked) locked++;
          else if (d.isWatertight) watertight++;
          else normal++;
          return {
            id: d.id,
            deck: engine.map.deckGrid[d.ty]?.[d.tx] ?? 'DECK_2',
            orientation: d.orientation,
            isLocked: d.isLocked,
            isWatertight: Boolean(d.isWatertight),
            isBroken: d.isBroken,
            isOpen: d.isOpen,
            x: (d.tx + 0.5) * ts,
            y: (d.ty + 0.5) * ts,
          };
        });
        return {
          doorsTotal: doors.length,
          doorsByKind: { normal, locked, watertight, broken },
          stairwellsTotal: engine.map.stairwells.length,
          doors,
          stairwells: engine.map.stairwells.map((s) => ({
            id: s.id,
            deck: s.deck,
            direction: s.direction,
            x: s.x,
            y: s.y,
          })),
        };
      },
      getTelemetry: () => syncDebugTelemetry(),
      getStatus: () => statusRef.current,
      getRendererBackend: () => rendererRef.current?.getBackendLabel() ?? 'Uninitialized',
      setGraphicsSettings: (patch) => {
        const next = { ...graphicsSettingsRef.current, ...patch };
        handleChangeGraphicsSettings(next);
      },
      getGraphicsInfo: () => ({
        settings: { ...graphicsSettingsRef.current },
        display: rendererRef.current?.getDisplayTelemetry() ?? null,
      }),
      getContainersState: () => {
        const engine = engineRef.current;
        if (!engine) return null;
        return {
          cursorTarget: engine.cursorTarget ? { ...engine.cursorTarget } : null,
          containers: engine.map.containers.map((c) => ({
            id: c.id,
            type: c.type,
            deck: engine.map.deckGrid[c.ty]?.[c.tx] ?? 'DECK_2',
            x: c.x,
            y: c.y,
            isOpen: c.isOpen,
            openProgress: c.openProgress,
            searched: c.searched,
            item: c.item,
          })),
        };
      },
      aimAtContainer: (containerId: string, targetPart: 'CONTAINER' | 'CONTAINER_ITEM' = 'CONTAINER') => {
        const engine = engineRef.current;
        const renderer = rendererRef.current;
        if (!engine || !renderer || !renderer.isInitialized()) return null;
        renderImmediateFrame();
        const pt = renderer.getContainerScreenPoint(
          containerId,
          targetPart,
          window.innerWidth,
          window.innerHeight
        );
        if (!pt) return null;
        engine.mouseScreenX = pt.x;
        engine.mouseScreenY = pt.y;
        engine.mouseMoved = true;
        if (
          renderer.screenToWorldGround(
            pt.x,
            pt.y,
            window.innerWidth,
            window.innerHeight,
            groundScratchRef.current,
            16
          )
        ) {
          engine.setWorldMouse(groundScratchRef.current.x, groundScratchRef.current.y);
        }
        renderer.updatePointerHover(engine, pt.x, pt.y, window.innerWidth, window.innerHeight);
        renderImmediateFrame();
        return {
          screenX: pt.x,
          screenY: pt.y,
          cursorTarget: engine.cursorTarget ? { ...engine.cursorTarget } : null,
        };
      },
      probePixels: () => {
        renderImmediateFrame();
        void refreshProbesAsync();
        return cachedProbesRef.current;
      },
      probePixelsAsync: async () => {
        renderImmediateFrame();
        return await refreshProbesAsync();
      },
      captureCanvasDataUrl: () => {
        renderImmediateFrame();
        return canvasRef.current?.toDataURL('image/png') ?? null;
      },
      captureCanvasDataUrlAsync: async () => {
        renderImmediateFrame();
        return (await rendererRef.current?.capturePngDataUrlAsync()) ?? null;
      },
    };
    return () => {
      delete window.__monstrumDebug;
    };
  }, [
    focusDoorInDebug,
    focusStairInDebug,
    handleChangeGraphicsSettings,
    handleLoadScenario,
    handleUpdateDebugConfig,
    refreshProbesAsync,
    renderImmediateFrame,
    syncDebugTelemetry,
    toggleNearestDoorInDebug,
  ]);

  // Keyboard & mouse handlers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        if (statusRef.current === 'PLAYING') {
          const eng = engineRef.current;
          if (eng?.player.openPaperMapDeck !== null && eng?.player.openPaperMapDeck !== undefined) {
            eng.closePaperMap(true);
            return;
          }
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
        if (devModeUnlockedRef.current) {
          e.preventDefault();
          setDebugOpen((prev) => !prev);
        }
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
          if (rendererRef.current?.isInitialized()) {
            rendererRef.current.updatePointerHover(
              engine,
              engine.mouseScreenX,
              engine.mouseScreenY,
              window.innerWidth,
              window.innerHeight
            );
          }
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
      rendererRef.current?.dispose();
      rendererRef.current = null;
      activeCanvasRef.current = null;
    };
  }, []);

  if (status === 'TITLE_MENU') {
    return (
      <TitleMenu
        difficulty={difficulty}
        onSelectDifficulty={handleSelectDifficulty}
        seedInput={seedInput}
        onSeedInputChange={setSeedInput}
        muted={muted}
        onToggleMute={toggleMute}
        devModeUnlocked={devModeUnlocked}
        onToggleDevMode={handleToggleDevMode}
        bruteTuning={bruteTuning}
        customTuningActive={customTuningActive}
        onChangeBruteTuning={handleChangeBruteTuning}
        onResetBruteTuning={handleResetBruteTuning}
        graphicsSettings={graphicsSettings}
        onChangeGraphicsSettings={handleChangeGraphicsSettings}
        onResetGraphicsSettings={handleResetGraphicsSettings}
        rendererBackend={rendererRef.current?.getBackendLabel()}
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
          if (dragOrbitRef.current.active) {
            const dx = e.clientX - dragOrbitRef.current.lastX;
            const dy = e.clientY - dragOrbitRef.current.lastY;
            dragOrbitRef.current.lastX = e.clientX;
            dragOrbitRef.current.lastY = e.clientY;
            if (
              Math.abs(e.clientX - dragOrbitRef.current.startX) > 3 ||
              Math.abs(e.clientY - dragOrbitRef.current.startY) > 3
            ) {
              dragOrbitRef.current.moved = true;
            }
            if (dragOrbitRef.current.mode === 'orbit') {
              let nextYaw = engine.debugConfig.cameraYawDeg + dx * 0.45;
              if (nextYaw > 180) nextYaw -= 360;
              if (nextYaw < -180) nextYaw += 360;
              const nextPitch = Math.max(0, Math.min(80, engine.debugConfig.cameraPitchDeg + dy * 0.4));
              engine.debugConfig.cameraYawDeg = nextYaw;
              engine.debugConfig.cameraPitchDeg = nextPitch;
            } else {
              const yawRad = (engine.debugConfig.cameraYawDeg * Math.PI) / 180;
              const cosY = Math.cos(yawRad);
              const sinY = Math.sin(yawRad);
              const zScale = 1 / Math.max(0.35, engine.debugConfig.freeCamZoom);
              engine.debugConfig.freeCamX -= (dx * cosY + dy * sinY) * zScale;
              engine.debugConfig.freeCamY -= (-dx * sinY + dy * cosY) * zScale;
            }
            return;
          }
          engine.mouseScreenX = e.clientX;
          engine.mouseScreenY = e.clientY;
          engine.mouseMoved = true;
          const renderer = rendererRef.current;
          if (
            renderer?.isInitialized() &&
            renderer.screenToWorldGround(
              e.clientX,
              e.clientY,
              window.innerWidth,
              window.innerHeight,
              groundScratchRef.current,
              16
            )
          ) {
            engine.setWorldMouse(groundScratchRef.current.x, groundScratchRef.current.y);
          }
        }}
        onMouseDown={(e) => {
          const engine = engineRef.current;
          if (!engine || statusRef.current !== 'PLAYING') return;
          const gfx = graphicsSettingsRef.current;
          const debugViewportActive =
            debugOpenRef.current &&
            engine.debugConfig.enabled &&
            (engine.debugConfig.freeCamEnabled ||
              e.altKey ||
              Math.abs(engine.debugConfig.cameraPitchDeg - gfx.cameraPitchDeg) > 0.5 ||
              Math.abs(engine.debugConfig.cameraYawDeg - gfx.cameraYawDeg) > 0.5);
          if (debugViewportActive && (e.button === 2 || (e.button === 0 && e.altKey))) {
            dragOrbitRef.current = {
              active: true,
              mode: 'orbit',
              startX: e.clientX,
              startY: e.clientY,
              lastX: e.clientX,
              lastY: e.clientY,
              moved: false,
            };
            return;
          }
          if (debugOpenRef.current && engine.debugConfig.freeCamEnabled && (e.button === 1 || (e.button === 0 && e.shiftKey))) {
            dragOrbitRef.current = {
              active: true,
              mode: 'pan',
              startX: e.clientX,
              startY: e.clientY,
              lastX: e.clientX,
              lastY: e.clientY,
              moved: false,
            };
            return;
          }
          if (e.button === 0) {
            engine.useSelectedItem();
          } else if (e.button === 2) {
            engine.toggleFlashlight();
          }
        }}
        onMouseUp={(e) => {
          if (dragOrbitRef.current.active) {
            const wasClick = e.button === 2 && !dragOrbitRef.current.moved;
            dragOrbitRef.current.active = false;
            if (wasClick && engineRef.current && statusRef.current === 'PLAYING') {
              engineRef.current.toggleFlashlight();
            }
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />

      {hud && status === 'PLAYING' && (
        <GameHud
          hud={hud}
          muted={muted}
          showDebugButton={devModeUnlocked}
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

      {hud && status === 'PLAYING' && hud.paperMapDeck && hud.paperMapStandPos && engineRef.current && (
        <PaperMapModal
          map={engineRef.current.map}
          initialDeck={hud.paperMapDeck}
          standPos={hud.paperMapStandPos}
          devModeUnlocked={devModeUnlocked}
          onClose={() => engineRef.current?.closePaperMap(true)}
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
          onFocusDoor={() => {
            focusDoorInDebug();
          }}
          onFocusStair={(dir) => {
            focusStairInDebug(dir);
          }}
          onToggleNearestDoor={() => {
            toggleNearestDoorInDebug();
          }}
          onCaptureScreenshot={() => {
            void handleCaptureScreenshot();
          }}
          onRefreshProbes={() => {
            renderImmediateFrame();
            void refreshProbesAsync();
          }}
        />
      )}

      {status === 'PAUSED' && engineRef.current && (
        <PauseModal
          seed={engineRef.current.map.seed}
          graphicsSettings={graphicsSettings}
          onChangeGraphicsSettings={handleChangeGraphicsSettings}
          onResetGraphicsSettings={handleResetGraphicsSettings}
          rendererBackend={rendererRef.current?.getBackendLabel()}
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
