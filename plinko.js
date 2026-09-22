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

  var TASK_VERSION = 1;
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

  function layoutOf(width, height) {
    var padX = 18;
    var gap = 4;
    var binCount = PAYOUTS.length;
    var binH = Math.max(52, Math.round(height * 0.12));
    var binTop = height - binH - 10;
    var inner = width - padX * 2;
    var binWidth = (inner - gap * (binCount - 1)) / binCount;
    var spacing = binWidth + gap;
    var centerX = padX + 4 * spacing + binWidth / 2;
    var pegTop = 46;
    var pegBottom = binTop - 26;
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
      yStart: 16,
      binBallY: binTop - 14
    };
  }

  function pegPosition(geo, row, pegIndex) {
    return {
      x: geo.centerX + (pegIndex - row / 2) * geo.spacing,
      y: geo.pegTop + row * geo.rowGap
    };
  }

  function binCenterX(geo, bin) {
    return geo.padX + bin * (geo.binWidth + geo.gap) + geo.binWidth / 2;
  }

  function buildPoints(path, geo) {
    var points = [{ x: geo.centerX, y: geo.yStart }];
    var rights = 0;
    for (var r = 0; r < path.length; r++) {
      var peg = pegPosition(geo, r, rights);
      points.push({ x: peg.x, y: peg.y });
      if (path.charAt(r) === "R") rights += 1;
    }
    points.push({ x: binCenterX(geo, rights), y: geo.binBallY });
    return points;
  }

  function easeInQuad(t) {
    return t * t;
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
        ctx.arc(peg.x, peg.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (view.ball) {
      ctx.beginPath();
      ctx.arc(view.ball.x, view.ball.y, 9, 0, Math.PI * 2);
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
      return { ctx: ctx, geo: layoutOf(cssWidth, cssHeight) };
    }

    function paint() {
      if (dead) return;
      var surface = ctx2d();
      var geo = surface.geo;
      if (view.path && view.ball && view.ball.settled) {
        var pts = buildPoints(view.path, geo);
        view.ball = { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, settled: true };
      } else if (!view.ball) {
        view.ball = { x: geo.centerX, y: geo.yStart, settled: false };
      } else if (!view.path) {
        view.ball = { x: geo.centerX, y: geo.yStart, settled: false };
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
      var durations = segmentDurations(options.dropDurationMs);
      var total = 0;
      for (var i = 0; i < durations.length; i++) total += durations[i];
      var startedAt = null;

      function frame(ts) {
        if (dead) return;
        if (startedAt === null) startedAt = ts;
        var elapsed = ts - startedAt;
        var surface = ctx2d();
        var points = buildPoints(settledRecord.path, surface.geo);
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
        var eased = idx >= durations.length - 2 ? easeOutCubic(localT) : easeInQuad(localT);
        var from = points[idx];
        var to = points[idx + 1];
        view.path = settledRecord.path;
        view.highlight = null;
        view.ball = {
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
          settled: false
        };
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
    mount: mount
  };
});
