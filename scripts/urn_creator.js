/*
 * Builds one urn, or several, that together hold every left/right path.
 * Paths that pay the same amount are one outcome. Each outcome's path
 * count must divide evenly across the urns. Default is one urn.
 *
 * Usage:
 *   node scripts/urn_creator.js
 *   node scripts/urn_creator.js --split
 *   node scripts/urn_creator.js --rows 8 --payouts 100,50,15,5,2.5,5,15,50,100 --urns 2
 */
var DEFAULT_ROWS = 8;
var DEFAULT_PAYOUTS = [100, 50, 15, 5, 2.5, 5, 15, 50, 100];
var EIGHT_ROW_PAYOUTS = [100, 50, 15, 5, 2.5];

function fail(message) {
  console.error("FAIL: " + message);
  process.exit(1);
}

function help() {
  console.log("Usage: node scripts/urn_creator.js [--rows N] [--payouts a,b,c] [--urns N | --split]");
  console.log("Default is 8 rows, the study payouts, and 1 urn. --split asks for 2 urns.");
  console.log("The payout list needs one value per bin, so its length is rows + 1.");
}

function nextValue(argv, index, flag) {
  if (index >= argv.length || argv[index].indexOf("--") === 0) {
    fail(flag + " needs a value");
  }
  return argv[index];
}

function positiveInt(text, flag) {
  if (!/^[1-9]\d*$/.test(text)) fail(flag + " needs a positive integer");
  return Number(text);
}

function parsePayouts(text) {
  var parts = text.split(",");
  var payouts = [];
  var i;
  var value;
  for (i = 0; i < parts.length; i++) {
    if (parts[i].trim() === "") fail("--payouts has an empty value");
    value = Number(parts[i]);
    if (!isFinite(value)) fail("--payouts has a non-number: " + parts[i]);
    payouts.push(value);
  }
  return payouts;
}

function readArgs(argv) {
  var rows = DEFAULT_ROWS;
  var payouts = DEFAULT_PAYOUTS;
  var urnCount = 1;
  var urnsSet = false;
  var split = false;
  var i;
  var arg;

  for (i = 0; i < argv.length; i++) {
    arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help();
      process.exit(0);
    } else if (arg === "--rows") {
      rows = positiveInt(nextValue(argv, ++i, arg), arg);
    } else if (arg === "--payouts") {
      payouts = parsePayouts(nextValue(argv, ++i, arg));
    } else if (arg === "--urns") {
      urnCount = positiveInt(nextValue(argv, ++i, arg), arg);
      urnsSet = true;
    } else if (arg === "--split") {
      split = true;
    } else {
      fail("unknown argument " + arg);
    }
  }

  if (split && urnsSet) fail("--split conflicts with --urns");
  if (split) urnCount = 2;
  if (payouts.length !== rows + 1) {
    fail("payout list has " + payouts.length + " values, expected " + (rows + 1));
  }
  return { rows: rows, payouts: payouts, urnCount: urnCount };
}

// Every path of `rows` left/right steps. "LL..." comes first, "RR..." last.
function allPaths(rows) {
  var paths = [""];
  var row;
  var i;
  var next;
  for (row = 0; row < rows; row++) {
    next = [];
    for (i = 0; i < paths.length; i++) {
      next.push(paths[i] + "L");
      next.push(paths[i] + "R");
    }
    paths = next;
  }
  return paths;
}

// Bin 0 is all lefts. Each right step moves one bin to the right.
function binOf(path) {
  var rights = 0;
  var i;
  for (i = 0; i < path.length; i++) {
    if (path.charAt(i) === "R") rights += 1;
  }
  return rights;
}

// Keys are strings, so 2.5 and "2.5" stay one outcome. `order` is first-seen.
function groupByPayout(paths, payouts) {
  var counts = {};
  var pathsByPayout = {};
  var order = [];
  var i;
  var key;

  for (i = 0; i < paths.length; i++) {
    key = String(payouts[binOf(paths[i])]);
    if (!Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] = 0;
      pathsByPayout[key] = [];
      order.push(key);
    }
    counts[key] += 1;
    pathsByPayout[key].push(paths[i]);
  }
  return { counts: counts, paths: pathsByPayout, order: order };
}

function randomInt(n) {
  return Math.floor(Math.random() * n);
}

