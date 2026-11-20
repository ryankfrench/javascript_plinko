/*
 * Compare sequential session ids with random session ids.
 * Every session still has subjects 1-12 and rounds 1 and 2.
 * The seed is getSeed from qualtrics/round.js. The path is Plinko.drawTrial.
 *
 *   node test/session-id-compare.js
 *   node test/session-id-compare.js --seed 1 --replicates 1000
 *
 * The sequential arm is sessions 1-100. The random arm draws 100 ids from
 * 1-1000 without replacement. Those 100 ids are also split into 10 sets of
 * 10, matched against the sequential blocks 1-10, 11-20, ..., 91-100.
 * Replicates redraw the random ids and locate the sequential results in
 * that cloud. The draw seed only picks session ids. It does not change
 * the Plinko hash.
 */
var fs = require("fs");
var path = require("path");
var Plinko = require("../plinko.js");

var sequentialCount = 100;
var randomCount = 100;
var randomMin = 1;
var randomMax = 1000;
var blockSize = 10;
var subjects = 12;
var rounds = [1, 2];
var sampleSeed = 1;
var replicates = 1000;

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
    console.log("Usage: node test/session-id-compare.js [--seed N] [--replicates N]");
    process.exit(0);
  } else if (arg === "--seed") {
    sampleSeed = parseInt(take(argv, ++a, arg), 10);
  } else if (arg === "--replicates") {
    replicates = parseInt(take(argv, ++a, arg), 10);
  } else {
    fail("Unknown argument: " + arg);
  }
}
if (!isFinite(sampleSeed) || !isFinite(replicates) || replicates < 1) {
  fail("seed and replicates need to be numbers, with at least one replicate");
}

