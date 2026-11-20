/*
 * Draw the bins a set of sessions and subjects would get in the study.
 * The seed is getSeed from qualtrics/round.js. The path is Plinko.drawTrial.
 *
 * Edit the defaults below, or override them from the shell:
 *
 *   node test/session-draws.js
 *   node test/session-draws.js --sessions 1-8 --subjects 1-12 --rounds 1,2
 *   node test/session-draws.js --sessions 1-3 --subjects 1-4 --rounds 2 --list
 *   node test/session-draws.js --csv > draws.csv
 *
 * A spec is one id (4), an inclusive range (1-15), or a comma list (1,2,5-7).
 * The subject list is repeated in every session. Session 1 subject 1 and
 * session 2 subject 1 differ because the session is part of the seed.
 * Ids are hashed as decimal text. --pad 2 stores them as 01, 02, and so on.
 * The loader itself does not pad, so the default matches embedded data "1".
 */
var fs = require("fs");
var path = require("path");
var Plinko = require("../plinko.js");

var sessionsSpec = "1-8";
var subjectsSpec = "1-12";
var roundsSpec = "1,2";
var pad = 0;
var list = false;
var csv = false;

function help() {
  console.log("Usage: node test/session-draws.js [options]");
  console.log("");
  console.log("  --sessions SPEC   Session ids. Default 1-8.");
  console.log("  --subjects SPEC   Subject ids in each session. Default 1-12.");
  console.log("  --rounds SPEC     Rounds. Default 1,2.");
  console.log("  --pad N           Zero-pad session and subject ids to N digits.");
  console.log("  --list            Print every draw after the summary.");
  console.log("  --csv             Print draws as CSV and skip the summary.");
  console.log("  --help");
  console.log("");
  console.log("SPEC is 4, or 1-15, or 1,2,5-7. The hashed text is session|subject|round.");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function take(argv, index, flag) {
  if (index >= argv.length || argv[index].indexOf("--") === 0) {
    fail(flag + " needs a value");
  }
  return argv[index];
}

var argv = process.argv.slice(2);
for (var a = 0; a < argv.length; a++) {
  var arg = argv[a];
  if (arg === "--help" || arg === "-h") {
    help();
    process.exit(0);
  } else if (arg === "--list") {
    list = true;
  } else if (arg === "--csv") {
    csv = true;
  } else if (arg === "--sessions") {
    sessionsSpec = take(argv, ++a, arg);
  } else if (arg === "--subjects") {
    subjectsSpec = take(argv, ++a, arg);
  } else if (arg === "--rounds") {
    roundsSpec = take(argv, ++a, arg);
  } else if (arg === "--pad") {
    var padText = take(argv, ++a, arg);
    if (!/^\d+$/.test(padText)) fail("--pad needs a non-negative integer");
    pad = parseInt(padText, 10);
  } else {
    fail("Unknown argument: " + arg + "\nRun with --help.");
  }
}

function expand(spec, label) {
  var parts = String(spec).split(",");
  var values = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) fail(label + " has an empty entry");
    var range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    var from;
    var to;
    if (range) {
      from = parseInt(range[1], 10);
      to = parseInt(range[2], 10);
      if (to < from) fail(label + " range " + part + " is reversed");
    } else if (/^\d+$/.test(part)) {
      from = parseInt(part, 10);
      to = from;
    } else {
      fail(label + " could not read \"" + part + "\"");
    }
    for (var n = from; n <= to; n++) {
      if (!seen[n]) {
        seen[n] = true;
        values.push(n);
      }
    }
  }
  if (!values.length) fail(label + " is empty");
  return values;
}

function idText(n) {
  var text = String(n);
  while (text.length < pad) text = "0" + text;
  return text;
}

function describe(values, text) {
  var show = text || String;
  var sequential = values.length > 1;
  for (var i = 1; sequential && i < values.length; i++) {
    if (values[i] !== values[i - 1] + 1) sequential = false;
  }
  if (values.length === 1) return show(values[0]);
  if (sequential) return show(values[0]) + "-" + show(values[values.length - 1]);
  if (values.length <= 12) return values.map(show).join(",");
  return values.slice(0, 8).map(show).join(",") + ",… (" + values.length + ")";
}

// The loader's getSeed, so a change there changes these draws too.
function loadGetSeed() {
  var src = fs.readFileSync(path.join(__dirname, "..", "qualtrics", "round.js"), "utf8");
  var start = src.indexOf("function hashSeed");
  var end = src.indexOf("function rootEl");
  if (start < 0 || end < start) {
    fail("qualtrics/round.js no longer has hashSeed ahead of rootEl");
  }
  if (typeof window === "undefined") global.window = { console: console };
  return new Function(src.slice(start, end) + "\nreturn getSeed;")();
}

var getSeed = loadGetSeed();
var sessions = expand(sessionsSpec, "sessions");
var subjects = expand(subjectsSpec, "subjects");
var rounds = expand(roundsSpec, "rounds");

