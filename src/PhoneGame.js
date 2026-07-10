import React from "react";
import "./PhoneGame.css";

const STORAGE_KEY = "myaipa-star-runner-best";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function createGame(width, height) {
  const stars = Array.from({ length: 80 }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: 0.7 + Math.random() * 1.9,
    speed: 18 + Math.random() * 55,
    alpha: 0.18 + Math.random() * 0.55,
  }));

  return {
    width,
    height,
    player: {
      x: width / 2,
      y: height - Math.max(78, height * 0.14),
      radius: Math.max(24, Math.min(34, width * 0.08)),
      targetX: width / 2,
    },
    items: [],
    bursts: [],
    stars,
    score: 0,
    lives: 3,
    combo: 0,
    level: 1,
    spawnTimer: 0,
    time: 0,
    running: false,
    over: false,
  };
}

function spawnItem(game) {
  const levelBoost = Math.min(3.5, 1 + game.time / 35000);
  const hazard = Math.random() < clamp(0.22 + game.time / 100000, 0.22, 0.42);
  const radius = hazard ? 22 : 18;

  game.items.push({
    type: hazard ? "hazard" : "gem",
    x: radius + Math.random() * (game.width - radius * 2),
    y: -radius - 6,
    radius,
    speed: (hazard ? 145 : 120) * levelBoost + Math.random() * 55,
    drift: (Math.random() - 0.5) * 42,
    spin: Math.random() * Math.PI,
  });
}

function addBurst(game, x, y, color, amount = 10) {
  for (let i = 0; i < amount; i += 1) {
    game.bursts.push({
      x,
      y,
      vx: (Math.random() - 0.5) * 210,
      vy: -80 - Math.random() * 170,
      life: 420 + Math.random() * 300,
      ttl: 420 + Math.random() * 300,
      radius: 2 + Math.random() * 4,
      color,
    });
  }
}

function updateGame(game, delta, onScore) {
  if (!game.running || game.over) return;

  game.time += delta;
  game.level = 1 + Math.floor(game.time / 9000);
  game.spawnTimer -= delta;

  const spawnEvery = clamp(780 - game.time / 120, 360, 780);
  if (game.spawnTimer <= 0) {
    spawnItem(game);
    game.spawnTimer = spawnEvery;
  }

  game.player.x += (game.player.targetX - game.player.x) * clamp(delta / 85, 0.06, 0.36);

  game.stars.forEach((star) => {
    star.y += (star.speed + game.level * 5) * (delta / 1000);
    if (star.y > game.height + star.r) {
      star.y = -star.r;
      star.x = Math.random() * game.width;
    }
  });

  for (let i = game.items.length - 1; i >= 0; i -= 1) {
    const item = game.items[i];
    item.y += item.speed * (delta / 1000);
    item.x += item.drift * (delta / 1000);
    item.spin += delta / 240;

    if (distance(item, game.player) < item.radius + game.player.radius * 0.78) {
      game.items.splice(i, 1);
      if (item.type === "hazard") {
        game.lives -= 1;
        game.combo = 0;
        addBurst(game, item.x, item.y, "#ff5b7a", 18);
        if (game.lives <= 0) {
          game.over = true;
          game.running = false;
        }
      } else {
        game.combo += 1;
        const gain = 10 + Math.min(40, game.combo * 2);
        game.score += gain;
        onScore(game.score);
        addBurst(game, item.x, item.y, "#ffd15a", 14);
      }
      continue;
    }

    if (item.y > game.height + item.radius * 2) {
      game.items.splice(i, 1);
      if (item.type === "gem") game.combo = 0;
    }
  }

  for (let i = game.bursts.length - 1; i >= 0; i -= 1) {
    const burst = game.bursts[i];
    burst.life -= delta;
    burst.x += burst.vx * (delta / 1000);
    burst.y += burst.vy * (delta / 1000);
    burst.vy += 420 * (delta / 1000);
    if (burst.life <= 0) game.bursts.splice(i, 1);
  }
}

