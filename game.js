if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        const [tl, tr, br, bl] = Array.isArray(r)
            ? [r[0]??0, r[1]??0, r[2]??0, r[3]??0]
            : [r, r, r, r];
        this.moveTo(x + tl, y);
        this.lineTo(x + w - tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + tr);
        this.lineTo(x + w, y + h - br);
        this.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        this.lineTo(x + bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - bl);
        this.lineTo(x, y + tl);
        this.quadraticCurveTo(x, y, x + tl, y);
        this.closePath();
        return this;
    };
}

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const scoreEl  = document.getElementById('score-value');
const bestEl   = document.getElementById('best-value');

const DIFFICULTY = {
    easy:   { speedBase: 4,  speedMax: 9,  gapStart: 420, gapMin: 280, spawnBase: 0.014, spawnMax: 0.030 },
    normal: { speedBase: 6,  speedMax: 12, gapStart: 350, gapMin: 220, spawnBase: 0.020, spawnMax: 0.038 },
    hard:   { speedBase: 8,  speedMax: 14, gapStart: 280, gapMin: 180, spawnBase: 0.028, spawnMax: 0.050 },
};
let diffMode = 'normal';

let highScore = parseInt(localStorage.getItem('rabbitHighScore') || '0', 10);
bestEl.textContent = highScore;

function getLeaderboard() {
    try { return JSON.parse(localStorage.getItem('rabbitLeaderboard') || '[]'); }
    catch { return []; }
}

function saveLeaderboard(score) {
    const board = getLeaderboard();
    board.push(score);
    board.sort((a, b) => b - a);
    const top5 = board.slice(0, 5);
    localStorage.setItem('rabbitLeaderboard', JSON.stringify(top5));
    return top5;
}

const FAR_PEAKS  = [[0,158],[65,118],[140,142],[230,103],[320,126],[410,108],[500,136],[600,158]];
const NEAR_PEAKS = [[0,183],[95,158],[205,174],[315,152],[420,170],[500,183]];

// Fixed star positions so they don't flicker each frame
const STARS = Array.from({ length: 80 }, () => ({
    x: Math.random() * 800,
    y: Math.random() * 155,
    r: Math.random() * 1.4 + 0.3,
}));

const state = {
    rabbit: {
        x: 50, y: 140,
        width: 50, height: 60,
        velocity: 0,
        gravity: 2880,    // px/s² (was 0.8/frame² at 60fps → 0.8×60² = 2880)
        jumpForce: -960,  // px/s  (was -16/frame at 60fps → -16×60 = -960)
        isJumping: false,
        legFrame: 0,
        blinkTimer: 0
    },
    obstacles: [],
    isPaused: false,
    clouds: [
        { x: 110, y: 24, r: 42 },
        { x: 330, y: 16, r: 32 },
        { x: 540, y: 30, r: 52 },
        { x: 730, y: 20, r: 36 },
    ],
    mtnOff:          0,
    terrainOff:      0,
    score:           0,
    gameSpeed:       6,
    isGameOver:      false,
    minGap:          350,
    lastMilestone:   0,
    milestoneFlash:  0
};

// ── Day/Night Cycle ───────────────────────────────────────────────

function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function lerpColor(c1, c2, t) {
    const [r1,g1,b1] = hexToRgb(c1);
    const [r2,g2,b2] = hexToRgb(c2);
    return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

// t=0 → dawn, t=1 → deep night  (mapped from display score 0→300)
const TIME_KF = [
    { t:0.00, skyTop:'#F4845F', skyBot:'#FAC980', mtn:'#C4905A', hill:'#8B7B3A', cloudR:255,cloudG:200,cloudB:160,cloudA:0.80 },
    { t:0.18, skyTop:'#82C8E8', skyBot:'#C5E6F5', mtn:'#8AAFC2', hill:'#628F4A', cloudR:255,cloudG:255,cloudB:255,cloudA:0.96 },
    { t:0.50, skyTop:'#2E86C1', skyBot:'#7BC8E8', mtn:'#7299B0', hill:'#4A7A38', cloudR:255,cloudG:255,cloudB:255,cloudA:0.90 },
    { t:0.72, skyTop:'#C8501A', skyBot:'#F09830', mtn:'#7A4A28', hill:'#5A420F', cloudR:255,cloudG:155,cloudB:80, cloudA:0.85 },
    { t:0.87, skyTop:'#120828', skyBot:'#2E1048', mtn:'#1A1228', hill:'#0C1008', cloudR:70, cloudG:55, cloudB:95, cloudA:0.28 },
    { t:1.00, skyTop:'#04060E', skyBot:'#08102A', mtn:'#090E18', hill:'#050805', cloudR:35, cloudG:40, cloudB:65, cloudA:0.12 },
];

function sampleKF(t, key) {
    for (let i = 0; i < TIME_KF.length - 1; i++) {
        const a = TIME_KF[i], b = TIME_KF[i + 1];
        if (t >= a.t && t <= b.t) {
            const u = (t - a.t) / (b.t - a.t);
            const v = a[key];
            if (typeof v === 'string') return lerpColor(v, b[key], u);
            return v + (b[key] - v) * u;
        }
    }
    return TIME_KF[TIME_KF.length - 1][key];
}

// Returns 0 (dawn) → 1 (deep night) based on display score 0→300
function getDayTime(displayScore) {
    return Math.min(displayScore / 300, 1.0);
}

// Sun arcs from left horizon (dawn) to right horizon (dusk)
function getSunPos(t) {
    const tNorm = Math.min(t / 0.85, 1);
    return {
        x: 60 + tNorm * 680,
        y: 175 - Math.sin(tNorm * Math.PI) * 152,
    };
}

// Moon rises from the right during dusk
function getMoonPos(t) {
    const tNorm = Math.max(0, Math.min((t - 0.75) / 0.25, 1));
    return {
        x: 680 - tNorm * 260,
        y: 175 - Math.sin(tNorm * Math.PI * 0.8) * 138,
    };
}

// ── Background drawing ────────────────────────────────────────────

function drawMountainLayer(offset, color, peaks) {
    const period = peaks[peaks.length - 1][0];
    const shift  = offset % period;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-period, canvas.height);
    for (let rep = -1; rep <= 2; rep++) {
        for (const [px, py] of peaks) {
            ctx.lineTo(px - shift + rep * period, py);
        }
    }
    ctx.lineTo(canvas.width + period, canvas.height);
    ctx.closePath();
    ctx.fill();
}