var draws = [];
var bySeed = {};
for (var s = 0; s < sessions.length; s++) {
  for (var u = 0; u < subjects.length; u++) {
    for (var r = 0; r < rounds.length; r++) {
      var session = idText(sessions[s]);
      var subject = idText(subjects[u]);
      var round = rounds[r];
      var key = session + "|" + subject + "|" + round;
      var seed = getSeed(session, subject, round);
      var trial = Plinko.drawTrial(seed);
      var again = Plinko.drawTrial(seed);
      if (again.path !== trial.path || again.bin !== trial.bin) {
        fail("draw was not reproducible for " + key);
      }
      if (trial.seed !== seed) fail("seed was changed for " + key);
      var row = {
        session: session,
        subject: subject,
        round: round,
        key: key,
        seed: trial.seed,
        path: trial.path,
        bin: trial.bin,
        payout: trial.payout
      };
      if (bySeed[seed]) bySeed[seed].push(key);
      else bySeed[seed] = [key];
      draws.push(row);
    }
  }
}

function csvCell(value) {
  var text = String(value);
  if (/[",\n]/.test(text)) return "\"" + text.replace(/"/g, "\"\"") + "\"";
  return text;
}

if (csv) {
  console.log("session,subject,round,seed,path,bin,payout");
  for (var c = 0; c < draws.length; c++) {
    var item = draws[c];
    console.log([
      item.session,
      item.subject,
      item.round,
      item.seed,
      item.path,
      item.bin,
      item.payout
    ].map(csvCell).join(","));
  }
  process.exit(0);
}

var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
var payoutSum = 0;
var roundSum = {};
var roundCount = {};
var sessionSum = {};
var sessionCount = {};
for (var d = 0; d < draws.length; d++) {
  var draw = draws[d];
  counts[draw.bin] += 1;
  payoutSum += draw.payout;
  if (!roundSum[draw.round]) {
    roundSum[draw.round] = 0;
    roundCount[draw.round] = 0;
  }
  roundSum[draw.round] += draw.payout;
  roundCount[draw.round] += 1;
  if (!sessionSum[draw.session]) {
    sessionSum[draw.session] = 0;
    sessionCount[draw.session] = 0;
  }
  sessionSum[draw.session] += draw.payout;
  sessionCount[draw.session] += 1;
}

var n = draws.length;
var expectedMean = Plinko.expectedPayout();
var mean = payoutSum / n;
var secondMoment = 0;
for (var b = 0; b < Plinko.PAYOUTS.length; b++) {
  secondMoment += Plinko.PAYOUTS[b] * Plinko.PAYOUTS[b] * Plinko.WEIGHTS[b];
}
secondMoment /= 256;
var standardError = Math.sqrt(secondMoment - expectedMean * expectedMean) / Math.sqrt(n);

var shared = [];
Object.keys(bySeed).forEach(function (seed) {
  if (bySeed[seed].length > 1) shared.push(seed + " " + bySeed[seed].join(" "));
});

console.log("sessions", describe(sessions, idText));
console.log("subjects", describe(subjects, idText), "in each session");
console.log("rounds", describe(rounds));
console.log("pad", pad);
console.log("example key", draws[0].key);
console.log("draws", n);
console.log("unique seeds", Object.keys(bySeed).length);
if (shared.length) {
  console.log("shared seeds", shared.length);
  shared.forEach(function (line) { console.log(" ", line); });
}
console.log(
  "mean payout",
  "$" + mean.toFixed(4),
  "expected",
  "$" + expectedMean.toFixed(4),
  "se",
  "$" + standardError.toFixed(4),
  "z",
  ((mean - expectedMean) / standardError).toFixed(2)
);

console.log("round  draws  mean");
rounds.forEach(function (round) {
  var label = String(round);
  console.log(
    String(label).padStart(5),
    String(roundCount[label]).padStart(6),
    ("$" + (roundSum[label] / roundCount[label]).toFixed(4)).padStart(9)
  );
});

console.log("bin  payout  observed  expected      z");
for (var i = 0; i < 9; i++) {
  var expected = (n * Plinko.WEIGHTS[i]) / 256;
  var variance = expected * (1 - Plinko.WEIGHTS[i] / 256);
  var z = (counts[i] - expected) / Math.sqrt(variance);
  console.log(
    String(i).padStart(3),
    Plinko.formatMoney(Plinko.PAYOUTS[i]).padStart(8),
    String(counts[i]).padStart(9),
    expected.toFixed(2).padStart(9),
    z.toFixed(2).padStart(7)
  );
}

if (sessions.length > 1) {
  console.log("session  draws  mean");
  sessions.forEach(function (session) {
    var label = idText(session);
    console.log(
      label.padStart(7),
      String(sessionCount[label]).padStart(6),
      ("$" + (sessionSum[label] / sessionCount[label]).toFixed(4)).padStart(9)
    );
  });
}

if (list) {
  console.log("session subject round seed path bin payout");
  for (var rowIndex = 0; rowIndex < draws.length; rowIndex++) {
    var shown = draws[rowIndex];
    console.log(
      shown.session,
      shown.subject,
      shown.round,
      shown.seed,
      shown.path,
      shown.bin,
      shown.payout
    );
  }
}
