const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');
const scoreEl  = document.getElementById('score-value');
const bestEl   = document.getElementById('best-value');

let highScore = parseInt(localStorage.getItem('rabbitHighScore') || '0', 10);
bestEl.textContent = highScore;

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
        gravity: 0.8,
        jumpForce: -16,
        isJumping: false,
        legFrame: 0,
        blinkTimer: 0
    },
    obstacles: [],
    clouds: [
        { x: 110, y: 24, r: 42 },
        { x: 330, y: 16, r: 32 },
        { x: 540, y: 30, r: 52 },
        { x: 730, y: 20, r: 36 },
    ],
    mtnOff:     0,
    terrainOff: 0,
    score:      0,
    gameSpeed:  6,
    isGameOver: false,
    minGap:     350
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

function updateGame() {
    if (state.isGameOver) return;

    const displayScore = Math.floor(state.score / 5);

    // Progressive difficulty
    state.gameSpeed = Math.min(6 + displayScore * 0.022, 15);

    // Switch music theme with day/night cycle
    if (AudioManager.isReady()) {
        AudioManager.play(getDayTime(displayScore) >= 0.85 ? 'night' : 'day');
    }
    state.minGap    = Math.max(350 - displayScore * 0.5, 180);
    const spawnChance = Math.min(0.02 + displayScore * 0.00006, 0.045);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    state.mtnOff     += state.gameSpeed;
    state.terrainOff += state.gameSpeed;
    for (const c of state.clouds) {
        c.x -= 0.75;
        if (c.x + c.r * 2 < 0) {
            c.x = canvas.width + c.r;
            c.y = 12 + Math.random() * 36;
            c.r = 28 + Math.random() * 30;
        }
    }

    drawBackground();

    // Update rabbit
    state.rabbit.velocity += state.rabbit.gravity;
    state.rabbit.y        += state.rabbit.velocity;

    if (state.rabbit.y >= 140) {
        state.rabbit.y         = 140;
        state.rabbit.velocity  = 0;
        state.rabbit.isJumping = false;
        state.rabbit.legFrame++;
    }

    state.rabbit.blinkTimer--;
    if (Math.random() < 0.005) state.rabbit.blinkTimer = 10;

    // Spawn tortoises
    const last = state.obstacles[state.obstacles.length - 1];
    if (state.obstacles.length === 0 ||
        (last.x < canvas.width - state.minGap && Math.random() < spawnChance)) {
        state.obstacles.push(createTortoise());
    }

    // Update & draw tortoises
    state.obstacles.forEach(obs => {
        obs.x -= state.gameSpeed;
        obs.legFrame++;
        drawTortoise(obs);

        if (state.rabbit.x + 40 > obs.x &&
            state.rabbit.x      < obs.x + obs.width &&
            state.rabbit.y + 50 > obs.y &&
            state.rabbit.y      < obs.y + obs.height) {
            gameOver();
        }
    });

    state.obstacles = state.obstacles.filter(o => o.x + o.width >= 0);

    drawGround();
    drawRabbit();

    state.score++;
    scoreEl.textContent = displayScore;

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

    ctx.fillStyle = 'rgba(10, 30, 50, 0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const cw = 340, ch = 100;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - cw / 2, cy - ch / 2, cw, ch, 12);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText('GAME OVER', cx + 2, cy - 14 + 2);
    ctx.fillStyle = '#FF6B6B';
    ctx.fillText('GAME OVER', cx, cy - 14);

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 120, cy + 6);
    ctx.lineTo(cx + 120, cy + 6);
    ctx.stroke();

    // New best badge
    if (isNewBest) {
        ctx.font = '8px "Press Start 2P", monospace';
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillText('✦ NEW BEST ✦', cx + 1, cy + 22 + 1);
        ctx.fillStyle = '#FFD700';
        ctx.fillText('✦ NEW BEST ✦', cx, cy + 22);
    }

    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText('PRESS  R  TO  RESTART', cx + 1, cy + 38 + 1);
    ctx.fillStyle = '#A8D8EA';
    ctx.fillText('PRESS  R  TO  RESTART', cx, cy + 38);

    ctx.textAlign = 'left';
}

function resetGame() {
    state.obstacles        = [];
    state.score            = 0;
    state.gameSpeed        = 6;
    state.minGap           = 350;
    state.rabbit.y         = 140;
    state.rabbit.velocity  = 0;
    state.rabbit.isJumping = false;
    state.isGameOver       = false;
    updateGame();
}

document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !state.isGameOver) jump();
    if (e.key.toLowerCase() === 'r' && state.isGameOver) resetGame();
    if (e.key.toLowerCase() === 'm') {
        const nowMuted = AudioManager.toggleMute();
        document.getElementById('best-label').textContent = nowMuted ? 'MUTED' : 'BEST';
    }
});

updateGame();
