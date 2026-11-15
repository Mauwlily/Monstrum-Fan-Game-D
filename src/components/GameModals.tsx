import React from 'react';
import { detectDifficultyPreset, RunStats } from '../game/types';

interface PauseModalProps {
  seed: number;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  seed,
  onResume,
  onRestart,
  onMainMenu,
}) => {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-lg border border-slate-800 bg-[#0d1118] p-6 shadow-2xl">
        <h2 className="font-display text-2xl font-bold text-slate-100">Game Paused</h2>
        <p className="mt-1 text-xs text-slate-400 font-mono-num">Vessel Seed: {seed}</p>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onResume}
            className="w-full rounded-md bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Resume
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Restart Ship
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="w-full rounded-md border border-slate-800 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:text-slate-200 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
};

interface EndModalProps {
  outcome: 'VICTORY' | 'GAME_OVER';
  stats: RunStats;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDifficultyLabel(stats: RunStats): string {
  const preset = detectDifficultyPreset(stats.difficulty);
  if (preset === 'MERCY') return 'Mercy';
  if (preset === 'STANDARD') return 'Standard';
  if (preset === 'NIGHTMARE') return 'Nightmare';
  const short = (lvl: 'LOW' | 'MEDIUM' | 'HIGH') =>
    lvl === 'HIGH' ? 'Hi' : lvl === 'MEDIUM' ? 'Med' : 'Low';
  return `Int ${short(stats.difficulty.intelligence)} · Sen ${short(stats.difficulty.senses)} · Spd ${short(stats.difficulty.speed)}`;
}

export const EndModal: React.FC<EndModalProps> = ({
  outcome,
  stats,
  onPlayAgain,
  onMainMenu,
}) => {
  const isVictory = outcome === 'VICTORY';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/82 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#0d1118] p-7 shadow-2xl">
        <div className="text-xs font-medium text-slate-400">
          {isVictory ? 'Vessel Escaped' : 'Killed Aboard Ship'}
          <span aria-hidden="true"> · </span>
          <span>{formatDifficultyLabel(stats)}</span>
          <span aria-hidden="true"> · </span>
          <span className="font-mono-num">Seed {stats.seed}</span>
        </div>

        <h2
          className={`mt-2 font-display text-4xl font-bold tracking-tight ${
            isVictory ? 'text-emerald-400' : 'text-orange-500'
          }`}
        >
          {isVictory ? 'You Escaped Alive :D' : 'Caught by the Brute'}
        </h2>

        <p className="mt-2 text-sm text-slate-300">
          {isVictory
            ? `Successfully launched the ${
                stats.escapeMethod === 'HELICOPTER' ? 'stern helicopter' : 'port lifeboat'
              } into the dark sea.`
            : stats.deathReason ?? 'The Brute tore through your cover.'}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-y-3 gap-x-6 border-t border-b border-slate-800/80 py-4 text-xs">
          <div>
            <div className="text-slate-400">Time Survived</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {formatDuration(stats.elapsedSeconds)}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Escape Parts Found</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.partsInstalled} / 6
            </div>
          </div>
          <div>
            <div className="text-slate-400">Brute Sightings</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.bruteSightings}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Clues Spotted</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.cluesSpotted}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Lockers Swept</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.hidingSpotsCheckedByBrute}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Containers Searched</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.containersSearched}
            </div>
          </div>
          <div>
            <div className="text-slate-400">Doors Smashed</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.doorsSmashed}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 rounded-md bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-500 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Play Again
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="rounded-md border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Main Menu
          </button>
        </div>
      </div>
    </div>
  );
};
