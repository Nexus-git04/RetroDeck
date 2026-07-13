/* OVERDRIVE SQUAD: Patch Notes
   Side-scrolling run-and-gun. You're a developer who stepped inside a live
   server to hunt down what's breaking it: literal bugs, malware viruses,
   infinite loops, and uncaught exceptions.
   Twist: enemies you "fix" become platforms briefly.

   Three levels, each harder than the last. Level 3 ends in a boss fight
   against FATAL_EXCEPTION.EXE. Clearing it plays a proper ending sequence
   before handing control back to the shell.
*/
window.Overdrive = (() => {
  const W = 960, H = 540;
  const GRAVITY = 0.55;
  const DROP_CHANCE = 0.4;        // chance an enemy drops a pickup on death
  const RAPIDFIRE_DURATION = 240; // frames the rapid-fire buff lasts (~4s)
  const HEALTH_RESTORE = 25;

  const LEVELS = [
    {
      name: 'LEVEL 1 — SERVER ROOM',
      subtitle: 'Clear the buffer bloat',
      killsToWin: 18,
      stageLength: 4200,
      spawnMin: 60, spawnMax: 100,
      speedMul: 1,
      floatAmp: 55, floatFreq: 0.7, floatGap: 300,
      tint: ['rgba(10,5,25,0.55)', 'rgba(20,5,35,0.35)', 'rgba(40,5,30,0.55)'],
      boss: false
    },
    {
      name: 'LEVEL 2 — FIREWALL FRONTIER',
      subtitle: 'Enemy traffic is picking up',
      killsToWin: 24,
      stageLength: 5000,
      spawnMin: 48, spawnMax: 82,
      speedMul: 1.15,
      floatAmp: 70, floatFreq: 0.75, floatGap: 270,
      tint: ['rgba(5,15,25,0.55)', 'rgba(5,25,35,0.35)', 'rgba(5,35,30,0.5)'],
      boss: false
    },
    {
      name: 'LEVEL 3 — KERNEL CORE',
      subtitle: 'Something big is corrupting the core',
      killsToWin: 12,
      stageLength: 4000,
      spawnMin: 55, spawnMax: 90,
      speedMul: 1.25,
      floatAmp: 85, floatFreq: 0.8, floatGap: 320,
      tint: ['rgba(25,5,5,0.6)', 'rgba(35,5,10,0.4)', 'rgba(45,5,5,0.6)'],
      boss: true,
      bossHp: 46,
      bossName: 'FATAL_EXCEPTION.EXE'
    }
  ];

  function create(container, onWin, onLose) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.width = '100%';
    canvas.style.maxWidth = (W * 1.5) + 'px';
    canvas.style.height = 'auto';
    canvas.setAttribute('data-testid', 'overdrive-canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Server-interior background art
    const bgImg = new Image();
    bgImg.src = 'assets/images/overdrive_bg.png';
    let bgReady = false;
    bgImg.onload = () => { bgReady = true; };

    // Background music
    const music = new Audio('assets/audio/overdrive-theme.mp3');
    music.loop = true;
    music.volume = 0.35;
    music.play().catch(() => {
      // Autoplay blocked until a user gesture; retry on first input.
      const resume = () => { music.play().catch(() => {}); document.removeEventListener('keydown', resume); canvas.removeEventListener('mousedown', resume); };
      document.addEventListener('keydown', resume, { once: true });
      canvas.addEventListener('mousedown', resume, { once: true });
    });

    let raf = null, running = true, keys = {};
    let cameraX = 0;

    let level = 0;
    let cfg = LEVELS[0];
    let kills = 0;
    let spawnTimer = 45;
    let ended = false;

    // 'intro' -> 'play' -> 'levelComplete' -> (next level's 'intro') ... -> 'gameComplete'
    let phaseState = 'intro';
    let phaseTimer = 0;
    let phaseMax = 0;

    let boss = null;
    let bossActive = false;
    let bossDefeated = false;

    const player = {
      x: 100, y: 300, vx: 0, vy: 0, w: 24, h: 40,
      grounded: false, dir: 1, hp: 100, cool: 0, rapidTimer: 0
    };
    const bullets = [];
    const enemyBullets = [];
    const enemies = [];
    const platforms = [];
    const fixed = []; // fixed enemies acting as platforms
    const drops = []; // pickups dropped by killed enemies

    function buildStage() {
      platforms.length = 0;
      for (let x = 0; x < cfg.stageLength; x += 200) {
        platforms.push({ x, y: 440, w: 180, h: 100, type: 'ground' });
      }
      // Leave an open arena near the end of boss levels for the fight.
      const floatEnd = cfg.boss ? cfg.stageLength - 500 : cfg.stageLength - 200;
      let i = 0;
      for (let x = 500; x < floatEnd; x += cfg.floatGap) {
        const raw = 300 + Math.sin(i * 0.7 + level) * cfg.floatAmp;
        const y = Math.max(220, Math.min(380, raw));
        platforms.push({ x, y, w: 120, h: 20, type: 'float' });
        i++;
      }
    }

    function startLevel(idx, opts) {
      opts = opts || {};
      level = idx;
      cfg = LEVELS[level];
      buildStage();
      enemies.length = 0; bullets.length = 0; enemyBullets.length = 0;
      fixed.length = 0; drops.length = 0;
      kills = 0; spawnTimer = 45;
      boss = null; bossActive = false; bossDefeated = false;
      cameraX = 0;
      player.x = 100; player.y = 300; player.vx = 0; player.vy = 0;
      player.grounded = false; player.dir = 1; player.cool = 0;
      if (opts.healOnEntry) player.hp = Math.min(100, player.hp + 20);
      phaseState = 'intro';
      phaseTimer = 110; phaseMax = 110;
    }

    function onKey(e, down) {
      const k = e.key.toLowerCase();
      keys[k] = down;
      if ((k === ' ' || k === 'w' || k === 'arrowup') && down && phaseState === 'play' && player.grounded) {
        player.vy = -11;
        player.grounded = false;
      }
      if (k === 'escape' && down) { onLose && onLose(); teardown(); }
    }
    function onDown() { shoot(); keys['j'] = true; }
    function onUp() { keys['j'] = false; }
    const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);

    function shoot() {
      if (phaseState !== 'play') return;
      if (player.cool > 0) return;
      player.cool = player.rapidTimer > 0 ? 8 : 18;
      bullets.push({
        x: player.x + player.w/2, y: player.y + 18,
        vx: player.dir * 10, vy: 0, life: 60
      });
      beep(880, 0.08, 'square', 0.15);
    }

    function spawnEnemy() {
      const roll = Math.random();
      const kind = roll < 0.3 ? 'bug' : roll < 0.55 ? 'virus' : roll < 0.8 ? 'loop' : 'exception';
      const m = cfg.speedMul;
      let y, w, h, hp, vx;
      if (kind === 'bug') {
        y = 408; w = 32; h = 32; hp = 2;
        vx = (-1.4 - Math.random() * 1) * m;
      } else if (kind === 'virus') {
        y = 260 + Math.random() * 140; w = 30; h = 30; hp = 3;
        vx = (-1 - Math.random() * 0.7) * m;
      } else if (kind === 'loop') {
        y = 400; w = 32; h = 32; hp = 2;
        vx = (-1.2 - Math.random() * 0.9) * m;
      } else {
        y = 300 + Math.random() * 80; w = 32; h = 32; hp = 2;
        vx = (-1.2 - Math.random() * 0.9) * m;
      }
      enemies.push({ x: cameraX + W + 40, y, vx, vy: 0, w, h, hp, kind, phase: 0 });
    }

    function spawnDrop(x, y) {
      if (Math.random() > DROP_CHANCE) return;
      const kind = Math.random() < 0.5 ? 'health' : 'rapid';
      drops.push({ x, y, vx: 0, vy: -3, w: 16, h: 16, kind, life: 500, bob: 0 });
    }

    function spawnBoss() {
      boss = { x: cameraX + W + 80, y: 230, w: 84, h: 84, hp: cfg.bossHp, maxHp: cfg.bossHp, phase: 0, shootTimer: 90 };
      bossActive = true;
      beep(90, 0.3, 'sawtooth', 0.25);
    }

    function rectHit(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    function step() {
      if (!running) return;

      if (phaseState === 'intro') {
        phaseTimer--;
        draw();
        if (phaseTimer <= 0) phaseState = 'play';
        raf = requestAnimationFrame(step);
        return;
      }
      if (phaseState === 'levelComplete') {
        phaseTimer--;
        draw();
        if (phaseTimer <= 0) {
          if (level + 1 < LEVELS.length) {
            startLevel(level + 1, { healOnEntry: true });
          } else {
            phaseState = 'gameComplete';
            phaseTimer = 170; phaseMax = 170;
          }
        }
        raf = requestAnimationFrame(step);
        return;
      }
      if (phaseState === 'gameComplete') {
        phaseTimer--;
        draw();
        if (phaseTimer <= 0 && !ended) {
          ended = true; onWin && onWin(); teardown(); return;
        }
        raf = requestAnimationFrame(step);
        return;
      }

      // ---- phaseState === 'play' ----
      const speed = 3.2;
      if (keys['a'] || keys['arrowleft']) { player.vx = -speed; player.dir = -1; }
      else if (keys['d'] || keys['arrowright']) { player.vx = speed; player.dir = 1; }
      else player.vx = 0;

      if (keys['j']) shoot();

      // Physics
      player.vy += GRAVITY;
      player.x += player.vx;
      player.y += player.vy;

      // Platform collisions
      player.grounded = false;
      const allPlats = platforms.concat(fixed.map(f => ({ x: f.x, y: f.y, w: f.w, h: 8, type: 'fixed' })));
      for (const p of allPlats) {
        if (player.x + player.w > p.x && player.x < p.x + p.w) {
          if (player.vy >= 0 && player.y + player.h >= p.y && player.y + player.h - player.vy <= p.y + 4) {
            player.y = p.y - player.h;
            player.vy = 0;
            player.grounded = true;
          }
        }
      }
      if (player.y > H) { onLose && onLose(); teardown(); return; }

      // Camera follows player
      cameraX = Math.max(0, player.x - W * 0.3);
      if (player.cool > 0) player.cool--;

      // Spawn (paused once the boss is active)
      spawnTimer--;
      if (!(cfg.boss && bossActive) && spawnTimer <= 0) {
        spawnEnemy();
        spawnTimer = cfg.spawnMin + Math.random() * (cfg.spawnMax - cfg.spawnMin);
      }

      // Rapid-fire buff countdown
      if (player.rapidTimer > 0) player.rapidTimer--;

      // Bullets
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx; b.y += b.vy; b.life--;
        if (b.life <= 0) { bullets.splice(i, 1); continue; }
      }

      // Enemies
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.x += e.vx;
        e.phase += 0.15;
        if (e.kind === 'exception') e.y += Math.sin(e.phase) * 0.6;
        if (e.kind === 'bug') e.y = 408 + Math.sin(e.phase * 2) * 2; // leg-scuttle wobble
        if (e.kind === 'virus') e.y += Math.max(-0.6, Math.min(0.6, (player.y - e.y) * 0.01));

        // Hit by player
        if (rectHit({ x: player.x, y: player.y, w: player.w, h: player.h }, e)) {
          player.hp -= 8;
          player.vx = -player.dir * 8;
          player.vy = -6;
          beep(120, 0.15, 'sawtooth', 0.2);
          e.hp = 0;
          spawnDrop(e.x + e.w / 2 - 8, e.y);
        }
        // Bullets
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (b.x > e.x && b.x < e.x + e.w && b.y > e.y && b.y < e.y + e.h) {
            e.hp--;
            bullets.splice(j, 1);
            beep(400, 0.05, 'square', 0.15);
            if (e.hp <= 0) {
              // Fix -> becomes platform for 3s
              fixed.push({ x: e.x, y: e.y + e.h - 4, w: e.w, life: 180 });
              spawnDrop(e.x + e.w / 2 - 8, e.y);
              kills++;
              beep(660, 0.12, 'triangle', 0.2);
              break;
            }
          }
        }
        if (e.hp <= 0 || e.x < cameraX - 200) enemies.splice(i, 1);
      }

      // Boss trigger + behavior (level 3 only)
      if (cfg.boss && !bossActive && !bossDefeated && kills >= cfg.killsToWin) spawnBoss();
      if (bossActive && boss) {
        boss.phase += 0.05;
        const targetX = cameraX + W - 220;
        boss.x += (targetX - boss.x) * 0.03;
        boss.y = 230 + Math.sin(boss.phase * 1.4) * 45;
        boss.shootTimer--;
        if (boss.shootTimer <= 0) {
          boss.shootTimer = 65 + Math.random() * 35;
          const dx = (player.x + player.w/2) - (boss.x + boss.w/2);
          const dy = (player.y + player.h/2) - (boss.y + boss.h/2);
          const dist = Math.max(1, Math.hypot(dx, dy));
          enemyBullets.push({ x: boss.x + boss.w/2, y: boss.y + boss.h/2, vx: dx/dist*4.2, vy: dy/dist*4.2, life: 140 });
          beep(220, 0.1, 'sawtooth', 0.18);
        }
        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (b.x > boss.x && b.x < boss.x + boss.w && b.y > boss.y && b.y < boss.y + boss.h) {
            boss.hp--; bullets.splice(j, 1);
            beep(500, 0.05, 'square', 0.15);
            if (boss.hp <= 0) {
              for (let k = 0; k < 4; k++) spawnDrop(boss.x + Math.random()*boss.w - 8, boss.y + Math.random()*boss.h);
              beep(700, 0.25, 'triangle', 0.25);
              bossActive = false; bossDefeated = true; boss = null;
            }
            break;
          }
        }
        if (boss && rectHit({ x: player.x, y: player.y, w: player.w, h: player.h }, boss)) {
          player.hp -= 0.6; // light continuous chip damage on contact
        }
      }

      // Enemy projectiles (boss only, for now)
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        b.x += b.vx; b.y += b.vy; b.life--;
        if (rectHit({ x: player.x, y: player.y, w: player.w, h: player.h }, { x: b.x - 3, y: b.y - 3, w: 6, h: 6 })) {
          player.hp -= 12;
          beep(150, 0.12, 'sawtooth', 0.2);
          enemyBullets.splice(i, 1);
          continue;
        }
        if (b.life <= 0 || b.x < cameraX - 200 || b.x > cameraX + W + 200) enemyBullets.splice(i, 1);
      }

      // Decay fixed platforms
      for (let i = fixed.length - 1; i >= 0; i--) {
        fixed[i].life--;
        if (fixed[i].life <= 0) fixed.splice(i, 1);
      }

      // Drops: pop up, fall, settle on platforms, and get collected
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.vy += GRAVITY * 0.5;
        d.y += d.vy;
        d.x += d.vx;
        d.bob += 0.12;
        for (const p of allPlats) {
          if (d.x + d.w > p.x && d.x < p.x + p.w) {
            if (d.vy >= 0 && d.y + d.h >= p.y && d.y + d.h - d.vy <= p.y + 4) {
              d.y = p.y - d.h;
              d.vy = 0;
            }
          }
        }
        d.life--;
        let collected = false;
        if (rectHit({ x: player.x, y: player.y, w: player.w, h: player.h }, d)) {
          collected = true;
          if (d.kind === 'health') {
            player.hp = Math.min(100, player.hp + HEALTH_RESTORE);
            beep(520, 0.15, 'sine', 0.2);
          } else {
            player.rapidTimer = RAPIDFIRE_DURATION;
            beep(980, 0.15, 'triangle', 0.2);
          }
        }
        if (collected || d.life <= 0 || d.x < cameraX - 200) drops.splice(i, 1);
      }

      // Player HP / fall
      if (player.hp <= 0 && !ended) { ended = true; onLose && onLose(); teardown(); return; }

      // Level completion
      const levelDone = cfg.boss ? bossDefeated : kills >= cfg.killsToWin;
      if (levelDone && phaseState === 'play') {
        phaseState = 'levelComplete';
        phaseTimer = 150; phaseMax = 150;
      }

      draw();
      raf = requestAnimationFrame(step);
    }

    function overlayPanel(titleLines, sub, color, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(5,5,15,0.78)';
      ctx.fillRect(0, H/2 - 90, W, 180);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.strokeRect(0, H/2 - 90, W, 180);
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText(titleLines[0], W/2, H/2 - 28);
      if (titleLines[1]) {
        ctx.font = '14px "Press Start 2P", monospace';
        ctx.fillText(titleLines[1], W/2, H/2 + 6);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '18px VT323, monospace';
      ctx.fillText(sub, W/2, H/2 + 42);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    function draw() {
      // Server-interior background (circuit board), slow parallax scroll
      if (bgReady) {
        const iw = bgImg.width, ih = bgImg.height;
        const scale = H / ih;
        const drawW = iw * scale;
        const offset = (cameraX * 0.25) % drawW;
        let sx0 = -offset;
        for (let x = sx0; x < W; x += drawW) {
          ctx.drawImage(bgImg, x, 0, drawW, H);
        }
        // Dark overlay for readability, tinted per level to keep the mood distinct
        const tint = ctx.createLinearGradient(0, 0, 0, H);
        tint.addColorStop(0, cfg.tint[0]);
        tint.addColorStop(0.6, cfg.tint[1]);
        tint.addColorStop(1, cfg.tint[2]);
        ctx.fillStyle = tint; ctx.fillRect(0, 0, W, H);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#1a0a2a'); g.addColorStop(0.5, '#5a1a4a'); g.addColorStop(1, '#ff4fa0');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }

      // Neon horizon lines (server floor grid)
      ctx.strokeStyle = '#4ff0ff'; ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const y = 340 + i * 20;
        ctx.globalAlpha = 0.5 - i * 0.05;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Perspective lines
      ctx.strokeStyle = '#ff4fd8';
      for (let i = -20; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(W/2 + i * 40 - (cameraX * 0.3) % 40, 340);
        ctx.lineTo(W/2 + i * 200, H);
        ctx.stroke();
      }

      // Platforms
      for (const p of platforms) {
        const sx = p.x - cameraX;
        if (sx < -p.w || sx > W) continue;
        if (p.type === 'ground') {
          ctx.fillStyle = '#0a0a1e'; ctx.fillRect(sx, p.y, p.w, p.h);
          ctx.fillStyle = '#4ff0ff'; ctx.fillRect(sx, p.y, p.w, 3);
        } else {
          ctx.fillStyle = '#2a1a3a'; ctx.fillRect(sx, p.y, p.w, p.h);
          ctx.fillStyle = '#ffb347'; ctx.fillRect(sx, p.y, p.w, 2);
        }
      }
      // Fixed (green, "patched")
      for (const f of fixed) {
        const sx = f.x - cameraX;
        const alpha = Math.min(1, f.life / 60);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#4fff8a';
        ctx.fillRect(sx, f.y, f.w, 6);
        ctx.fillStyle = '#a8ffcf';
        ctx.fillRect(sx, f.y - 2, f.w, 2);
        ctx.globalAlpha = 1;
      }

      // Enemies
      for (const e of enemies) {
        const sx = e.x - cameraX;
        if (e.kind === 'loop') {
          ctx.save();
          ctx.translate(sx + e.w/2, e.y + e.h/2);
          ctx.rotate(e.phase);
          ctx.fillStyle = '#ff4fd8';
          for (let k = 0; k < 8; k++) {
            ctx.save();
            ctx.rotate((Math.PI * 2 * k) / 8);
            ctx.globalAlpha = 0.4 + (k/8)*0.6;
            ctx.fillRect(6, -3, 10, 6);
            ctx.restore();
          }
          ctx.restore();
        } else if (e.kind === 'exception') {
          ctx.fillStyle = '#fff'; ctx.fillRect(sx, e.y, e.w, e.h);
          ctx.fillStyle = '#ff2020'; ctx.fillRect(sx, e.y, e.w, 6);
          ctx.fillStyle = '#000';
          ctx.fillRect(sx + e.w - 8, e.y + 1, 6, 4);
          ctx.font = '9px monospace';
          ctx.fillText('ERR', sx + 5, e.y + 22);
        } else if (e.kind === 'bug') {
          const legPhase = Math.sin(e.phase * 3);
          ctx.save();
          ctx.translate(sx + e.w/2, e.y + e.h/2);
          ctx.strokeStyle = '#1a3a1a'; ctx.lineWidth = 2;
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath(); ctx.moveTo(k * 8, -2); ctx.lineTo(k * 8 + legPhase * 3, 10); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(k * 8, 2); ctx.lineTo(k * 8 - legPhase * 3, -10); ctx.stroke();
          }
          ctx.fillStyle = '#3fae3f'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 9, 0, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#0a0a1e'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(-16, -12); ctx.moveTo(10, -6); ctx.lineTo(16, -12); ctx.stroke();
          ctx.restore();
        } else if (e.kind === 'virus') {
          ctx.save();
          ctx.translate(sx + e.w/2, e.y + e.h/2);
          ctx.rotate(-e.phase * 0.6);
          ctx.fillStyle = '#c04fff';
          for (let k = 0; k < 10; k++) {
            const a = (Math.PI * 2 * k) / 10;
            ctx.save(); ctx.rotate(a);
            ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, -14); ctx.lineTo(-4, -14); ctx.closePath(); ctx.fill();
            ctx.restore();
          }
          ctx.fillStyle = '#7a1fbf'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#f0c0ff';
          ctx.beginPath(); ctx.arc(-3, -2, 1.6, 0, Math.PI * 2); ctx.arc(3, -2, 1.6, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // Boss
      if (bossActive && boss) {
        const sx = boss.x - cameraX;
        ctx.save();
        ctx.translate(sx + boss.w/2, boss.y + boss.h/2);
        ctx.rotate(Math.sin(boss.phase) * 0.05);
        ctx.fillStyle = '#1a0505';
        ctx.fillRect(-boss.w/2, -boss.h/2, boss.w, boss.h);
        ctx.strokeStyle = '#ff3b1e'; ctx.lineWidth = 3;
        ctx.strokeRect(-boss.w/2, -boss.h/2, boss.w, boss.h);
        ctx.fillStyle = '#ff3b1e';
        for (let k = 0; k < 6; k++) {
          const ang = (Math.PI * 2 * k) / 6 + boss.phase;
          const px = Math.cos(ang) * boss.w/2, py = Math.sin(ang) * boss.h/2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(ang) * 10, py + Math.sin(ang) * 10);
          ctx.lineTo(px + Math.cos(ang + 0.3) * 4, py + Math.sin(ang + 0.3) * 4);
          ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#ff3b1e';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('FATAL', 0, -4);
        ctx.fillText('ERROR', 0, 10);
        ctx.textAlign = 'left';
        ctx.restore();
      }

      // Drops
      for (const d of drops) {
        const sx = d.x - cameraX;
        const bobY = d.y + Math.sin(d.bob) * 3;
        ctx.save();
        ctx.translate(sx + d.w / 2, bobY + d.h / 2);
        if (d.kind === 'health') {
          ctx.fillStyle = '#2a1a3a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#4fff8a'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#4fff8a';
          ctx.fillRect(-6, -1.5, 12, 3);
          ctx.fillRect(-1.5, -6, 3, 12);
        } else {
          ctx.fillStyle = '#2a1a3a'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#ffe57a'; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#ffe57a';
          ctx.beginPath();
          ctx.moveTo(2, -7); ctx.lineTo(-4, 1); ctx.lineTo(0, 1);
          ctx.lineTo(-2, 7); ctx.lineTo(4, -1); ctx.lineTo(0, -1);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }

      // Bullets
      ctx.fillStyle = '#ffe57a';
      for (const b of bullets) {
        ctx.fillRect(b.x - cameraX - 3, b.y - 2, 6, 4);
      }
      // Enemy (boss) projectiles
      ctx.fillStyle = '#ff5c3a';
      for (const b of enemyBullets) {
        ctx.beginPath(); ctx.arc(b.x - cameraX, b.y, 4, 0, Math.PI * 2); ctx.fill();
      }

      // Player
      const px = player.x - cameraX;
      ctx.fillStyle = '#4ff0ff'; ctx.fillRect(px, player.y, player.w, player.h);
      ctx.fillStyle = '#0a0a1e'; ctx.fillRect(px + 4, player.y + 8, 4, 4);
      ctx.fillStyle = '#0a0a1e'; ctx.fillRect(px + 16, player.y + 8, 4, 4);
      ctx.fillStyle = '#111'; ctx.fillRect(px + (player.dir > 0 ? player.w : -14), player.y + 18, 14, 6);

      // HUD
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(10, 10, 260, 60);
      ctx.strokeStyle = '#4ff0ff'; ctx.strokeRect(10, 10, 260, 60);
      ctx.fillStyle = '#ffb347';
      ctx.font = '18px "Press Start 2P", monospace';
      ctx.fillText('HP', 22, 34);
      ctx.fillStyle = '#333'; ctx.fillRect(60, 20, 200, 16);
      ctx.fillStyle = '#ff3b1e'; ctx.fillRect(60, 20, 200 * Math.max(0, player.hp/100), 16);
      ctx.fillStyle = '#fff'; ctx.font = '16px "VT323", monospace';
      ctx.fillText(`PATCHED ${kills}/${cfg.killsToWin}`, 22, 60);

      // Level indicator, top-right
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(W - 210, 10, 200, 24);
      ctx.strokeStyle = '#ffb347'; ctx.strokeRect(W - 210, 10, 200, 24);
      ctx.fillStyle = '#ffb347'; ctx.font = '12px "VT323", monospace';
      ctx.fillText(`LV ${level + 1}/${LEVELS.length}`, W - 20, 26);
      ctx.textAlign = 'left';

      if (player.rapidTimer > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(280, 10, 150, 30);
        ctx.strokeStyle = '#ffe57a'; ctx.strokeRect(280, 10, 150, 30);
        ctx.fillStyle = '#ffe57a'; ctx.font = '14px "VT323", monospace';
        ctx.fillText(`RAPID FIRE ${Math.ceil(player.rapidTimer / 60)}s`, 290, 30);
      }

      // Boss health bar
      if (bossActive && boss) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(W/2 - 160, 10, 320, 34);
        ctx.strokeStyle = '#ff3b1e'; ctx.strokeRect(W/2 - 160, 10, 320, 34);
        ctx.fillStyle = '#ffb347'; ctx.font = '11px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(cfg.bossName, W/2, 24);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#333'; ctx.fillRect(W/2 - 150, 28, 300, 10);
        ctx.fillStyle = '#ff3b1e'; ctx.fillRect(W/2 - 150, 28, 300 * Math.max(0, boss.hp / boss.maxHp), 10);
      }

      // Phase overlays
      if (phaseState === 'intro') {
        const alpha = Math.min(1, (phaseMax - phaseTimer) / 20);
        overlayPanel([cfg.name], cfg.subtitle, '#4ff0ff', alpha);
      } else if (phaseState === 'levelComplete') {
        const alpha = Math.min(1, (phaseMax - phaseTimer) / 20);
        overlayPanel(
          ['LEVEL COMPLETE', cfg.name],
          `Bugs patched: ${kills}/${cfg.killsToWin}  •  HP ${Math.max(0, Math.round(player.hp))}`,
          '#4fff8a', alpha
        );
      } else if (phaseState === 'gameComplete') {
        const alpha = Math.min(1, (phaseMax - phaseTimer) / 25);
        overlayPanel(
          ['SYSTEM PATCHED', 'GAME COMPLETE'],
          'All corrupted processes eliminated. Ejecting...',
          '#ffe57a', alpha
        );
      }
    }

    function teardown() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
      try { music.pause(); music.currentTime = 0; } catch (e) {}
    }

    startLevel(0);
    step();
    return { teardown };
  }

  // Tiny procedural beep
  let audioCtx = null;
  function beep(freq, dur, type, vol) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }

  return { create };
})();