function mulberry32(seed) {
  var state = seed >>> 0;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGetSeed() {
  var src = fs.readFileSync(path.join(__dirname, "..", "qualtrics", "round.js"), "utf8");
  var start = src.indexOf("function hashSeed");
  var end = src.indexOf("function rootEl");
  if (start < 0 || end < start) fail("qualtrics/round.js no longer has hashSeed ahead of rootEl");
  if (typeof window === "undefined") global.window = { console: console };
  return new Function(src.slice(start, end) + "\nreturn getSeed;")();
}

function sampleIds(rng, count, min, max) {
  var span = max - min + 1;
  if (count > span) fail("cannot draw " + count + " ids from " + min + "-" + max);
  var items = [];
  for (var n = min; n <= max; n++) items.push(n);
  for (var i = 0; i < count; i++) {
    var j = i + Math.floor(rng() * (items.length - i));
    var swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items.slice(0, count);
}

function emptyCounts() {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

var getSeed = loadGetSeed();
var drawsPerSession = subjects * rounds.length;

function collect(ids) {
  var counts = emptyCounts();
  var sum = 0;
  var sessionMeans = [];
  var blocks = [];
  for (var s = 0; s < ids.length; s++) {
    if (s % blockSize === 0) blocks.push({ ids: [], counts: emptyCounts(), sum: 0, n: 0 });
    var block = blocks[blocks.length - 1];
    block.ids.push(ids[s]);
    var sessionSum = 0;
    for (var u = 1; u <= subjects; u++) {
      for (var r = 0; r < rounds.length; r++) {
        var trial = Plinko.drawTrial(getSeed(String(ids[s]), String(u), rounds[r]));
        counts[trial.bin] += 1;
        block.counts[trial.bin] += 1;
        sum += trial.payout;
        block.sum += trial.payout;
        sessionSum += trial.payout;
      }
    }
    block.n += drawsPerSession;
    sessionMeans.push(sessionSum / drawsPerSession);
  }
  var n = ids.length * drawsPerSession;
  blocks.forEach(function (block) {
    block.mean = block.sum / block.n;
    block.chi = chiSquare(block.counts, block.n);
  });
  return {
    ids: ids,
    counts: counts,
    n: n,
    sum: sum,
    mean: sum / n,
    chi: chiSquare(counts, n),
    sessionMeans: sessionMeans,
    blocks: blocks
  };
}

var expectedMean = Plinko.expectedPayout();
var probs = Plinko.WEIGHTS.map(function (weight) { return weight / 256; });

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
  var total = a.n + b.n;
  for (var i = 0; i < 9; i++) {
    var combined = a.counts[i] + b.counts[i];
    if (combined === 0) continue;
    var ea = total === 0 ? 0 : (a.n * combined) / total;
    var eb = total === 0 ? 0 : (b.n * combined) / total;
    x += ((a.counts[i] - ea) * (a.counts[i] - ea)) / ea;
    x += ((b.counts[i] - eb) * (b.counts[i] - eb)) / eb;
  }
  return x;
}

// Upper tail of chi-square for even degrees of freedom.
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

function correlation(xs, ys) {
  var n = xs.length;
  var mx = 0;
  var my = 0;
  for (var i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  var num = 0;
  var dx = 0;
  var dy = 0;
  for (var j = 0; j < n; j++) {
    var a = xs[j] - mx;
    var b = ys[j] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}

function meanOf(values) {
  var sum = 0;
  for (var i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function sdOf(values) {
  var center = meanOf(values);
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    var diff = values[i] - center;
    sum += diff * diff;
  }
  return Math.sqrt(sum / (values.length - 1));
}

function percentileRank(value, sample) {
  var below = 0;
  var equal = 0;
  for (var i = 0; i < sample.length; i++) {
    if (sample[i] < value) below += 1;
    else if (sample[i] === value) equal += 1;
  }
  return (below + 0.5 * equal) / sample.length;
}

var sequentialIds = [];
for (var id = 1; id <= sequentialCount; id++) sequentialIds.push(id);
var sequential = collect(sequentialIds);

var rng = mulberry32(sampleSeed);
var randomIds = sampleIds(rng, randomCount, randomMin, randomMax);
var random = collect(randomIds);

var overlap = 0;
randomIds.forEach(function (sessionId) {
  if (sessionId >= 1 && sessionId <= sequentialCount) overlap += 1;
});

var sessionIndex = sequentialIds.map(function (sessionId) { return sessionId; });
var sessionCorrelation = correlation(sessionIndex, sequential.sessionMeans);
var permRng = mulberry32((sampleSeed + 17) >>> 0);
var permHits = 0;
var permN = 5000;
for (var p = 0; p < permN; p++) {
  var shuffled = sequential.sessionMeans.slice();
  for (var i = shuffled.length - 1; i > 0; i--) {
    var j = Math.floor(permRng() * (i + 1));
    var swap = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = swap;
  }
  if (Math.abs(correlation(sessionIndex, shuffled)) >= Math.abs(sessionCorrelation)) permHits += 1;
}

var replicateMeans = [];
var replicateChi = [];
var replicateBlockSd = [];
var replicateHomogeneity = [];
for (var rep = 0; rep < replicates; rep++) {
  var ids = sampleIds(rng, randomCount, randomMin, randomMax);
  var arm = collect(ids);
  replicateMeans.push(arm.mean);
  replicateChi.push(arm.chi);
  replicateBlockSd.push(sdOf(arm.blocks.map(function (block) { return block.mean; })));
  replicateHomogeneity.push(homogeneity(sequential, arm));
}

var homo = homogeneity(sequential, random);
var seqBlockMeans = sequential.blocks.map(function (block) { return block.mean; });
var randBlockMeans = random.blocks.map(function (block) { return block.mean; });
var seqBlockSd = sdOf(seqBlockMeans);

function money(amount) {
  return "$" + amount.toFixed(4);
}

console.log("Sequential sessions 1-" + sequentialCount + " vs " + randomCount + " random ids from " + randomMin + "-" + randomMax);
console.log("Subjects 1-" + subjects + ", rounds " + rounds.join(",") + ", " + drawsPerSession + " draws per session");
console.log("Draws per arm", sequential.n);
console.log("Random-id seed", sampleSeed);
console.log("Ids shared with 1-" + sequentialCount, overlap);
console.log("Random ids", randomIds.join(","));
console.log("");
console.log("mean sequential", money(sequential.mean), "random", money(random.mean), "expected", money(expectedMean));
console.log(
  "chi-square vs binomial  sequential",
  sequential.chi.toFixed(2),
  "p",
  chiSquareUpperP(sequential.chi, 8).toFixed(3),
  " random",
  random.chi.toFixed(2),
  "p",
  chiSquareUpperP(random.chi, 8).toFixed(3)
);
console.log(
  "homogeneity sequential vs this random draw",
  homo.toFixed(2),
  "df 8  p",
  chiSquareUpperP(homo, 8).toFixed(3)
);
console.log(
  "correlation of session number with session mean",
  sessionCorrelation.toFixed(3),
  "permutation p",
  ((1 + permHits) / (permN + 1)).toFixed(3)
);
console.log("");
console.log("Among " + replicates + " random 100-id draws:");
console.log(
  "  sequential mean percentile",
  (100 * percentileRank(sequential.mean, replicateMeans)).toFixed(1)
);
console.log(
  "  sequential chi-square percentile",
  (100 * percentileRank(sequential.chi, replicateChi)).toFixed(1)
);
console.log(
  "  random-arm mean range",
  money(Math.min.apply(null, replicateMeans)),
  "to",
  money(Math.max.apply(null, replicateMeans)),
  "sd",
  money(sdOf(replicateMeans))
);
console.log(
  "  homogeneity vs sequential: this draw percentile",
  (100 * percentileRank(homo, replicateHomogeneity)).toFixed(1)
);
console.log("");
console.log("bin  payout  sequential  random  expected");
for (var bin = 0; bin < 9; bin++) {
  console.log(
    String(bin).padStart(3),
    Plinko.formatMoney(Plinko.PAYOUTS[bin]).padStart(8),
    String(sequential.counts[bin]).padStart(11),
    String(random.counts[bin]).padStart(7),
    (sequential.n * probs[bin]).toFixed(1).padStart(9)
  );
}
console.log("");
console.log("Blocks of " + blockSize + ". Random sets are the random ids in draw order, 10 at a time.");
console.log("block  sequential-ids  seq-mean  seq-chi  random-mean  random-chi");
for (var b = 0; b < sequential.blocks.length; b++) {
  var left = sequential.blocks[b];
  var right = random.blocks[b];
  console.log(
    String(b + 1).padStart(5),
    (left.ids[0] + "-" + left.ids[left.ids.length - 1]).padStart(15),
    money(left.mean).padStart(9),
    left.chi.toFixed(2).padStart(8),
    money(right.mean).padStart(12),
    right.chi.toFixed(2).padStart(10)
  );
}
console.log(
  "sd of the 10 block means  sequential",
  money(seqBlockSd),
  "this random split",
  money(sdOf(randBlockMeans)),
  "percentile among random splits",
  (100 * percentileRank(seqBlockSd, replicateBlockSd)).toFixed(1)
);