function drawCloud(cx, cy, r, rgba) {
    ctx.fillStyle = rgba;
    ctx.beginPath();
    ctx.arc(cx,            cy,            r * 0.55, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.5,  cy - r * 0.22, r * 0.46, 0, Math.PI * 2);
    ctx.arc(cx + r,        cy,            r * 0.40, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.25, cy + r * 0.1,  r * 0.34, 0, Math.PI * 2);
    ctx.fill();
}

function drawStars(alpha) {
    if (alpha <= 0) return;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(2)})`;
    for (const s of STARS) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawSun(x, y, t) {
    // Fade in at dawn, fade out at dusk
    const alpha = t < 0.06 ? t / 0.06 : (t > 0.80 ? Math.max(0, (0.88 - t) / 0.08) : 1);
    if (alpha <= 0) return;

    const isEdge = t < 0.22 || t > 0.62;
    const glowR  = isEdge ? 255 : 255;
    const glowG  = isEdge ? 120 : 210;
    const glowB  = isEdge ? 20  : 80;

    const grd = ctx.createRadialGradient(x, y, 3, x, y, 42);
    grd.addColorStop(0, `rgba(${glowR},${glowG},${glowB},${(0.5 * alpha).toFixed(2)})`);
    grd.addColorStop(1, `rgba(${glowR},${glowG},${glowB},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, 42, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = isEdge
        ? `rgba(255,170,60,${alpha.toFixed(2)})`
        : `rgba(255,240,160,${alpha.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = `rgba(255,255,255,${(0.65 * alpha).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x - 4, y - 4, 6, 0, Math.PI * 2); ctx.fill();
}

function drawMoon(x, y, alpha) {
    if (alpha <= 0) return;

    // Glow
    const grd = ctx.createRadialGradient(x, y, 3, x, y, 32);
    grd.addColorStop(0, `rgba(180,210,255,${(0.35 * alpha).toFixed(2)})`);
    grd.addColorStop(1, `rgba(180,210,255,0)`);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill();

    // Moon disc
    ctx.fillStyle = `rgba(215,228,255,${alpha.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill();

    // Crescent shadow (offset darker circle)
    ctx.fillStyle = `rgba(8,10,28,${alpha.toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x + 6, y - 2, 11, 0, Math.PI * 2); ctx.fill();

    // Highlight
    ctx.fillStyle = `rgba(240,245,255,${(0.75 * alpha).toFixed(2)})`;
    ctx.beginPath(); ctx.arc(x - 4, y - 3, 4, 0, Math.PI * 2); ctx.fill();
}

function drawBackground() {
    const displayScore = Math.floor(state.score / 5);
    const t = getDayTime(displayScore);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, 185);
    sky.addColorStop(0, sampleKF(t, 'skyTop'));
    sky.addColorStop(1, sampleKF(t, 'skyBot'));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, 185);

    // Stars (fade in from dusk)
    drawStars(Math.min(Math.max(0, (t - 0.65) / 0.22), 1));

    // Sun
    if (t < 0.90) {
        const sp = getSunPos(t);
        drawSun(sp.x, sp.y, t);
    }

    // Moon
    if (t > 0.72) {
        const moonAlpha = Math.min((t - 0.72) / 0.15, 1);
        const mp = getMoonPos(t);
        drawMoon(mp.x, mp.y, moonAlpha);
    }

    // Mountains & hills with time-based colors
    drawMountainLayer(state.mtnOff * 0.35, sampleKF(t, 'mtn'),  FAR_PEAKS);
    drawMountainLayer(state.mtnOff * 0.7,  sampleKF(t, 'hill'), NEAR_PEAKS);

    // Clouds with time-based tint
    const cr = Math.round(sampleKF(t, 'cloudR'));
    const cg = Math.round(sampleKF(t, 'cloudG'));
    const cb = Math.round(sampleKF(t, 'cloudB'));
    const ca = sampleKF(t, 'cloudA').toFixed(2);
    const cloudRgba = `rgba(${cr},${cg},${cb},${ca})`;
    for (const c of state.clouds) drawCloud(c.x, c.y, c.r, cloudRgba);
}

