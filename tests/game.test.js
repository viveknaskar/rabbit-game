// Rabbit Run — Unit Tests
// Run with: node tests/game.test.js

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  ✗  ${name}\n       → ${e.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertApprox(actual, expected, tolerance = 0.01, message) {
    if (Math.abs(actual - expected) > tolerance)
        throw new Error(`${message ? message + ': ' : ''}expected ~${expected}, got ${actual}`);
}

// ── Pure functions mirrored from game.js ──────────────────────────

function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function lerpColor(c1, c2, t) {
    const [r1,g1,b1] = hexToRgb(c1);
    const [r2,g2,b2] = hexToRgb(c2);
    return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

function getDayTime(displayScore) {
    return Math.min(displayScore / 300, 1.0);
}

function checkCollision(rabbit, obs) {
    return rabbit.x + 40 > obs.x &&
           rabbit.x      < obs.x + obs.width &&
           rabbit.y + 50 > obs.y &&
           rabbit.y      < obs.y + obs.height;
}

function getDisplayScore(score) {
    return Math.floor(score / 5);
}

function getLeaderboard(stored) {
    try { return JSON.parse(stored || '[]'); }
    catch { return []; }
}

function saveLeaderboard(board, score) {
    const updated = [...board, score];
    updated.sort((a, b) => b - a);
    return updated.slice(0, 5);
}

const DIFFICULTY = {
    easy:   { speedBase: 4,  speedMax: 9,  gapStart: 420, gapMin: 280, spawnBase: 0.014, spawnMax: 0.030 },
    normal: { speedBase: 6,  speedMax: 12, gapStart: 350, gapMin: 220, spawnBase: 0.020, spawnMax: 0.038 },
    hard:   { speedBase: 8,  speedMax: 14, gapStart: 280, gapMin: 180, spawnBase: 0.028, spawnMax: 0.050 },
};

function getGameSpeed(diffMode, displayScore) {
    const diff = DIFFICULTY[diffMode];
    return Math.min(diff.speedBase + displayScore * 0.022, diff.speedMax);
}

function getMinGap(diffMode, displayScore) {
    const diff = DIFFICULTY[diffMode];
    return Math.max(diff.gapStart - displayScore * 0.5, diff.gapMin);
}

// ── Tests ─────────────────────────────────────────────────────────

console.log('\nhexToRgb');
test('parses white',  () => { const [r,g,b] = hexToRgb('#FFFFFF'); assertEqual(r,255); assertEqual(g,255); assertEqual(b,255); });
test('parses black',  () => { const [r,g,b] = hexToRgb('#000000'); assertEqual(r,0);   assertEqual(g,0);   assertEqual(b,0);   });
test('parses a colour', () => { const [r,g,b] = hexToRgb('#4A8AAA'); assertEqual(r,74); assertEqual(g,138); assertEqual(b,170); });

console.log('\nlerpColor');
test('t=0 returns first colour',  () => assertEqual(lerpColor('#FF0000','#0000FF',0), 'rgb(255,0,0)'));
test('t=1 returns second colour', () => assertEqual(lerpColor('#FF0000','#0000FF',1), 'rgb(0,0,255)'));
test('t=0.5 returns midpoint',    () => assertEqual(lerpColor('#000000','#FFFFFF',0.5), 'rgb(128,128,128)'));

console.log('\ngetDayTime');
test('returns 0 at score 0',              () => assertEqual(getDayTime(0), 0));
test('returns 1 at score 300',            () => assertEqual(getDayTime(300), 1.0));
test('clamps to 1 beyond score 300',      () => assertEqual(getDayTime(999), 1.0));
test('returns 0.5 at score 150',          () => assertApprox(getDayTime(150), 0.5));

console.log('\nDisplay Score');
test('score 0  → display 0',   () => assertEqual(getDisplayScore(0),   0));
test('score 5  → display 1',   () => assertEqual(getDisplayScore(5),   1));
test('score 14 → display 2',   () => assertEqual(getDisplayScore(14),  2));
test('score 500 → display 100',() => assertEqual(getDisplayScore(500), 100));

console.log('\nCollision Detection');
test('detects overlap',             () => assert( checkCollision({x:100,y:140}, {x:120,y:163,width:50,height:35})));
test('no collision — rabbit left',  () => assert(!checkCollision({x:10, y:140}, {x:200,y:163,width:50,height:35})));
test('no collision — rabbit in air',() => assert(!checkCollision({x:100,y:80},  {x:110,y:163,width:50,height:35})));
test('no collision — rabbit passed',() => assert(!checkCollision({x:180,y:140}, {x:100,y:163,width:50,height:35})));

console.log('\nLeaderboard');
test('sorts scores descending', () => {
    let b = [];
    b = saveLeaderboard(b, 100);
    b = saveLeaderboard(b, 200);
    b = saveLeaderboard(b, 50);
    assertEqual(b[0], 200); assertEqual(b[1], 100); assertEqual(b[2], 50);
});
test('keeps only top 5', () => {
    let b = [];
    [10,20,30,40,50,60].forEach(s => { b = saveLeaderboard(b, s); });
    assertEqual(b.length, 5);
    assertEqual(b[0], 60);
    assertEqual(b[4], 20);
});
test('parses empty stored value', () => assertEqual(getLeaderboard(null).length, 0));
test('handles invalid JSON',      () => assertEqual(getLeaderboard('not-json').length, 0));

console.log('\nDifficulty Profiles');
test('hard is faster than normal',       () => assert(DIFFICULTY.hard.speedBase  > DIFFICULTY.normal.speedBase));
test('hard has smaller gap than normal', () => assert(DIFFICULTY.hard.gapMin     < DIFFICULTY.normal.gapMin));
test('hard spawns more than normal',     () => assert(DIFFICULTY.hard.spawnMax   > DIFFICULTY.normal.spawnMax));
test('easy is slower than normal',       () => assert(DIFFICULTY.easy.speedBase  < DIFFICULTY.normal.speedBase));
test('easy has larger gap than normal',  () => assert(DIFFICULTY.easy.gapMin     > DIFFICULTY.normal.gapMin));
test('easy spawns less than normal',     () => assert(DIFFICULTY.easy.spawnMax   < DIFFICULTY.normal.spawnMax));
test('speed caps at speedMax',           () => assertEqual(getGameSpeed('normal', 10000), DIFFICULTY.normal.speedMax));
test('speed starts at speedBase',        () => assertEqual(getGameSpeed('normal', 0),     DIFFICULTY.normal.speedBase));
test('gap caps at gapMin',               () => assertEqual(getMinGap('normal', 10000),    DIFFICULTY.normal.gapMin));
test('gap starts at gapStart',           () => assertEqual(getMinGap('normal', 0),        DIFFICULTY.normal.gapStart));

console.log('\nPhysics');
test('jump reaches apex in ~20 frames at 60fps', () => {
    const dt = 1 / 60;
    let velocity = -960;
    let frames = 0;
    while (velocity < 0) { velocity += 2880 * dt; frames++; }
    assert(frames >= 19 && frames <= 21, `expected ~20 frames, got ${frames}`);
});
test('delta-time clamp rejects negative values', () => {
    const clamp = raw => Math.max(0, Math.min(raw, 0.033));
    assertEqual(clamp(-0.5), 0);
    assertEqual(clamp(0.016), 0.016);
    assertEqual(clamp(1.0), 0.033);
});

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed + failed} tests   ${passed} passed   ${failed} failed\n`);
if (failed > 0) process.exit(1);
