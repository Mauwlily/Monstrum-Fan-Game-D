import React from 'react';
import { Camera, Eye, Pause, Play, SkipForward, X } from 'lucide-react';
import { DEBUG_SCENARIOS } from '../game/debugScenarios';
import { DebugOverlayConfig, DebugScenarioId } from '../game/types';

export interface ProbeReading {
  label: string;
  r: number;
  g: number;
  b: number;
  isPureBlack: boolean;
}

export interface DebugTelemetry {
  scenario: DebugScenarioId | null;
  playerX: number;
  playerY: number;
  hidingSpotId: string | null;
  peekingSpotId: string | null;
  peekingDoorId: string | null;
  peekingStairId: string | null;
  flashlightOn: boolean;
  battery: number;
  bruteState: string;
  bruteGoal: string;
  watchedHideSpotId: string | null;
  inspectSpotId: string | null;
  inspectTimer: number;
  bruteDistance: number;
  probes: ProbeReading[];
}

interface DebugPanelProps {
  config: DebugOverlayConfig;
  telemetry: DebugTelemetry;
  lastCaptureUrl: string | null;
  onClose: () => void;
  onLoadScenario: (id: DebugScenarioId) => void;
  onUpdateConfig: (patch: Partial<DebugOverlayConfig>) => void;
  onStepFrame: () => void;
  onCaptureScreenshot: () => void;
  onRefreshProbes: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({
  config,
  telemetry,
  lastCaptureUrl,
  onClose,
  onLoadScenario,
  onUpdateConfig,
  onStepFrame,
  onCaptureScreenshot,
  onRefreshProbes,
}) => {
  return (
    <aside className="pointer-events-auto fixed top-0 right-0 bottom-0 z-30 flex w-80 flex-col border-l border-slate-800 bg-[#090d14]/95 text-slate-200 backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Live Vision & AI Debug</h2>
          <p className="text-[11px] text-slate-400">Dummy scenarios · Pixel probe · F9</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close debug panel"
          className="flex h-8 w-8 items-center justify-center rounded border border-slate-800 text-slate-400 transition-colors hover:border-slate-700 hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
        {/* Dummy Player Scenarios */}
        <section className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">Dummy Player Scenarios</div>
          <div className="grid grid-cols-2 gap-1.5">
            {DEBUG_SCENARIOS.map((sc) => {
              const active = telemetry.scenario === sc.id;
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => onLoadScenario(sc.id)}
                  title={sc.summary}
                  className={`rounded border px-2.5 py-2 text-left text-[11px] font-medium whitespace-nowrap truncate transition-colors cursor-pointer ${
                    active
                      ? 'border-orange-500/80 bg-orange-500/15 text-orange-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  {sc.label}
                </button>
              );
            })}
          </div>
          {telemetry.scenario && (
            <p className="text-[11px] leading-relaxed text-slate-400">
              {DEBUG_SCENARIOS.find((s) => s.id === telemetry.scenario)?.summary}
            </p>
          )}
        </section>

        <div className="border-t border-slate-800/80" />

        {/* Simulation & Peek Controls */}
        <section className="space-y-2">
          <div className="text-[11px] font-semibold text-slate-400">Simulation Controls</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onUpdateConfig({ freezeAi: !config.freezeAi })}
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                config.freezeAi
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              {config.freezeAi ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
              <span>{config.freezeAi ? 'Resume AI' : 'Freeze AI'}</span>
            </button>
            <button
              type="button"
              onClick={onStepFrame}
              className="flex items-center gap-1.5 rounded border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 hover:border-slate-700 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
            >
              <SkipForward className="h-3 w-3" />
              <span>Step 50ms</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => onUpdateConfig({ forceVentPeek: !config.forceVentPeek })}
              className={`rounded border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                config.forceVentPeek
                  ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              {config.forceVentPeek ? 'Vent Peek: ON' : 'Vent Peek: OFF'}
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ forceDoorPeek: !config.forceDoorPeek })}
              className={`rounded border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                config.forceDoorPeek
                  ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              {config.forceDoorPeek ? 'Door Peek: ON' : 'Door Peek: OFF'}
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ forceStairPeek: !config.forceStairPeek })}
              className={`col-span-2 rounded border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                config.forceStairPeek
                  ? 'border-sky-500/70 bg-sky-500/15 text-sky-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              {config.forceStairPeek ? 'Stair Peek Portal: ON' : 'Stair Peek Portal: OFF'}
            </button>
          </div>
        </section>

        <div className="border-t border-slate-800/80" />

        {/* Canvas Vision Overlays */}
        <section className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <Eye className="h-3.5 w-3.5" />
            <span>Vision Overlays</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {(
              [
                ['showPlayerLos', 'Player LoS'],
                ['showBruteFov', 'Brute FoV'],
                ['showWallSegments', 'Wall Segments'],
                ['showBlackProbes', 'Black Probes'],
              ] as const
            ).map(([key, label]) => {
              const active = config[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onUpdateConfig({ [key]: !active })}
                  className={`rounded border px-2.5 py-1.5 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        <div className="border-t border-slate-800/80" />

        {/* Live State & Behind-Wall OLED Black Probe */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">Live Telemetry</span>
            <button
              type="button"
              onClick={onRefreshProbes}
              className="text-[11px] font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sample Pixels
            </button>
          </div>

          <div className="space-y-1 rounded border border-slate-800 bg-[#05070b] p-2.5 font-mono-num text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Player Pos</span>
              <span>
                {Math.round(telemetry.playerX)}, {Math.round(telemetry.playerY)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Flashlight</span>
              <span className={telemetry.flashlightOn ? 'text-amber-300' : 'text-slate-400'}>
                {telemetry.flashlightOn ? 'ON' : 'OFF'} · {Math.round(telemetry.battery)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Hiding / Peek</span>
              <span>
                {telemetry.hidingSpotId ?? 'None'} ·{' '}
                {telemetry.peekingSpotId
                  ? 'Vent'
                  : telemetry.peekingStairId
                    ? 'Stairs'
                    : telemetry.peekingDoorId
                      ? 'Door'
                      : 'None'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Brute State</span>
              <span className="text-orange-300">
                {telemetry.bruteState} ({telemetry.bruteGoal})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Watched Hide</span>
              <span>{telemetry.watchedHideSpotId ?? 'None'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Inspect Spot</span>
              <span>
                {telemetry.inspectSpotId ?? 'None'} ({telemetry.inspectTimer.toFixed(2)}s)
              </span>
            </div>
          </div>

          {telemetry.probes.length > 0 && (
            <div className="space-y-1 rounded border border-slate-800 bg-[#05070b] p-2.5 font-mono-num text-[11px]">
              <div className="text-[10px] font-semibold text-slate-400">Behind-Wall Pixel Probe</div>
              {telemetry.probes.map((pr) => (
                <div key={pr.label} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-300">{pr.label}</span>
                  <span className={pr.isPureBlack ? 'text-emerald-400' : 'text-rose-400'}>
                    rgb({pr.r},{pr.g},{pr.b}) · {pr.isPureBlack ? '#000000' : 'LEAK'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="border-t border-slate-800/80" />

        {/* Screenshot Capture */}
        <section className="space-y-2">
          <button
            type="button"
            onClick={onCaptureScreenshot}
            className="flex w-full items-center justify-center gap-2 rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-white transition-colors hover:border-orange-500/70 hover:bg-slate-700 whitespace-nowrap cursor-pointer"
          >
            <Camera className="h-3.5 w-3.5" />
            <span>Capture Screenshot PNG</span>
          </button>

          {lastCaptureUrl && (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-400">Latest Capture Preview</div>
              <img
                src={lastCaptureUrl}
                alt="Captured live game vision debug frame"
                className="w-full rounded border border-slate-800 bg-black object-contain"
              />
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
