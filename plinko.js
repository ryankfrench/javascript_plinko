/*
 * Study C Plinko task.
 * The landing bin is drawn first. The canvas only plays that path back.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Plinko = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TASK_VERSION = 2;
  var ROWS = 8;
  var PAYOUTS = [100, 50, 15, 5, 2.5, 5, 15, 50, 100];
  var WEIGHTS = [1, 8, 28, 56, 70, 56, 28, 8, 1];
  var DEFAULT_ENDOWMENT = 10;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function freshSeed() {
    var cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : null;
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      var buf = new Uint32Array(1);
      cryptoObj.getRandomValues(buf);
      return buf[0];
    }
    return Math.floor(Math.random() * 4294967296);
  }

  function pathFromSeed(seed) {
    var rng = mulberry32(seed);
    var path = "";
    for (var i = 0; i < ROWS; i++) {
      path += rng() < 0.5 ? "L" : "R";
    }
    return path;
  }

  function binFromPath(path) {
    var rights = 0;
    for (var i = 0; i < path.length; i++) {
      if (path.charAt(i) === "R") rights += 1;
    }
    return rights;
  }

  function roundMoney(amount) {
    return Math.round(amount * 100) / 100;
  }

  function formatMoney(amount) {
    var rounded = roundMoney(amount);
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
      return "$" + String(Math.round(rounded));
    }
    return "$" + rounded.toFixed(2);
  }

  function expectedPayout() {
    var total = 0;
    var denom = 0;
    for (var i = 0; i < PAYOUTS.length; i++) {
      total += PAYOUTS[i] * WEIGHTS[i];
      denom += WEIGHTS[i];
    }
    return total / denom;
  }

  function drawTrial(seed) {
    if (seed === undefined || seed === null) seed = freshSeed();
    seed = seed >>> 0;
    var path = pathFromSeed(seed);
    var bin = binFromPath(path);
    return {
      seed: seed,
      path: path,
      bin: bin,
      payout: PAYOUTS[bin]
    };
  }

  function settle(decision, payout, endowment) {
    return {
      earnings: decision === "play" ? payout : endowment,
      signed_outcome: roundMoney(payout - endowment)
    };
  }

  function protocolMessage(decision, endowment) {
    if (decision === "play") {
      return "The ball will now drop. Where it lands determines your earnings for this stage.";
    }
    return (
      "The ball will now drop. You chose not to play, so where it lands will NOT affect your earnings of " +
      formatMoney(endowment) +
      " for this stage."
    );
  }

  function outcomeMessage(decision, payout, earnings, endowment) {
    if (decision === "play") {
      return "You earn " + formatMoney(earnings) + " for this stage.";
    }
    return (
      "You keep " +
      formatMoney(endowment) +
      " for this stage. The ball landed on " +
      formatMoney(payout) +
      "."
    );
  }

  // Nine segments: a drop onto each of 8 pegs, then the settle into the bin.
  // The first seven accelerate. The last two share half the total time.
  function segmentDurations(totalMs) {
    var earlyCount = 7;
    var earlyShare = 0.5;
    var lateShare = 0.5;
    var earlyWeights = [];
    var i;
    for (i = 0; i < earlyCount; i++) earlyWeights.push(Math.pow(0.75, i));
    var earlySum = 0;
    for (i = 0; i < earlyWeights.length; i++) earlySum += earlyWeights[i];
    var durations = [];
    for (i = 0; i < earlyWeights.length; i++) {
      durations.push((totalMs * earlyShare * earlyWeights[i]) / earlySum);
    }
    durations.push(totalMs * lateShare * 0.42);
    durations.push(totalMs * lateShare * 0.58);
    return durations;
  }

  // Guided Physics spends time in proportion to how many steps a channel took.
  // The last two segments stay the long, slow ones.
  function playbackDurations(totalMs, hops) {
    var weights = [];
    var i;
    for (i = 0; i < hops.length; i++) {
      var count = hops[i].points ? hops[i].points.length : 1;
      weights.push(Math.max(12, count));
    }
    var n = weights.length;
    if (n >= 2) {
      weights[n - 2] *= 1.7;
      weights[n - 1] *= 2.2;
    }
    var sum = 0;
    for (i = 0; i < n; i++) sum += weights[i];
    var out = [];
    for (i = 0; i < n; i++) out.push((totalMs * weights[i]) / sum);
    return out;
  }

  function storageKey(responseId, round) {
    return "plinko:" + String(responseId) + ":round:" + String(round);
  }

  function readStored(key) {
    try {
      if (typeof sessionStorage === "undefined") return null;
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeStored(key, record) {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.setItem(key, JSON.stringify(record));
    } catch (err) {
      /* Private mode and some survey browsers block storage. The trial still runs. */
    }
  }

  function blankTimestamps() {
    return {
      choice_iso: null,
      message_onset_iso: null,
      message_offset_iso: null,
      animation_start_iso: null,
      animation_end_iso: null,
      reveal_onset_iso: null,
      next_enabled_iso: null
    };
  }

  function createRecord(options, decision, trial) {
    var money = settle(decision, trial.payout, options.endowment);
    var stamps = blankTimestamps();
    var now = new Date().toISOString();
    stamps.choice_iso = now;
    stamps.message_onset_iso = now;
    return {
      task_version: TASK_VERSION,
      round: options.round,
      decision: decision,
      seed: trial.seed,
      path: trial.path,
      bin: trial.bin,
      payout: trial.payout,
      endowment: options.endowment,
      earnings: money.earnings,
      signed_outcome: money.signed_outcome,
      interrupted: false,
      animation: options.animation === "guided-physics" ? "guided-physics" : "guided",
      physics_fallback: false,
      disk_radius: options.diskRadius,
      peg_radius: options.pegRadius,
      drop_duration_ms: options.dropDurationMs,
      message_dwell_ms: options.messageDwellMs,
      reveal_dwell_ms: options.revealDwellMs,
      choice_iso: stamps.choice_iso,
      message_onset_iso: stamps.message_onset_iso,
      message_offset_iso: stamps.message_offset_iso,
      animation_start_iso: stamps.animation_start_iso,
      animation_end_iso: stamps.animation_end_iso,
      reveal_onset_iso: stamps.reveal_onset_iso,
      next_enabled_iso: stamps.next_enabled_iso
    };
  }

  function validPath(path) {
    if (typeof path !== "string" || path.length !== ROWS) return false;
    for (var i = 0; i < path.length; i++) {
      var ch = path.charAt(i);
      if (ch !== "L" && ch !== "R") return false;
    }
    return true;
  }

  function injectCss() {
    if (typeof document === "undefined") return;
    if (document.getElementById("plinko-style")) return;
    var style = document.createElement("style");
    style.id = "plinko-style";
    style.textContent = [
      ".plinko-app {",
      "  box-sizing: border-box;",
      "  max-width: 760px;",
      "  margin: 0 auto;",
      "  color: #1c2430;",
      "  font-family: \"Segoe UI\", Helvetica, Arial, sans-serif;",
      "  line-height: 1.4;",
      "}",
      ".plinko-app *, .plinko-app *::before, .plinko-app *::after { box-sizing: border-box; }",
      ".plinko-endowment {",
      "  margin: 0 0 6px;",
      "  font-size: 1.35rem;",
      "  font-weight: 650;",
      "}",
      ".plinko-instruction {",
      "  margin: 0 0 12px;",
      "  font-size: 1.05rem;",
      "}",
      ".plinko-canvas {",
      "  display: block;",
      "  width: 100%;",
      "  background: #fbfaf7;",
      "  border: 1px solid #d5d0c6;",
      "  border-radius: 10px;",
      "}",
      ".plinko-actions {",
      "  display: flex;",
      "  gap: 12px;",
      "  margin-top: 16px;",
      "}",
      ".plinko-actions button {",
      "  flex: 1 1 0;",
      "  appearance: none;",
      "  font: inherit;",
      "  font-size: 1.15rem;",
      "  font-weight: 650;",
      "  padding: 14px 16px;",
      "  border-radius: 8px;",
      "  border: 2px solid #1c2430;",
      "  background: #fff;",
      "  color: #1c2430;",
      "  cursor: pointer;",
      "}",
      ".plinko-actions button:hover:not(:disabled) { background: #eef2f4; }",
      ".plinko-actions button:disabled { cursor: default; opacity: 0.45; }",
      ".plinko-actions button:focus-visible {",
      "  outline: 3px solid #c2410c;",
      "  outline-offset: 2px;",
      "}",
      ".plinko-banner {",
      "  margin: 0 0 12px;",
      "  padding: 16px 18px;",
      "  border-radius: 8px;",
      "  background: #1c2430;",
      "  color: #fbfaf7;",
      "  font-size: 1.2rem;",
      "  line-height: 1.45;",
      "}",
      ".plinko-banner:empty { display: none; }",
      ".plinko-banner:focus { outline: none; }"
    ].join("\n");
    document.head.appendChild(style);
  }

  function layoutOf(width, height, disk) {
    var padX = 18;
    var gap = 4;
    var binCount = PAYOUTS.length;
    var binH = Math.max(52, Math.round(height * 0.12));
    var binTop = height - binH - 10;
    var inner = width - padX * 2;
    var binWidth = (inner - gap * (binCount - 1)) / binCount;
    var spacing = binWidth + gap;
    var centerX = padX + 4 * spacing + binWidth / 2;
    var diskRadiusPx = spacing * disk.diskRadius;
    var pegRadiusPx = spacing * disk.pegRadius;
    var pegBottom = binTop - Math.max(26, Math.ceil(diskRadiusPx + 12));
    var startY = -0.4 - (disk.diskRadius + disk.pegRadius);
    var above = (-startY / LOGICAL_ROW) / (ROWS - 1);
    var need = diskRadiusPx + 8;
    var pegTop = Math.ceil((need + above * pegBottom) / (1 + above));
    var rowGap = (pegBottom - pegTop) / (ROWS - 1);
    return {
      width: width,
      height: height,
      padX: padX,
      gap: gap,
      binWidth: binWidth,
      binH: binH,
      binTop: binTop,
      spacing: spacing,
      centerX: centerX,
      pegTop: pegTop,
      rowGap: rowGap,
      diskRadiusPx: diskRadiusPx,
      pegRadiusPx: pegRadiusPx,
      yStart: 16,
      binBallY: binTop - diskRadiusPx - 6
    };
  }

  function pegPosition(geo, row, pegIndex) {
    return {
      x: geo.centerX + (pegIndex - row / 2) * geo.spacing,
      y: geo.pegTop + row * geo.rowGap
    };
  }

  var LOGICAL_ROW = 0.58;
  var DEFAULT_DISK_RADIUS = 0.2;
  var DEFAULT_PEG_RADIUS = 5 / 76;

  function diskSpec(diskRadius, pegRadius) {
    var disk = typeof diskRadius === "number" && diskRadius > 0 ? diskRadius : DEFAULT_DISK_RADIUS;
    var peg = typeof pegRadius === "number" && pegRadius > 0 ? pegRadius : DEFAULT_PEG_RADIUS;
    return { diskRadius: disk, pegRadius: peg, gap: disk + peg };
  }

  function roundStep(n) {
    return Math.round(n * 4096) / 4096;
  }

  function logicalPeg(row, index) {
    return {
      x: index - row / 2,
      y: row * LOGICAL_ROW
    };
  }

  function logicalBin(bin) {
    return { x: bin - 4, y: 7 * LOGICAL_ROW + 0.17, bin: true };
  }

  function exitAngle(seed, row) {
    var rng = mulberry32((seed + row * 0x9e3779b9) >>> 0);
    var theta = 0.62 + (rng() - 0.5) * ((8 * Math.PI) / 180);
    if (theta < 0.4) theta = 0.4;
    if (theta > 0.95) theta = 0.95;
    return theta;
  }

  function shoulder(peg, dir, theta, gap) {
    return {
      x: peg.x + dir * Math.sin(theta) * gap,
      y: peg.y - Math.cos(theta) * gap
    };
  }

  function logicalStart(gap) {
    var y = -0.4 - gap;
    return { x: 0, y: y };
  }

  function contactsFor(path, seed, gap) {
    var points = [logicalStart(gap)];
    var pegs = [];
    var rights = 0;
    for (var r = 0; r < path.length; r++) {
      var dir = path.charAt(r) === "R" ? 1 : -1;
      var peg = logicalPeg(r, rights);
      points.push(shoulder(peg, dir, exitAngle(seed >>> 0, r), gap));
      pegs.push({ row: r, index: rights, dir: dir });
      if (dir === 1) rights += 1;
    }
    points.push(logicalBin(rights));
    return { points: points, pegs: pegs, bin: rights };
  }

  function hopPoint(from, to, t) {
    var dy = to.y - from.y;
    var g = dy > 0 ? dy * 0.85 : 0;
    var vy0 = dy - 0.5 * g;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + vy0 * t + 0.5 * g * t * t,
      bin: to.bin && t === 1 ? true : undefined
    };
  }

  function sampleGuidedHop(from, to) {
    var points = [];
    var steps = 16;
    for (var i = 0; i <= steps; i++) points.push(hopPoint(from, to, i / steps));
    return points;
  }

  function fallTime(dy, vy, g) {
    if (dy <= 0.0001) return 0.04;
    var disc = vy * vy + 2 * g * dy;
    if (disc < 0) disc = 0;
    return (-vy + Math.sqrt(disc)) / g;
  }

  function simulateFall(from, endPoint) {
    var g = 2.4;
    var dt = 1 / 180;
    var x = from.x;
    var y = from.y;
    var flight = fallTime(Math.max(endPoint.y - from.y, 0.02), 0.2, g);
    var vx = flight > 0 ? (endPoint.x - from.x) / flight : 0;
    var vy = 0.2;
    var points = [{ x: x, y: y }];
    var step;
    for (step = 0; step < 400; step++) {
      var remain = endPoint.y - y;
      var predT = fallTime(Math.max(remain, 0.01), Math.max(vy, 0.05), g);
      var err = endPoint.x - (x + vx * predT);
      var ax = err * 1.2;
      if (ax > 1) ax = 1;
      if (ax < -1) ax = -1;
      vx = roundStep(vx + ax * dt);
      vy = roundStep(vy + g * dt);
      x = roundStep(x + vx * dt);
      y = roundStep(y + vy * dt);
      points.push({ x: x, y: y });
      if (y >= endPoint.y) {
        points[points.length - 1] = { x: endPoint.x, y: endPoint.y, bin: true };
        return { hit: true, points: points };
      }
    }
    return { hit: false, points: points };
  }

  function reflectDisk(x, y, vx, vy, peg, gap, restitution) {
    var dx = x - peg.x;
    var dy = y - peg.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (!(dist < gap) || dist === 0) return null;
    var nx = dx / dist;
    var ny = dy / dist;
    var pen = gap - dist;
    x = roundStep(x + nx * pen);
    y = roundStep(y + ny * pen);
    var vn = vx * nx + vy * ny;
    if (vn >= 0) return { x: x, y: y, vx: vx, vy: vy, nx: nx, ny: ny, reflected: false };
    if (vn > -0.35) {
      return { x: x, y: y, vx: vx, vy: vy, nx: nx, ny: ny, reflected: false };
    }
    var bounce = 1 + restitution;
    return {
      x: x,
      y: y,
      vx: roundStep(vx - bounce * vn * nx),
      vy: roundStep(vy - bounce * vn * ny),
      nx: nx,
      ny: ny,
      reflected: true
    };
  }

  function reflectPlane(x, y, vx, vy, planeX, normalSign, gap, restitution) {
    var signed = (x - planeX) * normalSign;
    if (signed >= gap) return null;
    x = roundStep(x + normalSign * (gap - signed));
    var vn = vx * normalSign;
    if (vn >= 0) return { x: x, y: y, vx: vx, vy: vy, reflected: false };
    return {
      x: x,
      y: y,
      vx: roundStep(vx - (1 + restitution) * vn * normalSign),
      vy: vy,
      reflected: true
    };
  }

  function wallsForStep(row, rightsBefore, dir) {
    var peg = logicalPeg(row, rightsBefore);
    var neighborIndex = rightsBefore + dir;
    var neighbor = null;
    if (neighborIndex >= 0 && neighborIndex <= row) neighbor = logicalPeg(row, neighborIndex);
    var left;
    var right;
    if (dir === 1) {
      left = { x: peg.x, y: peg.y, virtual: false };
      right = neighbor
        ? { x: neighbor.x, y: neighbor.y, virtual: false }
        : { x: roundStep(peg.x + 1), y: peg.y, virtual: true };
    } else {
      right = { x: peg.x, y: peg.y, virtual: false };
      left = neighbor
        ? { x: neighbor.x, y: neighbor.y, virtual: false }
        : { x: roundStep(peg.x - 1), y: peg.y, virtual: true };
    }
    return { left: left, right: right, exitY: left.y };
  }

  function maxSafeSpeed(x, y, vy, targetX, targetY) {
    var g = 2.4;
    var dx = targetX - x;
    var dy = targetY - y;
    var adx = Math.abs(dx);
    if (!(adx > 0.001)) return 0;
    if (!(dy > 0.02)) return 0.4;
    var disc = vy * adx * (vy * adx) + 2 * g * dy * adx * adx;
    var speed = (vy * adx + Math.sqrt(Math.max(0, disc))) / (2 * dy);
    if (speed > 2.4) speed = 2.4;
    if (!(speed > 0)) speed = 0;
    return speed;
  }

  function capHorizontal(x, y, vx, vy, leftX, rightX, targetY, gap) {
    var pinX = vx >= 0 ? rightX : leftX;
    var t = (pinX - x) / vx;
    if (t > 0.001) {
      var yAt = y + vy * t + 1.2 * t * t;
      if (yAt >= targetY - gap) return roundStep(vx);
    }
    var safe = maxSafeSpeed(x, y, vy, pinX, targetY) * 0.96;
    if (Math.abs(vx) > safe) vx = (vx >= 0 ? 1 : -1) * safe;
    return roundStep(vx);
  }

  function headingInto(x, y, vx, vy, pinX, pinY, gap) {
    var g = 2.4;
    var dt = 1 / 180;
    var cx = x;
    var cy = y;
    var cvy = vy;
    var i;
    for (i = 0; i < 48; i++) {
      cvy += g * dt;
      cx += vx * dt;
      cy += cvy * dt;
      if (cy > pinY + gap) return false;
      var dx = cx - pinX;
      var dy = cy - pinY;
      if (dx * dx + dy * dy < gap * gap) return true;
    }
    return false;
  }

  function brakeLanding(x, y, vx, vy, x0, x1, targetY) {
    var g = 2.4;
    var width = x1 - x0;
    var pad = width > 0.08 ? 0.02 : 0;
    var gate0 = x0 + pad;
    var gate1 = x1 - pad;
    var dy = targetY - y;
    if (dy <= 0) {
      var span = Math.max(vy, 0.4);
      if (x > gate1) {
        var pullRight = -Math.min(2, (x - gate1) * span / 0.12);
        if (vx > pullRight) vx = pullRight;
      } else if (x < gate0) {
        var pullLeft = Math.min(2, (gate0 - x) * span / 0.12);
        if (vx < pullLeft) vx = pullLeft;
      }
      return roundStep(vx);
    }
    var disc = vy * vy + 2 * g * dy;
    var t = (-vy + Math.sqrt(Math.max(0, disc))) / g;
    if (!(t > 0.02)) return vx;
    var land = x + vx * t;
    if (land > gate1 && vx > 0) {
      var need = (gate1 - x) / t;
      if (need < 0) need = 0;
      if (vx > need) vx = need;
    } else if (land < gate0 && vx < 0) {
      var needLeft = (gate0 - x) / t;
      if (needLeft > 0) needLeft = 0;
      if (vx < needLeft) vx = needLeft;
    }
    return roundStep(vx);
  }

  function pinsNear(row) {
    var pins = [];
    var r0 = row - 2;
    if (r0 < 0) r0 = 0;
    var r;
    var p;
    for (r = r0; r <= row; r++) {
      for (p = 0; p <= r; p++) pins.push(logicalPeg(r, p));
    }
    return pins;
  }

  function simulateChannel(from, walls, handoff, env) {
    var gap = env.gap;
    var rng = mulberry32((env.seed + env.row * 0x9e3779b9 + 17) >>> 0);
    var restitution = 0.58 + rng() * 0.14;
    var x = from.x;
    var y = from.y;
    var vx = from.vx;
    var vy = from.vy;
    if (vx === undefined || vy === undefined) {
      var goRight = rng() < 0.5;
      var targetX = goRight ? walls.right.x : walls.left.x;
      var sign = targetX >= x ? 1 : -1;
      if (vy === undefined) vy = 0.08 + rng() * 0.14;
      var safe = maxSafeSpeed(x, y, vy, targetX, walls.exitY);
      vx = sign * safe * (0.78 + rng() * 0.16);
    }
    vx = capHorizontal(x, y, vx, vy, walls.left.x, walls.right.x, walls.exitY, gap);
    var points = [{ x: roundStep(x), y: roundStep(y) }];
    var hits = 0;
    var overheadHits = 0;
    var overhead = null;
    var g = 2.4;
    var dt = 1 / 180;
    var pins = pinsNear(env.row);
    var stalled = false;
    var step;
    for (step = 0; step < 900; step++) {
      if (y > walls.exitY - 0.03 && vy > 0) {
        var pinX = vx >= 0 ? walls.right.x : walls.left.x;
        if (!headingInto(x, y, vx, vy, pinX, walls.exitY, gap)) {
          vx = brakeLanding(x, y, vx, vy, handoff.x0, handoff.x1, walls.exitY);
        }
      }
      vy = roundStep(vy + g * dt);
      x = roundStep(x + vx * dt);
      y = roundStep(y + vy * dt);
      var guard = 0;
      while (guard < 4) {
        guard += 1;
        var best = null;
        var bi;
        for (bi = 0; bi < pins.length; bi++) {
          var peg = pins[bi];
          var dx = x - peg.x;
          var dy = y - peg.y;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < gap && (best === null || dist < best.dist)) best = { peg: peg, dist: dist };
        }
        if (!best) break;
        var bounced = reflectDisk(x, y, vx, vy, best.peg, gap, restitution);
        if (!bounced) break;
        x = bounced.x;
        y = bounced.y;
        vx = bounced.vx;
        vy = bounced.vy;
        if (!bounced.reflected) break;
        hits += 1;
        if (best.peg.y < walls.exitY - 0.2) {
          overheadHits += 1;
          if (!overhead) {
            overhead = { nx: bounced.nx, ny: bounced.ny, vx: bounced.vx, vy: bounced.vy };
          }
        }
        vx = capHorizontal(x, y, vx, vy, walls.left.x, walls.right.x, walls.exitY, gap);
      }
      if (walls.left.virtual) {
        var leftHit = reflectPlane(x, y, vx, vy, walls.left.x, 1, gap, restitution);
        if (leftHit) {
          x = leftHit.x;
          y = leftHit.y;
          vx = leftHit.vx;
          vy = leftHit.vy;
          if (leftHit.reflected) {
            hits += 1;
            vx = capHorizontal(x, y, vx, vy, walls.left.x, walls.right.x, walls.exitY, gap);
          }
        }
      }
      if (walls.right.virtual) {
        var rightHit = reflectPlane(x, y, vx, vy, walls.right.x, -1, gap, restitution);
        if (rightHit) {
          x = rightHit.x;
          y = rightHit.y;
          vx = rightHit.vx;
          vy = rightHit.vy;
          if (rightHit.reflected) {
            hits += 1;
            vx = capHorizontal(x, y, vx, vy, walls.left.x, walls.right.x, walls.exitY, gap);
          }
        }
      }
      if (x <= walls.left.x) {
        x = roundStep(walls.left.x + 0.004);
        if (vx < 0) vx = roundStep(-vx * restitution);
      }
      if (x >= walls.right.x) {
        x = roundStep(walls.right.x - 0.004);
        if (vx > 0) vx = roundStep(-vx * restitution);
      }
      var speed = Math.sqrt(vx * vx + vy * vy);
      var nearlyStill = y < walls.exitY - 0.1 && Math.abs(vx) < 0.18 && vy < 0.25;
      if (nearlyStill && !stalled && step > 30) {
        var gateMid = (handoff.x0 + handoff.x1) / 2;
        vx = roundStep(vx + (gateMid >= x ? 1 : -1) * speed * 0.5);
        vx = capHorizontal(x, y, vx, vy, walls.left.x, walls.right.x, walls.exitY, gap);
        stalled = true;
      }
      if (!nearlyStill) stalled = false;
      if (hits >= 3 && vy < 0) vy = roundStep(vy * 0.97);
      points.push({ x: roundStep(x), y: roundStep(y) });
      if (y > walls.exitY && x > handoff.x0 && x < handoff.x1) {
        return {
          hit: true,
          points: points,
          hits: hits,
          overheadHits: overheadHits,
          overhead: overhead,
          x: x,
          y: y,
          vx: vx,
          vy: vy
        };
      }
    }
    return {
      hit: false,
      points: points,
      hits: hits,
      overheadHits: overheadHits,
      overhead: overhead,
      x: x,
      y: y,
      vx: vx,
      vy: vy
    };
  }

  function channelHandoff(walls, row, nextRights, path, bin) {
    var x0 = walls.left.x;
    var x1 = walls.right.x;
    if (row + 1 < ROWS) {
      var nextDir = path.charAt(row + 1) === "R" ? 1 : -1;
      var nextWalls = wallsForStep(row + 1, nextRights, nextDir);
      if (nextWalls.left.x > x0) x0 = nextWalls.left.x;
      if (nextWalls.right.x < x1) x1 = nextWalls.right.x;
    } else {
      var center = bin - 4;
      if (center - 0.5 > x0) x0 = center - 0.5;
      if (center + 0.5 < x1) x1 = center + 0.5;
    }
    if (!(x0 < x1)) {
      x0 = walls.left.x + 0.02;
      x1 = walls.right.x - 0.02;
    }
    return { x0: x0, x1: x1 };
  }

  function guidedRoute(path, seed, diskRadius, pegRadius) {
    var disk = diskSpec(diskRadius, pegRadius);
    var layout = contactsFor(path, seed >>> 0, disk.gap);
    var hops = [];
    for (var i = 0; i < layout.points.length - 1; i++) {
      hops.push({ points: sampleGuidedHop(layout.points[i], layout.points[i + 1]), fallback: false });
    }
    return {
      animation: "guided",
      fallback: false,
      contacts: layout.pegs,
      bin: layout.bin,
      diskRadius: disk.diskRadius,
      pegRadius: disk.pegRadius,
      hops: hops
    };
  }

  function simulatePhysics(path, seed, diskRadius, pegRadius) {
    var disk = diskSpec(diskRadius, pegRadius);
    var layout = contactsFor(path, seed >>> 0, disk.gap);
    var hops = [];
    var fallback = false;
    var pos = layout.points[0];
    var vel = { vy: undefined };
    var rights = 0;
    var row;
    for (row = 0; row < layout.pegs.length; row++) {
      var dir = path.charAt(row) === "R" ? 1 : -1;
      var walls = wallsForStep(row, rights, dir);
      var nextRights = rights + (dir === 1 ? 1 : 0);
      var handoff = channelHandoff(walls, row, nextRights, path, layout.bin);
      var sim = simulateChannel(
        { x: pos.x, y: pos.y, vx: vel.vx, vy: vel.vy },
        walls,
        handoff,
        { seed: seed >>> 0, row: row, gap: disk.gap }
      );
      if (!sim.hit) {
        fallback = true;
        var guidedTo = {
          x: (handoff.x0 + handoff.x1) / 2,
          y: roundStep(walls.exitY + 0.02)
        };
        var guided = sampleGuidedHop(pos, guidedTo);
        hops.push({
          points: guided,
          fallback: true,
          hits: 0,
          overheadHits: 0,
          left: walls.left.x,
          right: walls.right.x,
          exitY: walls.exitY,
          interior: !walls.left.virtual && !walls.right.virtual
        });
        pos = guided[guided.length - 1];
        vel = { vx: undefined, vy: undefined };
      } else {
        hops.push({
          points: sim.points,
          fallback: false,
          hits: sim.hits,
          overheadHits: sim.overheadHits,
          overhead: sim.overhead,
          left: walls.left.x,
          right: walls.right.x,
          exitY: walls.exitY,
          interior: !walls.left.virtual && !walls.right.virtual
        });
        pos = sim.points[sim.points.length - 1];
        vel = { vx: sim.vx, vy: sim.vy };
      }
      rights = nextRights;
    }
    var lastTo = layout.points[layout.points.length - 1];
    var intoBin = simulateFall(pos, lastTo);
    if (!intoBin.hit) {
      fallback = true;
      hops.push({ points: sampleGuidedHop(pos, lastTo), fallback: true, hits: 0 });
    } else {
      hops.push({ points: intoBin.points, fallback: false, hits: 0 });
    }
    return {
      animation: "guided-physics",
      fallback: fallback,
      contacts: layout.pegs,
      bin: layout.bin,
      diskRadius: disk.diskRadius,
      pegRadius: disk.pegRadius,
      hops: hops
    };
  }

  function routeFor(path, seed, animation, diskRadius, pegRadius) {
    if (animation === "guided-physics") return simulatePhysics(path, seed, diskRadius, pegRadius);
    return guidedRoute(path, seed, diskRadius, pegRadius);
  }

  function logicalToCanvas(point, geo) {
    return {
      x: geo.centerX + point.x * geo.spacing,
      y: point.bin ? geo.binBallY : geo.pegTop + (point.y / LOGICAL_ROW) * geo.rowGap
    };
  }

  function pointOnHop(hop, t) {
    var pts = hop.points;
    var scaled = t * (pts.length - 1);
    var i = Math.floor(scaled);
    if (i >= pts.length - 1) return pts[pts.length - 1];
    if (i < 0) i = 0;
    var f = scaled - i;
    var a = pts[i];
    var b = pts[i + 1];
    return {
      x: a.x + (b.x - a.x) * f,
      y: a.y + (b.y - a.y) * f,
      bin: b.bin && f > 0.999 ? true : undefined
    };
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function drawBoard(ctx, geo, view) {
    ctx.clearRect(0, 0, geo.width, geo.height);

    var i;
    for (i = 0; i < PAYOUTS.length; i++) {
      var x = geo.padX + i * (geo.binWidth + geo.gap);
      var landed = view.highlight === i;
      ctx.fillStyle = landed ? "#1c2430" : i % 2 === 0 ? "#f3efe6" : "#e4ded2";
      ctx.fillRect(x, geo.binTop, geo.binWidth, geo.binH);
      ctx.fillStyle = landed ? "#fbfaf7" : "#1c2430";
      var labelSize = Math.max(11, Math.min(16, geo.binWidth * 0.3));
      ctx.font = "bold " + labelSize + "px Segoe UI, Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(formatMoney(PAYOUTS[i]), x + geo.binWidth / 2, geo.binTop + geo.binH / 2);
    }

    ctx.fillStyle = "#5e6a72";
    for (var r = 0; r < ROWS; r++) {
      for (var p = 0; p <= r; p++) {
        var peg = pegPosition(geo, r, p);
        ctx.beginPath();
        ctx.arc(peg.x, peg.y, geo.pegRadiusPx, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (view.ball) {
      ctx.beginPath();
      ctx.arc(view.ball.x, view.ball.y, geo.diskRadiusPx, 0, Math.PI * 2);
      ctx.fillStyle = "#c2410c";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#7c2d12";
      ctx.stroke();
    }
  }

  function mount(selector, userOptions) {
    if (typeof document === "undefined") {
      throw new Error("Plinko.mount requires a browser document.");
    }
    var el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) throw new Error("Plinko mount target was not found.");

    var options = {
      round: userOptions && userOptions.round !== undefined ? userOptions.round : 1,
      responseId: userOptions && userOptions.responseId ? String(userOptions.responseId) : "local",
      endowment:
        userOptions && userOptions.endowment !== undefined
          ? userOptions.endowment
          : DEFAULT_ENDOWMENT,
      dropDurationMs:
        userOptions && userOptions.dropDurationMs !== undefined
          ? userOptions.dropDurationMs
          : 10000,
      messageDwellMs:
        userOptions && userOptions.messageDwellMs !== undefined
          ? userOptions.messageDwellMs
          : 4000,
      revealDwellMs:
        userOptions && userOptions.revealDwellMs !== undefined
          ? userOptions.revealDwellMs
          : 4000,
      animation: userOptions && userOptions.animation === "guided-physics" ? "guided-physics" : "guided",
      diskRadius: diskSpec(userOptions && userOptions.diskRadius, userOptions && userOptions.pegRadius).diskRadius,
      pegRadius: diskSpec(userOptions && userOptions.diskRadius, userOptions && userOptions.pegRadius).pegRadius,
      onComplete: userOptions && userOptions.onComplete ? userOptions.onComplete : function () {}
    };

    injectCss();
    el.innerHTML = "";

    var app = document.createElement("div");
    app.className = "plinko-app";
    app.setAttribute("data-state", "idle");

    var endowmentEl = document.createElement("p");
    endowmentEl.className = "plinko-endowment";
    endowmentEl.textContent = "You have " + formatMoney(options.endowment) + " for this stage.";

    var instructionEl = document.createElement("p");
    instructionEl.className = "plinko-instruction";
    instructionEl.textContent = "Play it on this board, or decline and keep it.";

    var canvas = document.createElement("canvas");
    canvas.className = "plinko-canvas";
    canvas.setAttribute("aria-hidden", "true");

    var actions = document.createElement("div");
    actions.className = "plinko-actions";

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.textContent = "Play";

    var declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.textContent = "Decline";

    var banner = document.createElement("div");
    banner.className = "plinko-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.tabIndex = -1;

    actions.appendChild(playBtn);
    actions.appendChild(declineBtn);
    app.appendChild(endowmentEl);
    app.appendChild(instructionEl);
    app.appendChild(banner);
    app.appendChild(canvas);
    app.appendChild(actions);
    el.appendChild(app);

    var dead = false;
    var timer = null;
    var completeTimer = null;
    var raf = 0;
    var completed = false;
    var choosing = false;
    var record = null;
    var view = { ball: null, highlight: null, path: null };
    var route = null;
    var key = storageKey(options.responseId, options.round);

    function ctx2d() {
      var cssWidth = canvas.clientWidth || 720;
      var cssHeight = Math.max(380, Math.round(Math.min(cssWidth * 0.58, 440)));
      canvas.style.height = cssHeight + "px";
      var dpr = Math.min((window.devicePixelRatio || 1), 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      var ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return {
        ctx: ctx,
        geo: layoutOf(cssWidth, cssHeight, {
          diskRadius: options.diskRadius,
          pegRadius: options.pegRadius
        })
      };
    }

    function paint() {
      if (dead) return;
      var surface = ctx2d();
      var geo = surface.geo;
      if (view.path && view.ball && view.ball.settled && view.highlight !== null) {
        var rested = logicalToCanvas(logicalBin(view.highlight), geo);
        view.ball = { x: rested.x, y: rested.y, settled: true };
      } else if (!view.ball || !view.path) {
        var rest = logicalToCanvas(logicalStart(options.diskRadius + options.pegRadius), geo);
        view.ball = { x: rest.x, y: rest.y, settled: false };
      }
      drawBoard(surface.ctx, geo, view);
    }

    function finish(nextRecord) {
      if (dead || completed) return;
      completed = true;
      record = nextRecord;
      writeStored(key, record);
      app.setAttribute("data-state", record.interrupted ? "interrupted" : "done");
      app.setAttribute("data-bin", String(record.bin));
      app.setAttribute("data-decision", record.decision);
      app.setAttribute("data-earnings", String(record.earnings));
      completeTimer = window.setTimeout(function () {
        if (dead) return;
        options.onComplete(record);
      }, 0);
    }

    function showOutcome(settledRecord, staticReveal) {
      actions.style.display = "none";
      instructionEl.style.display = "none";
      endowmentEl.style.display = "none";
      banner.textContent = outcomeMessage(
        settledRecord.decision,
        settledRecord.payout,
        settledRecord.earnings,
        settledRecord.endowment
      );
      view.path = settledRecord.path;
      view.highlight = settledRecord.bin;
      view.ball = { settled: true };
      paint();
      if (!staticReveal) banner.focus();
    }

    function armReveal(settledRecord) {
      showOutcome(settledRecord, false);
      app.setAttribute("data-state", "reveal");
      timer = setTimeout(function () {
        if (dead) return;
        settledRecord.next_enabled_iso = new Date().toISOString();
        writeStored(key, settledRecord);
        finish(settledRecord);
      }, options.revealDwellMs);
    }

    function runDrop(settledRecord) {
      app.setAttribute("data-state", "dropping");
      var durations =
        route && route.animation === "guided-physics"
          ? playbackDurations(options.dropDurationMs, route.hops)
          : segmentDurations(options.dropDurationMs);
      var total = 0;
      for (var i = 0; i < durations.length; i++) total += durations[i];
      var startedAt = null;

      function frame(ts) {
        if (dead) return;
        if (startedAt === null) startedAt = ts;
        var elapsed = ts - startedAt;
        var surface = ctx2d();
        var acc = 0;
        var idx = durations.length - 1;
        var localT = 1;
        for (var s = 0; s < durations.length; s++) {
          if (elapsed < acc + durations[s]) {
            idx = s;
            localT = durations[s] === 0 ? 1 : (elapsed - acc) / durations[s];
            break;
          }
          acc += durations[s];
        }
        if (localT < 0) localT = 0;
        if (localT > 1) localT = 1;
        var eased = idx >= durations.length - 2 ? easeOutCubic(localT) : localT;
        var logical = pointOnHop(route.hops[idx], eased);
        var canvasPoint = logicalToCanvas(logical, surface.geo);
        view.path = settledRecord.path;
        view.highlight = null;
        view.ball = { x: canvasPoint.x, y: canvasPoint.y, settled: false };
        drawBoard(surface.ctx, surface.geo, view);
        if (elapsed >= total) {
          var doneAt = new Date().toISOString();
          settledRecord.animation_end_iso = doneAt;
          settledRecord.reveal_onset_iso = doneAt;
          writeStored(key, settledRecord);
          armReveal(settledRecord);
          return;
        }
        raf = window.requestAnimationFrame(frame);
      }

      raf = window.requestAnimationFrame(frame);
    }

    function beginTimedTrial(settledRecord) {
      actions.style.display = "none";
      instructionEl.style.display = "none";
      banner.textContent = protocolMessage(settledRecord.decision, settledRecord.endowment);
      banner.focus();
      app.setAttribute("data-state", "message");
      timer = setTimeout(function () {
        if (dead) return;
        var started = new Date().toISOString();
        settledRecord.message_offset_iso = started;
        settledRecord.animation_start_iso = started;
        writeStored(key, settledRecord);
        runDrop(settledRecord);
      }, options.messageDwellMs);
    }

    function choose(decision) {
      if (record || dead || choosing) return;
      choosing = true;
      playBtn.disabled = true;
      declineBtn.disabled = true;
      var trial = drawTrial();
      record = createRecord(options, decision, trial);
      route = routeFor(trial.path, trial.seed, options.animation, options.diskRadius, options.pegRadius);
      record.physics_fallback = route.fallback;
      writeStored(key, record);
      beginTimedTrial(record);
    }

    function restore(saved) {
      saved.interrupted = true;
      if (!saved.next_enabled_iso) saved.next_enabled_iso = new Date().toISOString();
      record = saved;
      writeStored(key, saved);
      showOutcome(saved, true);
      app.setAttribute("data-state", "interrupted");
      finish(saved);
    }

    playBtn.addEventListener("click", function () {
      choose("play");
    });
    declineBtn.addEventListener("click", function () {
      choose("decline");
    });

    function onResize() {
      if (dead || app.getAttribute("data-state") === "dropping") return;
      paint();
    }
    window.addEventListener("resize", onResize);

    var existing = readStored(key);
    if (existing && validPath(existing.path) && (existing.decision === "play" || existing.decision === "decline")) {
      restore(existing);
    } else {
      paint();
    }

    return {
      destroy: function () {
        dead = true;
        if (timer) window.clearTimeout(timer);
        if (completeTimer) window.clearTimeout(completeTimer);
        if (raf) window.cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        if (el.contains(app)) el.removeChild(app);
      }
    };
  }

  return {
    TASK_VERSION: TASK_VERSION,
    ROWS: ROWS,
    PAYOUTS: PAYOUTS,
    WEIGHTS: WEIGHTS,
    DEFAULT_ENDOWMENT: DEFAULT_ENDOWMENT,
    freshSeed: freshSeed,
    pathFromSeed: pathFromSeed,
    binFromPath: binFromPath,
    drawTrial: drawTrial,
    settle: settle,
    formatMoney: formatMoney,
    protocolMessage: protocolMessage,
    outcomeMessage: outcomeMessage,
    expectedPayout: expectedPayout,
    segmentDurations: segmentDurations,
    storageKey: storageKey,
    DEFAULT_DISK_RADIUS: DEFAULT_DISK_RADIUS,
    DEFAULT_PEG_RADIUS: DEFAULT_PEG_RADIUS,
    diskSpec: diskSpec,
    guidedRoute: guidedRoute,
    simulatePhysics: simulatePhysics,
    simulateChannel: simulateChannel,
    wallsForStep: wallsForStep,
    reflectDisk: reflectDisk,
    hopPoint: hopPoint,
    mount: mount
  };
});
