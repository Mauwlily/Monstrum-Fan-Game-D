import React, { useState } from 'react';
import { ArrowLeft, Sliders } from 'lucide-react';
import { GraphicsSettings } from '../game/graphicsSettings';
import { detectDifficultyPreset, DifficultyLevel, GAME_VERSION, GameViewMode, RunStats } from '../game/types';
import { GraphicsSettingsPanel } from './GraphicsSettingsPanel';

interface PauseModalProps {
  seed: number;
  viewMode: GameViewMode;
  graphicsSettings: GraphicsSettings;
  onChangeGraphicsSettings: (next: GraphicsSettings) => void;
  onResetGraphicsSettings: () => void;
  rendererBackend?: string;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  seed,
  viewMode,
  graphicsSettings,
  onChangeGraphicsSettings,
  onResetGraphicsSettings,
  rendererBackend,
  onResume,
  onRestart,
  onMainMenu,
}) => {
  const [showGraphics, setShowGraphics] = useState(false);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/82 px-4">
      <div
        className={`flex max-h-[90vh] w-full flex-col rounded-lg border border-slate-800 bg-[#0d1118] shadow-2xl ${
          showGraphics ? 'max-w-3xl' : 'max-w-sm p-6'
        }`}
      >
        {showGraphics ? (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 className="font-display text-xl font-bold text-slate-100">Graphics Settings</h2>
                <p className="mt-0.5 text-xs text-slate-400 font-mono-num">
                  Live Shader, Camera &amp; HDR1000 Tuning · Vessel Seed {seed}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGraphics(false)}
                className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              <GraphicsSettingsPanel
                settings={graphicsSettings}
                onChange={onChangeGraphicsSettings}
                onReset={onResetGraphicsSettings}
                rendererBackend={rendererBackend}
              />
            </div>
          </>
        ) : (
          <>
            <h2 className="font-display text-2xl font-bold text-slate-100">Game Paused</h2>
            <p className="mt-1 text-xs text-slate-400 font-mono-num">
              Vessel Seed: {seed} · {viewMode === 'FIRST_PERSON' ? 'First-Person' : 'Top-Down 3D'}
            </p>

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
                data-testid="pause-graphics-btn"
                onClick={() => setShowGraphics(true)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-amber-500/50 bg-[#121722] px-4 py-2.5 text-sm font-medium text-amber-200 transition-colors hover:border-amber-400 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sliders className="h-4 w-4" />
                <span>Graphics Settings</span>
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
          </>
        )}
      </div>
    </div>
  );
};

interface EndModalProps {
  outcome: 'VICTORY' | 'GAME_OVER';
  stats: RunStats;
  viewMode: GameViewMode;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDifficultyLabel(stats: RunStats): string {
  if (stats.customBruteTuning) return 'Dev Custom';
  const preset = detectDifficultyPreset(stats.difficulty);
  if (preset === 'MERCY') return 'Mercy';
  if (preset === 'STANDARD') return 'Standard';
  if (preset === 'NIGHTMARE') return 'Nightmare';
  if (preset === 'EXTREME') return 'Extreme';
  const short = (lvl: DifficultyLevel) =>
    lvl === 'EXTREME' ? 'Ext' : lvl === 'HIGH' ? 'Hi' : lvl === 'MEDIUM' ? 'Med' : 'Low';
  return `Int ${short(stats.difficulty.intelligence)} · Sen ${short(stats.difficulty.senses)} · Spd ${short(stats.difficulty.speed)}`;
}

export const EndModal: React.FC<EndModalProps> = ({
  outcome,
  stats,
  viewMode,
  onPlayAgain,
  onMainMenu,
}) => {
  const isVictory = outcome === 'VICTORY';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/84 px-4">
      <div className="w-full max-w-md rounded-lg border border-slate-800 bg-[#0d1118] p-7 shadow-2xl">
        <div className="text-xs font-medium text-slate-400">
          <span className="font-mono-num text-slate-300">v{GAME_VERSION}</span>
          <span aria-hidden="true"> · </span>
          <span>{viewMode === 'FIRST_PERSON' ? 'First-Person' : 'Top-Down'}</span>
          <span aria-hidden="true"> · </span>
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
                stats.escapeMethod === 'HELICOPTER'
                  ? 'Deck 3 stern helicopter'
                  : stats.escapeMethod === 'SUBMARINE'
                    ? 'Deck 1 moonpool submarine'
                    : 'Deck 2 bow lifeboat'
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
            <div className="text-slate-400">Parts Installed</div>
            <div className="mt-0.5 font-mono-num text-sm font-semibold text-slate-100">
              {stats.partsInstalled} / 9
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