function shuffle(list) {
  var i;
  var j;
  var tmp;
  for (i = list.length - 1; i > 0; i--) {
    j = randomInt(i + 1);
    tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
}

function openIndexes(slots, start, end) {
  var open = [];
  var i;
  for (i = start; i < end; i++) {
    if (slots[i] === null) open.push(i);
  }
  return open;
}

// One $50 in a random slot of each equal block of the urn.
function placeFifties(slots, blocks) {
  var size = slots.length;
  var blockSize = size / blocks;
  var block;
  if (blockSize !== Math.floor(blockSize)) {
    fail("urn size " + size + " does not split into " + blocks + " blocks");
  }
  for (block = 0; block < blocks; block++) {
    slots[block * blockSize + randomInt(blockSize)] = 50;
  }
}

// Three $15 in each block of the interior (every draw but the first and last).
// Extra $15 draws go one each to the earliest blocks. The last block takes
// any interior slots left over from the block division.
function placeFifteens(slots, count) {
  var size = slots.length;
  var blocks = Math.floor(count / 3);
  var blockSize = Math.floor((size - 2) / blocks);
  var extra = count - blocks * 3;
  var block;
  var start;
  var end;
  var open;
  var needed;
  var i;

  for (block = 0; block < blocks; block++) {
    start = 1 + block * blockSize;
    end = block === blocks - 1 ? size - 1 : start + blockSize;
    open = shuffle(openIndexes(slots, start, end));
    needed = 3 + (block < extra ? 1 : 0);
    if (open.length < needed) {
      fail("block " + block + " has no room for " + needed + " $15 draws");
    }
    for (i = 0; i < needed; i++) slots[open[i]] = 15;
  }
}

// Whatever is left, shuffled, then filled with $5, then $100, then $2.50.
function fillRemainder(slots, counts) {
  var open = shuffle(openIndexes(slots, 0, slots.length));
  var expected = counts[5] + counts[100] + counts[2.5];
  var i;

  if (open.length !== expected) {
    fail("remaining positions do not match remaining payouts");
  }
  for (i = 0; i < open.length; i++) {
    if (i < counts[5]) slots[open[i]] = 5;
    else if (i < counts[5] + counts[100]) slots[open[i]] = 100;
    else slots[open[i]] = 2.5;
  }
}

// Index 0 is the first draw. `counts` is this urn's share of each payout.
function buildEightRowUrn(counts, size) {
  var slots = [];
  var i;
  for (i = 0; i < size; i++) slots.push(null);
  placeFifties(slots, counts[50]);
  placeFifteens(slots, counts[15]);
  fillRemainder(slots, counts);
  return slots;
}

function perUrnCounts(grouped, urnCount) {
  var counts = {};
  var size = 0;
  var i;
  var payout;

  for (i = 0; i < EIGHT_ROW_PAYOUTS.length; i++) {
    payout = EIGHT_ROW_PAYOUTS[i];
    if (!grouped.counts[String(payout)]) fail("8-row urns need a " + payout + " payout");
    counts[payout] = grouped.counts[String(payout)] / urnCount;
    size += counts[payout];
  }
  if (grouped.order.length !== EIGHT_ROW_PAYOUTS.length) {
    fail("8-row urns support only the payouts 100, 50, 15, 5, 2.5");
  }
  return { counts: counts, size: size };
}

// Same payout layout in every urn. Each payout's paths are shuffled once
// and dealt out, so a path is used in exactly one urn.
function generateUrnsForEightRows(grouped, urnCount) {
  var share = perUrnCounts(grouped, urnCount);
  var pools = {};
  var urns = [];
  var i;
  var payout;
  var slots;
  var draw;

  for (i = 0; i < EIGHT_ROW_PAYOUTS.length; i++) {
    payout = EIGHT_ROW_PAYOUTS[i];
    pools[payout] = shuffle(grouped.paths[String(payout)].slice());
  }
  for (i = 0; i < urnCount; i++) {
    slots = buildEightRowUrn(share.counts, share.size);
    for (draw = 0; draw < slots.length; draw++) {
      slots[draw] = pools[slots[draw]].pop();
    }
    urns.push(slots);
  }
  return urns;
}

// Row counts other than 8 are not laid out yet.
function generateUrnsGeneral(urnCount) {
  var urns = [];
  var i;
  for (i = 0; i < urnCount; i++) urns.push([]);
  return urns;
}

function generateUrns(grouped, urnCount, rows) {
  if (rows === 8) return generateUrnsForEightRows(grouped, urnCount);
  return generateUrnsGeneral(urnCount);
}

function requireEvenSplit(grouped, urnCount) {
  var uneven = false;
  var i;
  var key;
  var count;

  for (i = 0; i < grouped.order.length; i++) {
    if (grouped.counts[grouped.order[i]] % urnCount !== 0) uneven = true;
  }
  if (!uneven) return;

  for (i = 0; i < grouped.order.length; i++) {
    key = grouped.order[i];
    count = grouped.counts[key];
    console.error("payout " + key + ": " + count + " remainder " + (count % urnCount));
  }
  fail("payout counts are not divisible by " + urnCount);
}

function main() {
  var options = readArgs(process.argv.slice(2));
  var paths = allPaths(options.rows);
  var grouped = groupByPayout(paths, options.payouts);
  var i;
  var key;

  console.log("rows " + options.rows);
  console.log("urns " + options.urnCount);
  console.log("paths " + paths.length);

  requireEvenSplit(grouped, options.urnCount);
  for (i = 0; i < grouped.order.length; i++) {
    key = grouped.order[i];
    console.log("payout " + key + ": " + grouped.counts[key]);
  }
  console.log(JSON.stringify(generateUrns(grouped, options.urnCount, options.rows)));
}

main();
