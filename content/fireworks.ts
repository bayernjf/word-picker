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

    .fw-confetti {
      position: fixed;
      left: 0;
      top: 0;
      width: 8px;
      height: 12px;
      margin-left: -4px;
      margin-top: -6px;
      background: var(--color);
      animation: fw-confetti-fall 1200ms cubic-bezier(0.15, 0.6, 0.35, 1) forwards;
      pointer-events: none;
      will-change: transform, opacity;
    }

    @keyframes fw-confetti-fall {
      0% {
        opacity: 1;
        transform: translate(var(--sx), var(--sy)) rotate(0deg);
      }
      100% {
        opacity: 0;
        transform: translate(var(--ex), var(--ey)) rotate(var(--rot));
      }
    }

    .fw-sparkle {
      position: fixed;
      left: 0;
      top: 0;
      width: 10px;
      height: 10px;
      margin-left: -5px;
      margin-top: -5px;
      background: var(--color);
      clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
      animation: fw-sparkle-pop 800ms ease-out forwards;
      pointer-events: none;
      will-change: transform, opacity;
    }

    @keyframes fw-sparkle-pop {
      0% {
        opacity: 1;
        transform: translate(var(--sx), var(--sy)) scale(0) rotate(0deg);
      }
      50% {
        opacity: 1;
        transform: translate(var(--mx), var(--my)) scale(1.5) rotate(90deg);
      }
      100% {
        opacity: 0;
        transform: translate(var(--ex), var(--ey)) scale(0.3) rotate(180deg);
      }
    }

    .fw-ripple {
      position: fixed;
      left: var(--cx);
      top: var(--cy);
      width: 0;
      height: 0;
      border-radius: 50%;
      border: 3px solid var(--color);
      transform: translate(-50%, -50%);
      animation: fw-ripple-expand var(--duration) ease-out forwards;
      pointer-events: none;
      will-change: width, height, opacity;
    }

    @keyframes fw-ripple-expand {
      0% {
        width: 0;
        height: 0;
        opacity: 1;
        border-width: 3px;
      }
      100% {
        width: var(--size);
        height: var(--size);
        opacity: 0;
        border-width: 1px;
      }
    }

    .fw-emoji {
      position: fixed;
      left: 0;
      top: 0;
      font-size: 24px;
      line-height: 1;
      animation: fw-emoji-float 1200ms ease-out forwards;
      pointer-events: none;
      will-change: transform, opacity;
    }

    @keyframes fw-emoji-float {
      0% {
        opacity: 1;
        transform: translate(var(--sx), var(--sy)) scale(0.5);
      }
      50% {
        opacity: 1;
        transform: translate(var(--mx), var(--my)) scale(1.2);
      }
      100% {
        opacity: 0;
        transform: translate(var(--ex), var(--ey)) scale(0.6);
      }
    }

    .fw-heart {
      position: fixed;
      left: 0;
      top: 0;
      font-size: 20px;
      line-height: 1;
      animation: fw-heart-rise 1100ms ease-out forwards;
      pointer-events: none;
      will-change: transform, opacity;
    }

    @keyframes fw-heart-rise {
      0% {
        opacity: 1;
        transform: translate(var(--sx), var(--sy)) scale(0.5);
      }
      50% {
        opacity: 1;
        transform: translate(var(--mx), var(--my)) scale(1.3);
      }
      100% {
        opacity: 0;
        transform: translate(var(--ex), var(--ey)) scale(0.4);
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
      fireworksShadow.querySelectorAll(".fw-particle, .fw-confetti, .fw-sparkle, .fw-ripple, .fw-emoji, .fw-heart").forEach((node) => node.remove());
    }
    if (fireworksHost) {
      fireworksHost.remove();
      fireworksHost = null;
      fireworksShadow = null;
    }
  }

  function launchConfetti(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) return;

    const COUNT = 40;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement("span");
      el.className = "fw-confetti";
      const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.8;
      const distance = 50 + Math.random() * 120;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance + 60 + Math.random() * 40;
      const rot = (Math.random() * 720 - 360).toFixed(0);
      el.style.setProperty("--sx", `${x}px`);
      el.style.setProperty("--sy", `${y}px`);
      el.style.setProperty("--ex", `${x + dx}px`);
      el.style.setProperty("--ey", `${y + dy}px`);
      el.style.setProperty("--rot", `${rot}deg`);
      el.style.setProperty("--color", pickColor());
      el.style.animationDuration = `${900 + Math.random() * 600}ms`;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      frag.appendChild(el);
    }
    shadow.appendChild(frag);
  }

  function launchSparkle(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) return;

    const COUNT = 24;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement("span");
      el.className = "fw-sparkle";
      const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.5;
      const dist = 30 + Math.random() * 60;
      const midDist = dist * 0.6;
      const endDist = dist * 1.2;
      el.style.setProperty("--sx", `${x}px`);
      el.style.setProperty("--sy", `${y}px`);
      el.style.setProperty("--mx", `${x + Math.cos(angle) * midDist}px`);
      el.style.setProperty("--my", `${y + Math.sin(angle) * midDist}px`);
      el.style.setProperty("--ex", `${x + Math.cos(angle) * endDist}px`);
      el.style.setProperty("--ey", `${y + Math.sin(angle) * endDist}px`);
      el.style.setProperty("--color", pickColor());
      el.style.animationDuration = `${600 + Math.random() * 400}ms`;
      el.style.animationDelay = `${Math.random() * 150}ms`;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      frag.appendChild(el);
    }
    shadow.appendChild(frag);
  }

  function launchRipple(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) return;

    const RING_COUNT = 4;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < RING_COUNT; i++) {
      const el = document.createElement("span");
      el.className = "fw-ripple";
      const size = 80 + i * 60;
      el.style.setProperty("--cx", `${x}px`);
      el.style.setProperty("--cy", `${y}px`);
      el.style.setProperty("--size", `${size}px`);
      el.style.setProperty("--color", pickColor());
      el.style.setProperty("--duration", `${600 + i * 200}ms`);
      el.style.animationDelay = `${i * 120}ms`;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      frag.appendChild(el);
    }
    shadow.appendChild(frag);
  }

  function launchEmoji(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) return;

    const EMOJIS = ["\u{1F389}", "\u{1F31F}", "\u{2728}", "\u{1F4AB}", "\u{1F388}", "\u{1F49E}", "\u{1F38A}"];
    const COUNT = 16;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement("span");
      el.className = "fw-emoji";
      el.textContent = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      const angle = (Math.PI * 2 * i) / COUNT + (Math.random() - 0.5) * 0.6;
      const dist = 40 + Math.random() * 80;
      const midDist = dist * 0.5;
      const endDist = dist * 1.3;
      el.style.setProperty("--sx", `${x}px`);
      el.style.setProperty("--sy", `${y}px`);
      el.style.setProperty("--mx", `${x + Math.cos(angle) * midDist}px`);
      el.style.setProperty("--my", `${y + Math.sin(angle) * midDist - 30}px`);
      el.style.setProperty("--ex", `${x + Math.cos(angle) * endDist}px`);
      el.style.setProperty("--ey", `${y + Math.sin(angle) * endDist + 20}px`);
      el.style.animationDuration = `${900 + Math.random() * 500}ms`;
      el.style.animationDelay = `${Math.random() * 200}ms`;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      frag.appendChild(el);
    }
    shadow.appendChild(frag);
  }

  function launchHearts(x: number, y: number): void {
    const shadow = ensureFireworksHost();
    if (!shadow) return;

    const HEARTS = ["\u{2764}\u{FE0F}", "\u{1F496}", "\u{1F497}", "\u{1F498}", "\u{1F49D}", "\u{1F496}"];
    const COUNT = 14;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const el = document.createElement("span");
      el.className = "fw-heart";
      el.textContent = HEARTS[Math.floor(Math.random() * HEARTS.length)];
      const dist = 50 + Math.random() * 80;
      const drift = (Math.random() - 0.5) * 60;
      el.style.setProperty("--sx", `${x}px`);
      el.style.setProperty("--sy", `${y}px`);
      el.style.setProperty("--mx", `${x + drift}px`);
      el.style.setProperty("--my", `${y - dist * 0.5}px`);
      el.style.setProperty("--ex", `${x + drift * 1.5}px`);
      el.style.setProperty("--ey", `${y - dist}px`);
      el.style.animationDuration = `${800 + Math.random() * 500}ms`;
      el.style.animationDelay = `${Math.random() * 250}ms`;
      el.addEventListener("animationend", () => el.remove(), { once: true });
      frag.appendChild(el);
    }
    shadow.appendChild(frag);
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
    if (effectMode === "confetti") {
      launchConfetti(x, y);
      return;
    }
    if (effectMode === "sparkle") {
      launchSparkle(x, y);
      return;
    }
    if (effectMode === "ripple") {
      launchRipple(x, y);
      return;
    }
    if (effectMode === "emoji") {
      launchEmoji(x, y);
      return;
    }
    if (effectMode === "hearts") {
      launchHearts(x, y);
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
