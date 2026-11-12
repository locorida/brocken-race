// Fairness-Simulation: Absprung-Fenster je Hindernis, Tempo und Geländestelle.
// Jedes Hindernis muss sich in einem Zeitfenster von mindestens MIN_MS überspringen lassen, auch das zweite von zwei
// Hindernissen im kleinsten Abstand, den spawn() erzeugen kann. Sonst Exit-Code 1.
// Aufruf: node sim/fairness.js [narrow]   (narrow = Handy-Breite)
const { loadGame } = require('./harness');
const MIN_MS = 125;
const narrow = process.argv[2] === 'narrow';
const G = loadGame({ narrow });

const DT = 4, STEP = 3;
const OBST = {
    stone28: () => ({ type: 'stone', h: 28, w: 39.2, hw: 39.2 * 0.38, hh: 25.2, v: 0 }),
    stone22: () => ({ type: 'stone', h: 22, w: 30.8, hw: 30.8 * 0.38, hh: 19.8, v: 0 }),
    stone20: () => ({ type: 'stone', h: 20, w: 28, hw: 28 * 0.38, hh: 18, v: 0 }),
    sapling42: () => ({ type: 'sapling', h: 42, w: 23.5, hw: 23.5 * 0.28, hh: 37.8, v: 0 }),
    sapling34: () => ({ type: 'sapling', h: 34, w: 19, hw: 19 * 0.28, hh: 30.6, v: 0 }),
    sapling32: () => ({ type: 'sapling', h: 32, w: 17.9, hw: 17.9 * 0.28, hh: 28.8, v: 0 }),
    bush18: () => ({ type: 'bush', h: 18, w: 28.8, hw: 11.5, hh: 16.2, v: 0 }),
    bush16: () => ({ type: 'bush', h: 16, w: 25.6, hw: 10.2, hh: 14.4, v: 0 }),
    bench: () => ({ type: 'bench', w: 44, hw: 17, hh: 19, v: 0 }),
    boar: () => ({ type: 'boar', w: 40, hw: 16, hh: 21, v: 0.09, phase: 0 }),
    wolf: () => ({ type: 'wolf', w: 42, hw: 15, hh: 23, v: 0.12, phase: 0 }),
};
// Welche Hindernisse wo erlaubt sind (wie spawn()): Abfahrt nur flach, Bank/Doppelstein nicht am Anstieg usw.
function allowed(base, uphill, descent) {
    if (descent) return ['stone20', 'bush16', 'sapling32'];
    const l = ['bush' + (base < 0.4 ? 16 : 18), 'sapling' + (base < 0.4 ? 34 : 42), base < 0.4 ? 'stone20' : (uphill ? 'stone22' : 'stone28'), 'boar', 'wolf'];
    if (base >= 0.4 && !uphill) l.push('bench');
    return l;
}

// Startet die Fahrt so, dass der Biker bei Weltposition startX steht, mit eingeschwungenem Tempo.
function start(base, startX) {
    G.reset();
    const s = G.state;
    s.mode = 'run'; s.base = base; s.dist = startX - 90; s.nextGap = 1e12;
    s.y = G.groundY(startX);
    for (let i = 0; i < 120; i++) { const d = s.dist; G.update(DT); s.dist = d; s.base = base; } // Tempo einschwingen ohne Fortbewegung
    s.obstacles = [];
}

// Ein Durchlauf: Hindernisse (Liste von [spawnNachStrecke, fabrik]) werden wie im Spiel am rechten Rand erzeugt.
// jumps: Abstände (Hindernis-Mitte minus Biker-Vorderkante) zum Absprung je Hindernis.
function run(base, startX, list, jumps) {
    start(base, startX);
    const s = G.state;
    let traveled = 0, idx = 0, crashed = false;
    const spawned = [], jv = [];
    for (let step = 0; step < 4000; step++) {
        while (idx < list.length && traveled >= list[idx][0]) {
            const o = list[idx][1](); o.wx = s.dist + G.W + 30; s.obstacles.push(o); spawned.push(o); idx++;
        }
        // springen, sobald das nächste noch nicht übersprungene Hindernis die Absprung-Distanz erreicht
        for (let j = 0; j < spawned.length; j++) {
            const o = spawned[j];
            if (o.jumped) continue;
            const gap = o.wx - (s.dist + 90 + 38);
            if (gap <= jumps[j]) { o.jumped = true; jv[j] = s.vel; if (!s.air) { s.vy = -0.92; s.air = true; } else return { ok: false, why: 'air' }; }
            break;
        }
        const before = s.dist;
        G.update(DT);
        traveled += s.dist - before;
        if (s.mode === 'over') { crashed = true; break; }
        if (idx === list.length && spawned.every((o) => o.wx < s.dist + 20)) break;
    }
    return { ok: !crashed, vel: s.vel, jv };
}

