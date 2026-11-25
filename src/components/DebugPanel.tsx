import React from 'react';
import { Camera, Eye, Pause, Play, SkipForward, X } from 'lucide-react';
import { DEBUG_SCENARIOS } from '../game/debugScenarios';
import {
  DEFAULT_CAMERA_FOV_DEG,
  DEFAULT_CAMERA_PITCH_DEG,
  DEFAULT_CAMERA_YAW_DEG,
} from '../game/graphicsSettings';
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
  onFocusDoor: () => void;
  onFocusStair: (dir: 'UP' | 'DOWN') => void;
  onToggleNearestDoor: () => void;
  onCaptureScreenshot: () => void;
  onRefreshProbes: () => void;
}

const RENDER_MODES: Array<{ id: DebugOverlayConfig['renderMode']; label: string }> = [
  { id: 'NORMAL', label: 'Normal' },
  { id: 'FULLBRIGHT', label: 'Fullbright' },
  { id: 'LOS_ONLY', label: 'LoS Only' },
  { id: 'LOS_MASK', label: 'LoS Mask' },
  { id: 'LIGHT_MASK', label: 'Light Mask' },
];

export const DebugPanel: React.FC<DebugPanelProps> = ({
  config,
  telemetry,
  lastCaptureUrl,
  onClose,
  onLoadScenario,
  onUpdateConfig,
  onStepFrame,
  onFocusDoor,
  onFocusStair,
  onToggleNearestDoor,
  onCaptureScreenshot,
  onRefreshProbes,
}) => {
  return (
    <aside className="pointer-events-auto fixed top-0 right-0 bottom-0 z-30 flex w-80 flex-col border-l border-slate-800 bg-[#090d14]/96 text-slate-200">
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Live Vision &amp; 3D Debug</h2>
          <p className="text-[11px] text-slate-400">Free-cam · Shaders · Wireframe · F9</p>
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
        {/* 3D Camera & Render Mode Inspector */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">3D Visual Inspector</span>
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  renderMode: 'NORMAL',
                  cameraPitchDeg: DEFAULT_CAMERA_PITCH_DEG,
                  cameraYawDeg: DEFAULT_CAMERA_YAW_DEG,
                  cameraFovDeg: DEFAULT_CAMERA_FOV_DEG,
                  wireframeStructure: false,
                  hideWallCaps: false,
                  showStructureGizmos: false,
                  debugDeckOverride: 'AUTO',
                  freeCamEnabled: false,
                })
              }
              className="text-[10px] font-medium text-slate-400 hover:text-white cursor-pointer"
            >
              Reset View
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1">
            {RENDER_MODES.map((m) => {
              const active = config.renderMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onUpdateConfig({ renderMode: m.id })}
                  className={`rounded border px-1.5 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                    active
                      ? 'border-sky-500/80 bg-sky-500/15 text-sky-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-5 gap-1">
            <button
              type="button"
              onClick={() =>
                onUpdateConfig({
                  cameraPitchDeg: DEFAULT_CAMERA_PITCH_DEG,
                  cameraYawDeg: DEFAULT_CAMERA_YAW_DEG,
                  cameraFovDeg: DEFAULT_CAMERA_FOV_DEG,
                })
              }
              className={`rounded border px-1 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.cameraPitchDeg === DEFAULT_CAMERA_PITCH_DEG &&
                config.cameraYawDeg === DEFAULT_CAMERA_YAW_DEG
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              15°
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ cameraPitchDeg: 0, cameraYawDeg: 0 })}
              className={`rounded border px-1 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.cameraPitchDeg === 0 && config.cameraYawDeg === 0
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Top 0°
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ cameraPitchDeg: 38, cameraYawDeg: 25 })}
              className={`rounded border px-1 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.cameraPitchDeg === 38
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Iso 38°
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ cameraPitchDeg: 58, cameraYawDeg: -35 })}
              className={`rounded border px-1 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.cameraPitchDeg === 58
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Low 58°
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ freeCamEnabled: !config.freeCamEnabled })}
              title="Toggle WASD free-cam pan & right-drag 3D orbit"
              className={`rounded border px-1 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.freeCamEnabled
                  ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              FreeCam
            </button>
          </div>

          <div className="space-y-1.5 rounded border border-slate-800/90 bg-[#05070b] p-2 text-[10px]">
            <label className="flex items-center justify-between gap-2">
              <span className="w-12 text-slate-400">Pitch</span>
              <input
                type="range"
                min={0}
                max={80}
                step={1}
                value={config.cameraPitchDeg}
                onChange={(e) => onUpdateConfig({ cameraPitchDeg: Number(e.target.value) })}
                className="h-1 flex-1 accent-amber-400 cursor-pointer"
              />
              <span className="w-8 text-right font-mono-num text-slate-200">
                {Math.round(config.cameraPitchDeg)}°
              </span>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="w-12 text-slate-400">Yaw</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={config.cameraYawDeg}
                onChange={(e) => onUpdateConfig({ cameraYawDeg: Number(e.target.value) })}
                className="h-1 flex-1 accent-amber-400 cursor-pointer"
              />
              <span className="w-8 text-right font-mono-num text-slate-200">
                {Math.round(config.cameraYawDeg)}°
              </span>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="w-12 text-slate-400">FOV</span>
              <input
                type="range"
                min={25}
                max={90}
                step={1}
                value={config.cameraFovDeg}
                onChange={(e) => onUpdateConfig({ cameraFovDeg: Number(e.target.value) })}
                className="h-1 flex-1 accent-sky-400 cursor-pointer"
              />
              <span className="w-8 text-right font-mono-num text-slate-200">
                {Math.round(config.cameraFovDeg)}°
              </span>
            </label>
            {config.freeCamEnabled && (
              <label className="flex items-center justify-between gap-2">
                <span className="w-12 text-slate-400">Zoom</span>
                <input
                  type="range"
                  min={0.35}
                  max={4.0}
                  step={0.05}
                  value={config.freeCamZoom}
                  onChange={(e) => onUpdateConfig({ freeCamZoom: Number(e.target.value) })}
                  className="h-1 flex-1 accent-emerald-400 cursor-pointer"
                />
                <span className="w-8 text-right font-mono-num text-slate-200">
                  {config.freeCamZoom.toFixed(1)}x
                </span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => onUpdateConfig({ wireframeStructure: !config.wireframeStructure })}
              className={`rounded border px-1.5 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.wireframeStructure
                  ? 'border-fuchsia-500/70 bg-fuchsia-500/15 text-fuchsia-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Wireframe
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ hideWallCaps: !config.hideWallCaps })}
              className={`rounded border px-1.5 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.hideWallCaps
                  ? 'border-fuchsia-500/70 bg-fuchsia-500/15 text-fuchsia-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Hide Caps
            </button>
            <button
              type="button"
              onClick={() => onUpdateConfig({ showStructureGizmos: !config.showStructureGizmos })}
              className={`rounded border px-1.5 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                config.showStructureGizmos
                  ? 'border-cyan-500/70 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
              }`}
            >
              Gizmos
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ['AUTO', 'Auto'],
                ['DECK_3', 'D3'],
                ['DECK_2', 'D2'],
                ['DECK_1', 'D1'],
              ] as const
            ).map(([deckId, label]) => (
              <button
                key={deckId}
                type="button"
                onClick={() => onUpdateConfig({ debugDeckOverride: deckId })}
                className={`rounded border px-1.5 py-1 text-[10px] font-medium whitespace-nowrap cursor-pointer ${
                  config.debugDeckOverride === deckId
                    ? 'border-orange-500/70 bg-orange-500/15 text-orange-200'
                    : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={onFocusDoor}
              className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-slate-200 hover:border-slate-700 hover:text-white cursor-pointer"
            >
              Next Door
            </button>
            <button
              type="button"
              onClick={onToggleNearestDoor}
              className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-slate-200 hover:border-slate-700 hover:text-white cursor-pointer"
            >
              Toggle Door
            </button>
            <button
              type="button"
              onClick={() => onFocusStair('DOWN')}
              className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-sky-300 hover:border-sky-500/60 cursor-pointer"
            >
              Next Stair ↓
            </button>
            <button
              type="button"
              onClick={() => onFocusStair('UP')}
              className="rounded border border-slate-800 bg-slate-900/70 px-2 py-1 text-[10px] font-medium text-amber-300 hover:border-amber-500/60 cursor-pointer"
            >
              Next Stair ↑
            </button>
          </div>
        </section>

        <div className="border-t border-slate-800/80" />

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
