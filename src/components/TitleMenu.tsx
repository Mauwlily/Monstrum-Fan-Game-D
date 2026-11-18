import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Compass,
  Eye,
  Flame,
  Footprints,
  Lock,
  Maximize2,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  BruteTuningNumbers,
  detectDifficultyPreset,
  DIFFICULTY_PRESETS,
  DifficultyConfig,
  DifficultyLevel,
  GAME_VERSION,
} from '../game/types';
import { CrtFeedScene, CrtMonitorFeed } from './CrtMonitorFeed';

interface TitleMenuProps {
  difficulty: DifficultyConfig;
  onSelectDifficulty: (d: DifficultyConfig) => void;
  seedInput: string;
  onSeedInputChange: (val: string) => void;
  muted: boolean;
  onToggleMute: () => void;
  devModeUnlocked: boolean;
  onToggleDevMode: () => void;
  bruteTuning: BruteTuningNumbers;
  customTuningActive: boolean;
  onChangeBruteTuning: (next: BruteTuningNumbers) => void;
  onResetBruteTuning: () => void;
  onStartGame: () => void;
}

type DossierId = 'SETUP' | 'OPTIONS' | 'GUIDE' | 'INTEL' | 'CREDITS' | null;

const LEVELS: Array<{ value: DifficultyLevel; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
];

const AXES: Array<{
  key: keyof DifficultyConfig;
  label: string;
  hint: string;
}> = [
  {
    key: 'intelligence',
    label: 'Intelligence',
    hint: 'Clue depth, locker sweep coverage, chase prediction & door-peek response',
  },
  {
    key: 'senses',
    label: 'Senses',
    hint: 'Vision cone width, sight distance & footstep hearing range',
  },
  {
    key: 'speed',
    label: 'Speed',
    hint: 'Patrol pace, sprint pursuit velocity & door smash recovery',
  },
];

interface TuningField {
  key: keyof BruteTuningNumbers;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SPEED_FIELDS: TuningField[] = [
  { key: 'roamSpeed', label: 'Roam Speed (px/s)', min: 40, max: 350, step: 2 },
  { key: 'investigateSpeed', label: 'Investigate Speed (px/s)', min: 50, max: 380, step: 2 },
  { key: 'stalkSpeed', label: 'Stalk Speed (px/s)', min: 50, max: 380, step: 2 },
  { key: 'chaseSpeed', label: 'Chase Speed (px/s)', min: 80, max: 460, step: 2 },
  { key: 'smashChaseDelay', label: 'Door Smash (Chase s)', min: 0.08, max: 2.5, step: 0.02 },
  { key: 'smashPatrolDelay', label: 'Door Smash (Patrol s)', min: 0.1, max: 3.0, step: 0.02 },
  { key: 'stairClimbChase', label: 'Stair Climb (Chase s)', min: 0.1, max: 2.5, step: 0.02 },
  { key: 'stairClimbPatrol', label: 'Stair Climb (Patrol s)', min: 0.1, max: 3.0, step: 0.02 },
];

const SENSES_FIELDS: TuningField[] = [
  { key: 'sightMult', label: 'Sight Range Mult', min: 0.3, max: 2.5, step: 0.02 },
  { key: 'halfFovDeg', label: 'Half-FOV (deg)', min: 20, max: 140, step: 1 },
  { key: 'peripheralBase', label: 'Peripheral Base (px)', min: 15, max: 260, step: 2 },
  { key: 'peripheralCrouch', label: 'Peripheral Crouch (px)', min: 10, max: 200, step: 2 },
  { key: 'hearingMult', label: 'Hearing Range Mult', min: 0.2, max: 2.5, step: 0.05 },
];

const INTEL_FIELDS: TuningField[] = [
  { key: 'sweepCoverage', label: 'Locker Sweep (0–1)', min: 0.1, max: 1.0, step: 0.05 },
  { key: 'overshootDist', label: 'Chase Overshoot (px)', min: 40, max: 450, step: 10 },
  { key: 'clueRoomDepth', label: 'Clue Room Depth', min: 1, max: 8, step: 1 },
  { key: 'clueScanInterval', label: 'Clue Scan Interval (s)', min: 0.02, max: 1.0, step: 0.02 },
  { key: 'stairPursuitRange', label: 'Stair Pursuit Snap (px)', min: 20, max: 260, step: 5 },
];

interface MonitorConfig {
  id: Exclude<DossierId, null>;
  label: string;
  feedCode: string;
  timestamp: string;
  scene: CrtFeedScene;
  testId: string;
}

const MAIN_MONITORS: MonitorConfig[] = [
  {
    id: 'SETUP',
    label: 'NEW GAME',
    feedCode: 'SEC FEED 00-1',
    timestamp: '01-20-79 03:45:12',
    scene: 'CORRIDOR',
    testId: 'crt-new-game',
  },
  {
    id: 'OPTIONS',
    label: 'OPTIONS',
    feedCode: 'SEC FEED 00-2',
    timestamp: '01-20-79 03:45:18',
    scene: 'STAIRWELL',
    testId: 'crt-options',
  },
  {
    id: 'GUIDE',
    label: 'FIELD GUIDE',
    feedCode: 'SEC FEED 00-3',
    timestamp: '01-20-79 03:45:24',
    scene: 'CARGO',
    testId: 'crt-field-guide',
  },
  {
    id: 'INTEL',
    label: 'BRUTE INTEL',
    feedCode: 'SEC FEED 00-4',
    timestamp: '01-20-79 03:45:31',
    scene: 'ENGINE_BRUTE',
    testId: 'crt-brute-intel',
  },
];

export const TitleMenu: React.FC<TitleMenuProps> = ({
  difficulty,
  onSelectDifficulty,
  seedInput,
  onSeedInputChange,
  muted,
  onToggleMute,
  devModeUnlocked,
  onToggleDevMode,
  bruteTuning,
  customTuningActive,
  onChangeBruteTuning,
  onResetBruteTuning,
  onStartGame,
}) => {
  const [activeDossier, setActiveDossier] = useState<DossierId>(null);
  const [hoveredMonitor, setHoveredMonitor] = useState<DossierId>(null);
  const [consecutiveSmileyClicks, setConsecutiveSmileyClicks] = useState(0);
  const [nightmareStreak, setNightmareStreak] = useState(0);
  const [highStreaks, setHighStreaks] = useState<Record<keyof DifficultyConfig, number>>({
    intelligence: 0,
    senses: 0,
    speed: 0,
  });

  const activePreset = detectDifficultyPreset(difficulty);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && activeDossier !== null) {
        e.preventDefault();
        setActiveDossier(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDossier]);

