/*
 * Checks the Study C draw: binomial bin counts, path integrity, payouts, and EV.
 * Usage: node test/distribution.js
 */
var Plinko = require("../plinko.js");

var N = 100000;
var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0];
var payoutSum = 0;
var i;

function fail(message) {
  console.error("FAIL: " + message);
  process.exit(1);
}

if (Plinko.WEIGHTS.reduce(function (a, b) { return a + b; }, 0) !== 256) {
  fail("weights must sum to 256");
}

var theoreticalEv = 2575 / 256;
if (Math.abs(Plinko.expectedPayout() - theoreticalEv) > 1e-9) {
  fail("expected payout " + Plinko.expectedPayout() + " !== " + theoreticalEv);
}

if (Plinko.protocolMessage("play", 10) !==
  "The ball will now drop. Where it lands determines your earnings for this opportunity.") {
  fail("play message does not match the protocol");
}
if (Plinko.protocolMessage("decline", 10) !==
  "The ball will now drop. You chose not to play, so where it lands will NOT affect your earnings of $10 for this opportunity.") {
  fail("decline message does not match the protocol");
}

var playWin = Plinko.settle("play", 100, 10);
var playLoss = Plinko.settle("play", 2.5, 10);
var declineWin = Plinko.settle("decline", 100, 10);
var declineLoss = Plinko.settle("decline", 2.5, 10);
if (playWin.earnings !== 100 || playWin.signed_outcome !== 90) fail("play win settlement");
if (playLoss.earnings !== 2.5 || playLoss.signed_outcome !== -7.5) fail("play loss settlement");
if (declineWin.earnings !== 10 || declineWin.signed_outcome !== 90) fail("decline win settlement");
if (declineLoss.earnings !== 10 || declineLoss.signed_outcome !== -7.5) fail("decline loss settlement");

var seedTrial = Plinko.drawTrial(1);
var seedAgain = Plinko.drawTrial(1);
if (seedTrial.path !== seedAgain.path || seedTrial.bin !== seedAgain.bin) {
  fail("same seed did not reproduce the same path");
}
if (seedTrial.path !== "RLRRRLRR") fail("seed 1 path changed: " + seedTrial.path);

var durations = Plinko.segmentDurations(10000);
var durationSum = durations.reduce(function (a, b) { return a + b; }, 0);
if (Math.abs(durationSum - 10000) > 1e-6) fail("segment durations do not sum to the drop length");
for (i = 1; i < 7; i++) {
  if (!(durations[i] < durations[i - 1])) fail("early segments do not accelerate");
}
if (!(durations[7] > durations[0] && durations[8] > durations[7])) {
  fail("the last two segments are not the slow approach");
}

for (i = 0; i < N; i++) {
  var trial = Plinko.drawTrial();
  if (trial.path.length !== 8) fail("path length " + trial.path.length);
  var rights = 0;
  for (var c = 0; c < trial.path.length; c++) {
    var ch = trial.path.charAt(c);
    if (ch === "R") rights += 1;
    else if (ch !== "L") fail("bad path character");
  }
  if (rights !== trial.bin) fail("bin does not equal the right-step count");
  if (trial.payout !== Plinko.PAYOUTS[trial.bin]) fail("payout does not match the bin");
  if (Plinko.drawTrial(trial.seed).path !== trial.path) fail("seed did not reproduce its path");
  counts[trial.bin] += 1;
  payoutSum += trial.payout;
}

var mean = payoutSum / N;
if (Math.abs(mean - theoreticalEv) > 0.25) {
  fail("mean payout " + mean + " is too far from " + theoreticalEv);
}

console.log("draws", N);
console.log("mean payout", mean.toFixed(4), "theoretical", theoreticalEv.toFixed(4));
console.log("bin  observed  expected  z");
for (i = 0; i < 9; i++) {
  var expected = (N * Plinko.WEIGHTS[i]) / 256;
  var variance = expected * (1 - Plinko.WEIGHTS[i] / 256);
  var z = (counts[i] - expected) / Math.sqrt(variance);
  console.log(
    String(i).padStart(3),
    String(counts[i]).padStart(9),
    expected.toFixed(1).padStart(9),
    z.toFixed(2).padStart(7)
  );
  if (Math.abs(z) > 6) fail("bin " + i + " count is implausible (z=" + z.toFixed(2) + ")");
}

console.log("ok");
