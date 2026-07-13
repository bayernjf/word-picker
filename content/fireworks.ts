(() => {
  const FIREWORKS_CSS = `
    .fw-particle {
      position: fixed;
      left: 0;
      top: 0;
      width: 6px;
      height: 6px;
      margin-left: -3px;
      margin-top: -3px;
      border-radius: 50%;
      background: var(--color);
      box-shadow: 0 0 8px 2px var(--color);
      animation: fw-burst 900ms cubic-bezier(0.15, 0.6, 0.35, 1) forwards;
      pointer-events: none;
      will-change: transform, opacity;
    }

    @keyframes fw-burst {
      0% {
        opacity: 1;
        transform: translate(var(--sx), var(--sy)) scale(1);
      }
      70% {
        opacity: 1;
      }
      100% {
        opacity: 0;
        transform: translate(var(--ex), var(--ey)) scale(0.3);
      }
    }
  `;

  const FIREWORKS_PALETTE = ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89b4fa", "#cba6f7", "#f5c2e7"];

  let fireworksHost: HTMLDivElement | null = null;
  let fireworksShadow: ShadowRoot | null = null;
  let fireworksRafId: number | null = null;
  let fireworksCanvas: HTMLCanvasElement | null = null;

  function pickColor(): string {
    return FIREWORKS_PALETTE[Math.floor(Math.random() * FIREWORKS_PALETTE.length)];
  }

  function ensureFireworksHost(): ShadowRoot | null {
    if (fireworksShadow) {
      return fireworksShadow;
    }
    fireworksHost = document.createElement("div");
    fireworksHost.id = "word-picker-fireworks-host";
    fireworksHost.style.position = "fixed";
    fireworksHost.style.left = "0";
    fireworksHost.style.top = "0";
    fireworksHost.style.width = "100%";
    fireworksHost.style.height = "100%";
    fireworksHost.style.pointerEvents = "none";
    fireworksHost.style.zIndex = "2147483647";
    document.documentElement.appendChild(fireworksHost);
    fireworksShadow = fireworksHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.setAttribute("data-fw", "1");
    style.textContent = FIREWORKS_CSS;
    fireworksShadow.appendChild(style);
    return fireworksShadow;
  }

  function launchCssFireworks(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) {
      return;
    }

    const PARTICLE_COUNT = 56;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particle = document.createElement("span");
      particle.className = "fw-particle";
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.6;
      const distance = 60 + Math.random() * 80;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance + 30;
      const size = 5 + Math.random() * 5;
      particle.style.setProperty("--sx", `${x}px`);
      particle.style.setProperty("--sy", `${y}px`);
      particle.style.setProperty("--ex", `${x + dx}px`);
      particle.style.setProperty("--ey", `${y + dy}px`);
      particle.style.setProperty("--color", pickColor());
      particle.style.width = `${size}px`;
      particle.style.height = `${size}px`;
      particle.style.animationDuration = `${700 + Math.random() * 500}ms`;
      particle.addEventListener("animationend", () => particle.remove(), { once: true });
      frag.appendChild(particle);
    }
    shadow.appendChild(frag);
  }

  function launchCanvasFireworks(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow || fireworksCanvas) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.pointerEvents = "none";
    shadow.appendChild(canvas);
    fireworksCanvas = canvas;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      fireworksCanvas = null;
      return;
    }

    interface Particle {
      x: number; y: number; vx: number; vy: number;
      alpha: number; color: string; size: number;
    }
    const particles: Particle[] = [];
    const MAX_PARTICLES = 120;
    const GRAVITY = 0.12;
    const DRAG = 0.985;

    const spawnBurst = (cx: number, cy: number, count: number): void => {
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) {
          break;
        }
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 5;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          color: pickColor(),
          size: 2 + Math.random() * 2.5,
        });
      }
    };

    spawnBurst(x, y, 50);
    window.setTimeout(() => {
      if (fireworksCanvas === canvas) {
        spawnBurst(x + (Math.random() - 0.5) * 80, y + (Math.random() - 0.5) * 40, 50);
      }
    }, 220);

    const tick = (): void => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";

      let alive = 0;
      for (const p of particles) {
        if (p.alpha <= 0) {
          continue;
        }
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.012;
        if (p.alpha > 0) {
          alive++;
          ctx.globalAlpha = Math.max(0, p.alpha);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";

      if (alive === 0) {
        cancelAnimationFrame(fireworksRafId!);
        fireworksRafId = null;
        canvas.remove();
        if (fireworksCanvas === canvas) {
          fireworksCanvas = null;
        }
        return;
      }
      fireworksRafId = requestAnimationFrame(tick);
    };
    fireworksRafId = requestAnimationFrame(tick);
  }

  function clearFireworks(): void {
    if (fireworksRafId) {
      cancelAnimationFrame(fireworksRafId);
      fireworksRafId = null;
    }
    if (fireworksCanvas) {
      fireworksCanvas.remove();
      fireworksCanvas = null;
    }
    if (fireworksShadow) {
      fireworksShadow.querySelectorAll(".fw-particle").forEach((node) => node.remove());
    }
    if (fireworksHost) {
      fireworksHost.remove();
      fireworksHost = null;
      fireworksShadow = null;
    }
  }

  function launchFireworks(effectMode: string, x: number, y: number): void {
    if (effectMode === "none") {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (effectMode === "canvas") {
      launchCanvasFireworks(x, y);
      return;
    }
    launchCssFireworks(x, y);
  }

  const fwApi = {
    launchFireworks,
    clearFireworks,
  };
  (window as unknown as { __WordPickerFireworks: typeof fwApi }).__WordPickerFireworks = fwApi;
})();