  const resetAllStreaks = () => {
    setConsecutiveSmileyClicks(0);
    setNightmareStreak(0);
    setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
  };

  const handleSmileyClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setNightmareStreak(0);
    setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
    const next = consecutiveSmileyClicks + 1;
    if (next >= 3) {
      setConsecutiveSmileyClicks(0);
      onToggleDevMode();
    } else {
      setConsecutiveSmileyClicks(next);
    }
  };

  const updateAxis = (axis: keyof DifficultyConfig, val: DifficultyLevel) => {
    onSelectDifficulty({ ...difficulty, [axis]: val });
  };

  const handlePresetClick = (presetKey: 'MERCY' | 'STANDARD' | 'NIGHTMARE') => {
    setConsecutiveSmileyClicks(0);
    setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });

    if (presetKey !== 'NIGHTMARE') {
      setNightmareStreak(0);
      onSelectDifficulty({ ...DIFFICULTY_PRESETS[presetKey] });
      return;
    }

    if (activePreset === 'EXTREME') {
      setNightmareStreak(0);
      onSelectDifficulty({ ...DIFFICULTY_PRESETS.NIGHTMARE });
      return;
    }

    const next = nightmareStreak + 1;
    if (next >= 3) {
      setNightmareStreak(0);
      onSelectDifficulty({ ...DIFFICULTY_PRESETS.EXTREME });
    } else {
      setNightmareStreak(next);
      onSelectDifficulty({ ...DIFFICULTY_PRESETS.NIGHTMARE });
    }
  };

  const handleAxisLevelClick = (axis: keyof DifficultyConfig, lvl: DifficultyLevel) => {
    setConsecutiveSmileyClicks(0);
    setNightmareStreak(0);

    if (lvl !== 'HIGH') {
      setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
      updateAxis(axis, lvl);
      return;
    }

    if (difficulty[axis] === 'EXTREME') {
      setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
      updateAxis(axis, 'HIGH');
      return;
    }

    const next = highStreaks[axis] + 1;
    if (next >= 3) {
      setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
      updateAxis(axis, 'EXTREME');
    } else {
      setHighStreaks({ intelligence: 0, senses: 0, speed: 0, [axis]: next });
      updateAxis(axis, 'HIGH');
    }
  };

  const handleTuningChange = (field: TuningField, raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.max(field.min, Math.min(field.max, parsed));
    onChangeBruteTuning({
      ...bruteTuning,
      [field.key]: clamped,
    });
  };

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      void document.exitFullscreen?.().catch(() => {});
    }
  };

  const renderFieldGroup = (title: string, fields: TuningField[]) => (
    <div className="rounded border border-slate-800 bg-[#070a0f] p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
        {title}
      </div>
      <div className="space-y-1.5">
        {fields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-2">
            <label htmlFor={`dev-${field.key}`} className="min-w-0 flex-1 text-[11px] leading-tight text-slate-400">
              {field.label}
            </label>
            <input
              id={`dev-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              step={field.step}
              value={bruteTuning[field.key]}
              onChange={(e) => handleTuningChange(field, e.target.value)}
              className="w-16 shrink-0 rounded border border-slate-800 bg-[#040609] px-1.5 py-0.5 text-right text-xs text-amber-200 font-mono-num focus:border-amber-500 focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      onClick={resetAllStreaks}
      className="relative flex min-h-screen lg:h-screen w-full flex-col justify-between overflow-x-hidden overflow-y-auto lg:overflow-hidden bg-[#040607] text-slate-100"
    >
      {/* Cabin ambient depth: cool P1 CRT wash on left, warm tungsten desk lamp bounce on right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            'radial-gradient(circle at 26% 36%, rgba(16, 185, 129, 0.11), transparent 44%)',
            'radial-gradient(ellipse 46% 52% at 77% 62%, rgba(217, 119, 6, 0.24), transparent 64%)',
            'radial-gradient(ellipse 35% 42% at 74% 38%, rgba(245, 158, 11, 0.14), transparent 62%)',
            'linear-gradient(180deg, rgba(2, 4, 5, 0.92) 0%, rgba(5, 8, 9, 0.35) 38%, rgba(3, 5, 6, 0.95) 100%)',
          ].join(', '),
        }}
      />

      {/* Top micro utility bar (subtle cabin edge) */}
      <div className="relative z-20 flex items-center justify-between px-4 pt-3 sm:px-7 sm:pt-4">
        <div className="flex items-center gap-2.5 text-[11px] text-emerald-200/60 font-mono-num">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
          <span>BRIDGE SECURITY CONSOLE · 3-DECK FREIGHTER</span>
          {devModeUnlocked && (
            <span className="rounded border border-amber-500/50 bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
              DEV MODE
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
          className="flex items-center gap-1.5 rounded border border-slate-800/90 bg-[#0b1014]/90 px-2.5 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:border-amber-500/60 hover:text-amber-200 focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer whitespace-nowrap shrink-0"
        >
          {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          <span>{muted ? 'Audio Muted' : 'Audio On'}</span>
        </button>
      </div>

      {/* Main Security Booth Composition */}
      <div className="relative z-10 mx-auto grid w-full max-w-[1440px] flex-1 grid-cols-1 items-center gap-6 px-4 py-3 lg:grid-cols-12 lg:gap-4 lg:px-8 lg:py-0">
        {/* LEFT: Angled 2x2 Green-Phosphor CRT Monitor Bank */}
        <div className="lg:col-span-6 flex items-center justify-center">
          <div className="relative w-full max-w-[660px] rounded-md border border-[#1a2228] bg-[#0a0e12] p-2.5 sm:p-3.5 shadow-[0_28px_70px_rgba(0,0,0,0.92),0_0_55px_rgba(16,185,129,0.08)] lg:[transform:perspective(1150px)_rotateY(9deg)_rotateZ(-1.1deg)]">
            {/* Inner recessed steel monitor rack */}
            <div className="relative grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 rounded border border-[#141b20] bg-[#06090c] p-2 sm:p-2.5">
              {/* Two weathered sticky memos stuck to the central bezel divider */}
              <div
                aria-hidden="true"
                className="pointer-events-none hidden sm:flex absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 gap-1.5"
              >
                <div className="-rotate-6 rounded-[2px] bg-[#b8aa75] px-1.5 py-1 text-[7px] leading-tight font-mono-num font-semibold text-[#1e1b12] shadow-md opacity-85">
                  DECK 1 SUB
                  <br />
                  FLOOD LEVER
                </div>
                <div className="rotate-6 rounded-[2px] bg-[#cab97f] px-1.5 py-1 text-[7px] leading-tight font-mono-num font-semibold text-[#1e1b12] shadow-md opacity-80">
                  LIT ROOM
                  <br />
                  VENT STEALTH
                </div>
              </div>

              {MAIN_MONITORS.map((mon) => {
                const isHovered = hoveredMonitor === mon.id;
                return (
                  <button
                    key={mon.id}
                    type="button"
                    data-testid={mon.testId}
                    onMouseEnter={() => setHoveredMonitor(mon.id)}
                    onMouseLeave={() => setHoveredMonitor(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      resetAllStreaks();
                      setActiveDossier(mon.id);
                    }}
                    className="group relative aspect-[4/3] w-full overflow-hidden rounded-[10px] border-4 border-[#13181d] bg-[#03100a] text-left shadow-[inset_0_0_24px_rgba(0,0,0,0.95)] transition-transform duration-150 hover:scale-[1.015] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 cursor-pointer"
                  >
                    {/* Live Canvas CCTV security camera feed */}
                    <CrtMonitorFeed scene={mon.scene} hovered={isHovered} />

                    {/* Subtle CRT scanlines + convex glass reflection */}
                    <div aria-hidden="true" className="crt-scanlines pointer-events-none absolute inset-0 opacity-75" />
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[8px] transition-opacity duration-150"
                      style={{
                        background:
                          'radial-gradient(circle at 28% 22%, rgba(167, 243, 208, 0.14), transparent 52%), linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 45%)',
                        opacity: isHovered ? 1 : 0.72,
                      }}
                    />
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 rounded-[8px] ring-1 transition-colors duration-150 ${
                        isHovered
                          ? 'ring-emerald-300/60 shadow-[inset_0_0_28px_rgba(52,211,153,0.22)]'
                          : 'ring-emerald-900/60'
                      }`}
                    />

                    {/* Top & bottom CCTV HUD overlays */}
                    <div className="pointer-events-none absolute inset-x-2.5 top-2 flex items-center justify-between text-[9px] tracking-wider text-emerald-300/55 font-mono-num">
                      <span>{mon.feedCode}</span>
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
                        LIVE
                      </span>
                    </div>

                    {/* Centered glowing serif CRT menu label */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-3">
                      <span
                        className="font-serif-crt text-center text-lg sm:text-xl md:text-2xl font-bold tracking-[0.12em] text-[#e2f9ee] transition-transform duration-150 group-hover:scale-[1.03]"
                        style={{
                          textShadow: isHovered
                            ? '0 0 14px rgba(110, 231, 183, 0.85), 0 2px 6px rgba(0,0,0,0.95)'
                            : '0 0 8px rgba(52, 211, 153, 0.5), 0 2px 5px rgba(0,0,0,0.95)',
                        }}
                      >
                        {mon.label}
                      </span>
                    </div>

                    <div className="pointer-events-none absolute inset-x-2.5 bottom-1.5 flex items-center justify-between text-[8px] tracking-wider text-emerald-300/45 font-mono-num">
                      <span>{mon.timestamp}</span>
                      <span className="text-emerald-200/40 group-hover:text-emerald-200/80 transition-colors">
                        OPEN ▸
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Bottom monitor bank brand plate */}
            <div className="mt-1.5 flex items-center justify-between px-2 text-[9px] tracking-[0.22em] text-slate-600 font-mono-num">
              <span>MARITIME CCTV QUAD-ARRAY</span>
              <span>CH 01–04</span>
            </div>
          </div>
        </div>

        {/* RIGHT: Slatted Amber-Lit Bulkhead + Extruded MONSTRUM :D Signage */}
        <div className="order-first lg:order-none lg:col-span-6 relative flex flex-col items-center lg:items-end justify-center min-h-[125px] lg:min-h-[380px] lg:pr-4">
          {/* Vertical slatted wall backdrop */}
          <div
            aria-hidden="true"
            className="pointer-events-none relative w-full max-w-[600px] h-[125px] sm:h-[190px] lg:h-[360px] overflow-hidden rounded-sm border border-[#1b1410]/80 bg-[#080605]"
          >
            {/* Slats */}
            <div className="absolute inset-0 grid grid-cols-14 gap-1.5 px-2">
              {Array.from({ length: 14 }, (_, idx) => (
                <div
                  key={idx}
                  className="h-full rounded-[1px]"
                  style={{
                    background:
                      idx >= 5 && idx <= 11
                        ? 'linear-gradient(180deg, #1b1410 0%, #3d2415 48%, #733f1f 82%, #2b180e 100%)'
                        : 'linear-gradient(180deg, #141110 0%, #201712 65%, #120d0a 100%)',
                    boxShadow: 'inset 1px 0 0 rgba(255, 198, 120, 0.08), 2px 0 6px rgba(0,0,0,0.85)',
                  }}
                />
              ))}
            </div>
            {/* Warm diagonal lamp spill across the slats */}
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(ellipse 68% 72% at 68% 82%, rgba(251, 146, 60, 0.42), rgba(180, 83, 9, 0.14) 55%, transparent 80%), radial-gradient(circle at 8% 58%, rgba(16, 185, 129, 0.16), transparent 45%)',
              }}
            />
          </div>

          {/* 3D-lit MONSTRUM signage mounted across the slatted bulkhead */}
          <div className="relative lg:absolute lg:right-8 lg:top-[30%] flex flex-col items-center lg:items-end -mt-22 sm:-mt-30 lg:mt-0 px-2">
            <div className="flex items-baseline gap-2.5 sm:gap-3.5">
              <h1 className="monstrum-wall-text font-sans text-4xl sm:text-5xl md:text-6xl lg:text-[4.15rem] font-bold tracking-[0.14em] leading-none select-none">
                MONSTRUM
              </h1>
              <button
                type="button"
                onClick={handleSmileyClick}
                aria-label={activeDossier !== 'SETUP' ? 'happy face' : 'dev mode accent'}
                title="Monstrum Fan Game :D"
                className="text-2xl sm:text-3xl md:text-4xl font-bold text-amber-400/90 hover:text-amber-300 transition-colors select-none cursor-default focus-visible:outline-2 focus-visible:outline-amber-400 rounded px-0.5"
              >
                :D
              </button>
            </div>
            <p className="mt-1.5 text-[10px] sm:text-[11px] uppercase tracking-[0.34em] text-amber-200/60 font-mono-num">
              Fan Game · Security Station
            </p>
          </div>
        </div>
      </div>

      {/* FOREGROUND: Console Desk, Props, Vintage CREDITS CRT + Bust, Lamp & Flip-Clock */}
      <div className="relative z-10 w-full mt-2 lg:mt-0">
        {/* Desk countertop surface */}
        <div
          className="relative mx-auto w-full border-t border-[#25353a]/80 px-4 pt-4 pb-3 sm:px-8"
          style={{
            background:
              'linear-gradient(180deg, #162226 0%, #0d1518 45%, #070b0d 100%)',
            boxShadow:
              'inset 0 1px 0 rgba(148, 226, 189, 0.14), 0 -14px 36px rgba(0, 0, 0, 0.88)',
          }}
        >
          {/* Green monitor reflection left + warm desk lamp pool right */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 36% 90% at 24% 25%, rgba(16, 185, 129, 0.14), transparent 70%), radial-gradient(ellipse 38% 110% at 72% 35%, rgba(251, 191, 36, 0.24), transparent 72%)',
            }}
          />

          <div className="relative mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-4">
            {/* Left Desk Props: Logbook, Bottle, Coffee Mug & Scattered Blueprints */}
            <div aria-hidden="true" className="hidden md:flex items-end gap-4 pb-1 select-none pointer-events-none">
              {/* Closed ship logbook */}
              <div className="h-7 w-24 -rotate-3 rounded-xs border border-slate-700/70 bg-gradient-to-b from-[#1a2433] to-[#0c121b] shadow-lg flex items-center justify-center">
                <span className="text-[8px] tracking-widest text-slate-400/70 font-mono-num">SHIP LOG</span>
              </div>
              {/* Dark bottle + Coffee Mug */}
              <div className="flex items-end gap-2">
                <div className="flex flex-col items-center">
                  <div className="h-4 w-2 rounded-t-xs bg-[#1f1916] border border-white/10" />
                  <div className="h-9 w-5 rounded-t-sm bg-gradient-to-r from-[#1a1411] via-[#2e231c] to-[#120e0c] border border-white/10 shadow-md" />
                </div>
                <div className="relative h-9 w-9 rounded-b-md rounded-t-xs border border-[#9d9589]/40 bg-gradient-to-r from-[#877e71] via-[#b8ae9e] to-[#5a534a] shadow-lg">
                  <div className="absolute -right-2 top-2 h-4 w-2.5 rounded-r-full border-2 border-[#9d9589]/70" />
                  <div className="mx-1 mt-1 h-1 rounded-full bg-[#24160e]/80" />
                </div>
              </div>
              {/* Scattered ship schematics */}
              <div className="relative h-10 w-52">
                <div className="absolute left-0 bottom-0 h-8 w-20 -rotate-6 rounded-[1px] border border-emerald-400/20 bg-[#3a4b3f]/45 p-1 shadow">
                  <div className="h-full w-full border border-dashed border-emerald-200/25" />
                </div>
                <div className="absolute left-20 bottom-1 h-8 w-24 rotate-3 rounded-[1px] border border-amber-200/20 bg-[#4b4c39]/45 p-1 shadow">
                  <div className="h-1 w-12 bg-amber-100/20 mb-1" />
                  <div className="h-1 w-16 bg-amber-100/15" />
                </div>
              </div>
            </div>

            {/* Center-Right: Vintage Desk CREDITS CRT + Brute Bust + Desk Lamp + Flip-Clock */}
            <div className="mx-auto lg:mx-0 lg:ml-auto flex flex-wrap items-end justify-center gap-4 sm:gap-6">
              {/* Vintage Wooden Desk CRT + Perched Monster Bust */}
              <div className="relative flex flex-col items-center">
                {/* Small Brute / Sea-Beast Bust Figurine perched on top of TV */}
                <svg
                  aria-hidden="true"
                  viewBox="0 0 80 42"
                  className="-mb-1.5 h-8 w-16 drop-shadow-[0_4px_6px_rgba(0,0,0,0.9)] pointer-events-none"
                >
                  <defs>
                    <linearGradient id="bustRim" x1="0" y1="0" x2="1" y2="0.4">
                      <stop offset="0%" stopColor="#3a231c" />
                      <stop offset="65%" stopColor="#92400e" />
                      <stop offset="100%" stopColor="#f59e0b" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M16 39 C18 25, 25 14, 40 12 C54 10, 65 18, 67 28 L61 32 L54 29 L48 39 Z"
                    fill="url(#bustRim)"
                    stroke="#1c110c"
                    strokeWidth="1.5"
                  />
                  {/* Horns / ridges & glowing eye socket */}
                  <path d="M26 17 L18 7 L32 13 Z" fill="#78350f" />
                  <path d="M40 12 L43 3 L48 12 Z" fill="#b45309" />
                  <circle cx="52" cy="21" r="2.2" fill="#fbbf24" />
                  {/* Teeth */}
                  <path d="M53 29 L55 33 L57 29 L59 33 L62 29" fill="none" stroke="#fef3c7" strokeWidth="1.2" />
                </svg>

                {/* Vintage wood-grain TV cabinet */}
                <div className="flex items-stretch gap-2 rounded-md border-2 border-[#432c1e] bg-gradient-to-b from-[#3b271a] via-[#271911] to-[#170f0a] p-2 shadow-[0_14px_32px_rgba(0,0,0,0.9)]">
                  <button
                    type="button"
                    data-testid="crt-credits"
                    onMouseEnter={() => setHoveredMonitor('CREDITS')}
                    onMouseLeave={() => setHoveredMonitor(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      resetAllStreaks();
                      setActiveDossier('CREDITS');
                    }}
                    className="group relative h-[76px] w-[132px] sm:h-[88px] sm:w-[154px] overflow-hidden rounded-[8px] border-2 border-[#15181a] bg-[#03100a] focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer"
                  >
                    <CrtMonitorFeed scene="SUB_BAY" hovered={hoveredMonitor === 'CREDITS'} />
                    <div aria-hidden="true" className="crt-scanlines pointer-events-none absolute inset-0 opacity-75" />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span
                        className="font-serif-crt text-sm sm:text-base font-bold tracking-[0.14em] text-[#e2f9ee] transition-transform duration-150 group-hover:scale-105"
                        style={{
                          textShadow: '0 0 8px rgba(52, 211, 153, 0.55), 0 2px 4px #000',
                        }}
                      >
                        CREDITS
                      </span>
                    </div>
                  </button>

                  {/* TV Rotary Dials Panel */}
                  <div aria-hidden="true" className="flex flex-col items-center justify-between py-1 px-1 bg-[#1e140e] rounded-xs border border-[#4a3223]/60 pointer-events-none">
                    <div className="h-5 w-5 rounded-full border border-amber-200/30 bg-[#0d0a08] flex items-center justify-center">
                      <div className="h-3 w-0.5 rotate-45 bg-amber-200/50" />
                    </div>
                    <div className="h-5 w-5 rounded-full border border-amber-200/30 bg-[#0d0a08] flex items-center justify-center">
                      <div className="h-3 w-0.5 -rotate-12 bg-amber-200/50" />
                    </div>
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-300/40" />
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-500/60" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Banker's Desk Lamp + Archival Binders */}
              <div aria-hidden="true" className="hidden sm:flex items-end gap-3 pointer-events-none">
                <div className="flex gap-1 pb-0.5">
                  <div className="h-16 w-4 rounded-t-xs border border-slate-700/60 bg-[#12161a]" />
                  <div className="h-16 w-4 rounded-t-xs border border-slate-700/60 bg-[#171b20]" />
                </div>
                <div className="relative flex flex-col items-center">
                  {/* Lamp shade */}
                  <div className="h-4 w-28 rounded-t-md border border-emerald-950 bg-gradient-to-b from-[#173628] to-[#0b1f16] shadow-[0_8px_22px_rgba(251,191,36,0.55)] flex items-end justify-center pb-0.5">
                    <div className="h-1 w-24 rounded-full bg-amber-100/90 blur-[0.5px]" />
                  </div>
                  {/* Brass articulated arm + heavy base */}
                  <div className="h-14 w-1.5 bg-gradient-to-r from-[#78531b] via-[#d4a44a] to-[#5e4012]" />
                  <div className="h-2.5 w-12 rounded-t-sm bg-gradient-to-b from-[#a17228] to-[#3f2b0d] border border-amber-200/20" />
                </div>
              </div>

              {/* Retro Flip-Clock + Subtle Version Stamp */}
              <div className="flex items-end gap-4">
                <div
                  aria-hidden="true"
                  className="pointer-events-none flex items-center gap-1 rounded border-2 border-[#462d1c] bg-gradient-to-b from-[#2e1c11] to-[#170e08] px-2.5 py-2 shadow-xl"
                >
                  <span className="rounded-xs bg-[#0d1014] px-2 py-1 text-lg font-bold tracking-wider text-slate-200 font-mono-num border border-slate-700/60">
                    11
                  </span>
                  <span className="text-slate-500 font-mono-num font-bold">:</span>
                  <span className="rounded-xs bg-[#0d1014] px-2 py-1 text-lg font-bold tracking-wider text-slate-200 font-mono-num border border-slate-700/60">
                    45
                  </span>
                </div>

                <span className="pb-0.5 text-[11px] font-mono-num tracking-wider text-slate-400/75">
                  v{GAME_VERSION}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SINGLE ACTIVE DOSSIER OVERLAY */}
      {activeDossier !== null && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            e.stopPropagation();
            setActiveDossier(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/78 p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => {
              e.stopPropagation();
              resetAllStreaks();
            }}
            className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-lg border border-slate-700/90 bg-[#0b0f15] shadow-2xl ${
              activeDossier === 'SETUP' && devModeUnlocked ? 'max-w-4xl' : 'max-w-2xl'
            }`}
          >
            {/* Dossier Header (Pinned) */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-4 sm:px-6">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-amber-400/90 font-mono-num">
                    {activeDossier === 'SETUP'
                      ? 'SEC FEED 00-1 · EXPEDITION BRIEFING'
                      : activeDossier === 'OPTIONS'
                        ? 'SEC FEED 00-2 · CONSOLE SETTINGS'
                        : activeDossier === 'GUIDE'
                          ? 'SEC FEED 00-3 · SURVIVAL MANUAL'
                          : activeDossier === 'INTEL'
                            ? 'SEC FEED 00-4 · ENTITY FILE'
                            : 'FEED 00-5 · ATTRIBUTION'}
                  </span>
                  {activeDossier === 'SETUP' && (
                    <button
                      type="button"
                      onClick={handleSmileyClick}
                      aria-label="happy face"
                      className="text-sm font-bold text-amber-400 hover:text-amber-300 select-none cursor-default focus-visible:outline-2 focus-visible:outline-amber-400 rounded px-1"
                    >
                      :D
                    </button>
                  )}
                </div>
                <h2 className="mt-0.5 font-serif-crt text-2xl font-bold tracking-wider text-slate-50">
                  {activeDossier === 'SETUP'
                    ? 'NEW EXPEDITION'
                    : activeDossier === 'OPTIONS'
                      ? 'OPTIONS & CONTROLS'
                      : activeDossier === 'GUIDE'
                        ? 'FIELD GUIDE'
                        : activeDossier === 'INTEL'
                          ? 'BRUTE INTEL'
                          : 'CREDITS'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActiveDossier(null)}
                aria-label="Close dossier"
                className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
                <span>Esc</span>
              </button>
            </div>

            {/* Scrollable Dossier Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
            {/* 1. SETUP DOSSIER */}
            {activeDossier === 'SETUP' && (
              <div className="space-y-5">
                {/* Brute Presets */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-300">Brute Presets</span>
                    <span
                      className={`text-xs ${
                        !customTuningActive && activePreset === 'EXTREME'
                          ? 'font-semibold text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {customTuningActive
                        ? 'Dev Custom Numbers'
                        : activePreset === 'EXTREME'
                          ? 'Extreme Preset'
                          : activePreset === 'CUSTOM'
                            ? 'Custom Profile'
                            : activePreset === 'MERCY'
                              ? 'Mercy Preset'
                              : activePreset === 'NIGHTMARE'
                                ? 'Nightmare Preset'
                                : 'Standard Preset'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 rounded-md border border-slate-800 bg-slate-950 p-1">
                    {(
                      [
                        { key: 'MERCY', label: 'Mercy' },
                        { key: 'STANDARD', label: 'Standard' },
                        { key: 'NIGHTMARE', label: 'Nightmare' },
                      ] as const
                    ).map((preset) => {
                      const isExtremePresetActive =
                        preset.key === 'NIGHTMARE' && activePreset === 'EXTREME';
                      const isSelected =
                        !customTuningActive &&
                        (activePreset === preset.key || isExtremePresetActive);

                      return (
                        <button
                          key={preset.key}
                          type="button"
                          data-testid={`preset-${preset.key.toLowerCase()}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePresetClick(preset.key);
                          }}
                          className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isSelected
                              ? isExtremePresetActive
                                ? 'border border-red-700/60 bg-red-950/90 text-red-200'
                                : preset.key === 'NIGHTMARE'
                                  ? 'border border-orange-700/50 bg-orange-950/90 text-orange-200'
                                  : 'bg-slate-800 text-white'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {isExtremePresetActive ? 'Extreme' : preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 3x3 Granular Matrix */}
                <div className="space-y-3 border-t border-slate-800/80 pt-4">
                  {AXES.map((axis) => (
                    <div key={axis.key}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
                          {axis.label}
                        </span>
                        <div className="grid w-52 shrink-0 grid-cols-3 gap-1 rounded-md border border-slate-800 bg-slate-950 p-1">
                          {LEVELS.map((lvl) => {
                            const isExtremeAxis =
                              lvl.value === 'HIGH' && difficulty[axis.key] === 'EXTREME';
                            const selected = difficulty[axis.key] === lvl.value || isExtremeAxis;
                            return (
                              <button
                                key={lvl.value}
                                type="button"
                                data-testid={`axis-${axis.key}-${lvl.value.toLowerCase()}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAxisLevelClick(axis.key, lvl.value);
                                }}
                                className={`rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                  selected
                                    ? isExtremeAxis
                                      ? 'border border-red-700/60 bg-red-950/90 text-red-200'
                                      : lvl.value === 'HIGH'
                                        ? 'border border-orange-700/50 bg-orange-950/90 text-orange-200'
                                        : 'bg-slate-800 text-white'
                                    : 'text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {isExtremeAxis ? 'Extreme' : lvl.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">{axis.hint}</p>
                    </div>
                  ))}
                </div>

                {/* Ship Seed */}
                <div>
                  <label htmlFor="ship-seed" className="mb-1.5 block text-xs font-medium text-slate-300">
                    Ship Seed (Optional)
                  </label>
                  <input
                    id="ship-seed"
                    type="text"
                    inputMode="numeric"
                    placeholder="Random vessel layout"
                    value={seedInput}
                    onChange={(e) =>
                      onSeedInputChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))
                    }
                    className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 font-mono-num focus:border-amber-500 focus:outline-none"
                  />
                </div>

                {/* Dev Mode Tuning Numbers */}
                {devModeUnlocked && (
                  <div className="rounded-md border border-amber-500/40 bg-[#080c12] p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Sliders className="h-4 w-4 text-amber-400" />
                        <span className="text-xs font-semibold text-slate-100">
                          Dev Mode: Internal Brute Numbers
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={onResetBruteTuning}
                        className="flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-slate-500 cursor-pointer"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reset to Preset</span>
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {renderFieldGroup('Speed', SPEED_FIELDS)}
                      {renderFieldGroup('Senses', SENSES_FIELDS)}
                      {renderFieldGroup('Intelligence', INTEL_FIELDS)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. OPTIONS DOSSIER */}
            {activeDossier === 'OPTIONS' && (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={onToggleMute}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/80 px-4 py-3 text-left transition-colors hover:border-amber-500/50 cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-100">Master Audio</div>
                      <div className="text-[11px] text-slate-400">
                        Procedural Web Audio synthesis
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-amber-300">
                      {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                      {muted ? 'Muted' : 'On'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/80 px-4 py-3 text-left transition-colors hover:border-amber-500/50 cursor-pointer"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-100">Display Mode</div>
                      <div className="text-[11px] text-slate-400">Shortcut: Press F11 anytime</div>
                    </div>
                    <span className="flex items-center gap-1.5 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200">
                      <Maximize2 className="h-3.5 w-3.5" />
                      Fullscreen
                    </span>
                  </button>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Controls Reference
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      ['WASD / Arrows', 'Move'],
                      ['Shift', 'Sprint (drains stamina, loud)'],
                      ['C / Ctrl', 'Toggle Sneak (quiet steps)'],
                      ['Hold Q', 'Peek Doors, Stairs & Locker Vents'],
                      ['E / Space', 'Interact, Repair, Open Doors & Paper Maps'],
                      ['F / Right-Click', 'Toggle Flashlight'],
                      ['Left-Click', 'Use Selected Tool / Bolt Cutters'],
                      ['G', 'Drop Selected Item'],
                      ['J', 'Open Escape Journal'],
                      ['Mouse Wheel', 'Adjust Camera Zoom (1.0x–2.5x)'],
                    ].map(([key, action]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 rounded border border-slate-800/70 bg-[#070a0f] px-3 py-2"
                      >
                        <span className="font-mono-num text-[11px] font-semibold text-amber-300">
                          {key}
                        </span>
                        <span className="text-right text-[11px] text-slate-300">{action}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 3. FIELD GUIDE DOSSIER */}
            {activeDossier === 'GUIDE' && (
              <div className="space-y-4 text-xs leading-relaxed text-slate-300">
                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                    <Compass className="h-4 w-4" />
                    <span>3-Deck Freighter &amp; Escape Craft</span>
                  </div>
                  <p>
                    Descend across three interconnected decks—from the open{' '}
                    <span className="text-amber-200 font-medium">Deck 3 Stern Helideck</span>, through
                    the{' '}
                    <span className="text-sky-300 font-medium">Deck 2 Bow Lifeboat Davit</span>, down
                    into the claustrophobic{' '}
                    <span className="text-emerald-300 font-medium">Deck 1 Submarine Bay</span> laced
                    with scalding steam pipes and heavy watertight bulkheads.
                  </p>
                  <p className="text-slate-400">
                    Consult fixed per-deck <span className="text-slate-200">Paper Maps</span> to chart
                    your deck without pausing time, and check your{' '}
                    <span className="text-slate-200">[J] Escape Journal</span> to track missing
                    parts.
                  </p>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                    <BookOpen className="h-4 w-4" />
                    <span>Peeking &amp; Light Stealth (v{GAME_VERSION})</span>
                  </div>
                  <ul className="space-y-2 text-slate-300 list-disc pl-4">
                    <li>
                      <span className="font-semibold text-slate-100">Lit-Room Hiding Peek:</span>{' '}
                      When hiding inside a locker or bunk in a compartment with its overhead light
                      ON, holding <span className="font-mono-num text-amber-300">Q</span> peeks
                      silently using room light—zero flashlight battery drain and no glint to alert
                      the Brute.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-100">Dark-Room Hiding Peek:</span>{' '}
                      In dark rooms, peeking vents switches on your flashlight, drains battery, and
                      exposes you if the Brute is looking toward your locker.
                    </li>
                    <li>
                      <span className="font-semibold text-slate-100">Door Keyhole Peek:</span>{' '}
                      Holding <span className="font-mono-num text-amber-300">Q</span> at a closed
                      door shines your flashlight beam through to scout ahead—draining battery and
                      risking attention from sharper Brutes.
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* 4. BRUTE INTEL DOSSIER */}
            {activeDossier === 'INTEL' && (
              <div className="space-y-3.5 text-xs leading-relaxed text-slate-300">
                <div className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3.5">
                  <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div>
                    <p className="font-semibold text-slate-100">
                      Unleashed Cross-Deck Patrol &amp; Sight-Based Escape Bias
                    </p>
                    <p className="mt-0.5 text-slate-400">
                      No rubber-banding director. The Brute freely sweeps all three decks via
                      companionway stairs, shuts unlocked doors behind himself, and biases patrols
                      toward escape craft only after hearing repairs or visually spotting your work.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3.5">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="font-semibold text-slate-100">
                      Door-Peek Beam Reactions by Intelligence
                    </p>
                    <div className="mt-1.5 space-y-1 text-slate-400">
                      <p>
                        <span className="font-semibold text-slate-200">Low Intelligence:</span>{' '}
                        Ignores flashlight beams peeking through closed doors.
                      </p>
                      <p>
                        <span className="font-semibold text-amber-300">Medium Intelligence:</span>{' '}
                        Treats the door-peek beam as an environmental clue and stalks your doorway.
                      </p>
                      <p>
                        <span className="font-semibold text-red-400">High / Extreme:</span> Immediately
                        roars, charges straight through the door, smashes it open, and pursues you.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-3.5">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                  <div>
                    <p className="font-semibold text-slate-100">
                      Clue Memory &amp; Locker Sweeps
                    </p>
                    <p className="mt-0.5 text-slate-400">
                      Propped doors, cut padlocks, looted containers, and lights left ON trigger
                      Stalker Mode across adjacent rooms and methodical locker checks. Use{' '}
                      <span className="text-slate-200">Flares</span> as audio/light lures or{' '}
                      <span className="text-slate-200">CO2 Extinguishers</span> to blind him.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 5. CREDITS DOSSIER */}
            {activeDossier === 'CREDITS' && (
              <div className="space-y-4 text-xs leading-relaxed text-slate-300">
                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                    <Flame className="h-4 w-4" />
                    <span>Monstrum Fan Game :D — Build v{GAME_VERSION}</span>
                  </div>
                  <p>
                    A browser-native 2D top-down survival horror tribute inspired by{' '}
                    <span className="font-semibold text-slate-100">Team Junkfish&apos;s Monstrum</span>
                    , built around pure procedural ship generation, raycasted OLED darkness occlusion,
                    synthesized maritime Web Audio, and a non-cheating utility AI hunter.
                  </p>
                </div>

                <div className="rounded-md border border-slate-800 bg-slate-950/70 p-4 space-y-1.5 text-slate-400">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <ShieldAlert className="h-3.5 w-3.5 text-emerald-400" />
                    <span>v{GAME_VERSION} Highlights</span>
                  </div>
                  <p>• Monstrum-inspired security desk console with live green-phosphor CCTV feeds.</p>
                  <p>• Lit-room silent locker vent peeking with zero battery drain or Brute alerts.</p>
                  <p>• Battery-consuming door keyhole peeking with Low/Med/High Brute AI tiers.</p>
                  <p>• Expanded stair-peek radius, 1.0x–2.5x zoom range, and louder escape machinery.</p>
                </div>
              </div>
            )}
            </div>

            {activeDossier === 'SETUP' && (
              <div className="shrink-0 border-t border-slate-800 bg-[#080c12] px-5 py-3.5 sm:px-6">
                <button
                  type="button"
                  onClick={onStartGame}
                  className="w-full rounded-md bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 cursor-pointer"
                >
                  Start Game
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