// Fenster für ein Einzelhindernis: alle Absprung-Distanzen, die klappen, in ms umgerechnet
function windowSingle(base, startX, name) {
    let okD = [], vel = 0;
    for (let d = -40; d <= 520; d += STEP) {
        const r = run(base, startX, [[0, OBST[name]]], [d]);
        if (r.ok) okD.push([d, r.jv[0]]);
    }
    start(base, startX); vel = G.state.vel;
    return { ms: span(okD), vel, okD: okD.map((x) => x[0]) };
}
// größte zusammenhängende Spanne in ms (jeder Schritt mit dem Tempo beim Absprung umgerechnet)
function span(list) {
    let best = 0, cur = 0;
    for (let i = 0; i < list.length; i++) {
        const inc = STEP / list[i][1];
        cur = i && list[i][0] - list[i - 1][0] === STEP ? cur + inc : inc;
        best = Math.max(best, cur);
    }
    return best;
}

// Kleinster Abstand wie in spawn(): max(base, vel) * (900 - 180 * tight) + 140 (Zufallsanteil = 0).
// tight beginnt erst ab 400 m; Grundtempo 0,55 erreicht man bei ca. 380 m. Darüber vorsichtshalber voll (1).
function minGap(base, vel) {
    const tight = base < 0.55 ? 0 : 1;
    return Math.max(base, vel) * (900 - 180 * tight) + 140;
}

const speeds = [];
for (let b = 0.3; b <= G.topSpeed + 1e-9; b += 0.1) speeds.push(+b.toFixed(2));
// Prüfstellen: normale Wellen (mehrere Phasen) und viele Stellen am großen Berg
const spots = [];
for (let x = 2000; x < 12000; x += 1300) spots.push(x);
const hill0 = G.HILL_FIRST + G.HILL_EVERY; // zweiter Berg (bereits bei voller Welle)
for (let p = 0; p < G.HILL_UP + G.HILL_DOWN; p += 300) spots.push(hill0 + p);
if (G.BROCKEN) for (let x = G.BROCKEN.start - 600; x < G.BROCKEN.start + G.BROCKEN.up + G.BROCKEN.flat + G.BROCKEN.down; x += 400) spots.push(x);

let worst = { ms: 1e9 }, worstPair = { ms: 1e9 }, maxVel = 0, count = 0;
for (const base of speeds) {
    for (const sx of spots) {
        if (sx >= hill0 && base < 0.5) continue;
        // Hindernis taucht bei sx + W + 30 auf und wird ca. bei sx + W erreicht: Prüfstelle = dort
        const at = sx + G.W;
        const uphill = G.slopeAt(at) < -0.04, descent = G.onDescent(at);
        for (const name of allowed(base, uphill, descent)) {
            const w = windowSingle(base, sx, name);
            count++;
            maxVel = Math.max(maxVel, w.vel);
            if (w.ms < worst.ms) worst = { ms: w.ms, base, sx, name, vel: w.vel, descent, uphill };
        }
        // Paar mit kleinstem Abstand (zwei flache Hindernisse, das härteste an dieser Stelle)
        start(base, sx);
        const g = minGap(base, G.state.vel);
        const pair = descent ? ['stone20', 'sapling32'] : ['bush' + (base < 0.4 ? 16 : 18), 'sapling' + (base < 0.4 ? 34 : 42)];
        let bestMs = 0;
        const first = windowSingle(base, sx, pair[0]).okD;
        for (let i = 0; i < first.length; i += 8) {
            let ok2 = [];
            for (let d2 = -40; d2 <= 520; d2 += STEP) { const r = run(base, sx, [[0, OBST[pair[0]]], [g, OBST[pair[1]]]], [first[i], d2]); if (r.ok) ok2.push([d2, r.jv[1]]); }
            bestMs = Math.max(bestMs, span(ok2));
        }
        if (bestMs < worstPair.ms) worstPair = { ms: bestMs, base, sx, pair, descent };
    }
}
console.log(narrow ? 'HANDY' : 'DESKTOP', 'Fälle:', count, 'max. Tempo:', maxVel.toFixed(2));
console.log('kleinstes Fenster einzeln:', worst.ms.toFixed(0), 'ms', JSON.stringify(worst));
console.log('kleinstes Fenster 2. Hindernis bei Mindestabstand:', worstPair.ms.toFixed(0), 'ms', JSON.stringify(worstPair));

const ok = worst.ms >= MIN_MS && worstPair.ms >= MIN_MS;
console.log(ok ? 'OK: alle Fenster ≥ ' + MIN_MS + ' ms' : 'FEHLER: Fenster unter ' + MIN_MS + ' ms');
process.exit(ok ? 0 : 1);