function drawGround() {
    const off = state.terrainOff;
    const sp  = 46;

    ctx.fillStyle = '#4A7A2C';
    ctx.fillRect(0, 191, canvas.width, 9);

    ctx.fillStyle = '#386020';
    ctx.fillRect(0, 191, canvas.width, 2);

    ctx.fillStyle = '#7A5828';
    ctx.fillRect(0, 197, canvas.width, 3);

    ctx.fillStyle = '#2E5018';
    for (let x = -(off % sp); x < canvas.width + sp; x += sp) {
        ctx.fillRect(x,      187, 2, 5);
        ctx.fillRect(x + 7,  185, 2, 7);
        ctx.fillRect(x + 14, 188, 2, 4);
        ctx.fillRect(x + 24, 186, 2, 6);
        ctx.fillRect(x + 31, 188, 2, 4);
        ctx.fillRect(x + 38, 186, 2, 5);
    }

    ctx.fillStyle = '#8A7860';
    for (let x = -(off % sp) + 20; x < canvas.width + sp; x += sp) {
        ctx.beginPath();
        ctx.ellipse(x,      194, 4, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 28, 193, 3, 2,   0, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ── Rabbit (player) ───────────────────────────────────────────────

function drawRabbit() {
    ctx.save();
    ctx.translate(state.rabbit.x, state.rabbit.y);

    const cream  = '#EDE8DC';
    const shadow = '#C8BEB0';
    const white  = '#F8F6F2';
    const pink   = '#F0A0B8';
    const dpink  = '#D84070';
    const legPos = Math.floor(state.rabbit.legFrame / 5) % 2;

    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.roundRect(29, -23, 10, 31, [5,5,3,3]); ctx.fill();
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.roundRect(32, -19, 5, 23, [3,3,2,2]); ctx.fill();

    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(39, -26, 10, 34, [5,5,3,3]); ctx.fill();
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.roundRect(42, -22, 5, 26, [3,3,2,2]); ctx.fill();

    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(7, 35, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(9, 38, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(6, 34, 5, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(5, 20, 38, 36, 16); ctx.fill();

    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(19, 39, 12, 13, 0, 0, Math.PI * 2); ctx.fill();

    if (legPos === 0) {
        ctx.fillStyle = shadow;
        ctx.beginPath(); ctx.roundRect(7,  50, 15, 12, [3,3,2,2]); ctx.fill();
        ctx.beginPath(); ctx.roundRect(4,  59, 22,  6, 3); ctx.fill();
        ctx.fillStyle = cream;
        ctx.beginPath(); ctx.roundRect(33, 48, 10, 10, [3,3,2,2]); ctx.fill();
        ctx.beginPath(); ctx.roundRect(30, 55, 14,  5, 3); ctx.fill();
    } else {
        ctx.fillStyle = shadow;
        ctx.beginPath(); ctx.roundRect(8,  48, 14,  9, [3,3,2,2]); ctx.fill();
        ctx.beginPath(); ctx.roundRect(6,  54, 18,  5, 3); ctx.fill();
        ctx.fillStyle = cream;
        ctx.beginPath(); ctx.roundRect(34, 50, 10, 13, [3,3,2,2]); ctx.fill();
        ctx.beginPath(); ctx.roundRect(30, 60, 16,  5, 3); ctx.fill();
    }

    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(27, 4, 22, 22, 10); ctx.fill();
    ctx.beginPath(); ctx.roundRect(30, 18, 14, 8, 4); ctx.fill();

    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(45, 19, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = dpink;
    ctx.beginPath(); ctx.ellipse(49, 17, 3, 2, 0, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = 'rgba(80,80,80,0.38)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(47, 15); ctx.lineTo(31, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(47, 18); ctx.lineTo(31, 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(47, 21); ctx.lineTo(31, 24); ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(40, 11, 5, 0, Math.PI * 2); ctx.fill();

    if (state.rabbit.blinkTimer <= 0) {
        ctx.fillStyle = '#1A1520';
        ctx.beginPath(); ctx.arc(41, 11, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(42, 10, 1, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.strokeStyle = shadow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(41, 14, 4, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
    }

    ctx.restore();
}

// ── Tortoise (obstacle) ───────────────────────────────────────────

function createTortoise() {
    return { x: canvas.width, y: 163, width: 50, height: 35, legFrame: 0 };
}

function drawTortoise(obs) {
    ctx.save();
    ctx.translate(obs.x, obs.y);

    const shell  = '#4C7040';
    const dshell = '#324A28';
    const lshell = '#6A9A52';
    const skin   = '#7A9840';
    const dskin  = '#5A7830';
    const lp     = Math.floor(obs.legFrame / 8) % 2;

    ctx.fillStyle = skin;
    if (lp === 0) {
        ctx.beginPath(); ctx.roundRect(5,  26, 11, 11, 4); ctx.fill();
        ctx.beginPath(); ctx.roundRect(34, 24,  9,  8, 4); ctx.fill();
    } else {
        ctx.beginPath(); ctx.roundRect(5,  24, 11,  8, 4); ctx.fill();
        ctx.beginPath(); ctx.roundRect(34, 26,  9, 11, 4); ctx.fill();
    }
    ctx.fillStyle = dskin;
    ctx.beginPath(); ctx.roundRect(4,  33, 14, 3, 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(33, 33, 13, 3, 2); ctx.fill();

    ctx.fillStyle = dshell;
    ctx.beginPath(); ctx.roundRect(4, 22, 44, 13, [0,0,5,5]); ctx.fill();

    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.arc(26, 22, 22, Math.PI, 0);
    ctx.lineTo(48, 22);
    ctx.lineTo(4,  22);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = lshell;
    ctx.beginPath();
    ctx.arc(17, 14, 13, Math.PI * 1.1, Math.PI * 1.85);
    ctx.arc(10, 19,  8, Math.PI * 1.8,  Math.PI * 1.05, true);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = dshell;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(6, 20); ctx.quadraticCurveTo(26, 5, 46, 20);
    ctx.stroke();
    const divs = [
        [[4, 22],  [16, 2]],
        [[14, 22], [23, 1]],
        [[26, 22], [26, 0]],
        [[38, 22], [30, 1]],
        [[48, 22], [36, 2]],
    ];
    for (const [[x1,y1],[x2,y2]] of divs) {
        ctx.beginPath();
        ctx.moveTo(x1, y1); ctx.quadraticCurveTo(x1, (y1+y2)/2, x2, y2);
        ctx.stroke();
    }

    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.roundRect(-13, 12, 21, 13, [5,3,4,5]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(4,  14,  8, 10,  3); ctx.fill();

    ctx.fillStyle = dskin;
    ctx.beginPath(); ctx.roundRect(-13, 19, 21, 6, [0,0,4,5]); ctx.fill();

    ctx.fillStyle = '#1A2010';
    ctx.beginPath(); ctx.arc(-6, 15, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-5, 14, 0.8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = dskin;
    ctx.beginPath(); ctx.arc(-12, 18, 1.2, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = dskin;
    ctx.beginPath(); ctx.arc(49, 25, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(48, 24, 3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

// ── Game loop ─────────────────────────────────────────────────────

let lastTimestamp = performance.now();

function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(8, 22, 40, 0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillText('PAUSED', canvas.width / 2 + 2, canvas.height / 2 + 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = '#A8D8F0';
    ctx.fillText('PRESS  R  TO  RESUME', canvas.width / 2, canvas.height / 2 + 28);
    ctx.textAlign = 'left';
}

function updateGame(timestamp = performance.now()) {
    if (state.isGameOver) return;
    if (state.isPaused) return;

    // Delta time in seconds — clamped: floor 0 prevents negative dt from rAF
    // timing quirks; ceiling 0.033 (~2 frames) prevents physics explosion after pauses
    const dt = Math.max(0, Math.min((timestamp - lastTimestamp) / 1000, 0.033));
    lastTimestamp = timestamp;

    const displayScore = Math.floor(state.score / 5);

    // Progressive difficulty — scaled by selected mode
    const diff = DIFFICULTY[diffMode];
    state.gameSpeed = Math.min(diff.speedBase + displayScore * 0.022, diff.speedMax);

    // Switch music theme with day/night cycle
    if (AudioManager.isReady()) {
        AudioManager.play(getDayTime(displayScore) >= 0.85 ? 'night' : 'day');
    }
    state.minGap    = Math.max(diff.gapStart - displayScore * 0.5, diff.gapMin);
    const spawnChance = Math.min(diff.spawnBase + displayScore * 0.00006, diff.spawnMax);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const speedPx = state.gameSpeed * 60 * dt;  // convert speed to px this frame
    state.mtnOff     += speedPx;
    state.terrainOff += speedPx;
    for (const c of state.clouds) {
        c.x -= 0.75 * 60 * dt;
        if (c.x + c.r * 2 < 0) {
            c.x = canvas.width + c.r;
            c.y = 12 + Math.random() * 36;
            c.r = 28 + Math.random() * 30;
        }
    }

    drawBackground();

    // Update rabbit (delta-time physics)
    state.rabbit.velocity += state.rabbit.gravity * dt;
    state.rabbit.y        += state.rabbit.velocity * dt;

    if (state.rabbit.y >= 140) {
        state.rabbit.y         = 140;
        state.rabbit.velocity  = 0;
        state.rabbit.isJumping = false;
        state.rabbit.legFrame++;
    }

    state.rabbit.blinkTimer -= 60 * dt;
    if (Math.random() < 0.005 * 60 * dt) state.rabbit.blinkTimer = 10;

    // Spawn tortoises
    const last = state.obstacles[state.obstacles.length - 1];
    if (state.obstacles.length === 0 ||
        (last.x < canvas.width - state.minGap && Math.random() < spawnChance)) {
        state.obstacles.push(createTortoise());
    }

    // Update & draw tortoises
    state.obstacles.forEach(obs => {
        obs.x -= speedPx;
        obs.legFrame += 60 * dt;
        drawTortoise(obs);

        if (state.rabbit.x + 40 > obs.x &&
            state.rabbit.x      < obs.x + obs.width &&
            state.rabbit.y + 50 > obs.y &&
            state.rabbit.y      < obs.y + obs.height) {
            gameOver();
        }
    });

    state.obstacles = state.obstacles.filter(o => o.x + o.width >= 0);

    if (state.isGameOver) return;

    drawGround();
    drawRabbit();

    state.score += 60 * dt;
    scoreEl.textContent = displayScore;

    // Score milestone check (every 100 points up to 1000, then every 500)
    const MILESTONES = [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000];
    for (const m of MILESTONES) {
        if (displayScore >= m && state.lastMilestone < m) {
            state.lastMilestone  = m;
            state.milestoneFlash = 22;
            AudioManager.sfxMilestone();
            break;
        }
    }

    // Draw milestone flash ring
    if (state.milestoneFlash > 0) {
        const alpha = (state.milestoneFlash / 22) * 0.45;
        ctx.strokeStyle = `rgba(255,230,80,${alpha.toFixed(2)})`;
        ctx.lineWidth   = 6;
        const progress  = 1 - state.milestoneFlash / 22;
        const radius    = 20 + progress * 180;
        ctx.beginPath();
        ctx.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
        ctx.stroke();
        state.milestoneFlash--;
    }

    requestAnimationFrame(updateGame);
}

function jump() {
    if (!state.rabbit.isJumping) {
        AudioManager.init();                          // start AudioContext on first gesture
        AudioManager.play(getDayTime(Math.floor(state.score / 5)) >= 0.85 ? 'night' : 'day');
        state.rabbit.velocity  = state.rabbit.jumpForce;
        state.rabbit.isJumping = true;
        AudioManager.sfxJump();
    }
}

function drawGameOverTortoise(cx, cy) {
    const shell  = '#4C7040';
    const dshell = '#324A28';
    const lshell = '#6A9A52';
    const skin   = '#7A9840';
    const dskin  = '#5A7830';

    ctx.save();

    // Shell behind head
    ctx.fillStyle = dshell;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 24, 48, 32, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = shell;
    ctx.beginPath();
    ctx.arc(cx, cy + 12, 44, Math.PI, 0);
    ctx.fill();

    // Shell highlight
    ctx.fillStyle = lshell;
    ctx.beginPath();
    ctx.arc(cx - 10, cy + 4, 22, Math.PI * 1.1, Math.PI * 1.88);
    ctx.arc(cx - 4,  cy + 10, 14, Math.PI * 1.82, Math.PI * 1.1, true);
    ctx.closePath();
    ctx.fill();

    // Shell plate lines
    ctx.strokeStyle = dshell;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy + 12);
    ctx.quadraticCurveTo(cx, cy - 10, cx + 40, cy + 12);
    ctx.stroke();
    [[-24,10],[-8,5],[8,5],[24,10]].forEach(([dx]) => {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy + 12);
        ctx.quadraticCurveTo(cx + dx * 0.5, cy, cx + dx * 0.35, cy - 12);
        ctx.stroke();
    });

    // Head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, cy, 36, 0, Math.PI * 2);
    ctx.fill();

    // Head bottom shading
    ctx.fillStyle = dskin;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 24, 26, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Laughing tears at eye corners
    ctx.fillStyle = 'rgba(120,190,255,0.75)';
    ctx.beginPath(); ctx.ellipse(cx - 24, cy - 1, 3, 5, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 24, cy - 1, 3, 5, -0.4, 0, Math.PI * 2); ctx.fill();

    // Laughing eyes  (^ arcs — opening faces upward)
    ctx.strokeStyle = '#1A2010';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx - 13, cy - 9, 11, Math.PI + 0.38, 2 * Math.PI - 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 13, cy - 9, 11, Math.PI + 0.38, 2 * Math.PI - 0.38);
    ctx.stroke();

    // Rosy cheeks
    ctx.fillStyle = 'rgba(220,90,70,0.26)';
    ctx.beginPath(); ctx.ellipse(cx - 27, cy + 3, 11, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 27, cy + 3, 11, 7, 0, 0, Math.PI * 2); ctx.fill();

    // Open laughing mouth — filled bottom-semicircle
    ctx.fillStyle = '#8B2020';
    ctx.beginPath();
    ctx.arc(cx, cy + 15, 17, 0, Math.PI);
    ctx.fill();

    // Teeth
    ctx.fillStyle = '#F2EFE8';
    ctx.beginPath(); ctx.roundRect(cx - 14, cy + 15, 12, 7, [0,0,3,3]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(cx + 1,  cy + 15, 12, 7, [0,0,3,3]); ctx.fill();

    // Mouth outline
    ctx.strokeStyle = '#1A2010';
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy + 15, 17, 0, Math.PI);
    ctx.moveTo(cx - 17, cy + 15);
    ctx.lineTo(cx + 17, cy + 15);
    ctx.stroke();

    ctx.restore();
}

function drawGameOverRabbit(anchorX, anchorY) {
    // anchorX/Y = where the rabbit's feet should land (top of tortoise shell)
    const scale = 0.58;

    ctx.save();
    ctx.translate(anchorX - 25 * scale, anchorY - 65 * scale);
    ctx.scale(scale, scale);

    const cream  = '#EDE8DC';
    const shadow = '#C8BEB0';
    const white  = '#F8F6F2';
    const pink   = '#F0A0B8';
    const dpink  = '#D84070';

    // Back ear
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.roundRect(29, -23, 10, 31, [5,5,3,3]); ctx.fill();
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.roundRect(32, -19, 5, 23, [3,3,2,2]); ctx.fill();

    // Front ear
    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(39, -26, 10, 34, [5,5,3,3]); ctx.fill();
    ctx.fillStyle = pink;
    ctx.beginPath(); ctx.roundRect(42, -22, 5, 26, [3,3,2,2]); ctx.fill();

    // Fluffy tail
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(7, 35, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.arc(9, 38, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(6, 34, 5, 0, Math.PI * 2); ctx.fill();

    // Body
    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(5, 20, 38, 36, 16); ctx.fill();

    // Belly highlight
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(19, 39, 12, 13, 0, 0, Math.PI * 2); ctx.fill();

    // Legs — both feet down (seated/riding pose)
    ctx.fillStyle = shadow;
    ctx.beginPath(); ctx.roundRect(7,  50, 15, 12, [3,3,2,2]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(4,  59, 22,  6, 3); ctx.fill();
    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(33, 50, 10, 12, [3,3,2,2]); ctx.fill();
    ctx.beginPath(); ctx.roundRect(30, 58, 14,  5, 3); ctx.fill();

    // Head
    ctx.fillStyle = cream;
    ctx.beginPath(); ctx.roundRect(27, 4, 22, 22, 10); ctx.fill();
    ctx.beginPath(); ctx.roundRect(30, 18, 14, 8, 4); ctx.fill();

    // Cheek / snout
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(45, 19, 6, 5, 0, 0, Math.PI * 2); ctx.fill();

    // Nose
    ctx.fillStyle = dpink;
    ctx.beginPath(); ctx.ellipse(49, 17, 3, 2, 0, 0, Math.PI * 2); ctx.fill();

    // Whiskers
    ctx.strokeStyle = 'rgba(80,80,80,0.38)';
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(47, 15); ctx.lineTo(31, 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(47, 18); ctx.lineTo(31, 18); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(47, 21); ctx.lineTo(31, 24); ctx.stroke();

    // Eye — sad, drooping (downward arc = closed sad squint)
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(40, 11, 5, 0, Math.PI * 2); ctx.fill();
    // Sad closed eye: arc opening faces downward (U shape)
    ctx.strokeStyle = shadow;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(41, 9, 4, 0.25, Math.PI - 0.25); // brow furrow / sad squint
    ctx.stroke();

    // Sweat drop (embarrassed)
    ctx.fillStyle = 'rgba(100,180,255,0.85)';
    ctx.beginPath(); ctx.arc(27, 5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(27, 2);
    ctx.lineTo(25, -4);
    ctx.lineTo(29, -4);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

function showGameOverScreen(isNewBest, finalScore) {
    // Dark overlay
    ctx.fillStyle = 'rgba(8, 22, 40, 0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Tortoise face (left side) + defeated rabbit riding on top
    drawGameOverTortoise(90, 108);
    drawGameOverRabbit(90, 76);   // feet land on top of tortoise shell (y≈76)

    // ── Speech bubble ─────────────────────────────────────────────
    const bx = 148, by = 18, bw = 638, bh = 164, br = 14;
    const tailMidY = 108;

    // Tail triangle pointing left toward tortoise
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.beginPath();
    ctx.moveTo(bx - 10, tailMidY);         // tip
    ctx.lineTo(bx + 2,  tailMidY - 17);    // upper base
    ctx.lineTo(bx + 2,  tailMidY + 17);    // lower base
    ctx.closePath();
    ctx.fill();

    // Bubble body (drawn on top to seal the tail seam)
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, br);
    ctx.fill();
    ctx.stroke();

    const tcx = bx + bw / 2;   // text center x

    ctx.textAlign = 'center';

    // Quote
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillStyle = '#3A5A6A';
    ctx.fillText('Slow and steady', tcx, by + 38);
    ctx.fillText('wins the race!', tcx, by + 58);

    // Divider
    ctx.strokeStyle = 'rgba(80,120,150,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 30, by + 72);
    ctx.lineTo(bx + bw - 30, by + 72);
    ctx.stroke();

    // GAME OVER
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillText('GAME OVER', tcx + 2, by + 100 + 2);
    ctx.fillStyle = '#E04040';
    ctx.fillText('GAME OVER', tcx, by + 100);

    // New best badge or blank space
    if (isNewBest) {
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillText('✦ NEW BEST ✦', tcx + 1, by + 125 + 1);
        ctx.fillStyle = '#C8920A';
        ctx.fillText('✦ NEW BEST ✦', tcx, by + 125);
    }

    // Restart hint
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillText('PRESS  R  TO  RESTART', tcx + 1, by + 148 + 1);
    ctx.fillStyle = '#2A6A8A';
    ctx.fillText('PRESS  R  TO  RESTART', tcx, by + 148);

    // Show difficulty badge
    ctx.textAlign = 'left';
    const modeLabel = diffMode.toUpperCase();
    const modeColor = diffMode === 'easy' ? '#2A7A2A' : diffMode === 'hard' ? '#A02020' : '#1E4D6B';
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillStyle = modeColor;
    ctx.fillText('MODE: ' + modeLabel, bx + 12, by + bh - 10);

    // Top 5 leaderboard (right side)
    const board = getLeaderboard();
    if (board.length > 0) {
        const lx = bx + bw - 138, ly = by + 14;
        ctx.font = '6px "Press Start 2P", monospace';
        ctx.fillStyle = '#7AA0B8';
        ctx.textAlign = 'left';
        ctx.fillText('TOP 5', lx, ly);
        board.slice(0, 5).forEach((s, i) => {
            const isCurrent = s === finalScore && i === board.indexOf(finalScore);
            ctx.fillStyle = isCurrent ? '#C8920A' : '#4A7A9B';
            ctx.fillText(`${i + 1}. ${s}`, lx, ly + 14 + i * 14);
        });
    }

    ctx.textAlign = 'left';
}

function gameOver() {
    state.isGameOver = true;

    const finalScore = Math.floor(state.score / 5);
    const isNewBest  = finalScore > highScore;
    if (isNewBest) {
        highScore = finalScore;
        localStorage.setItem('rabbitHighScore', highScore);
        bestEl.textContent = highScore;
        AudioManager.sfxNewBest();
    } else {
        AudioManager.sfxGameOver();
    }
    AudioManager.stop();
    saveLeaderboard(finalScore);

    // Brief white flash before the overlay
    let flashAlpha = 0.7;
    function flash() {
        ctx.fillStyle = `rgba(255,255,255,${flashAlpha.toFixed(2)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        flashAlpha -= 0.07;
        if (flashAlpha > 0) {
            requestAnimationFrame(flash);
        } else {
            showGameOverScreen(isNewBest, finalScore);
        }
    }
    requestAnimationFrame(flash);
}

function resetGame() {
    const diff             = DIFFICULTY[diffMode];
    state.obstacles        = [];
    state.score            = 0;
    state.gameSpeed        = diff.speedBase;
    state.minGap           = diff.gapStart;
    state.rabbit.y         = 140;
    state.rabbit.velocity  = 0;
    state.rabbit.isJumping = false;
    state.isGameOver       = false;
    state.isPaused         = false;
    state.lastMilestone    = 0;
    state.milestoneFlash   = 0;
    lastTimestamp          = performance.now();
    updateGame();
}

function togglePause() {
    if (state.isGameOver) return;
    state.isPaused = !state.isPaused;
    if (state.isPaused) {
        AudioManager.stop();
        drawPauseOverlay();
    } else {
        const displayScore = Math.floor(state.score / 5);
        AudioManager.play(getDayTime(displayScore) >= 0.85 ? 'night' : 'day');
        lastTimestamp = performance.now();
        requestAnimationFrame(updateGame);
    }
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !state.isGameOver && !state.isPaused) jump();
    if (e.key.toLowerCase() === 'r') {
        if (state.isGameOver) resetGame();
        else if (state.isPaused) togglePause();
    }
    if (e.key.toLowerCase() === 'p') togglePause();
    if (e.key.toLowerCase() === 'm') {
        const nowMuted = AudioManager.toggleMute();
        document.getElementById('best-label').textContent = nowMuted ? 'MUTED' : 'BEST';
    }
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden && !state.isGameOver && !state.isPaused) {
        togglePause();
    }
});

window.addEventListener('focus', () => {
    if (AudioManager.isReady()) AudioManager.resumeContext();
});

document.getElementById('volume-slider').addEventListener('input', e => {
    const pct = parseInt(e.target.value, 10);
    document.getElementById('volume-label').textContent = pct === 0 ? '🔇' : '🔊';
    AudioManager.setVolume(pct);
    if (pct === 0 && !AudioManager.isReady()) return;
    // Unmute if dragging slider back up while muted
    if (pct > 0) {
        const label = document.getElementById('best-label');
        if (label.textContent === 'MUTED') {
            AudioManager.toggleMute();
            label.textContent = 'BEST';
        }
    }
});

canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    AudioManager.init();
    if (state.isGameOver) {
        resetGame();
    } else {
        jump();
    }
}, { passive: false });

// Draw a static preview so the canvas isn't blank behind the difficulty overlay
drawBackground();
drawGround();
drawRabbit();

// ── Difficulty screen ─────────────────────────────────────────────
const diffScreen = document.getElementById('difficulty-screen');
document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        diffMode = btn.dataset.mode;
        diffScreen.style.display = 'none';
        const diff = DIFFICULTY[diffMode];
        state.gameSpeed = diff.speedBase;
        state.minGap    = diff.gapStart;
        lastTimestamp   = performance.now();
        canvas.focus();
        updateGame();
    });
});

// ── Favicon ───────────────────────────────────────────────────────
(function generateFavicon() {
    const CACHE_KEY = 'rabbitFaviconDataURL';
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
        link.rel = 'icon'; link.type = 'image/png'; link.href = cached;
        document.head.appendChild(link);
        return;
    }
    const S = 32;
    const fc = document.createElement('canvas');
    fc.width = fc.height = S;
    const c = fc.getContext('2d');

    const cream  = '#EDE8DC';
    const shadow = '#C8BEB0';
    const pink   = '#F0A0B8';
    const dpink  = '#D84070';
    const dark   = '#1A1520';

    // Background — rounded square in the game's sky blue
    c.fillStyle = '#4A90B8';
    c.beginPath();
    c.roundRect(0, 0, S, S, 7);
    c.fill();

    // Back ear (slightly darker)
    c.fillStyle = shadow;
    c.beginPath(); c.roundRect(7, 1, 5, 14, [3,3,2,2]); c.fill();
    c.fillStyle = pink;
    c.beginPath(); c.roundRect(8.5, 2.5, 2.5, 10, [2,2,1,1]); c.fill();

    // Front ear
    c.fillStyle = cream;
    c.beginPath(); c.roundRect(20, 0, 5, 15, [3,3,2,2]); c.fill();
    c.fillStyle = pink;
    c.beginPath(); c.roundRect(21.5, 1.5, 2.5, 11, [2,2,1,1]); c.fill();

    // Head
    c.fillStyle = cream;
    c.beginPath(); c.arc(16, 21, 10, 0, Math.PI * 2); c.fill();

    // Snout
    c.fillStyle = '#F8F6F2';
    c.beginPath(); c.ellipse(16, 23.5, 4, 3, 0, 0, Math.PI * 2); c.fill();

    // Cheek blush
    c.fillStyle = 'rgba(240,150,170,0.32)';
    c.beginPath(); c.ellipse(10.5, 22, 3, 2, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(21.5, 22, 3, 2, 0, 0, Math.PI * 2); c.fill();

    // Eyes
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(12.5, 19.5, 2.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(19.5, 19.5, 2.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = dark;
    c.beginPath(); c.arc(13, 19.5, 1.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(20, 19.5, 1.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(13.6, 18.8, 0.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(20.6, 18.8, 0.6, 0, Math.PI * 2); c.fill();

    // Nose
    c.fillStyle = dpink;
    c.beginPath(); c.ellipse(16, 23, 2, 1.5, 0, 0, Math.PI * 2); c.fill();

    // Mouth
    c.strokeStyle = 'rgba(160,100,110,0.7)';
    c.lineWidth = 0.9;
    c.lineCap = 'round';
    c.beginPath(); c.arc(14, 25, 2, 0, Math.PI * 0.8); c.stroke();
    c.beginPath(); c.arc(18, 25, 2, Math.PI * 0.2, Math.PI); c.stroke();

    const dataURL = fc.toDataURL();
    localStorage.setItem(CACHE_KEY, dataURL);
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.rel  = 'icon';
    link.type = 'image/png';
    link.href = dataURL;
    document.head.appendChild(link);
}());
