import React, { useState } from 'react';
import { Eye, Footprints, Lock, RotateCcw, Sliders, Volume2, VolumeX } from 'lucide-react';
import {
  BruteTuningNumbers,
  detectDifficultyPreset,
  DIFFICULTY_PRESETS,
  DifficultyConfig,
  DifficultyLevel,
  GAME_VERSION,
} from '../game/types';

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
    hint: 'Clue memory depth, room locker sweep coverage & chase trail prediction',
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
  const [consecutiveSmileyClicks, setConsecutiveSmileyClicks] = useState(0);
  const [nightmareStreak, setNightmareStreak] = useState(0);
  const [highStreaks, setHighStreaks] = useState<Record<keyof DifficultyConfig, number>>({
    intelligence: 0,
    senses: 0,
    speed: 0,
  });
  const activePreset = detectDifficultyPreset(difficulty);

  const resetAllStreaks = () => {
    setConsecutiveSmileyClicks(0);
    setNightmareStreak(0);
    setHighStreaks({ intelligence: 0, senses: 0, speed: 0 });
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

  const renderFieldGroup = (title: string, fields: TuningField[]) => (
    <div className="rounded-md border border-slate-800/80 bg-slate-950/70 p-3.5">
      <div className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
        {title}
      </div>
      <div className="space-y-2">
        {fields.map((field) => (
          <div key={field.key} className="flex items-center justify-between gap-3">
            <label
              htmlFor={`dev-${field.key}`}
              className="text-[11px] text-slate-400 truncate"
            >
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
              className="w-20 shrink-0 rounded border border-slate-800 bg-[#070a0f] px-2 py-1 text-right text-xs text-orange-200 font-mono-num focus:border-orange-500 focus:outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div
      onClick={resetAllStreaks}
      className="relative flex min-h-screen w-full items-center justify-center bg-[#07090c] px-6 py-8 text-slate-100 overflow-y-auto"
    >
      {/* Subtle atmospheric radial depth */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at 72% 28%, rgba(234, 88, 12, 0.08), transparent 45%), radial-gradient(circle at 20% 80%, rgba(14, 116, 144, 0.08), transparent 50%)',
        }}
      />

      <div className="relative z-10 w-full max-w-4xl">
        {/* Top bar */}
        <div className="mb-8 flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span className="font-mono-num font-semibold text-slate-200">v{GAME_VERSION}</span>
            <span aria-hidden="true">·</span>
            <span>Multi-Deck Cargo Vessel</span>
            <span aria-hidden="true">·</span>
            <span>Brute-Only Edition</span>
            <span aria-hidden="true">·</span>
            <span>2D Top-Down</span>
            {devModeUnlocked && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-orange-400">Dev Mode Active</span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute();
            }}
            className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>{muted ? 'Audio Muted' : 'Audio On'}</span>
          </button>
        </div>

        {/* Hero Title */}
        <div className="mb-8">
          <h1 className="font-display text-5xl font-bold tracking-tight text-slate-50 sm:text-6xl text-balance">
            Monstrum Fan Game{' '}
            <span
              onClick={(e) => {
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
              }}
              className="text-orange-400 select-none cursor-default"
              aria-label="happy face"
            >
              :D
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">
            Trapped aboard a pitch-black procedural cargo vessel spanning an open Main Weather Deck
            and a cramped Lower Hull linked by stairwells. Hauling parts inside a tight 4-slot pack
            (expandable via the Crew Backpack), repair the{' '}
            <span className="font-medium text-sky-300">Bow Lifeboat</span> or{' '}
            <span className="font-medium text-amber-300">Stern Helicopter</span> while the Brute
            patrols both routes.
          </p>
        </div>

        {/* Two-column setup & rules */}
        <div className="grid gap-8 md:grid-cols-12 items-stretch">
          {/* Left: Brute Rebalance Rules */}
          <div className="md:col-span-6 flex flex-col justify-between rounded-lg border border-slate-800/90 bg-[#0d1118] p-6">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-wide text-slate-100">
                Brute Behavior Changes
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                No rubber-banding director. Pure organic terror once he finds you.
              </p>

              <div className="mt-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      Cross-Deck Pursuit &amp; Escape Patrol Bias
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                      Explores every deck freely, favors checking escape craft once he spots your
                      repairs, follows through stairwells (~0.9s climb), and hears noisy installs
                      or crane/turbine spin-ups.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      Closes Doors Behind &amp; Spots Clues
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                      Shuts unlocked doors behind himself as he patrols, while propped doors,
                      looted crates, or lit rooms trigger Stalker Mode across nearby compartments.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-200">
                      Thorough Locker Sweeps &amp; Blind Hiding
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                      Methodically clears every unchecked hiding spot inside suspect rooms; hiding
                      limits vision to your locker until you risk holding Q to peek the vents.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-800/80 pt-4 text-xs text-slate-400 leading-relaxed">
              <span className="font-semibold text-slate-300">Controls:</span> WASD Move · Shift
              Sprint · C Sneak · Hold Q Peek Doors, Stairs &amp; Vents · E / Hold E Interact &amp;
              Repair · F / Right-Click Flashlight · Left-Click Use Tool · G Drop · J Journal · F11
              Fullscreen
            </div>
          </div>

          {/* Right: Expedition Configuration (3x3 Difficulty + Presets) */}
          <div className="md:col-span-6 flex flex-col justify-between rounded-lg border border-slate-800/90 bg-[#0d1118] p-6">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
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
                <div className="grid grid-cols-3 gap-1.5 rounded-md bg-slate-950 p-1 border border-slate-800">
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
                              ? 'bg-red-950/90 text-red-200 border border-red-700/60'
                              : preset.key === 'NIGHTMARE'
                                ? 'bg-orange-950/90 text-orange-200 border border-orange-700/50'
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

              {/* 3x3 Granular Difficulty Matrix */}
              <div className="space-y-3 border-t border-slate-800/80 pt-4">
                {AXES.map((axis) => (
                  <div key={axis.key}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
                        {axis.label}
                      </span>
                      <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-950 p-1 border border-slate-800 w-52 shrink-0">
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
                                    ? 'bg-red-950/90 text-red-200 border border-red-700/60'
                                    : lvl.value === 'HIGH'
                                      ? 'bg-orange-950/90 text-orange-200 border border-orange-700/50'
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

              <div>
                <label
                  htmlFor="ship-seed"
                  className="block text-xs font-medium text-slate-300 mb-2"
                >
                  Ship Seed (Optional)
                </label>
                <input
                  id="ship-seed"
                  type="text"
                  inputMode="numeric"
                  placeholder="Random vessel layout"
                  value={seedInput}
                  onChange={(e) => onSeedInputChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
                  className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-600 font-mono-num focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={onStartGame}
                className="w-full rounded-md bg-orange-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-orange-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Start Game
              </button>
            </div>
          </div>
        </div>

        {/* Secret Dev Mode Panel: Internal Brute Numbers */}
        {devModeUnlocked && (
          <div className="mt-6 rounded-lg border border-orange-500/40 bg-[#0d1118] p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2.5">
                <Sliders className="h-4 w-4 text-orange-400" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Dev Mode: Internal Brute Numbers
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Direct simulation parameters for Speed, Senses, and Intelligence. In-game Debug
                    panel is also unlocked.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onResetBruteTuning}
                className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset to Preset</span>
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {renderFieldGroup('Speed', SPEED_FIELDS)}
              {renderFieldGroup('Senses', SENSES_FIELDS)}
              {renderFieldGroup('Intelligence', INTEL_FIELDS)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
