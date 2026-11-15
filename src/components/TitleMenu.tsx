import React from 'react';
import { Eye, Footprints, Lock, Volume2, VolumeX } from 'lucide-react';
import {
  detectDifficultyPreset,
  DIFFICULTY_PRESETS,
  DifficultyConfig,
  DifficultyLevel,
} from '../game/types';

interface TitleMenuProps {
  difficulty: DifficultyConfig;
  onSelectDifficulty: (d: DifficultyConfig) => void;
  seedInput: string;
  onSeedInputChange: (val: string) => void;
  muted: boolean;
  onToggleMute: () => void;
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

export const TitleMenu: React.FC<TitleMenuProps> = ({
  difficulty,
  onSelectDifficulty,
  seedInput,
  onSeedInputChange,
  muted,
  onToggleMute,
  onStartGame,
}) => {
  const activePreset = detectDifficultyPreset(difficulty);

  const updateAxis = (axis: keyof DifficultyConfig, val: DifficultyLevel) => {
    onSelectDifficulty({ ...difficulty, [axis]: val });
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-[#07090c] px-6 py-8 text-slate-100 overflow-y-auto">
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
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>Multi-Deck Cargo Vessel</span>
            <span aria-hidden="true">·</span>
            <span>Brute-Only Edition</span>
            <span aria-hidden="true">·</span>
            <span>2D Top-Down</span>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
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
            <span className="text-orange-400" aria-label="happy face">
              :D
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-300">
            Trapped aboard a pitch-black procedural cargo vessel spanning an open Main Weather Deck
            and a cramped Lower Hull linked by stairwells. Scavenge 3 parts for the{' '}
            <span className="font-medium text-sky-300">Lifeboat</span> or{' '}
            <span className="font-medium text-amber-300">Helicopter</span> while only the Brute
            hunts these decks.
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
                      Cross-Deck Pursuit &amp; Grate Acoustics
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                      Explores every deck freely, follows straight through stairwells if you slip
                      away near a hatch (~0.9s climb), and hears sprints or slammed doors bleeding
                      through engine grates.
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
              Sprint · C Toggle Sneak · Scroll Zoom · Hold Q Peek Doors &amp; Vents · E Interact
              (Sneak/Stop+E Silent · Walk/Run+E Slam) · F / Right-Click Flashlight · G / Click
              Tool · 1–5 Slots
            </div>
          </div>

          {/* Right: Expedition Configuration (3x3 Difficulty + Presets) */}
          <div className="md:col-span-6 flex flex-col justify-between rounded-lg border border-slate-800/90 bg-[#0d1118] p-6">
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-300">Brute Presets</span>
                  <span className="text-xs text-slate-400">
                    {activePreset === 'CUSTOM'
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
                  ).map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => onSelectDifficulty({ ...DIFFICULTY_PRESETS[preset.key] })}
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        activePreset === preset.key
                          ? preset.key === 'NIGHTMARE'
                            ? 'bg-orange-950/90 text-orange-200 border border-orange-700/50'
                            : 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
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
                          const selected = difficulty[axis.key] === lvl.value;
                          return (
                            <button
                              key={lvl.value}
                              type="button"
                              onClick={() => updateAxis(axis.key, lvl.value)}
                              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                selected
                                  ? lvl.value === 'HIGH'
                                    ? 'bg-orange-950/90 text-orange-200 border border-orange-700/50'
                                    : 'bg-slate-800 text-white'
                                  : 'text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {lvl.label}
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
      </div>
    </div>
  );
};
