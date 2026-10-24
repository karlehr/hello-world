'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const POCKETS = 16; // must be even so the colors alternate evenly
  const TAU = Math.PI * 2;
  const SLICE = TAU / POCKETS;

  const PLAYERS = {
    H: { name: 'Heidi', colorVar: '--heidi' },
    N: { name: 'Hanne', colorVar: '--hanne' },
  };

  // Even pockets are Heidi's, odd pockets are Hanne's.
  const pocketPlayer = (i) => (i % 2 === 0 ? 'H' : 'N');

  // Timeline, in seconds from the tap.
  const ACCEL = 0.5;      // wheel reaches full speed
  const BALL_DROP = 1.0;  // ball appears on the rim
  const RESULT_DELAY = 300; // ms after everything is at rest

  // Geometry, as fractions of the wheel radius.
  const GEO = {
    bezelInner: 0.955,
    trackInner: 0.845,
    ballTrack: 0.90,
    pocketOuter: 0.845,
    pocketInner: 0.56,
    ballLip: 0.81,
    ballPocket: 0.715,
    ball: 0.045,
    hub: 0.13,
  };

  const HISTORY_KEY = 'frontseat.history.v1';

  // ---------------------------------------------------------------------------
  // Randomness (crypto only)
  // ---------------------------------------------------------------------------

  function randomFloat() {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  }

  function randomInt(n) {
    return Math.floor(randomFloat() * n);
  }

  function coinFlip() {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] & 1) ? 'H' : 'N';
  }

  // ---------------------------------------------------------------------------
  // History + streak rule
  // ---------------------------------------------------------------------------

  function loadHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY));
      if (Array.isArray(value)) return value.filter((x) => x === 'H' || x === 'N').slice(-4);
    } catch (e) { /* ignore */ }
    return [];
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* ignore */ }
  }

  function decideWinner() {
    const history = loadHistory();
    let winner;
    if (history.length === 4 && history.every((x) => x === history[0])) {
      winner = history[0] === 'H' ? 'N' : 'H';
    } else {
      winner = coinFlip();
    }
    history.push(winner);
    saveHistory(history.slice(-4));
    return winner;
  }

  // ---------------------------------------------------------------------------
  // Math helpers
  // ---------------------------------------------------------------------------

  const mod = (a, n) => ((a % n) + n) % n;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  // ---------------------------------------------------------------------------
  // Spin planning: the outcome is fixed first, then the motion is solved for it.
  //
  // Angles are measured clockwise from 12 o'clock. The wheel turns clockwise
  // (positive), the ball travels counter-clockwise (negative). At rest the
  // winning pocket sits under the pointer.
  // ---------------------------------------------------------------------------

  function planSpin(winner, startAngle) {
    const candidates = [];
    for (let i = 0; i < POCKETS; i++) if (pocketPlayer(i) === winner) candidates.push(i);
    const target = candidates[randomInt(candidates.length)];

    const wheelStop = 9.5 + randomFloat() * 0.25;
    const restJitter = (randomFloat() - 0.5) * 0.3 * SLICE;
    const needed = mod(-(target + 0.5) * SLICE + restJitter - startAngle, TAU);
    const wheelTotal = (5 + randomInt(3)) * TAU + needed;
    // Linear ramp to v0 over ACCEL, then v0 * (1 - u)^2 down to zero at wheelStop.
    const v0 = wheelTotal / (ACCEL / 2 + (wheelStop - ACCEL) / 3);

    // Ball lands `bounces` pockets ahead and hops back one pocket at a time.
    const bounces = [0, 1, 1, 2, 2][randomInt(5)];
    const relPath = [];
    for (let j = 0; j <= bounces; j++) relPath.push((target + bounces - j + 0.5) * SLICE);
    const hopDurations = [[], [0.5], [0.45, 0.35]][bounces];

    const tLand = 8.1 + randomFloat() * 0.4;
    const dropDur = 0.18;
    const tRest = tLand + dropDur + hopDurations.reduce((a, b) => a + b, 0);

    const plan = {
      winner, target, startAngle, wheelStop, wheelTotal, v0,
      relPath, hopDurations, tLand, dropDur, tRest,
      end: Math.max(tRest, wheelStop),
    };

    // Free-rolling ball: ends exactly over the first landing pocket at tLand.
    const ballStart = randomFloat() * TAU;
    const landWorld = wheelAngleAt(plan, tLand) + relPath[0];
    plan.ballStart = ballStart;
    plan.ballTravel = (4 + randomInt(2)) * TAU + mod(ballStart - landWorld, TAU);
    plan.ballWobble = randomFloat() * TAU;

    return plan;
  }

  function wheelAngleAt(p, t) {
    if (t <= 0) return p.startAngle;
    if (t < ACCEL) return p.startAngle + (p.v0 * t * t) / (2 * ACCEL);
    if (t < p.wheelStop) {
      const u = (t - ACCEL) / (p.wheelStop - ACCEL);
      return p.startAngle + (p.v0 * ACCEL) / 2 + ((p.v0 * (p.wheelStop - ACCEL)) / 3) * (1 - Math.pow(1 - u, 3));
    }
    return p.startAngle + p.wheelTotal;
  }

  // Ball position: { angle (world), radius (fraction of R) } or null if not visible.
  function ballAt(p, t, wheelAngle) {
    if (t < BALL_DROP) return null;

    if (t < p.tLand) {
      const s = (t - BALL_DROP) / (p.tLand - BALL_DROP);
      // Mostly ease-out, with a little linear drift so it still has momentum as it drops.
      const q = 0.92 * (1 - Math.pow(1 - s, 3)) + 0.08 * s;
      const angle = p.ballStart - p.ballTravel * q;
      const inward = smoothstep(0.5, 1, s);
      const wobble = Math.sin(s * 40 + p.ballWobble) * 0.008 * inward;
      const radius = lerp(GEO.ballTrack, GEO.ballLip, inward) + wobble;
      return { angle, radius };
    }

    // Locked to the wheel: drop into the first pocket, then hop toward the target.
    let local = t - p.tLand;
    if (local < p.dropDur) {
      const k = easeInOut(local / p.dropDur);
      return { angle: wheelAngle + p.relPath[0], radius: lerp(GEO.ballLip, GEO.ballPocket, k) };
    }
    local -= p.dropDur;
    for (let j = 0; j < p.hopDurations.length; j++) {
      const d = p.hopDurations[j];
      if (local < d) {
        const k = local / d;
        const hop = Math.sin(Math.PI * k) * 0.06 * Math.pow(0.6, j);
        return { angle: wheelAngle + lerp(p.relPath[j], p.relPath[j + 1], easeInOut(k)), radius: GEO.ballPocket + hop };
      }
      local -= d;
    }
    return { angle: wheelAngle + p.relPath[p.relPath.length - 1], radius: GEO.ballPocket };
  }

  // ---------------------------------------------------------------------------
  // Sound (synthesized; silently does nothing if unavailable)
  // ---------------------------------------------------------------------------

  // A faint noise whirr plus short filtered-noise "clacks": light ticks while
  // the ball rolls, and louder hits on diamonds, frets and pockets.

  let audio = null;
  let sfx = null;
  let suspendTimer = null;

  function unlockAudio() {
    clearTimeout(suspendTimer);
    try {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audio = new AC();
        sfx = buildSoundGraph(audio);
      }
      if (audio.state !== 'running') audio.resume();
    } catch (e) {
      audio = null;
      sfx = null;
    }
  }

  // Let the context sleep between spins so the noise loops don't burn battery.
  function sleepAudio() {
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => {
      if (audio && audio.state === 'running') audio.suspend();
    }, 2000);
  }

  function buildSoundGraph(ac) {
    const len = ac.sampleRate * 2;
    const white = ac.createBuffer(1, len, ac.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1; // audio noise only, not used for outcomes

    const master = ac.createDynamicsCompressor();
    master.connect(ac.destination);

    const bed = (buffer, type, freq, q) => {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ac.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(master);
      src.start();
      return { filter, gain };
    };
    // Only a faint, high whirr under the ball; the rolling is carried by ticks.
    const roll = bed(white, 'bandpass', 3500, 1.5);

    return { ac, master, white, roll };
  }

  // ballSpeed in rad/s; rolling = ball is free on the track.
  function updateSound(ballSpeed, rolling) {
    if (!sfx) return;
    const now = sfx.ac.currentTime;
    const b = rolling ? Math.min(1, ballSpeed / 14) : 0;
    sfx.roll.gain.gain.setTargetAtTime(0.06 * b, now, 0.15);
    sfx.roll.filter.frequency.setTargetAtTime(2500 + 2000 * b, now, 0.1);
  }

  function silenceBeds() {
    if (!sfx) return;
    sfx.roll.gain.gain.setTargetAtTime(0, sfx.ac.currentTime, 0.15);
  }

  function clack(vol, freq, dur = 0.035, delay = 0) {
    if (!sfx || sfx.ac.state !== 'running') return;
    const ac = sfx.ac;
    const t = ac.currentTime + delay;

    const src = ac.createBufferSource();
    src.buffer = sfx.white;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 6;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(sfx.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);

    // A short pitched "tok" gives the click some body.
    const osc = ac.createOscillator();
    const og = ac.createGain();
    osc.frequency.value = freq * 0.45;
    og.gain.setValueAtTime(vol * 0.12, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    osc.connect(og).connect(sfx.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const jitter = (base, spread) => base + (Math.random() - 0.5) * spread;

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');

  let size = 0;       // CSS px
  let dpr = 1;
  let wheelLayer = null; // pre-rendered rotating part
  let baseLayer = null;  // pre-rendered static bezel + track
  let colors = {};

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name) => cs.getPropertyValue(name).trim();
    colors = {
      heidi: v('--heidi'), hanne: v('--hanne'), bezel: v('--bezel'), bezelHi: v('--bezel-hi'),
      track: v('--track'), trackShade: v('--track-shade'), cone: v('--cone'), coneShade: v('--cone-shade'),
      sep: v('--sep'), pointer: v('--pointer'),
    };
  }

  function makeLayer() {
    const layer = document.createElement('canvas');
    layer.width = Math.round(size * dpr);
    layer.height = Math.round(size * dpr);
    const c = layer.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(size / 2, size / 2);
    return { layer, c };
  }

  // Canvas angles start at 3 o'clock; ours start at 12 o'clock.
  const toCanvas = (a) => a - Math.PI / 2;

  function renderBase() {
    const { layer, c } = makeLayer();
    const R = size / 2;

    c.beginPath();
    c.arc(0, 0, R, 0, TAU);
    const bezel = c.createRadialGradient(0, 0, R * 0.9, 0, 0, R);
    bezel.addColorStop(0, colors.bezelHi);
    bezel.addColorStop(1, colors.bezel);
    c.fillStyle = bezel;
    c.fill();

    c.beginPath();
    c.arc(0, 0, R * GEO.bezelInner, 0, TAU);
    const track = c.createRadialGradient(0, 0, R * GEO.trackInner, 0, 0, R * GEO.bezelInner);
    track.addColorStop(0, colors.trackShade);
    track.addColorStop(0.5, colors.track);
    track.addColorStop(1, colors.trackShade);
    c.fillStyle = track;
    c.fill();

    baseLayer = layer;
  }

  function renderWheel() {
    const { layer, c } = makeLayer();
    const R = size / 2;
    const outer = R * GEO.pocketOuter;
    const inner = R * GEO.pocketInner;

    for (let i = 0; i < POCKETS; i++) {
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, outer, toCanvas(i * SLICE), toCanvas((i + 1) * SLICE));
      c.closePath();
      c.fillStyle = pocketPlayer(i) === 'H' ? colors.heidi : colors.hanne;
      c.fill();
    }

    // Inner cone.
    c.beginPath();
    c.arc(0, 0, inner, 0, TAU);
    const cone = c.createRadialGradient(-inner * 0.3, -inner * 0.3, inner * 0.1, 0, 0, inner);
    cone.addColorStop(0, colors.cone);
    cone.addColorStop(1, colors.coneShade);
    c.fillStyle = cone;
    c.fill();

    // Separators.
    c.strokeStyle = colors.sep;
    c.lineWidth = Math.max(1.5, R * 0.012);
    c.lineCap = 'round';
    for (let i = 0; i < POCKETS; i++) {
      const a = toCanvas(i * SLICE);
      c.beginPath();
      c.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      c.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      c.stroke();
    }
    c.lineWidth = Math.max(1.5, R * 0.01);
    c.beginPath();
    c.arc(0, 0, outer, 0, TAU);
    c.stroke();
    c.beginPath();
    c.arc(0, 0, inner, 0, TAU);
    c.stroke();

    // Cone spokes and hub.
    c.lineWidth = Math.max(1, R * 0.008);
    c.strokeStyle = colors.coneShade;
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 4 + SLICE / 2;
      c.beginPath();
      c.moveTo(Math.cos(a) * R * GEO.hub, Math.sin(a) * R * GEO.hub);
      c.lineTo(Math.cos(a) * inner * 0.92, Math.sin(a) * inner * 0.92);
      c.stroke();
    }
    c.beginPath();
    c.arc(0, 0, R * GEO.hub, 0, TAU);
    const hub = c.createRadialGradient(-R * 0.04, -R * 0.04, R * 0.01, 0, 0, R * GEO.hub);
    hub.addColorStop(0, colors.bezelHi);
    hub.addColorStop(1, colors.bezel);
    c.fillStyle = hub;
    c.fill();

    wheelLayer = layer;
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const next = Math.floor(Math.min(rect.width, rect.height, 560));
    const nextDpr = Math.min(window.devicePixelRatio || 1, 3);
    if (next <= 0) return;
    if (next === size && nextDpr === dpr && wheelLayer) return;
    size = next;
    dpr = nextDpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    rebuild();
  }

  function rebuild() {
    readColors();
    renderBase();
    renderWheel();
    draw();
  }

  function drawPointer(R) {
    const tipY = -R * (GEO.trackInner - 0.02);
    const baseY = -R * 1.01;
    const halfW = R * 0.055;
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(-halfW, baseY);
    ctx.lineTo(halfW, baseY);
    ctx.closePath();
    ctx.fillStyle = colors.pointer;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = R * 0.02;
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }

  function drawBall(R, ball) {
    const x = Math.sin(ball.angle) * R * ball.radius;
    const y = -Math.cos(ball.angle) * R * ball.radius;
    const r = R * GEO.ball;

    ctx.beginPath();
    ctx.arc(x + r * 0.15, y + r * 0.25, r, 0, TAU);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.6, '#eceff3');
    g.addColorStop(1, '#a9b1bc');
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Current visual state.
  let wheelAngle = randomFloat() * TAU;
  let ball = null;

  function draw() {
    if (!wheelLayer) return;
    const R = size / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseLayer, 0, 0);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(wheelAngle);
    ctx.drawImage(wheelLayer, -canvas.width / 2, -canvas.height / 2);
    ctx.restore();

    ctx.setTransform(dpr, 0, 0, dpr, canvas.width / 2, canvas.height / 2);
    if (ball) drawBall(R, ball);
    drawPointer(R);
  }

  // ---------------------------------------------------------------------------
  // Spin + UI
  // ---------------------------------------------------------------------------

  const spinBtn = document.getElementById('spin');
  const result = document.getElementById('result');
  const resultCard = document.getElementById('result-card');
  const resultName = document.getElementById('result-name');
  const againBtn = document.getElementById('again');
  const announce = document.getElementById('announce');
  const title = document.getElementById('title');

  let spinning = false;
  let resultShownAt = 0;

  function spin() {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    announce.textContent = '';
    unlockAudio();

    const winner = decideWinner();
    const plan = planSpin(winner, mod(wheelAngle, TAU));
    ball = null;

    let t0 = null;
    let prevT = 0;
    let prevBall = null;
    let rollPhase = 0;
    let prevFret = null;
    let lastFretClick = 0;
    let hopIndex = -1;
    const hopsTotal = plan.hopDurations.reduce((a, b) => a + b, 0);

    const frame = (now) => {
      if (t0 === null) t0 = now;
      const t = Math.min((now - t0) / 1000, plan.end);
      const dt = t - prevT;

      wheelAngle = wheelAngleAt(plan, t);
      ball = ballAt(plan, t, wheelAngle);
      draw();

      // Rolling: faint whirr plus light ticks whose rate follows the ball's speed.
      const rolling = t >= BALL_DROP && t < plan.tLand;
      if (dt > 0) {
        const ballSpeed = ball && prevBall ? Math.abs(ball.angle - prevBall.angle) / dt : 0;
        updateSound(ballSpeed, rolling);
        if (rolling) {
          rollPhase += ballSpeed * dt * 1.6;
          if (rollPhase >= 1) {
            rollPhase %= 1;
            const b = Math.min(1, ballSpeed / 14);
            clack(jitter(0.12 + 0.1 * b, 0.06), jitter(5200, 1200), 0.018);
          }
        }
      }

      // Diamond hits: random rattles as the ball spirals in off the rim.
      if (rolling && dt > 0) {
        const s = (t - BALL_DROP) / (plan.tLand - BALL_DROP);
        const rate = 7 * smoothstep(0.45, 0.8, s) * (1 - 0.6 * smoothstep(0.85, 1, s));
        if (Math.random() < rate * dt) clack(jitter(0.9, 0.6), jitter(3200, 1600), 0.04);
      }

      // Fret clicks: ball skimming over the pocket dividers.
      if (ball && ball.radius < GEO.pocketOuter) {
        const fret = Math.floor((ball.angle - wheelAngle) / SLICE);
        if (prevFret !== null && fret !== prevFret && now - lastFretClick > 25) {
          lastFretClick = now;
          clack(jitter(0.5, 0.2), jitter(3800, 600), 0.025);
        }
        prevFret = fret;
      }

      // Drop into a pocket, hop over frets, settle.
      const local = t - plan.tLand;
      let phase = -1;
      if (local >= 0) {
        phase = 0;
        let acc = plan.dropDur;
        for (let j = 0; j < plan.hopDurations.length; j++) {
          if (local >= acc) phase = j + 1;
          acc += plan.hopDurations[j];
        }
        if (local >= plan.dropDur + hopsTotal) phase = plan.hopDurations.length + 1;
      }
      if (phase > hopIndex) {
        hopIndex = phase;
        if (phase === 0) {
          clack(1.4, 2000, 0.05);
          clack(0.7, 2800, 0.035, 0.07);
        } else if (phase <= plan.hopDurations.length) {
          clack(0.9 * Math.pow(0.7, phase - 1), 3000, 0.035);
        } else {
          clack(0.8, 1800, 0.05);
          clack(0.35, 2400, 0.03, 0.08);
          clack(0.15, 2600, 0.025, 0.14);
        }
      }

      prevT = t;
      prevBall = ball;

      if (t < plan.end) {
        requestAnimationFrame(frame);
      } else {
        silenceBeds();
        sleepAudio();
        wheelAngle = mod(wheelAngle, TAU);
        if (navigator.vibrate) {
          try { navigator.vibrate(30); } catch (e) { /* ignore */ }
        }
        setTimeout(() => showResult(winner), RESULT_DELAY);
      }
    };
    requestAnimationFrame(frame);
  }

  function showResult(winner) {
    const name = PLAYERS[winner].name;
    resultName.textContent = name;
    resultCard.classList.toggle('is-hanne', winner === 'N');
    result.hidden = false;
    resultShownAt = performance.now();
    announce.textContent = `${name} gets the front seat.`;
    againBtn.focus({ preventScroll: true });
  }

  function dismissResult() {
    if (result.hidden) return;
    result.hidden = true;
    spinning = false;
    spinBtn.disabled = false;
    spinBtn.focus({ preventScroll: true });
  }

  spinBtn.addEventListener('click', spin);
  againBtn.addEventListener('click', dismissResult);
  result.addEventListener('click', (e) => {
    // Ignore taps right as the overlay appears, so a stray tap doesn't dismiss it unseen.
    if (resultCard.contains(e.target)) return;
    if (performance.now() - resultShownAt < 500) return;
    dismissResult();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismissResult();
  });

  // Hidden dev affordance: tap the title 5 times quickly.
  let titleTaps = 0;
  let titleTimer = null;
  title.addEventListener('click', () => {
    titleTaps += 1;
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { titleTaps = 0; }, 1500);
    if (titleTaps < 5) return;
    titleTaps = 0;
    const history = loadHistory();
    console.log('[Front Seat] history (oldest first):', history.map((x) => PLAYERS[x].name));
    const label = history.length ? history.map((x) => PLAYERS[x].name).join(', ') : '(empty)';
    if (window.confirm(`History (oldest first):\n${label}\n\nReset history?`)) {
      saveHistory([]);
      console.log('[Front Seat] history reset');
    }
  });

  // Block iOS pinch-zoom gestures.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', rebuild);

  resize();
})();
