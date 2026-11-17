import React, { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, X } from 'lucide-react';
import { getDeckLabel, ROOM_CATEGORIES, SHIP_DECK_ORDER, ShipDeck, ShipMap } from '../game/types';

interface PaperMapModalProps {
  map: ShipMap;
  initialDeck: ShipDeck;
  standPos: { x: number; y: number; deck: ShipDeck };
  devModeUnlocked: boolean;
  onClose: () => void;
}

const DECK_SUBTITLES: Record<ShipDeck, string> = {
  DECK_3: 'Upper Superstructure & Stern Helideck',
  DECK_2: 'Main Transit Deck & Bow Lifeboat Davit',
  DECK_1: 'Lower Labyrinth & Moonpool Submarine Bay',
};

export const PaperMapModal: React.FC<PaperMapModalProps> = ({
  map,
  initialDeck,
  standPos,
  devModeUnlocked,
  onClose,
}) => {
  const [viewDeck, setViewDeck] = useState<ShipDeck>(initialDeck);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setViewDeck(devModeUnlocked ? initialDeck : standPos.deck);
  }, [devModeUnlocked, initialDeck, standPos.deck]);

  const effectiveDeck = devModeUnlocked ? viewDeck : standPos.deck;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bounds = map.deckBounds[effectiveDeck];
    const startY = Math.max(0, bounds.y1);
    const endY = Math.min(map.height - 1, bounds.y2);
    const deckTilesH = Math.max(1, endY - startY + 1);
    const deckTilesW = map.width;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const logicalW = 920;
    const logicalH = 340;
    canvas.width = Math.floor(logicalW * dpr);
    canvas.height = Math.floor(logicalH * dpr);

    ctx.save();
    ctx.scale(dpr, dpr);

    // Aged blueprint parchment-slate backdrop
    ctx.fillStyle = '#090f18';
    ctx.fillRect(0, 0, logicalW, logicalH);

    // Subtle nautical chart grid lines
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.28)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= logicalW; gx += 32) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, logicalH);
      ctx.stroke();
    }
    for (let gy = 0; gy <= logicalH; gy += 32) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(logicalW, gy);
      ctx.stroke();
    }

    const padX = 28;
    const padY = 26;
    const cellSize = Math.min(
      (logicalW - padX * 2) / deckTilesW,
      (logicalH - padY * 2) / deckTilesH
    );
    const offsetX = (logicalW - deckTilesW * cellSize) / 2;
    const offsetY = (logicalH - deckTilesH * cellSize) / 2;

    const toCanvasX = (tx: number) => offsetX + tx * cellSize;
    const toCanvasY = (ty: number) => offsetY + (ty - startY) * cellSize;

    // 1. Tile geometry pass
    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const tile = map.tiles[ty][tx];
        if (tile === 'VOID') continue;

        const cx = toCanvasX(tx);
        const cy = toCanvasY(ty);

        if (tile === 'WALL') {
          ctx.fillStyle = '#64748b';
        } else if (tile === 'EXTERIOR_DECK') {
          ctx.fillStyle = '#1e293b';
        } else if (tile === 'ESCAPE_HELI') {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        } else if (tile === 'ESCAPE_LIFEBOAT') {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
        } else if (tile === 'ESCAPE_SUBMARINE') {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        } else {
          const rName = map.roomGrid[ty][tx];
          ctx.fillStyle =
            rName === 'Corridor' || rName === 'Catwalk' ? '#172336' : '#131d2d';
        }
        ctx.fillRect(cx, cy, cellSize + 0.4, cellSize + 0.4);
      }
    }

    // 2. Doors on this deck
    for (const d of map.doors) {
      if (d.ty < startY || d.ty > endY) continue;
      const cx = toCanvasX(d.tx);
      const cy = toCanvasY(d.ty);
      ctx.fillStyle = d.isLocked ? '#f59e0b' : '#cbd5e1';
      if (d.orientation === 'H') {
        ctx.fillRect(cx + cellSize * 0.1, cy + cellSize * 0.35, cellSize * 0.8, Math.max(1.5, cellSize * 0.3));
      } else {
        ctx.fillRect(cx + cellSize * 0.35, cy + cellSize * 0.1, Math.max(1.5, cellSize * 0.3), cellSize * 0.8);
      }
    }

    // 3. Escape route annotations
    const ts = map.tileSize;
    ctx.font = 'bold 10px ui-monospace, SFMono-Regular, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (effectiveDeck === 'DECK_3') {
      const hx = toCanvasX(map.heliPos.x / ts);
      const hy = toCanvasY(map.heliPos.y / ts);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(hx, hy, cellSize * 1.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.fillText('H · HELICOPTER', hx, hy - cellSize * 2.6);
    } else if (effectiveDeck === 'DECK_2') {
      const bx = toCanvasX(map.lifeboatPos.x / ts);
      const by = toCanvasY(map.lifeboatPos.y / ts);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx - cellSize * 1.6, by - cellSize * 0.9, cellSize * 3.2, cellSize * 1.8);
      ctx.fillStyle = '#bae6fd';
      ctx.fillText('LIFEBOAT DAVIT', bx, by + cellSize * 2.1);
    } else if (effectiveDeck === 'DECK_1') {
      const sx = toCanvasX(map.submarinePos.x / ts);
      const sy = toCanvasY(map.submarinePos.y / ts);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(sx - cellSize * 2.2, sy - cellSize * 1.1, cellSize * 4.4, cellSize * 2.2);
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText('SUBMARINE BAY', sx, sy - cellSize * 2.2);
    }

    // 4. Deck 1 Steam Pipe markers
    if (effectiveDeck === 'DECK_1') {
      ctx.fillStyle = 'rgba(251, 146, 60, 0.85)';
      for (const pipe of map.steamPipes) {
        const px = toCanvasX(pipe.nozzleTx + 0.5);
        const py = toCanvasY(pipe.nozzleTy + 0.5);
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, cellSize * 0.35), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 5. Stairwells on this deck
    for (const st of map.stairwells) {
      if (st.deck !== effectiveDeck) continue;
      const sx = toCanvasX(st.tx + 0.5);
      const sy = toCanvasY(st.ty + 0.5);
      const r = Math.max(4, cellSize * 0.72);

      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = st.direction === 'UP' ? '#38bdf8' : '#fb923c';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.rect(sx - r, sy - r, r * 2, r * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = st.direction === 'UP' ? '#7dd3fc' : '#fdba74';
      ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(st.direction === 'UP' ? '▲' : '▼', sx, sy + 0.5);
    }

    // 6. Room labels (unique + major generic compartments)
    ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
    const drawnLabels: Array<{ x: number; y: number }> = [];
    for (const room of map.rooms) {
      if (room.deck !== effectiveDeck) continue;
      const cat = ROOM_CATEGORIES[room.name];
      if (cat === 'CIRCULATION') continue;
      const rw = room.x2 - room.x1 + 1;
      const rh = room.y2 - room.y1 + 1;
      if (rw < 4 || rh < 4) continue;
      if (room.name === 'Helideck' || room.name === 'Lifeboat Davit' || room.name === 'Submarine Bay') {
        continue;
      }

      const cx = toCanvasX((room.x1 + room.x2 + 1) / 2);
      const cy = toCanvasY((room.y1 + room.y2 + 1) / 2);
      const overlaps = drawnLabels.some((pt) => Math.abs(pt.x - cx) < 52 && Math.abs(pt.y - cy) < 13);
      if (overlaps) continue;
      drawnLabels.push({ x: cx, y: cy });

      ctx.fillStyle = cat === 'UNIQUE' ? 'rgba(226, 232, 240, 0.8)' : 'rgba(148, 163, 184, 0.64)';
      ctx.fillText(room.name, cx, cy);
    }

    // 7. Stationary Paper Map Stand icons on this deck
    for (const pm of map.paperMaps) {
      if (pm.deck !== effectiveDeck) continue;
      const mx = toCanvasX(pm.x / ts);
      const my = toCanvasY(pm.y / ts);
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.2;
      ctx.fillRect(mx - 4, my - 3, 8, 6);
      ctx.strokeRect(mx - 4, my - 3, 8, 6);
    }

    // 8. "YOU ARE HERE" fixed pin (only when inspecting the deck where this paper map stand sits)
    if (effectiveDeck === standPos.deck) {
      const yx = toCanvasX(standPos.x / ts);
      const yy = toCanvasY(standPos.y / ts);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(yx, yy, 9, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(yx - 13, yy);
      ctx.lineTo(yx - 5, yy);
      ctx.moveTo(yx + 5, yy);
      ctx.lineTo(yx + 13, yy);
      ctx.moveTo(yx, yy - 13);
      ctx.lineTo(yx, yy - 5);
      ctx.moveTo(yx, yy + 5);
      ctx.lineTo(yx, yy + 13);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(yx, yy, 3.6, 0, Math.PI * 2);
      ctx.fill();

      // Callout badge pinned to stand position
      const tagW = 94;
      const tagH = 18;
      const placeAbove = yy > 54;
      const tagX = Math.max(8, Math.min(logicalW - tagW - 8, yx - tagW / 2));
      const tagY = placeAbove ? yy - 34 : yy + 16;

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(yx, placeAbove ? yy - 10 : yy + 10);
      ctx.lineTo(yx, placeAbove ? tagY + tagH : tagY);
      ctx.stroke();

      ctx.fillStyle = '#991b1b';
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.2;
      ctx.fillRect(tagX, tagY, tagW, tagH);
      ctx.strokeRect(tagX, tagY, tagW, tagH);

      ctx.fillStyle = '#fef2f2';
      ctx.font = 'bold 9.5px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText('YOU ARE HERE', tagX + tagW / 2, tagY + tagH / 2 + 0.5);
    }

    ctx.restore();
  }, [effectiveDeck, map, standPos]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/78 px-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Vessel Deck Schematic"
    >
      <div className="w-full max-w-5xl rounded-lg border border-slate-700/90 bg-[#0b1017] p-5 sm:p-6 shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-sky-500/40 bg-sky-950/40 text-sky-300">
              <MapIcon className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-wide text-slate-50">
                {getDeckLabel(effectiveDeck)} Schematic
              </h2>
              <p className="text-xs text-slate-400">
                Fixed bulkhead paper map on {getDeckLabel(standPos.deck)}
                <span className="mx-2 text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-amber-300 font-medium">
                  Cannot be taken — ship remains live while reading
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close paper map"
            className="flex h-8 items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2.5 text-xs font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close [E / Esc]</span>
          </button>
        </div>

        {/* Deck Info Bar (Multi-deck switcher unlocked strictly in Dev Mode) */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {devModeUnlocked ? (
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-3 gap-1.5 rounded-md border border-slate-800 bg-slate-950 p-1">
                {SHIP_DECK_ORDER.map((deck) => {
                  const selected = effectiveDeck === deck;
                  const isStandHere = standPos.deck === deck;
                  return (
                    <button
                      key={deck}
                      type="button"
                      onClick={() => setViewDeck(deck)}
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selected
                          ? 'bg-slate-800 text-white border border-slate-600'
                          : 'text-slate-400 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      {getDeckLabel(deck)}
                      {isStandHere ? ' · Here' : ''}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs font-medium text-orange-400">Dev Mode · All Decks</span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              <span className="font-semibold text-slate-200">{getDeckLabel(effectiveDeck)} Only</span>
              <span className="mx-2 text-slate-600" aria-hidden="true">
                ·
              </span>
              <span>Find each deck’s fixed map stand for local layout</span>
            </div>
          )}

          <div className="text-xs text-slate-400">
            <span className="font-semibold text-slate-200">{getDeckLabel(effectiveDeck)}</span>
            <span className="mx-2 text-slate-600" aria-hidden="true">
              ·
            </span>
            <span>{DECK_SUBTITLES[effectiveDeck]}</span>
          </div>
        </div>

        {/* Schematic Canvas */}
        <div className="mt-3 overflow-hidden rounded-md border border-slate-800 bg-[#090f18]">
          <canvas
            ref={canvasRef}
            className="block w-full h-[260px] sm:h-[340px]"
            aria-label={`${getDeckLabel(effectiveDeck)} schematic layout`}
          />
        </div>

        {/* Legend Footer */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500 border border-red-300" />
              <span className="text-slate-200 font-medium">You Are Here (Map Stand)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 border border-sky-400 bg-slate-900" />
              <span>Stairs Up (▲)</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 border border-orange-400 bg-slate-900" />
              <span>Stairs Down (▼)</span>
            </span>
            {effectiveDeck === 'DECK_1' && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400/90" />
                <span>Steam Pipe Nozzle</span>
              </span>
            )}
          </div>
          <span className="text-slate-500">
            Stairwells offset across Deck 2 — transit Deck 2 to move between Deck 3 and Deck 1.
          </span>
        </div>
      </div>
    </div>
  );
};
