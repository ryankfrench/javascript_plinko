/*
 * Compare session-seeded draws with a new unseeded generator on every step.
 * The seeded arm hashes session|subject|round with getSeed from qualtrics/round.js
 * and uses one mulberry32 for the whole path, which is what the study does.
 * The unseeded arm calls Plinko.freshSeed() and builds a new mulberry32 for each
 * of the eight left/right steps. That generator is used once and discarded.
 *
 *   node test/python-draws-true-random.js
 *   node test/python-draws-true-random.js --draws 2400
 *
 * Seeded draws walk sessions in order, subjects 1-12, rounds 1 then 2,
 * and stop at the requested count. 192 draws is sessions 1-8.
 * The unseeded arm changes on every run.
 */
var fs = require("fs");
var path = require("path");
var Plinko = require("../plinko.js");

var draws = 192;
var subjectsPerSession = 12;
var rounds = [1, 2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function take(argv, index, flag) {
  if (index >= argv.length || argv[index].indexOf("--") === 0) fail(flag + " needs a value");
  return argv[index];
}

var argv = process.argv.slice(2);
for (var a = 0; a < argv.length; a++) {
  var arg = argv[a];
  if (arg === "--help" || arg === "-h") {
    console.log("Usage: node test/python-draws-true-random.js [--draws N]");
    console.log("");
    console.log("  --draws N   Draws in each arm. Default 192 (sessions 1-8, 12 subjects, 2 rounds).");
    process.exit(0);
  } else if (arg === "--draws") {
    var text = take(argv, ++a, arg);
    if (!/^\d+$/.test(text) || parseInt(text, 10) < 1) fail("--draws needs a positive integer");
    draws = parseInt(text, 10);
  } else {
    fail("Unknown argument: " + arg);
  }
}

function loadGetSeed() {
  var src = fs.readFileSync(path.join(__dirname, "..", "qualtrics", "round.js"), "utf8");
  var start = src.indexOf("function hashSeed");
  var end = src.indexOf("function rootEl");
  if (start < 0 || end < start) fail("qualtrics/round.js no longer has hashSeed ahead of rootEl");
  if (typeof window === "undefined") global.window = { console: console };
  return new Function(src.slice(start, end) + "\nreturn getSeed;")();
}

function loadMulberry32() {
  var src = fs.readFileSync(path.join(__dirname, "..", "plinko.js"), "utf8");
  var start = src.indexOf("function mulberry32");
  var end = src.indexOf("function freshSeed");
  if (start < 0 || end < start) fail("plinko.js no longer has mulberry32 ahead of freshSeed");
  return new Function(src.slice(start, end) + "\nreturn mulberry32;")();
}

var mulberry32 = loadMulberry32();

function drawTrueRandom() {
  var path = "";
  for (var step = 0; step < Plinko.ROWS; step++) {
    var rng = mulberry32(Plinko.freshSeed());
    path += rng() < 0.5 ? "L" : "R";
  }
  var bin = Plinko.binFromPath(path);
  return {
    path: path,
    bin: bin,
    payout: Plinko.PAYOUTS[bin]
  };
}

function seededDraw(index) {
  var perSession = subjectsPerSession * rounds.length;
  var session = Math.floor(index / perSession) + 1;
  var within = index % perSession;
  var subject = Math.floor(within / rounds.length) + 1;
  var round = rounds[within % rounds.length];
  return Plinko.drawTrial(getSeed(String(session), String(subject), round));
}

var getSeed = loadGetSeed();
var probs = Plinko.WEIGHTS.map(function (weight) { return weight / 256; });
var expectedMean = Plinko.expectedPayout();

function emptyCounts() {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function summarize(label, trials) {
  var counts = emptyCounts();
  var sum = 0;
  for (var i = 0; i < trials.length; i++) {
    counts[trials[i].bin] += 1;
    sum += trials[i].payout;
  }
  return {
    label: label,
    counts: counts,
    n: trials.length,
    mean: sum / trials.length,
    chi: chiSquare(counts, trials.length)
  };
}

function chiSquare(counts, n) {
  var x = 0;
  for (var i = 0; i < 9; i++) {
    var expected = n * probs[i];
    var diff = counts[i] - expected;
    x += (diff * diff) / expected;
  }
  return x;
}

function homogeneity(a, b) {
  var x = 0;
  for (var i = 0; i < 9; i++) {
    var combined = a.counts[i] + b.counts[i];
    if (combined === 0) continue;
    var ea = (a.n * combined) / (a.n + b.n);
    var eb = (b.n * combined) / (a.n + b.n);
    x += ((a.counts[i] - ea) * (a.counts[i] - ea)) / ea;
    x += ((b.counts[i] - eb) * (b.counts[i] - eb)) / eb;
  }
  return x;
}

function chiSquareUpperP(x, df) {
  var lambda = x / 2;
  var terms = df / 2;
  var term = Math.exp(-lambda);
  var sum = term;
  for (var m = 1; m < terms; m++) {
    term *= lambda / m;
    sum += term;
  }
  return Math.min(1, Math.max(0, sum));
}

function money(amount) {
  return "$" + amount.toFixed(4);
}

var seededTrials = [];
var randomTrials = [];
for (var d = 0; d < draws; d++) {
  seededTrials.push(seededDraw(d));
  randomTrials.push(drawTrueRandom());
}

var seeded = summarize("seeded", seededTrials);
var random = summarize("unseeded", randomTrials);
var compared = homogeneity(seeded, random);
var perSession = subjectsPerSession * rounds.length;
var lastSession = Math.floor((draws - 1) / perSession) + 1;

console.log("Draws in each arm", draws);
console.log(
  "Seeded arm: sessions 1-" + lastSession +
  ", subjects 1-" + subjectsPerSession +
  ", rounds " + rounds.join(",") +
  ", in that order, through session " + lastSession +
  " subject " + (Math.floor(((draws - 1) % perSession) / rounds.length) + 1) +
  " round " + rounds[(draws - 1) % rounds.length]
);
console.log("Unseeded arm: a new mulberry32 from Plinko.freshSeed() on each of the " + Plinko.ROWS + " steps");
console.log("");
console.log("mean seeded", money(seeded.mean), "unseeded", money(random.mean), "expected", money(expectedMean));
console.log(
  "chi-square vs binomial  seeded",
  seeded.chi.toFixed(2),
  "p",
  chiSquareUpperP(seeded.chi, 8).toFixed(3),
  " unseeded",
  random.chi.toFixed(2),
  "p",
  chiSquareUpperP(random.chi, 8).toFixed(3)
);
console.log(
  "homogeneity seeded vs unseeded",
  compared.toFixed(2),
  "df 8  p",
  chiSquareUpperP(compared, 8).toFixed(3)
);
if (draws * probs[0] < 5) {
  console.log("Tail bins are expected fewer than 5 times, so the chi-square p-values are approximate.");
}
console.log("");
console.log("bin  payout  seeded  unseeded  expected");
for (var bin = 0; bin < 9; bin++) {
  console.log(
    String(bin).padStart(3),
    Plinko.formatMoney(Plinko.PAYOUTS[bin]).padStart(8),
    String(seeded.counts[bin]).padStart(7),
    String(random.counts[bin]).padStart(9),
    (draws * probs[bin]).toFixed(1).padStart(9)
  );
}
