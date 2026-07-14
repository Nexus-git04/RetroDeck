/* ROAD FURY — a Road Rash-inspired motorcycle combat racer.
   Pseudo-3D scanline road (curves + hills), rival AI, melee combat with weapon
   pickups, and oil-slick hazards, all rendered with layered canvas "sprites". */
window.RoadFury = (() => {
  const W = 960, H = 540;
  const ROAD_W = 2000;   // road half-width at ground plane
  const SEGMENT_LEN = 200;
  const RUMBLE_LEN = 3;
  const CAMERA_HEIGHT = 1000;
  const CAMERA_DEPTH = 0.84; // 1 / tan(fov/2)
  const DRAW_DIST = 120;
  const FINISH_MARK = 4000; // segments
  const MAX_SPEED = SEGMENT_LEN * 60; // per second
  const ACCEL = MAX_SPEED / 4;
  const BRAKE = -MAX_SPEED;
  const DECEL = -MAX_SPEED / 6;
  const OFFROAD_LIMIT = MAX_SPEED / 3;
  const CENTRIFUGAL = 0.3;

  // ---- Combat / item tuning ----
  const WEAPON_TYPES = {
    fists:    { id: 'fists',    name: 'FISTS',     dmg: 22, range: 2.6, cooldown: 0.32, durability: Infinity, color: '#e0b088' },
    chain:    { id: 'chain',    name: 'CHAIN',     dmg: 32, range: 3.6, cooldown: 0.40, durability: 7,        color: '#9aa0a6' },
    club:     { id: 'club',     name: 'CLUB',      dmg: 44, range: 3.0, cooldown: 0.55, durability: 6,        color: '#6a4818' },
    nunchaku: { id: 'nunchaku', name: 'NUNCHAKU',  dmg: 28, range: 3.3, cooldown: 0.28, durability: 8,        color: '#202020' }
  };
  const RIVAL_WEAPON_POOL = ['chain', 'club', 'nunchaku'];
  const OIL_SLIP_TIME = 1.3;
  const OIL_RADIUS = 0.55; // lane units

  function create(container, onWin, onLose) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.width = '100%';
    canvas.style.maxWidth = (W * 1.5) + 'px';
    canvas.style.height = 'auto';
    canvas.setAttribute('data-testid', 'roadfury-canvas');
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');

    // Build road: mix of straight, curves, hills
    const segments = [];
    function addSeg(curve, y) {
      const n = segments.length;
      segments.push({
        index: n,
        p1: { world: { y: lastY(), z: n * SEGMENT_LEN } },
        p2: { world: { y: y,       z: (n + 1) * SEGMENT_LEN } },
        curve,
        color: Math.floor(n / RUMBLE_LEN) % 2 ? 'dark' : 'light',
        sprites: []
      });
    }
    function lastY() { return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y; }
    function addRoad(enter, hold, leave, curve, y) {
      const total = enter + hold + leave;
      for (let n = 0; n < enter; n++) addSeg(easeIn(0, curve, n / enter), easeInOut(lastY(), y, n / total));
      for (let n = 0; n < hold; n++) addSeg(curve, easeInOut(lastY(), y, (enter + n) / total));
      for (let n = 0; n < leave; n++) addSeg(easeInOut(curve, 0, n / leave), easeInOut(lastY(), y, (enter + hold + n) / total));
    }
    function easeIn(a, b, p) { return a + (b - a) * Math.pow(p, 2); }
    function easeInOut(a, b, p) { return a + (b - a) * ((-Math.cos(p * Math.PI) / 2) + 0.5); }

    addRoad(50, 200, 50, 0, 0);
    addRoad(40, 60, 40, 3, 0);
    addRoad(40, 80, 40, 0, 200);
    addRoad(40, 60, 40, -3, 200);
    addRoad(60, 100, 60, 0, 0);
    addRoad(40, 60, 40, 4, 400);
    addRoad(40, 60, 40, 0, 0);
    addRoad(50, 100, 50, -4, 0);
    addRoad(80, 40, 30, 2, 300);
    while (segments.length < FINISH_MARK) addRoad(30, 60, 30, (Math.random() * 6 - 3), Math.random() * 300);

    // Roadside decor sprites (city buildings / streetlamps to match the Road Rash city look)
    for (let i = 0; i < segments.length; i += 12) {
      const s = segments[i];
      const kind = Math.random() < 0.55 ? 'building' : (Math.random() < 0.5 ? 'lamp' : 'sign');
      const side = Math.random() < 0.5 ? -1 : 1;
      s.sprites.push({ kind, offset: side * (1.4 + Math.random() * 0.9), seed: Math.random() });
    }

    // Player
    const player = {
      x: 0, z: SEGMENT_LEN * 2,
      speed: 0,
      health: 100,
      money: 0,
      nitroMax: 100, nitro: 100,
      weapon: 'fists',
      weaponDurability: Infinity,
      oilCount: 2,
      attackCool: 0,
      attackFrame: 0,
      damageFlash: 0,
      slipTimer: 0,
      slipDir: 1
    };

    // Rivals — some carry weapons from the start, Road Rash style
    const rivals = [];
    for (let i = 0; i < 8; i++) {
      const armed = i % 3 === 1;
      const wpn = armed ? RIVAL_WEAPON_POOL[i % RIVAL_WEAPON_POOL.length] : null;
      rivals.push({
        x: (Math.random() * 2 - 1) * 0.6,
        z: SEGMENT_LEN * (15 + i * 45),
        speed: MAX_SPEED * (0.55 + Math.random() * 0.15),
        health: 60,
        hitFlash: 0,
        color: ['#ff2f2f', '#ffc72f', '#2fff9c', '#4ff0ff', '#ff4fd8', '#8dff4f', '#ff9040', '#a86bff'][i],
        alive: true,
        ko: false,
        angerCool: 0,
        weapon: wpn,
        weaponDurability: wpn ? WEAPON_TYPES[wpn].durability : Infinity,
        attackCool: Math.random() * 1.5,
        attackFrame: 0,
        slipTimer: 0,
        slipDir: Math.random() < 0.5 ? -1 : 1
      });
    }

    // Pickups on the track: oil canisters scattered, weapons dropped by KO'd rivals
    const pickups = [];
    for (let i = 220; i < segments.length; i += 90 + Math.floor(Math.random() * 70)) {
      pickups.push({ x: (Math.random() * 2 - 1) * 0.8, z: i * SEGMENT_LEN, kind: 'oilcan' });
    }
    // Oil-slick hazards (deployed by player, or pre-seeded on the road)
    const hazards = [];

    function spawnWeaponDrop(rival) {
      if (Math.random() < 0.72) {
        pickups.push({ x: rival.x, z: rival.z, kind: 'weapon', weaponType: rival.weapon || RIVAL_WEAPON_POOL[Math.floor(Math.random() * RIVAL_WEAPON_POOL.length)] });
      } else {
        pickups.push({ x: rival.x, z: rival.z, kind: 'oilcan' });
      }
    }

    function tryCollectPickups(entity, isPlayer) {
      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        const dz = Math.abs(p.z - entity.z);
        const dx = Math.abs(p.x - entity.x);
        if (dz < SEGMENT_LEN * 0.65 && dx < 0.55) {
          if (p.kind === 'oilcan') {
            if (isPlayer) {
              player.oilCount = Math.min(5, player.oilCount + 1);
              beep(660, 0.1, 'square', 0.15);
              pickups.splice(i, 1);
            }
          } else if (p.kind === 'weapon') {
            if (isPlayer) {
              player.weapon = p.weaponType;
              player.weaponDurability = WEAPON_TYPES[p.weaponType].durability;
              beep(520, 0.14, 'square', 0.2);
              pickups.splice(i, 1);
            } else if (!entity.weapon) {
              entity.weapon = p.weaponType;
              entity.weaponDurability = WEAPON_TYPES[p.weaponType].durability;
              pickups.splice(i, 1);
            }
          }
        }
      }
    }

    function triggerSlip(entity, isPlayer) {
      if (entity.slipTimer > 0) return;
      for (const h of hazards) {
        const dz = Math.abs(h.z - entity.z);
        const dx = Math.abs(h.x - entity.x);
        if (dz < SEGMENT_LEN * 0.55 && dx < OIL_RADIUS) {
          entity.slipTimer = OIL_SLIP_TIME;
          entity.slipDir = Math.random() < 0.5 ? -1 : 1;
          entity.speed *= 0.45;
          cameraShake = Math.max(cameraShake, isPlayer ? 12 : 5);
          if (!isPlayer) entity.health -= 6;
          for (let k = 0; k < 8; k++) {
            particles.push({ x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.75 + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 4, vy: -1 - Math.random() * 2, life: 400, color: 'rgba(30,26,18,0.8)', size: 5 });
          }
          beep(100, 0.2, 'sawtooth', 0.2);
          break;
        }
      }
    }

    const particles = [];
    let keys = {}, running = true, raf = null, ended = false;
    let startTime = performance.now();
    let position = 1; // race rank
    let cameraShake = 0;
    let slowmo = 0;

    // Audio: procedural engine
    let audioCtx = null, engineOsc = null, engineGain = null;
    function initAudio() {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        engineOsc = audioCtx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 60;
        engineGain = audioCtx.createGain();
        engineGain.gain.value = 0.0;
        const lp = audioCtx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 700;
        engineOsc.connect(lp).connect(engineGain).connect(audioCtx.destination);
        engineOsc.start();
      } catch (e) {}
    }
    function beep(freq, dur, type, vol) {
      try {
        if (!audioCtx) initAudio();
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        o.connect(g).connect(audioCtx.destination);
        o.start(); o.stop(audioCtx.currentTime + dur);
      } catch (e) {}
    }
    function crashSound() {
      try {
        if (!audioCtx) initAudio();
        const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const s = audioCtx.createBufferSource();
        s.buffer = buf;
        const g = audioCtx.createGain(); g.gain.value = 0.3;
        s.connect(g).connect(audioCtx.destination);
        s.start();
      } catch (e) {}
    }
    initAudio();

    function currentWeapon() { return WEAPON_TYPES[player.weapon] || WEAPON_TYPES.fists; }

    function onKey(e, down) {
      const k = e.key.toLowerCase();
      keys[k] = down;

      if (down && k === ' ' && player.attackCool <= 0) {
        const wep = currentWeapon();
        player.attackCool = wep.cooldown;
        player.attackFrame = wep.cooldown;
        for (const r of rivals) {
          if (!r.alive) continue;
          const dz = r.z - player.z;
          const dx = r.x - player.x;
          if (dz > 0 && dz < SEGMENT_LEN * wep.range && Math.abs(dx) < 0.6) {
            r.health -= wep.dmg;
            r.hitFlash = 0.3;
            r.angerCool = 1.5;
            particles.push({ x: W / 2 + (dx * 200), y: H / 2 - dz * 0.1, vx: (Math.random() - 0.5) * 3, vy: -3, life: 500, color: '#ffe57a', size: 4 });
            beep(wep.id === 'fists' ? 220 : 320, 0.09, 'square', 0.22);
            if (wep.id !== 'fists') {
              player.weaponDurability--;
              if (player.weaponDurability <= 0) {
                player.weapon = 'fists';
                player.weaponDurability = Infinity;
                beep(90, 0.25, 'sawtooth', 0.2);
              }
            }
            if (r.health <= 0) {
              r.alive = false; r.ko = true;
              player.money += 500;
              slowmo = 0.4;
              crashSound();
              spawnWeaponDrop(r);
            }
            break;
          }
        }
      }

      // Drop current weapon behind the bike (rivals can pick it back up)
      if (down && k === 'q' && player.weapon !== 'fists') {
        pickups.push({ x: player.x, z: Math.max(0, player.z - SEGMENT_LEN * 0.5), kind: 'weapon', weaponType: player.weapon });
        player.weapon = 'fists';
        player.weaponDurability = Infinity;
        beep(180, 0.1, 'square', 0.15);
      }

      // Lay an oil slick behind the bike, Road Rash 3 style
      if (down && k === 'e' && player.oilCount > 0) {
        player.oilCount--;
        hazards.push({ x: player.x, z: Math.max(0, player.z - SEGMENT_LEN * 1.2), life: 30 });
        beep(140, 0.16, 'sawtooth', 0.15);
      }

      if (down && k === 'escape') { onLose && onLose(); teardown(); }
    }
    const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);

    function findSegment(z) { return segments[Math.floor(z / SEGMENT_LEN) % segments.length]; }

    let lastT = performance.now();
    function step() {
      if (!running) return;
      const now = performance.now();
      let dt = (now - lastT) / 1000;
      if (dt > 0.1) dt = 0.1;
      lastT = now;

      const slowFactor = slowmo > 0 ? 0.3 : 1;
      const gdt = dt * slowFactor;
      if (slowmo > 0) slowmo -= dt;

      const playerSeg = findSegment(player.z);
      const speedPercent = player.speed / MAX_SPEED;
      const dx = gdt * 2 * speedPercent;

      // Input / steering (locked while slipping on oil)
      if (player.slipTimer > 0) {
        player.x += player.slipDir * gdt * 3.4 * (player.slipTimer / OIL_SLIP_TIME + 0.3);
        player.speed *= (1 - 2.6 * gdt);
        player.slipTimer = Math.max(0, player.slipTimer - dt);
        if (Math.random() < 0.5) particles.push({ x: W / 2 + (Math.random() - 0.5) * 40, y: H - 60, vx: (Math.random() - 0.5) * 3, vy: -1, life: 250, color: 'rgba(20,18,12,0.7)', size: 4 });
      } else {
        if (keys['a'] || keys['arrowleft']) player.x -= dx;
        if (keys['d'] || keys['arrowright']) player.x += dx;
        // Centrifugal on curves
        player.x -= dx * speedPercent * playerSeg.curve * CENTRIFUGAL;
      }

      const nitroActive = keys['shift'] && player.nitro > 0;
      if (nitroActive) player.nitro = Math.max(0, player.nitro - 20 * gdt);
      else player.nitro = Math.min(player.nitroMax, player.nitro + 8 * gdt);

      if (keys['w'] || keys['arrowup']) {
        player.speed += (nitroActive ? ACCEL * 1.7 : ACCEL) * gdt;
      } else if (keys['s'] || keys['arrowdown']) {
        player.speed += BRAKE * gdt;
      } else {
        player.speed += DECEL * gdt;
      }
      if (Math.abs(player.x) > 1 && player.speed > OFFROAD_LIMIT) {
        player.speed += DECEL * 2 * gdt;
      }
      player.speed = Math.max(0, Math.min(MAX_SPEED * (nitroActive ? 1.4 : 1), player.speed));
      player.x = Math.max(-2, Math.min(2, player.x));
      player.z = (player.z + player.speed * gdt);
      if (player.attackCool > 0) player.attackCool -= dt;
      if (player.attackFrame > 0) player.attackFrame -= dt;
      if (player.damageFlash > 0) player.damageFlash -= dt;

      // Engine sound pitch
      if (engineOsc && engineGain) {
        engineOsc.frequency.value = 60 + speedPercent * 260 + (nitroActive ? 60 : 0);
        engineGain.gain.value = 0.08 + speedPercent * 0.06;
      }

      // Pickups & hazards vs player
      tryCollectPickups(player, true);
      triggerSlip(player, true);

      // Decay hazards
      for (let i = hazards.length - 1; i >= 0; i--) {
        hazards[i].life -= dt;
        if (hazards[i].life <= 0) hazards.splice(i, 1);
      }

      // Rivals AI
      let rank = 1;
      for (const r of rivals) {
        if (!r.alive) continue;
        r.z += r.speed * gdt;
        if (r.hitFlash > 0) r.hitFlash -= dt;
        if (r.angerCool > 0) r.angerCool -= dt;
        if (r.attackCool > 0) r.attackCool -= dt;
        if (r.attackFrame > 0) r.attackFrame -= dt;

        tryCollectPickups(r, false);
        triggerSlip(r, false);

        if (r.slipTimer > 0) {
          r.x += r.slipDir * gdt * 3.4;
          r.x = Math.max(-1.4, Math.min(1.4, r.x));
        } else {
          // Lane change toward player when angry
          const target = r.angerCool > 0 ? player.x : (r.x < 0 ? -0.5 : 0.5);
          r.x += Math.sign(target - r.x) * 0.4 * gdt;
          r.x = Math.max(-1.2, Math.min(1.2, r.x));
        }

        const dz = r.z - player.z;
        const closeLat = Math.abs(r.x - player.x) < 0.5;

        // Weapon/fist swing attack on a cooldown, Road Rash style
        if (Math.abs(dz) < SEGMENT_LEN * 1.3 && closeLat && r.slipTimer <= 0) {
          r.angerCool = Math.max(r.angerCool, 0.8);
          if (r.attackCool <= 0) {
            const rw = r.weapon ? WEAPON_TYPES[r.weapon] : null;
            r.attackCool = rw ? rw.cooldown + 0.35 : 0.9;
            r.attackFrame = 0.3;
            const dmg = rw ? rw.dmg * 0.8 : 12;
            player.health -= dmg;
            player.damageFlash = 0.25;
            cameraShake = Math.max(cameraShake, 10);
            beep(180, 0.1, 'sawtooth', 0.2);
            if (rw) {
              r.weaponDurability--;
              if (r.weaponDurability <= 0) { r.weapon = null; r.weaponDurability = Infinity; }
            }
            if (player.health <= 0 && !ended) { ended = true; onLose && onLose(); teardown(); return; }
          }
        }
        // Light continuous ram damage on hard contact
        if (Math.abs(dz) < SEGMENT_LEN * 0.65 && closeLat) {
          player.health -= 6 * dt;
          player.damageFlash = Math.max(player.damageFlash, 0.15);
          if (player.health <= 0 && !ended) { ended = true; onLose && onLose(); teardown(); return; }
        }
        if (r.z > player.z) rank++;
      }
      position = rank;

      // Finish check
      const totalDist = FINISH_MARK * SEGMENT_LEN;
      if (player.z >= totalDist && !ended) {
        ended = true; onWin && onWin(); teardown(); return;
      }

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= dt * 1000;
        if (p.life <= 0) particles.splice(i, 1);
      }
      // Speed dust
      if (speedPercent > 0.6 && Math.random() < 0.5) {
        particles.push({ x: W/2 + (Math.random()-0.5)*30, y: H - 80 + Math.random()*20, vx: (Math.random()-0.5)*4, vy: -1, life: 300, color: 'rgba(210,190,140,0.7)', size: 3 });
      }
      if (cameraShake > 0) cameraShake -= dt * 30;

      draw(playerSeg, speedPercent, nitroActive);
      raf = requestAnimationFrame(step);
    }

    function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
      p.camera = { x: (p.world.x || 0) - cameraX, y: (p.world.y || 0) - cameraY, z: (p.world.z || 0) - cameraZ };
      p.screen = {};
      p.screen.scale = cameraDepth / p.camera.z;
      p.screen.x = Math.round((width / 2) + (p.screen.scale * p.camera.x * width / 2));
      p.screen.y = Math.round((height / 2) - (p.screen.scale * p.camera.y * height / 2));
      p.screen.w = Math.round(p.screen.scale * roadWidth * width / 2);
      return p;
    }

    function drawSegment(x1, y1, w1, x2, y2, w2, color) {
      const road1 = w1 * 0.9, road2 = w2 * 0.9;
      // grass
      ctx.fillStyle = color === 'dark' ? '#0e5a2a' : '#137a3a';
      ctx.fillRect(0, y2, W, y1 - y2);
      // rumble
      ctx.fillStyle = color === 'dark' ? '#c0202a' : '#f0f0f0';
      polygon(x1 - w1, y1, x1 - road1, y1, x2 - road2, y2, x2 - w2, y2);
      polygon(x1 + w1, y1, x1 + road1, y1, x2 + road2, y2, x2 + w2, y2);
      // road
      ctx.fillStyle = color === 'dark' ? '#2a2a2a' : '#3a3a3a';
      polygon(x1 - road1, y1, x1 + road1, y1, x2 + road2, y2, x2 - road2, y2);
      // lane
      if (color === 'light') {
        ctx.fillStyle = '#e8e8e8';
        const lane1 = road1 * 0.02, lane2 = road2 * 0.02;
        polygon(x1 - lane1, y1, x1 + lane1, y1, x2 + lane2, y2, x2 - lane2, y2);
      }
    }
    function polygon(x1, y1, x2, y2, x3, y3, x4, y4) {
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
      ctx.closePath(); ctx.fill();
    }

    // ---- Weapon icon (used both on-bike during a swing, and on ground pickups/HUD) ----
    function drawWeaponShape(type, x, y, s, progress) {
      const wep = WEAPON_TYPES[type];
      if (!wep) return;
      if (type === 'club') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(progress * 1.1);
        ctx.fillStyle = '#3a2a14'; ctx.fillRect(-2 * s, -4 * s, 4 * s, 8 * s);
        ctx.fillStyle = wep.color; ctx.fillRect(-3.2 * s, -18 * s, 6.4 * s, 15 * s);
        ctx.restore();
      } else if (type === 'chain') {
        ctx.strokeStyle = wep.color; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const zx = x + (i % 2 ? 6 * s : -6 * s);
          const zy = y - i * 6 * s;
          if (i === 0) ctx.moveTo(x, y); 
          ctx.lineTo(zx, zy - 6 * s);
        }
        ctx.stroke();
      } else if (type === 'nunchaku') {
        ctx.save(); ctx.translate(x, y); ctx.rotate(progress * 2.2);
        ctx.fillStyle = wep.color;
        ctx.fillRect(-2 * s, -12 * s, 4 * s, 10 * s);
        ctx.fillRect(-2 * s, 1 * s, 4 * s, 10 * s);
        ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(0, -2 * s); ctx.lineTo(0, 1 * s); ctx.stroke();
        ctx.restore();
      } else {
        // fists
        ctx.fillStyle = wep.color;
        ctx.beginPath(); ctx.arc(x, y, 6 * s, 0, Math.PI * 2); ctx.fill();
      }
    }

    // ---- Rider + bike sprite drawn from behind, Road Rash style ----
    function drawBike(sx, sy, scale, opts) {
      const s = Math.max(0.15, scale);
      const color = opts.color || '#ff2f2f';
      const lean = opts.lean || 0;
      const attackProgress = opts.attackProgress || 0; // 0..1, 1 = start of swing
      const weaponType = opts.weaponType || null;
      const hitFlash = opts.hitFlash || 0;
      const slipping = opts.slipping || false;
      const slipDir = opts.slipDir || 1;
      const isPlayer = !!opts.isPlayer;
      const helmet = opts.helmet || (isPlayer ? '#4ff0ff' : '#ff3030');

      ctx.save();
      ctx.translate(sx, sy);
      const tiltAngle = slipping ? 0.55 * slipDir : Math.max(-0.5, Math.min(0.5, lean * 0.35));
      ctx.rotate(tiltAngle);

      const w = 46 * s, h = 96 * s;

      // ground shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 3 * s, w * 0.78, w * 0.2, 0, 0, Math.PI * 2); ctx.fill();

      // rear wheel + hub
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.ellipse(0, -h * 0.12, w * 0.34, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#555';
      ctx.beginPath(); ctx.ellipse(0, -h * 0.12, w * 0.13, h * 0.055, 0, 0, Math.PI * 2); ctx.fill();

      // exhaust pipes
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(-w * 0.44, -h * 0.24, w * 0.13, h * 0.16);
      ctx.fillRect(w * 0.31, -h * 0.24, w * 0.13, h * 0.16);

      // tail light
      ctx.fillStyle = '#ff2f2f';
      ctx.fillRect(-w * 0.08, -h * 0.31, w * 0.16, h * 0.045);

      // rear fender / tail section
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w * 0.30, -h * 0.25);
      ctx.lineTo(w * 0.30, -h * 0.25);
      ctx.lineTo(w * 0.20, -h * 0.55);
      ctx.lineTo(-w * 0.20, -h * 0.55);
      ctx.closePath(); ctx.fill();

      // fuel-tank highlight stripe
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-w * 0.13, -h * 0.49, w * 0.26, h * 0.025);

      // rider legs (pegs)
      ctx.fillStyle = isPlayer ? '#2a2a30' : '#17181c';
      ctx.fillRect(-w * 0.34, -h * 0.42, w * 0.14, h * 0.16);
      ctx.fillRect(w * 0.20, -h * 0.42, w * 0.14, h * 0.16);

      // rider torso / jacket, leaning forward over the tank
      ctx.fillStyle = isPlayer ? '#8a2020' : '#22262e';
      ctx.beginPath();
      ctx.moveTo(-w * 0.24, -h * 0.55);
      ctx.lineTo(w * 0.24, -h * 0.55);
      ctx.lineTo(w * 0.30, -h * 0.86);
      ctx.lineTo(-w * 0.30, -h * 0.86);
      ctx.closePath(); ctx.fill();

      // racing stripe down the back
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2.2 * s;
      ctx.beginPath(); ctx.moveTo(0, -h * 0.56); ctx.lineTo(0, -h * 0.85); ctx.stroke();

      // shoulders / arms reaching to handlebar
      ctx.strokeStyle = isPlayer ? '#8a2020' : '#22262e';
      ctx.lineWidth = 8 * s; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-w * 0.26, -h * 0.80); ctx.lineTo(-w * 0.52, -h * 0.68);
      if (attackProgress <= 0) {
        ctx.moveTo(w * 0.26, -h * 0.80); ctx.lineTo(w * 0.52, -h * 0.68);
      }
      ctx.stroke();

      // handlebar
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4 * s;
      ctx.beginPath(); ctx.moveTo(-w * 0.55, -h * 0.665); ctx.lineTo(w * 0.55, -h * 0.665); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(-w * 0.55, -h * 0.665, 3.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.55, -h * 0.665, 3.5 * s, 0, Math.PI * 2); ctx.fill();

      // helmet
      ctx.fillStyle = helmet;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.93, w * 0.23, h * 0.10, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.ellipse(0, -h * 0.905, w * 0.16, h * 0.045, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-w * 0.03, -h * 1.00, w * 0.06, h * 0.09);

      // attacking arm swing (fist or weapon)
      if (attackProgress > 0) {
        const swing = 1 - attackProgress;
        const armX = w * 0.30 + swing * w * 0.9;
        const armY = -h * 0.78 - Math.sin(swing * Math.PI) * h * 0.12;
        ctx.strokeStyle = isPlayer ? '#e0b088' : '#c08868';
        ctx.lineWidth = 8 * s;
        ctx.beginPath(); ctx.moveTo(w * 0.26, -h * 0.80); ctx.lineTo(armX, armY); ctx.stroke();
        if (weaponType && weaponType !== 'fists') {
          drawWeaponShape(weaponType, armX, armY, s, swing);
        } else {
          ctx.fillStyle = isPlayer ? '#e0b088' : '#c08868';
          ctx.beginPath(); ctx.arc(armX, armY, 6 * s, 0, Math.PI * 2); ctx.fill();
        }
        if (isPlayer) {
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${16 * s | 0}px "Press Start 2P", monospace`;
          ctx.fillText(weaponType && weaponType !== 'fists' ? '' : 'POW!', armX + 6 * s, armY);
        }
      }

      // slipping smoke / sparks around the wheel
      if (slipping) {
        ctx.fillStyle = 'rgba(40,34,20,0.55)';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.ellipse((i - 1) * 14 * s, 6 * s, 10 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill();
        }
      }

      ctx.restore();

      if (hitFlash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.7, hitFlash * 2) + ')';
        ctx.beginPath(); ctx.ellipse(sx, sy - h * 0.5, w * 0.95, h * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawSideSprite(kind, sx, sy, scale, seed) {
      const s = scale;
      if (kind === 'building') {
        const stories = 3 + Math.floor((seed || 0.5) * 5);
        const bw = 70 * s, bh = stories * 34 * s;
        const hue = 200 + Math.floor((seed || 0.5) * 60);
        ctx.fillStyle = `hsl(${hue}, 20%, ${18 + (seed || 0.5) * 12}%)`;
        ctx.fillRect(sx - bw / 2, sy - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,220,140,0.55)';
        for (let r = 0; r < stories; r++) {
          for (let c = 0; c < 3; c++) {
            if (Math.random() < 0.6) ctx.fillRect(sx - bw / 2 + 8 * s + c * 22 * s, sy - bh + 10 * s + r * 34 * s, 10 * s, 14 * s);
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(sx - bw / 2, sy - bh, bw, 6 * s);
      } else if (kind === 'lamp') {
        ctx.fillStyle = '#222'; ctx.fillRect(sx - 2.5 * s, sy - 90 * s, 5 * s, 90 * s);
        ctx.fillStyle = '#333'; ctx.fillRect(sx - 2.5 * s, sy - 92 * s, 26 * s, 5 * s);
        ctx.fillStyle = '#ffe57a';
        ctx.beginPath(); ctx.arc(sx + 20 * s, sy - 90 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'sign') {
        ctx.fillStyle = '#6a4818'; ctx.fillRect(sx - 3*s, sy - 60*s, 6*s, 60*s);
        ctx.fillStyle = '#ffc72f'; ctx.fillRect(sx - 30*s, sy - 80*s, 60*s, 24*s);
        ctx.fillStyle = '#000'; ctx.font = `${10*s|0}px monospace`;
        ctx.fillText('ROAD FURY', sx - 26*s, sy - 66*s);
      }
    }

    function drawPickup(sx, sy, scale, p) {
      const s = scale * 160;
      ctx.save(); ctx.translate(sx, sy);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(0, 2 * s, 22 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      if (p.kind === 'oilcan') {
        ctx.fillStyle = '#151515'; ctx.fillRect(-7 * s, -22 * s, 14 * s, 22 * s);
        ctx.fillStyle = '#ffb347'; ctx.fillRect(-7 * s, -22 * s, 14 * s, 5 * s);
        ctx.fillStyle = '#fff'; ctx.font = `${7 * s | 0}px "Press Start 2P", monospace`;
        ctx.fillText('OIL', -6 * s, -9 * s);
      } else {
        drawWeaponShape(p.weaponType, 0, -14 * s, s, 0.35);
      }
      ctx.restore();
    }

    function drawHazard(sx, sy, scale) {
      const s = scale * 220;
      ctx.fillStyle = 'rgba(15,13,10,0.75)';
      ctx.beginPath(); ctx.ellipse(sx, sy, 34 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(90,80,45,0.35)';
      ctx.beginPath(); ctx.ellipse(sx - 8 * s, sy - 2 * s, 10 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
    }

    function draw(playerSeg, speedPercent, nitroActive) {
      // Sky
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H*0.55);
      skyGrad.addColorStop(0, '#ff5a2a'); skyGrad.addColorStop(0.5, '#ff2f8a'); skyGrad.addColorStop(1, '#4a1a5a');
      ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, H*0.55);
      // Sun
      const sunX = W/2 - playerSeg.curve * 20;
      const sunGrad = ctx.createRadialGradient(sunX, H*0.4, 5, sunX, H*0.4, 120);
      sunGrad.addColorStop(0, '#ffe57a'); sunGrad.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = sunGrad; ctx.fillRect(0, 0, W, H*0.55);

      // Camera shake
      const shx = (Math.random()-0.5) * cameraShake;
      const shy = (Math.random()-0.5) * cameraShake;
      ctx.save(); ctx.translate(shx, shy);

      // Road: iterate segments
      const baseSegIdx = Math.floor(player.z / SEGMENT_LEN) % segments.length;
      const cameraX = player.x * ROAD_W;
      const cameraY = CAMERA_HEIGHT + segments[baseSegIdx].p1.world.y;

      let maxY = H;
      let x = 0, dx = 0;
      for (let n = 0; n < DRAW_DIST; n++) {
        const seg = segments[(baseSegIdx + n) % segments.length];
        const loopedZ = (baseSegIdx + n) >= segments.length ? segments.length * SEGMENT_LEN : 0;
        seg.p1.world.x = -x; seg.p2.world.x = -x - dx;
        project(seg.p1, cameraX - x, cameraY, player.z - loopedZ, CAMERA_DEPTH, W, H, ROAD_W);
        project(seg.p2, cameraX - x - dx, cameraY, player.z - loopedZ, CAMERA_DEPTH, W, H, ROAD_W);
        x += dx; dx += seg.curve;
        if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= maxY) continue;
        drawSegment(seg.p1.screen.x, seg.p1.screen.y, seg.p1.screen.w,
                    seg.p2.screen.x, seg.p2.screen.y, seg.p2.screen.w, seg.color);
        maxY = seg.p2.screen.y;
        seg._proj = { x1: seg.p1.screen.x, y1: seg.p1.screen.y, w1: seg.p1.screen.w, scale: seg.p1.screen.scale };
      }

      // Roadside sprites (draw back-to-front)
      for (let n = DRAW_DIST - 1; n >= 0; n--) {
        const seg = segments[(baseSegIdx + n) % segments.length];
        if (!seg._proj) continue;
        for (const sp of seg.sprites) {
          const sx = seg._proj.x1 + sp.offset * seg._proj.w1;
          const sy = seg._proj.y1;
          drawSideSprite(sp.kind, sx, sy, seg._proj.scale * 200, sp.seed);
        }
      }

      // Oil hazards (draw flat on the road, back-to-front along with pickups)
      const trackItems = [];
      for (const h of hazards) trackItems.push({ z: h.z, kind: 'hazard', ref: h });
      for (const p of pickups) trackItems.push({ z: p.z, kind: 'pickup', ref: p });
      trackItems.sort((a, b) => b.z - a.z);
      for (const item of trackItems) {
        const dz = item.z - player.z;
        if (dz <= 0 || dz > DRAW_DIST * SEGMENT_LEN) continue;
        const scale = CAMERA_DEPTH / dz;
        const sx = W/2 + scale * (item.ref.x - player.x) * ROAD_W * W / 2;
        const sy = H/2 + scale * CAMERA_HEIGHT * H / 2;
        if (sy < H * 0.4 || sy > H + 40) continue;
        if (item.kind === 'hazard') drawHazard(sx, sy, scale);
        else drawPickup(sx, sy, scale, item.ref);
      }

      // Rivals (draw back-to-front)
      const sortedRivals = rivals.slice().sort((a, b) => b.z - a.z);
      for (const r of sortedRivals) {
        if (!r.alive) continue;
        const dz = r.z - player.z;
        if (dz < 0 || dz > DRAW_DIST * SEGMENT_LEN) continue;
        const scale = CAMERA_DEPTH / dz;
        const sx = W/2 + scale * (r.x - player.x) * ROAD_W * W / 2;
        const sy = H/2 + scale * CAMERA_HEIGHT * H / 2;
        drawBike(sx, Math.min(H - 40, sy), scale * 200, {
          color: r.color,
          lean: 0,
          attackProgress: r.attackFrame > 0 ? r.attackFrame / 0.3 : 0,
          weaponType: r.weapon,
          hitFlash: r.hitFlash,
          slipping: r.slipTimer > 0,
          slipDir: r.slipDir,
          isPlayer: false
        });
      }

      // Player bike (bottom center)
      const lean = ((keys['a']||keys['arrowleft']) ? -1 : (keys['d']||keys['arrowright']) ? 1 : 0) + player.x * 0.3;
      drawBike(W/2, H - 40, 1, {
        color: '#ff2f2f',
        lean,
        attackProgress: player.attackFrame > 0 ? player.attackFrame / currentWeapon().cooldown : 0,
        weaponType: player.weapon,
        hitFlash: 0,
        slipping: player.slipTimer > 0,
        slipDir: player.slipDir,
        isPlayer: true
      });

      // Speed lines
      if (speedPercent > 0.4) {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.1 + speedPercent * 0.25) + ')';
        for (let i = 0; i < 12; i++) {
          const y = (Math.random() * H * 0.6) + H * 0.35;
          const len = 40 + Math.random() * 60 * speedPercent;
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(len, y); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(W - len, y); ctx.lineTo(W, y); ctx.stroke();
        }
      }
      if (nitroActive) {
        ctx.fillStyle = 'rgba(79,240,255,0.15)';
        ctx.fillRect(0, 0, W, H);
      }

      // Particles
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 400));
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      // Damage flash
      if (player.damageFlash > 0) {
        ctx.fillStyle = `rgba(255,20,20,${player.damageFlash})`;
        ctx.fillRect(0, 0, W, H);
      }
      // Slip vignette
      if (player.slipTimer > 0) {
        ctx.fillStyle = `rgba(120,100,40,${0.15 * (player.slipTimer / OIL_SLIP_TIME)})`;
        ctx.fillRect(0, 0, W, H);
      }

      // HUD
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(0, 0, W, 60);
      ctx.strokeStyle = '#ff4fd8'; ctx.strokeRect(0, 0, W, 60);
      ctx.fillStyle = '#ffb347'; ctx.font = '18px "Press Start 2P", monospace';
      ctx.fillText('SPEED', 20, 26);
      ctx.fillStyle = '#333'; ctx.fillRect(120, 12, 200, 20);
      ctx.fillStyle = '#ff2f2f'; ctx.fillRect(120, 12, 200 * speedPercent, 20);
      ctx.fillStyle = '#fff'; ctx.font = '18px "VT323", monospace';
      ctx.fillText(`${Math.round(speedPercent * 220)} MPH`, 130, 50);

      ctx.fillStyle = '#ffb347';
      ctx.font = '14px "Press Start 2P", monospace';
      ctx.fillText('HP', 350, 26);
      ctx.fillStyle = '#333'; ctx.fillRect(390, 14, 160, 16);
      ctx.fillStyle = '#4fff8a'; ctx.fillRect(390, 14, 160 * Math.max(0, player.health/100), 16);

      ctx.fillText('NOS', 570, 26);
      ctx.fillStyle = '#333'; ctx.fillRect(620, 14, 140, 16);
      ctx.fillStyle = '#4ff0ff'; ctx.fillRect(620, 14, 140 * (player.nitro/100), 16);

      ctx.fillStyle = '#ffe57a';
      ctx.fillText(`POS ${position}/${rivals.length + 1}`, 780, 26);
      ctx.fillStyle = '#fff'; ctx.font = '16px "VT323", monospace';
      const dist = Math.min(100, (player.z / (FINISH_MARK * SEGMENT_LEN)) * 100);
      ctx.fillText(`TRACK ${dist.toFixed(0)}%`, 780, 48);

      // Weapon + oil readout
      ctx.font = '14px "Press Start 2P", monospace';
      ctx.fillStyle = player.weapon === 'fists' ? '#aaa' : '#ffe57a';
      ctx.fillText(currentWeapon().name, 20, 96);
      if (player.weapon !== 'fists' && Number.isFinite(player.weaponDurability)) {
        ctx.fillStyle = '#ff9040';
        for (let i = 0; i < player.weaponDurability; i++) ctx.fillRect(150 + i * 10, 86, 6, 10);
      }
      ctx.fillStyle = '#4ff0ff';
      ctx.fillText(`OIL x${player.oilCount}`, 260, 96);

      // Elapsed time / money
      const t = ((performance.now() - startTime) / 1000).toFixed(1);
      ctx.font = '16px "VT323", monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(`${t}s  $${player.money}`, 480, 96);
    }

    function teardown() {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
      try { if (engineOsc) engineOsc.stop(); } catch (e) {}
      try { if (audioCtx) audioCtx.close(); } catch (e) {}
    }

    step();
    return { teardown };
  }

  return { create };
})();