function drawGame(ctx, game, pulse) {
  const { width, height } = game;
  ctx.clearRect(0, 0, width, height);

  const sky = ctx.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, "#141833");
  sky.addColorStop(0.36, "#1a3550");
  sky.addColorStop(0.72, "#243431");
  sky.addColorStop(1, "#16121f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glowA = ctx.createRadialGradient(width * 0.2, height * 0.18, 20, width * 0.2, height * 0.18, width * 0.78);
  glowA.addColorStop(0, "rgba(87, 219, 201, 0.2)");
  glowA.addColorStop(1, "rgba(87, 219, 201, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, width, height);

  const glowB = ctx.createRadialGradient(width * 0.86, height * 0.72, 16, width * 0.86, height * 0.72, width * 0.64);
  glowB.addColorStop(0, "rgba(255, 107, 107, 0.16)");
  glowB.addColorStop(1, "rgba(255, 107, 107, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, width, height);

  game.stars.forEach((star) => {
    ctx.beginPath();
    ctx.fillStyle = `rgba(255, 248, 214, ${star.alpha})`;
    ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fill();
  });

  game.items.forEach((item) => {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.spin);
    if (item.type === "hazard") {
      ctx.fillStyle = "#ff5b7a";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 8; i += 1) {
        const angle = (Math.PI * 2 * i) / 8;
        const r = i % 2 === 0 ? item.radius : item.radius * 0.48;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      const gem = ctx.createLinearGradient(-item.radius, -item.radius, item.radius, item.radius);
      gem.addColorStop(0, "#fff4b1");
      gem.addColorStop(0.5, "#ffd15a");
      gem.addColorStop(1, "#41d6c3");
      ctx.fillStyle = gem;
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -item.radius);
      ctx.lineTo(item.radius * 0.78, 0);
      ctx.lineTo(0, item.radius);
      ctx.lineTo(-item.radius * 0.78, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  });

  game.bursts.forEach((burst) => {
    ctx.globalAlpha = clamp(burst.life / burst.ttl, 0, 1);
    ctx.fillStyle = burst.color;
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, burst.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  const ship = game.player;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  const bob = Math.sin(pulse / 180) * 3;
  ctx.translate(0, bob);

  const flame = ctx.createLinearGradient(0, ship.radius * 0.55, 0, ship.radius * 1.35);
  flame.addColorStop(0, "#fff4a7");
  flame.addColorStop(0.52, "#ff8f4f");
  flame.addColorStop(1, "rgba(255, 91, 122, 0)");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-ship.radius * 0.34, ship.radius * 0.55);
  ctx.quadraticCurveTo(0, ship.radius * (1.1 + Math.sin(pulse / 90) * 0.22), ship.radius * 0.34, ship.radius * 0.55);
  ctx.closePath();
  ctx.fill();

  const body = ctx.createLinearGradient(-ship.radius, -ship.radius, ship.radius, ship.radius);
  body.addColorStop(0, "#f4f7ff");
  body.addColorStop(0.45, "#74e1d5");
  body.addColorStop(1, "#2f84ff");
  ctx.fillStyle = body;
  ctx.strokeStyle = "rgba(255,255,255,0.86)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -ship.radius * 1.05);
  ctx.quadraticCurveTo(ship.radius * 0.92, -ship.radius * 0.1, ship.radius * 0.6, ship.radius * 0.64);
  ctx.lineTo(ship.radius * 0.2, ship.radius * 0.42);
  ctx.lineTo(0, ship.radius * 0.78);
  ctx.lineTo(-ship.radius * 0.2, ship.radius * 0.42);
  ctx.lineTo(-ship.radius * 0.6, ship.radius * 0.64);
  ctx.quadraticCurveTo(-ship.radius * 0.92, -ship.radius * 0.1, 0, -ship.radius * 1.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#17213a";
  ctx.beginPath();
  ctx.arc(0, -ship.radius * 0.25, ship.radius * 0.31, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.beginPath();
  ctx.arc(-ship.radius * 0.1, -ship.radius * 0.34, ship.radius * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default function PhoneGame() {
  const canvasRef = React.useRef(null);
  const gameRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const lastTimeRef = React.useRef(0);
  const installPromptRef = React.useRef(null);
  const [score, setScore] = React.useState(0);
  const [lives, setLives] = React.useState(3);
  const [level, setLevel] = React.useState(1);
  const [mode, setMode] = React.useState("ready");
  const [installState, setInstallState] = React.useState("checking");
  const [installMessage, setInstallMessage] = React.useState("");
  const [best, setBest] = React.useState(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) ? saved : 0;
  });

  React.useEffect(() => {
    const handleBeforeInstall = (event) => {
      event.preventDefault();
      installPromptRef.current = event;
      setInstallState("available");
      setInstallMessage("");
    };

    const handleInstalled = () => {
      installPromptRef.current = null;
      setInstallState("installed");
      setInstallMessage("Star Runner is installed.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);

    const timer = window.setTimeout(() => {
      if (!installPromptRef.current) {
        setInstallState(window.matchMedia("(display-mode: standalone)").matches ? "installed" : "manual");
      }
    }, 1200);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const syncHud = React.useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    setScore(game.score);
    setLives(game.lives);
    setLevel(game.level);
    if (game.over) {
      setMode("over");
      setBest((current) => {
        const next = Math.max(current, game.score);
        window.localStorage.setItem(STORAGE_KEY, String(next));
        return next;
      });
    }
  }, []);

  const resize = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(520, Math.floor(rect.height));

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const existing = gameRef.current;
    if (!existing) {
      gameRef.current = createGame(width, height);
    } else {
      existing.width = width;
      existing.height = height;
      existing.player.y = height - Math.max(78, height * 0.14);
      existing.player.x = clamp(existing.player.x, existing.player.radius, width - existing.player.radius);
      existing.player.targetX = clamp(existing.player.targetX, existing.player.radius, width - existing.player.radius);
    }
    drawGame(ctx, gameRef.current, performance.now());
  }, []);

  React.useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  React.useEffect(() => {
    const tick = (now) => {
      const canvas = canvasRef.current;
      const game = gameRef.current;
      const ctx = canvas?.getContext("2d");
      const last = lastTimeRef.current || now;
      const delta = Math.min(34, now - last);
      lastTimeRef.current = now;

      if (game && ctx) {
        updateGame(game, delta, setScore);
        drawGame(ctx, game, now);
        setLives(game.lives);
        setLevel(game.level);
        if (game.over && mode !== "over") syncHud();
      }
      frameRef.current = window.requestAnimationFrame(tick);
    };

    frameRef.current = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameRef.current);
  }, [mode, syncHud]);

  const start = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    gameRef.current = createGame(rect.width, rect.height);
    gameRef.current.running = true;
    lastTimeRef.current = performance.now();
    setScore(0);
    setLives(3);
    setLevel(1);
    setMode("playing");
    resize();
  }, [resize]);

  const movePlayer = React.useCallback((clientX) => {
    const canvas = canvasRef.current;
    const game = gameRef.current;
    if (!canvas || !game) return;
    const rect = canvas.getBoundingClientRect();
    game.player.targetX = clamp(clientX - rect.left, game.player.radius, game.width - game.player.radius);
  }, []);

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    movePlayer(event.clientX);
    if (mode !== "playing") start();
  };

  const installApp = async () => {
    const prompt = installPromptRef.current;
    if (!prompt) {
      setInstallMessage("Use your phone browser menu to add Star Runner to your home screen.");
      return;
    }

    prompt.prompt();
    const choice = await prompt.userChoice;
    installPromptRef.current = null;
    if (choice.outcome === "accepted") {
      setInstallState("installed");
      setInstallMessage("Star Runner is installing.");
    } else {
      setInstallState("manual");
      setInstallMessage("Install was dismissed. You can try again from the browser menu.");
    }
  };

  return (
    <main className="phone-game">
      <canvas
        ref={canvasRef}
        className="phone-game__canvas"
        aria-label="Star Runner game"
        onPointerDown={handlePointerDown}
        onPointerMove={(event) => movePlayer(event.clientX)}
      />

      <section className="phone-game__hud" aria-live="polite">
        <div>
          <span>Score</span>
          <strong>{score}</strong>
        </div>
        <div>
          <span>Lives</span>
          <strong>{lives}</strong>
        </div>
        <div>
          <span>Level</span>
          <strong>{level}</strong>
        </div>
        <div>
          <span>Best</span>
          <strong>{best}</strong>
        </div>
      </section>

      {mode !== "playing" && (
        <section className="phone-game__panel">
          <p className="phone-game__kicker">Star Runner</p>
          <h1>{mode === "over" ? "Run finished" : "Catch the gems"}</h1>
          <p>Grab bright gems, dodge red mines, and keep your combo alive as the speed climbs.</p>

          <div className="phone-game__download" aria-label="Download Star Runner">
            <div>
              <span>Mobile app</span>
              <strong>Download Star Runner</strong>
            </div>
            <button type="button" className="phone-game__install-button" onClick={installApp}>
              {installState === "installed" ? "Installed" : "Download app"}
            </button>
            {installMessage && <p>{installMessage}</p>}
            {installState === "manual" && !installMessage && (
              <p>On iPhone, open Safari and choose Add to Home Screen. On Android, use Chrome Install app.</p>
            )}
          </div>

          <button type="button" className="phone-game__play-button" onClick={start}>
            {mode === "over" ? "Play again" : "Play now"}
          </button>
        </section>
      )}

      <div className="phone-game__control">
        <span>Drag left or right to fly</span>
      </div>
    </main>
  );
}
