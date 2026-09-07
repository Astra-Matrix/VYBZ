// Ambient backdrop: two slow aurora fields in the brand colors, a fine dot
// lattice that brightens and drifts toward the pointer, and a soft spotlight
// that follows it. One canvas, capped at 30 frames per second, paused when
// the tab is hidden, and rendered once as a still image when the visitor asks
// for reduced motion. Nothing here is interactive for screen readers.
import { useEffect, useRef } from "react";

const CYAN = [0, 194, 255] as const;
const VIOLET = [139, 124, 255] as const;
const MINT = [56, 232, 176] as const;

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0, h = 0, raf = 0, last = 0, running = true;
    const mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, active: false };
    const t0 = performance.now();

    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      // ease the pointer so the light trails rather than snaps
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;

      ctx.fillStyle = "#06080d";
      ctx.fillRect(0, 0, w, h);

      // aurora fields, drifting on slow sines
      const blobs = [
        { c: CYAN, x: 0.14 + Math.sin(t * 0.11) * 0.05, y: -0.08 + Math.cos(t * 0.09) * 0.06, r: 0.62, a: 0.17 },
        { c: VIOLET, x: 0.92 + Math.cos(t * 0.08) * 0.05, y: 0.12 + Math.sin(t * 0.1) * 0.06, r: 0.58, a: 0.15 },
        { c: MINT, x: 0.5 + Math.sin(t * 0.06) * 0.08, y: 1.1, r: 0.8, a: 0.06 },
      ];
      for (const b of blobs) {
        const g = ctx.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * Math.max(w, h));
        g.addColorStop(0, rgba(b.c, b.a));
        g.addColorStop(1, rgba(b.c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // pointer spotlight
      if (mouse.active) {
        const g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, Math.min(w, h) * 0.45);
        g.addColorStop(0, rgba(CYAN, 0.10));
        g.addColorStop(0.5, rgba(VIOLET, 0.04));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // dot lattice, fading with depth, brightening and leaning toward the pointer
      const step = 36;
      const reach = 220;
      const ox = (t * 4) % step;
      for (let y = -step; y < h + step; y += step) {
        const depth = 1 - Math.min(1, y / (h * 0.9)); // brighter near the top, like the original grid
        if (depth <= 0.02) break;
        for (let x = -step + ox; x < w + step; x += step) {
          const dx = x - mouse.x, dy = y - mouse.y;
          const d = Math.hypot(dx, dy);
          const near = mouse.active && d < reach ? 1 - d / reach : 0;
          const px = x - (near > 0 ? (dx / (d || 1)) * near * 10 : 0);
          const py = y - (near > 0 ? (dy / (d || 1)) * near * 10 : 0);
          const alpha = 0.05 * depth + near * 0.55;
          const size = 1 + near * 1.6;
          ctx.fillStyle = near > 0.15 ? rgba(CYAN, alpha) : `rgba(255,255,255,${alpha})`;
          ctx.fillRect(px, py, size, size);
        }
      }
    };

    const loop = (now: number) => {
      if (!running) return;
      if (now - last >= 33) { last = now; draw(now); }
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX; mouse.ty = e.clientY; mouse.active = true; };
    const onLeave = () => { mouse.active = false; mouse.tx = -1e4; mouse.ty = -1e4; };
    const onVisibility = () => {
      if (document.hidden) { running = false; cancelAnimationFrame(raf); }
      else if (!reduced) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduced) {
      draw(t0);
    } else {
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
      document.addEventListener("visibilitychange", onVisibility);
      raf = requestAnimationFrame(loop);
    }
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="vz-backdrop-canvas" aria-hidden />;
}
