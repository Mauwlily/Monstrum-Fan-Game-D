import React, { useEffect, useRef } from 'react';

export type CrtFeedScene = 'CORRIDOR' | 'STAIRWELL' | 'CARGO' | 'ENGINE_BRUTE' | 'SUB_BAY';

interface CrtMonitorFeedProps {
  scene: CrtFeedScene;
  hovered?: boolean;
}

export const CrtMonitorFeed: React.FC<CrtMonitorFeedProps> = ({ scene, hovered = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let lastDraw = 0;

    const drawFeed = (timeMs: number) => {
      const t = reduceMotion ? 1.2 : timeMs * 0.001;
      const w = canvas.width;
      const h = canvas.height;

      // Dark P1 green-phosphor void base
      ctx.fillStyle = '#04120c';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      // Subtle CCTV camera pan + slight wide-angle distortion feel
      const panX = Math.sin(t * 0.38 + scene.length) * 6;
      const panY = Math.cos(t * 0.27 + scene.charCodeAt(0)) * 4;
      ctx.translate(w / 2 + panX, h / 2 + panY);
      ctx.rotate(-0.18);

      // Deck grid grating lines
      ctx.strokeStyle = hovered ? 'rgba(52, 211, 153, 0.14)' : 'rgba(52, 211, 153, 0.09)';
      ctx.lineWidth = 1;
      for (let gx = -160; gx <= 160; gx += 22) {
        ctx.beginPath();
        ctx.moveTo(gx, -120);
        ctx.lineTo(gx, 120);
        ctx.stroke();
      }
      for (let gy = -120; gy <= 120; gy += 22) {
        ctx.beginPath();
        ctx.moveTo(-160, gy);
        ctx.lineTo(160, gy);
        ctx.stroke();
      }

      if (scene === 'CORRIDOR') {
        // Corridor bulkheads + doorway spill + locker
        ctx.fillStyle = '#072419';
        ctx.fillRect(-130, -34, 260, 68);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-130, -34, 260, 68);

        // Side cross-passage
        ctx.fillStyle = '#061f15';
        ctx.fillRect(-26, -100, 52, 66);
        ctx.strokeRect(-26, -100, 52, 66);

        // Flickering overhead bulb pool
        const flicker = Math.sin(t * 9.5) > 0.85 ? 0.45 : 1;
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 74);
        grad.addColorStop(0, `rgba(110, 231, 183, ${0.32 * flicker})`);
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 74, 0, Math.PI * 2);
        ctx.fill();

        // Steel door silhouette
        ctx.fillStyle = '#134e37';
        ctx.fillRect(-24, -36, 48, 5);
      } else if (scene === 'STAIRWELL') {
        // Companionway landing + stair treads
        ctx.fillStyle = '#072419';
        ctx.fillRect(-90, -68, 180, 136);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.34)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-90, -68, 180, 136);

        // Stair hatch frame & rungs
        ctx.fillStyle = '#03120c';
        ctx.fillRect(-34, -24, 68, 48);
        ctx.strokeStyle = 'rgba(110, 231, 183, 0.48)';
        ctx.strokeRect(-34, -24, 68, 48);
        for (let sx = -26; sx <= 22; sx += 10) {
          ctx.fillStyle = 'rgba(74, 222, 128, 0.35)';
          ctx.fillRect(sx, -20, 4, 40);
        }

        // Gentle stairwell beacon glow
        const pulse = 0.65 + 0.35 * Math.sin(t * 2.4);
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, 62);
        grad.addColorStop(0, `rgba(110, 231, 183, ${0.26 * pulse})`);
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 62, 0, Math.PI * 2);
        ctx.fill();
      } else if (scene === 'CARGO') {
        // Storage hold crates, wall map desk, and lockers
        ctx.fillStyle = '#072217';
        ctx.fillRect(-120, -76, 240, 152);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-120, -76, 240, 152);

        const crates = [
          [-88, -48, 48, 34],
          [-88, 12, 38, 40],
          [36, -50, 52, 36],
          [44, 10, 44, 42],
        ];
        for (const [cx, cy, cw, ch] of crates) {
          ctx.fillStyle = '#0b3424';
          ctx.fillRect(cx, cy, cw, ch);
          ctx.strokeStyle = 'rgba(110, 231, 183, 0.36)';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(cx, cy, cw, ch);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + cw, cy + ch);
          ctx.stroke();
        }
      } else if (scene === 'ENGINE_BRUTE') {
        // Boiler bay with steam pipes + periodic Brute searchlight sweep!
        ctx.fillStyle = '#061e15';
        ctx.fillRect(-130, -74, 260, 148);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.28)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-130, -74, 260, 148);

        // Twin cylindrical boilers
        for (const bx of [-64, 62]) {
          ctx.fillStyle = '#0b3424';
          ctx.beginPath();
          ctx.arc(bx, -32, 20, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(110, 231, 183, 0.35)';
          ctx.stroke();
        }

        // Brute patrolling slowly across bottom corridor with sweeping cone
        const patrolX = Math.sin(t * 0.55) * 65;
        const aimAngle = Math.cos(t * 0.55) > 0 ? 0.12 : Math.PI - 0.12;
        const beamGrad = ctx.createRadialGradient(patrolX, 24, 4, patrolX, 24, 92);
        beamGrad.addColorStop(0, 'rgba(167, 243, 208, 0.42)');
        beamGrad.addColorStop(1, 'rgba(16, 185, 129, 0)');
        ctx.fillStyle = beamGrad;
        ctx.beginPath();
        ctx.moveTo(patrolX, 24);
        ctx.arc(patrolX, 24, 92, aimAngle - 0.48, aimAngle + 0.48);
        ctx.closePath();
        ctx.fill();

        // Brute shoulders silhouette
        ctx.fillStyle = '#185c42';
        ctx.beginPath();
        ctx.arc(patrolX, 24, 10, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // SUB_BAY (Moonpool dock for CREDITS monitor)
        ctx.fillStyle = '#061d14';
        ctx.fillRect(-116, -70, 232, 140);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-116, -70, 232, 140);

        // Moonpool water basin
        ctx.fillStyle = '#03150e';
        ctx.fillRect(-56, -34, 112, 68);
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
        ctx.strokeRect(-56, -34, 112, 68);

        // Submarine hull outline
        ctx.fillStyle = '#0e402d';
        ctx.beginPath();
        ctx.ellipse(0, 0, 38, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(167, 243, 208, 0.45)';
        ctx.stroke();
      }

      ctx.restore();

      // CRT radial phosphor vignette + faint scanbar
      const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.18, w / 2, h / 2, w * 0.72);
      vig.addColorStop(0, hovered ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.02)');
      vig.addColorStop(1, 'rgba(1, 7, 5, 0.78)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      if (!reduceMotion) {
        const barY = ((t * 36) % (h + 24)) - 12;
        const barGrad = ctx.createLinearGradient(0, barY - 10, 0, barY + 10);
        barGrad.addColorStop(0, 'rgba(110, 231, 183, 0)');
        barGrad.addColorStop(0.5, 'rgba(110, 231, 183, 0.07)');
        barGrad.addColorStop(1, 'rgba(110, 231, 183, 0)');
        ctx.fillStyle = barGrad;
        ctx.fillRect(0, barY - 10, w, 20);
      }
    };

    const tick = (now: number) => {
      if (now - lastDraw >= 42) {
        lastDraw = now;
        drawFeed(now);
      }
      if (!reduceMotion) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    drawFeed(performance.now());
    if (!reduceMotion) {
      rafId = window.requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [hovered, scene]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={176}
      aria-hidden="true"
      className="h-full w-full object-cover"
    />
  );
};
