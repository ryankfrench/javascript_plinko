/*
 * The steered drop must hit the predetermined pegs.
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

var mask;
var fallbacks = 0;
for (mask = 0; mask < 256; mask++) {
  var path = pathFromMask(mask);
  var sim = Plinko.simulatePhysics(path, 1);
  assertRoute(sim, path);
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

var guidedLeft = Plinko.guidedRoute("LLLLLLLL", 2);
var guidedRight = Plinko.guidedRoute("RLLLLLLL", 2);
var leftHit = guidedLeft.hops[0].points[guidedLeft.hops[0].points.length - 1];
var rightHit = guidedRight.hops[0].points[guidedRight.hops[0].points.length - 1];
if (!(leftHit.x < 0)) fail("a left bounce should meet the peg on its left shoulder");
if (!(rightHit.x > 0)) fail("a right bounce should meet the peg on its right shoulder");

var arc = guidedRight.hops[2];
var from = arc.points[0];
var to = arc.points[arc.points.length - 1];
var mid = Plinko.hopPoint(from, to, 0.5);
var chord = (from.y + to.y) / 2;
if (!(mid.y < chord)) fail("the hop should ride above the straight chord");

console.log("256 paths hit their predetermined pegs");
console.log("ok");
