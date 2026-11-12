// Bot-Simulation: ein Bot spielt das echte Spiel (echte Hindernisse, Zufall wie im Spiel) mit menschlicher
// Ungenauigkeit: Streuung beim Absprung, Reaktionszeit und gelegentliche Aussetzer. Drei Spielertypen.
// Damit wurde die Lage des Etappenziels (Brocken bei 2000 m) gewählt.
// Aufruf: node sim/bot.js [Läufe] [narrow]
const { loadGame } = require('./harness');
const RUNS = +process.argv[2] || 100;
const narrow = process.argv[3] === 'narrow';
const G = loadGame({ narrow });

const DT = 6, CAND = 12, BIKER_X = 90, CAP_M = 5000;
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const passed = (o, s) => o.wx + (o.hw || 20) < s.dist + BIKER_X - 10;

// Sprungfenster für Hindernis o ab jetzt: Liste von Zeitpunkten (ms ab jetzt), an denen ein Absprung klappt
function jumpWindow(o) {
    const real = G.state;
    let nid = 0; real.obstacles.forEach((x) => { if (x.id === undefined) x.id = Math.random(); });
    let master = structuredClone(real);
    const ok = [];
    const vel = real.vel;
    const tArrive = (o.wx - (real.dist + BIKER_X + 38)) / Math.max(0.2, vel + (o.v || 0));
    const from = Math.max(0, tArrive - 650);
    let t = 0;
    G.state = master;
    while (t < from) { G.update(DT); t += DT; if (master.mode === 'over') { G.state = real; return ok; } }
    for (; t <= tArrive + 150; t += CAND) {
        // Kopie springen lassen und bis zum Passieren laufen
        const c = structuredClone(master);
        G.state = c;
        if (!c.air && !c.duck) {
            c.vy = -0.92; c.air = true;
            const co = c.obstacles.find((x) => x.id === o.id);
            let k = 0;
            while (c.mode === 'run' && co && c.obstacles.includes(co) && !passed(co, c) && k++ < 400) G.update(DT);
            if (c.mode === 'run') ok.push(t);
        }
        G.state = master;
        for (let s = 0; s < CAND / DT; s++) G.update(DT);
        if (master.mode === 'over') break;
    }
    G.state = real;
    return ok;
}

function play(sigma, reaction, lapse) {
    G.reset();
    const s = G.state;
    s.mode = 'run';
    let time = 0, plan = null; // plan: { o, at } Absprungzeit
    const seen = new Map();    // Hindernis -> Zeitpunkt, ab dem sichtbar
    let duckUntil = null;
    while (s.mode === 'run' && s.dist / 40 < CAP_M) {
        for (const o of s.obstacles) if (!seen.has(o) && o.wx - s.dist < G.W) seen.set(o, time);
        // Vogel: ducken, sobald reagiert, bis er vorbei ist
        const bird = s.obstacles.find((o) => o.type === 'bird' && !passed(o, s) && seen.has(o) && time - seen.get(o) >= reaction);
        if (bird && !s.air) { s.duck = true; duckUntil = bird; }
        if (duckUntil && passed(duckUntil, s)) { s.duck = false; duckUntil = null; }
        // nächstes Bodenhindernis planen
        if (!plan) {
            const next = s.obstacles.filter((o) => o.type !== 'bird' && !o.done && !passed(o, s) && seen.has(o))
                .sort((a, b) => a.wx - b.wx)[0];
            if (next && !s.air && !s.duck) {
                const win = jumpWindow(next);
                next.done = true;
                let at;
                if (win.length) {
                    const mid = (win[0] + win[win.length - 1]) / 2;
                    const sd = Math.random() < lapse ? 200 : sigma * (0.6 + 0.8 * s.vel);
                    at = time + mid + gauss() * sd;
                } else at = time; // unmöglich: trotzdem springen
                at = Math.max(at, seen.get(next) + reaction);
                plan = { o: next, at };
            }
        }
        if (plan && time >= plan.at) {
            if (!s.air && !s.duck) { s.vy = -0.92; s.air = true; }
            plan = null;
        }
        G.update(DT);
        time += DT;
    }
    return Math.floor(s.dist / 40);
}

const types = [['geübt', 20, 220, 0.003], ['mittel', 35, 250, 0.01], ['gelegentlich', 55, 300, 0.03]];
for (const [name, sigma, reaction, lapse] of types) {
    const res = [];
    for (let i = 0; i < RUNS; i++) res.push(play(sigma, reaction, lapse));
    res.sort((a, b) => a - b);
    const pct = (p) => res[Math.min(res.length - 1, Math.floor(p * res.length))];
    const share = (m) => Math.round(100 * res.filter((r) => r >= m).length / res.length);
    console.log(`${narrow ? 'HANDY ' : ''}${name.padEnd(13)} Median ${String(pct(0.5)).padStart(4)} m | 25 % ${String(pct(0.25)).padStart(4)} | 75 % ${String(pct(0.75)).padStart(4)} | 90 % ${String(pct(0.9)).padStart(4)} | ` +
        [500, 1000, 1500, 2000, 2500, 3000].map((m) => `≥${m}: ${share(m)} %`).join('  '));
}
