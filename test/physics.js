/*
 * Guided Physics rattles inside each predetermined channel and still lands
 * in that path's bin. Guided arcs stay a single shallow hop.
 * Usage: node test/physics.js
 */
var Plinko = require("../plinko.js");

function fail(message) {
  console.error("FAIL: " + message);
  process.exit(1);
}

function pathFromMask(mask) {
  var path = "";
  var bit;
  for (bit = 0; bit < 8; bit++) path += mask & (1 << bit) ? "R" : "L";
  return path;
}

function assertRoute(route, path) {
  var rights = 0;
  var row;
  if (route.hops.length !== 9) fail(path + " produced " + route.hops.length + " hops");
  if (route.bin !== Plinko.binFromPath(path)) fail(path + " bin " + route.bin);
  for (row = 0; row < 8; row++) {
    if (route.contacts[row].index !== rights) {
      fail(path + " row " + row + " hit peg " + route.contacts[row].index);
    }
    if (route.contacts[row].row !== row) fail(path + " contact row");
    if (path.charAt(row) === "R") rights += 1;
    var end = route.hops[row].points[route.hops[row].points.length - 1];
    var next = route.hops[row + 1].points[0];
    if (Math.abs(end.x - next.x) > 1e-6 || Math.abs(end.y - next.y) > 1e-6) {
      fail(path + " hop " + row + " does not meet the next hop");
    }
  }
}

function assertInsideChannel(route, path) {
  var row;
  var p;
  for (row = 0; row < 8; row++) {
    var hop = route.hops[row];
    if (!hop.interior || hop.fallback) continue;
    for (p = 0; p < hop.points.length; p++) {
      var pt = hop.points[p];
      if (pt.x < hop.left - 1e-6 || pt.x > hop.right + 1e-6) {
        fail(path + " left the channel on row " + row);
      }
    }
  }
}

var mask;
var fallbacks = 0;
for (mask = 0; mask < 256; mask++) {
  var path = pathFromMask(mask);
  var sim = Plinko.simulatePhysics(path, 1);
  assertRoute(sim, path);
  assertInsideChannel(sim, path);
  if (sim.fallback) fallbacks += 1;
  var again = Plinko.simulatePhysics(path, 1);
  if (JSON.stringify(sim.hops[3].points) !== JSON.stringify(again.hops[3].points)) {
    fail(path + " was not deterministic");
  }
}

if (fallbacks !== 0) fail(fallbacks + " paths fell back to the guided arc");

assertRoute(Plinko.simulatePhysics("LLLLLLLL", 4), "LLLLLLLL");
assertRoute(Plinko.simulatePhysics("RRRRRRRR", 4), "RRRRRRRR");
if (Plinko.simulatePhysics("LLLLLLLL", 4).bin !== 0) fail("all-left bin");
if (Plinko.simulatePhysics("RRRRRRRR", 4).bin !== 8) fail("all-right bin");

var rattles = 0;
var sampleSeeds = [1, 2, 3, 7, 11];
var samplePaths = ["RLRLRLRL", "LRLRLRLR", "RRLLRRLL", "RLRRRLRR"];
var si;
var pi;
for (si = 0; si < sampleSeeds.length; si++) {
  for (pi = 0; pi < samplePaths.length; pi++) {
    var sample = Plinko.simulatePhysics(samplePaths[pi], sampleSeeds[si]);
    var hopIndex;
    for (hopIndex = 0; hopIndex < 8; hopIndex++) {
      var hop = sample.hops[hopIndex];
      if (hop.interior && hop.hits > 1) rattles += 1;
    }
  }
}
if (rattles < 8) fail("interior channels should bounce more than once, saw " + rattles);

var walls = Plinko.wallsForStep(2, 1, 1);
var gap = Plinko.diskSpec().gap;
var overhead = { x: (walls.left.x + walls.right.x) / 2, y: walls.exitY - 0.58 };
var launched = {
  x: overhead.x + 0.04,
  y: overhead.y + 0.2,
  vx: 0.05,
  vy: -1.15
};
var rebound = Plinko.reflectDisk(launched.x, launched.y, launched.vx, launched.vy, overhead, gap, 0.6);
if (!rebound || !rebound.reflected) fail("an upward launch should hit the pin above the channel");
var leaving = rebound.vx * rebound.nx + rebound.vy * rebound.ny;
if (!(leaving > 0)) fail("the rebound should leave along the contact normal");
var channel = Plinko.simulateChannel(
  launched,
  walls,
  { x0: walls.left.x + 0.04, x1: walls.right.x - 0.04 },
  { seed: 9, row: 2, gap: gap, preserveVelocity: true }
);
if (!channel.hit || channel.overheadHits < 1) fail("the upward launch should bounce off the pin above and still exit the gap");
if (!(channel.x > walls.left.x && channel.x < walls.right.x)) fail("the upward launch left the predetermined gap");

var guidedLeft = Plinko.guidedRoute("LLLLLLLL", 2);
var guidedRight = Plinko.guidedRoute("RLLLLLLL", 2);
var leftHit = guidedLeft.hops[0].points[guidedLeft.hops[0].points.length - 1];
var rightHit = guidedRight.hops[0].points[guidedRight.hops[0].points.length - 1];
if (!(leftHit.x < 0)) fail("a left bounce should meet the peg on its left shoulder");
if (!(rightHit.x > 0)) fail("a right bounce should meet the peg on its right shoulder");
if (guidedRight.hops[0].points.length !== 17) fail("a guided hop should stay a single shallow arc");

var arc = guidedRight.hops[2];
var from = arc.points[0];
var to = arc.points[arc.points.length - 1];
var mid = Plinko.hopPoint(from, to, 0.5);
var chord = (from.y + to.y) / 2;
if (!(mid.y < chord)) fail("the hop should ride above the straight chord");

console.log("256 paths stay in their channels and land in the path bin");
console.log("ok");
