import { useEffect, useRef } from "react";

/*
  O chão do app: uma tela amarela viva, desenhada em canvas atrás de tudo.
  - retícula de pontos que cresce em diagonal e incha perto do dedo ou do mouse;
  - anéis segmentados girando devagar, com paralaxe na rolagem e no ponteiro;
  - estrelas soltas que fogem do ponteiro, e um estouro a cada toque;
  - ao trocar de área, uma faixa na cor dela varre a tela.
  Para quando a aba está oculta ou a câmera cobre a tela; com "reduzir movimento" vira um quadro parado.
*/

const GROUND = "#ffd80a";
const DEEP = "#f9bc00";
const INK = "#0b0b0c";

type Star = { x: number; y: number; r: number; spin: number; drift: number; ink: boolean; vx: number; vy: number };
type Burst = { x: number; y: number; t0: number };

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const d = i % 2 ? r * 0.32 : r;
    ctx.lineTo(Math.cos(a) * d, Math.sin(a) * d);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export default function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    const c2d = el?.getContext("2d", { alpha: false });
    if (!el || !c2d) return;
    const cv: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = c2d;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    let t = 0;
    let frame = 0;
    let scroll = window.scrollY;
    const ptr = { x: 0.72, y: 0.22, tx: 0.72, ty: 0.22, heat: 0 };
    const bursts: Burst[] = [];
    let area = document.body.dataset.area ?? "home";
    let areaColor = GROUND;
    let wipe: { t0: number; color: string } | null = null;
    let stars: Star[] = [];

    const readArea = () => {
      const c = getComputedStyle(document.body).getPropertyValue("--a").trim();
      areaColor = c || GROUND;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(16, Math.max(7, (w * h) / 90000)));
      stars = Array.from({ length: n }, (_, i) => ({
        x: ((i * 0.618034) % 1) * w,
        y: ((i * 0.381966 + 0.13) % 1) * h,
        r: 7 + ((i * 7) % 5) * 4,
        spin: (i % 2 ? 1 : -1) * (0.15 + (i % 4) * 0.08),
        drift: 6 + (i % 5) * 4,
        ink: i % 3 === 0,
        vx: 0,
        vy: 0,
      }));
      if (reduce.matches) draw(0);
    };

    function rings(cx: number, cy: number, R: number, dir: number) {
      const spec: [number, number, string, number, number][] = [
        [0.36, 0.05, "rgb(255 255 255 / 0.55)", 0.1, 0.11],
        [0.52, 0.11, DEEP, -0.06, 0.2],
        [0.92, 0.14, "rgb(255 236 110 / 0.9)", -0.03, 0.31],
        [1.18, 0.05, DEEP, 0.02, 0.16],
      ];
      for (const [k, lw, color, speed, dash] of spec) {
        const r = R * k;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * speed * dir);
        ctx.strokeStyle = color;
        ctx.lineWidth = R * lw;
        ctx.setLineDash([r * dash * 2.2, r * dash]);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function halftone(px: number, py: number) {
      const s = w < 640 ? 20 : 26;
      const ang = -0.42;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const span = Math.hypot(w, h) / 2 + s;
      const n = Math.ceil(span / s);
      ctx.fillStyle = DEEP;
      ctx.beginPath();
      for (let i = -n; i <= n; i++) {
        for (let j = -n; j <= n; j++) {
          const gx = i * s + (j % 2 ? s / 2 : 0);
          const gy = j * s * 0.87;
          const x = w / 2 + gx * cos - gy * sin;
          const y = h / 2 + gx * sin + gy * cos;
          if (x < -s || y < -s || x > w + s || y > h + s) continue;
          // cresce do canto de cima à direita para o de baixo à esquerda, com uma onda passando
          const grad = (1 - x / w) * 0.55 + (y / h) * 0.6 - 0.28;
          const wave = Math.sin(x * 0.006 + y * 0.009 - t * 0.7) * 0.16;
          const d = Math.hypot(x - px, y - py);
          const near = Math.exp(-(d * d) / 26000) * (0.5 + ptr.heat * 0.5);
          const k = Math.max(0, Math.min(1, grad + wave)) * 0.42 + near * 0.5;
          if (k < 0.05) continue;
          const r = s * Math.min(0.56, k);
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
    }

    function draw(dt: number) {
      ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 5);
      ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 5);
      ptr.heat = Math.max(0, ptr.heat - dt * 0.6);
      const px = ptr.x * w;
      const py = ptr.y * h;
      const ox = (ptr.x - 0.5) * 2;
      const oy = (ptr.y - 0.5) * 2;

      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(px, py, 0, px, py, Math.max(w, h) * 0.6);
      glow.addColorStop(0, "rgb(255 248 176 / 0.95)");
      glow.addColorStop(1, "rgb(255 248 176 / 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const R = Math.max(w, h) * 0.5;
      rings(w * 0.9 - ox * 26, h * 0.14 - oy * 20 - scroll * 0.12, R, 1);
      halftone(px, py);
      rings(w * 0.04 - ox * 14, h * 1.02 - oy * 12 - scroll * 0.05, R * 0.5, -1);

      for (const s of stars) {
        const dx = s.x - px;
        const dy = s.y - py;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 150) {
          const f = ((150 - d) / 150) * 520 * dt;
          s.vx += (dx / d) * f;
          s.vy += (dy / d) * f;
        }
        s.vx *= 1 - Math.min(1, dt * 2.4);
        s.vy *= 1 - Math.min(1, dt * 2.4);
        s.x += s.vx * dt;
        s.y += (s.vy - s.drift) * dt;
        if (s.y < -30) s.y = h + 30;
        if (s.x < -30) s.x = w + 30;
        if (s.x > w + 30) s.x = -30;
        ctx.fillStyle = s.ink ? INK : "#ffffff";
        star(ctx, s.x, s.y, s.r, t * s.spin);
      }

      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        const k = (t - b.t0) / 0.55;
        if (k >= 1) {
          bursts.splice(i, 1);
          continue;
        }
        const e = 1 - (1 - k) ** 3;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 9 * (1 - k);
        ctx.beginPath();
        ctx.arc(b.x, b.y, 16 + e * 90, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 5 * (1 - k);
        ctx.beginPath();
        for (let a = 0; a < 8; a++) {
          const ang = (a * Math.PI) / 4 + 0.3;
          ctx.moveTo(b.x + Math.cos(ang) * (40 + e * 80), b.y + Math.sin(ang) * (40 + e * 80));
          ctx.lineTo(b.x + Math.cos(ang) * (60 + e * 120), b.y + Math.sin(ang) * (60 + e * 120));
        }
        ctx.stroke();
      }

      if (wipe) {
        const k = (t - wipe.t0) / 0.6;
        if (k >= 1) wipe = null;
        else {
          const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
          const bw = w * 0.7;
          const x = -bw - h * 0.4 + e * (w + bw + h * 0.8);
          const band = (dx: number, width: number, color: string) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(x + dx + h * 0.4, 0);
            ctx.lineTo(x + dx + h * 0.4 + width, 0);
            ctx.lineTo(x + dx + width, h);
            ctx.lineTo(x + dx, h);
            ctx.closePath();
            ctx.fill();
          };
          band(0, bw, wipe.color === GROUND ? "#ffffff" : wipe.color);
          band(-28, 14, INK);
          band(bw + 14, 8, INK);
        }
      }
    }

    const tick = (now: number) => {
      raf = window.requestAnimationFrame(tick);
      frame++;
      // no celular, 30 quadros por segundo: o vidro por cima refaz o desfoque a cada quadro
      if (coarse && frame % 2) return;
      if (frame % 20 === 0 && document.querySelector(".cam")) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      t += dt;
      draw(dt);
    };
    const start = () => {
      window.cancelAnimationFrame(raf);
      last = 0;
      if (reduce.matches || document.hidden) draw(0);
      else raf = window.requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      ptr.tx = e.clientX / Math.max(1, w);
      ptr.ty = e.clientY / Math.max(1, h);
      ptr.heat = 1;
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      if (reduce.matches) return;
      bursts.push({ x: e.clientX, y: e.clientY, t0: t });
      if (bursts.length > 6) bursts.shift();
    };
    const onScroll = () => {
      scroll = window.scrollY;
    };
    const watch = new MutationObserver(() => {
      const next = document.body.dataset.area ?? "home";
      if (next === area) return;
      area = next;
      readArea();
      if (reduce.matches) draw(0);
      else wipe = { t0: t, color: areaColor };
    });

    readArea();
    resize();
    start();
    watch.observe(document.body, { attributes: true, attributeFilter: ["data-area"] });
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", start);
    reduce.addEventListener("change", start);
    return () => {
      window.cancelAnimationFrame(raf);
      watch.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", start);
      reduce.removeEventListener("change", start);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="backdrop" />;
}
