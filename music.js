const AudioManager = (() => {
    let actx = null;
    let master = null;
    let muted = false;
    let schedulerTimer = null;
    let currentMelody = null;
    let noteIndex = 0;
    let nextNoteTime = 0;

    const LOOK_AHEAD       = 0.12;  // seconds to look ahead when scheduling
    const SCHEDULE_INTERVAL = 50;   // ms between scheduler ticks

    const N = {
        G3:196.00, A3:220.00, B3:246.94,
        C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88,
        C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77,
        C6:1046.50,
        R: 0,
    };

    // Upbeat C-major day theme
    const DAY_MELODY = [
        { f:N.C5, d:0.12 }, { f:N.E5, d:0.12 }, { f:N.G5, d:0.12 }, { f:N.E5, d:0.18 },
        { f:N.C5, d:0.12 }, { f:N.D5, d:0.12 }, { f:N.E5, d:0.25 }, { f:N.R,  d:0.10 },
        { f:N.F5, d:0.12 }, { f:N.A5, d:0.12 }, { f:N.G5, d:0.12 }, { f:N.E5, d:0.18 },
        { f:N.D5, d:0.12 }, { f:N.C5, d:0.28 }, { f:N.R,  d:0.10 },
        { f:N.G4, d:0.12 }, { f:N.C5, d:0.12 }, { f:N.E5, d:0.12 }, { f:N.G5, d:0.18 },
        { f:N.A5, d:0.12 }, { f:N.G5, d:0.12 }, { f:N.E5, d:0.25 }, { f:N.R,  d:0.10 },
        { f:N.F5, d:0.12 }, { f:N.D5, d:0.12 }, { f:N.B4, d:0.12 }, { f:N.G4, d:0.18 },
        { f:N.C5, d:0.42 }, { f:N.R,  d:0.22 },
    ];

    // Slower, atmospheric A-minor night theme
    const NIGHT_MELODY = [
        { f:N.A4, d:0.38 }, { f:N.R,  d:0.10 }, { f:N.C5, d:0.22 }, { f:N.E5, d:0.38 }, { f:N.R, d:0.12 },
        { f:N.G4, d:0.38 }, { f:N.R,  d:0.10 }, { f:N.B4, d:0.22 }, { f:N.D5, d:0.38 }, { f:N.R, d:0.12 },
        { f:N.F4, d:0.38 }, { f:N.R,  d:0.10 }, { f:N.A4, d:0.22 }, { f:N.C5, d:0.38 }, { f:N.R, d:0.12 },
        { f:N.E4, d:0.55 }, { f:N.R,  d:0.10 }, { f:N.A4, d:0.55 }, { f:N.R,  d:0.35 },
    ];

    function init() {
        if (actx) return;
        actx  = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = muted ? 0 : 0.11;
        master.connect(actx.destination);
    }

    function osc(freq, dur, time, type = 'square', vol = 0.28) {
        if (!actx || freq === 0) return;
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, time);
        g.gain.setValueAtTime(vol, time);
        g.gain.exponentialRampToValueAtTime(0.001, time + dur * 0.88);
        o.connect(g);
        g.connect(master);
        o.start(time);
        o.stop(time + dur);
    }

    function scheduler() {
        if (!currentMelody) return;
        const type = currentMelody === NIGHT_MELODY ? 'triangle' : 'square';
        while (nextNoteTime < actx.currentTime + LOOK_AHEAD) {
            const note = currentMelody[noteIndex % currentMelody.length];
            osc(note.f, note.d, nextNoteTime, type);
            nextNoteTime += note.d;
            noteIndex++;
        }
        schedulerTimer = setTimeout(scheduler, SCHEDULE_INTERVAL);
    }

    function play(theme) {
        if (!actx) return;
        if (actx.state === 'suspended') actx.resume();
        const melody = theme === 'night' ? NIGHT_MELODY : DAY_MELODY;
        if (currentMelody === melody) return;   // already playing this theme
        clearTimeout(schedulerTimer);
        currentMelody = melody;
        noteIndex     = 0;
        nextNoteTime  = actx.currentTime + 0.05;
        scheduler();
    }

    function stop() {
        clearTimeout(schedulerTimer);
        currentMelody = null;
    }

    let volume = 0.11; // base volume (maps to slider 100)

    function setVolume(pct) {
        volume = (pct / 100) * 0.11;
        if (master && !muted) master.gain.value = volume;
    }

    function toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : volume;
        return muted;
    }

    function isReady() { return !!actx; }

    function resumeContext() {
        if (actx && actx.state === 'suspended') actx.resume();
    }

    // ── Sound effects ─────────────────────────────────────────────

    function sfxJump() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(260, t);
        o.frequency.exponentialRampToValueAtTime(580, t + 0.09);
        g.gain.setValueAtTime(0.22, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 0.11);
    }

    function sfxGameOver() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        [N.G4, N.E4, N.C4].forEach((f, i) => osc(f, 0.20, t + i * 0.22, 'square', 0.30));
    }

    function sfxNewBest() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => osc(f, 0.13, t + i * 0.14, 'square', 0.26));
    }

    function sfxMilestone() {
        if (!actx || muted) return;
        const t = actx.currentTime;
        [N.G5, N.E5, N.G5].forEach((f, i) => osc(f, 0.10, t + i * 0.10, 'triangle', 0.22));
    }

    return { init, play, stop, toggleMute, setVolume, resumeContext, isReady, sfxJump, sfxGameOver, sfxNewBest, sfxMilestone };
})();
