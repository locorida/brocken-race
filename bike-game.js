// Brocken-Rennen: kleines Endlos-Spiel auf Canvas, ohne Abhängigkeiten.
// Ein Mountainbiker fährt durch den Harz: über Steine, Büsche, Jungtannen, Bänke, Wildschweine und Wölfe springen,
// unter tief fliegenden Vögeln ducken (tagsüber Mäusebussard, nachts Eule). Tannen stehen als Wald im Hintergrund.
// Das Gelände geht auf und ab: bergab wird er schneller, bergauf langsamer. Regelmäßig kommt ein großer Anstieg
// mit steiler Abfahrt (Kamera fährt mit), und das Spiel wird mit der Strecke immer schneller und dichter.
// Etappenziel bei 2000 m: der verschneite Brocken-Gipfel mit Konfetti, danach geht es weiter (Abfahrt nach Schierke).
// Erwartet ein <dialog id="bike-game"> mit Canvas (siehe index.html); window.BikeGame.open() öffnet das Spiel.
// Steuerung: Leertaste/Pfeil hoch/W springen, Pfeil runter/S ducken (halten); Handy: tippen springt,
// nach unten wischen duckt. Rekord im Browser (localStorage, nur Komfort, darf fehlen).
// Spielbalance prüfen: npm test (Fairness-Simulation) und npm run bot (Bot-Simulation), siehe README.
(function () {
    'use strict';

    const dialog = document.getElementById('bike-game');
    if (!dialog) return;
    const canvas = dialog.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const status = dialog.querySelector('.bike-game-status');
    const t = JSON.parse(dialog.dataset.texts || '{}');

    // Spielfeld in logischen Einheiten, wird auf die Breite des Fensters skaliert. Auf schmalen Bildschirmen
    // ist es kürzer (480 statt 800), damit Biker und Tannen auf dem Handy groß genug sind.
    const HGT = 220, MW = 800;   // MW: Breite einer Bergketten-Kachel
    // maxSpeed: bis hierher steigt das Grundtempo zügig (ca. 1 Minute), danach langsamer bis topSpeed.
    // velMax: Obergrenze in der großen Abfahrt. Auf dem Handy (kürzere Vorausschau) alles etwas langsamer.
    let W = 800, maxSpeed = 0.78, topSpeed = 1.0, velMax = 1.45;
    const BIKER_X = 90, WHEELBASE = 34;
    const GRAVITY = 0.0042;          // Einheiten pro ms²
    const JUMP_V = -0.92;            // Absprung (Einheiten pro ms): ca. 100 hoch, ca. 0,3 s über einer hohen Tanne
    const START_SPEED = 0.30, ACCEL = 0.0000075; // Grundtempo (Einheiten pro ms), steigt mit der Zeit
    const ACCEL_LATE = 0.000003;     // ab maxSpeed: weiter schneller, aber langsamer (topSpeed nach ca. 2500 m)
    const MIN_SPEED = 0.27;          // auch bergauf schnell genug, um über jede Tanne zu kommen
    const SLOPE_EFFECT = 2.2;        // Tempo-Änderung pro Gefälle (bergab schneller, bergauf langsamer)
    const DOWNHILL_BOOST = 4;        // zusätzlicher Schub in der großen Abfahrt (pro Gefälle über 0,04)
    const BIRDS_FROM = 150;          // ab dieser Strecke (m) kommen Vögel im Tiefflug (ducken)
    const BEST_KEY = 'brocken-race-best';

    // Großer Berg: erstmals bei 350 m, dann alle 650 m. Langer Anstieg (65 m), oben ein Gefälle-Schild,
    // dann eine steile Abfahrt (45 m). Höhe 140, die Kamera fährt mit (camY), damit alles im Bild bleibt.
    const HILL_FIRST = 14000, HILL_EVERY = 26000, HILL_UP = 2600, HILL_DOWN = 1800, HILL_H = 140;
    // Etappenziel: der Brocken bei 2000 m (Gipfel = Ende des Anstiegs). Höher als die anderen Berge, oben ein
    // flaches Gipfelstück mit Schnee, Sendemast und Gipfelstein, dann die Abfahrt nach Schierke. Danach geht es
    // normal weiter. Bot-Simulation (sim/bot.js): erreichen ca. 6 % der Gelegenheitsspieler, ca. 60 % der Geübteren.
    const SUMMIT_M = 2000;
    const BROCKEN = { start: SUMMIT_M * 40 - 6400, up: 6400, flat: 1000, down: 3200, h: 300, brocken: true };
    const BROCKEN_SEEN = 13000; // so viele Einheiten vor dem Anstieg taucht der Brocken im Hintergrund auf
    const BROCKEN_END = BROCKEN.start + BROCKEN.up + BROCKEN.flat + BROCKEN.down;
    const REGULAR = { up: HILL_UP, flat: 0, down: HILL_DOWN, h: HILL_H, brocken: false };
    let hillP = 0; // Position im Berg, von hillAt() gesetzt (spart ein Objekt pro Aufruf)
    // Welcher große Berg liegt bei wx (oder null)? Normale Berge, die den Brocken überschneiden würden, entfallen.
    function hillAt(wx) {
        if (wx >= BROCKEN.start && wx < BROCKEN_END) { hillP = wx - BROCKEN.start; return BROCKEN; }
        const p = wx - HILL_FIRST;
        if (p < 0) return null;
        const q = p % HILL_EVERY;
        if (q >= HILL_UP + HILL_DOWN) return null;
        const s0 = wx - q;
        if (s0 < BROCKEN_END && s0 + HILL_UP + HILL_DOWN > BROCKEN.start) return null;
        hillP = q;
        return REGULAR;
    }
    // Höhe des großen Bergs (negativ = oben), weich mit Kosinus an- und auslaufend
    function bigHill(wx) {
        const H = hillAt(wx);
        if (!H) return 0;
        const p = hillP;
        if (p < H.up) return -H.h * (1 - Math.cos(Math.PI * p / H.up)) / 2;
        if (p < H.up + H.flat) return -H.h;
        return -H.h * (1 + Math.cos(Math.PI * (p - H.up - H.flat) / H.down)) / 2;
    }
    const hillSlopeAt = (wx) => (bigHill(wx + 4) - bigHill(wx - 4)) / 8;
    const onDescent = (wx) => { const H = hillAt(wx); return !!H && hillP >= H.up + H.flat; };
    // Gipfelstück des Brockens (etwas Vorlauf und Nachlauf): dort keine Hindernisse, Zeit zum Feiern
    const onSummit = (wx) => wx >= BROCKEN.start + BROCKEN.up - 300 && wx < BROCKEN.start + BROCKEN.up + BROCKEN.flat + 150;
    // Schnee: nur am Brocken, oberhalb von Höhe 145 (die normalen Berge sind 140 hoch), 0 … 1
    const snowAt = (wx) => (wx >= BROCKEN.start && wx < BROCKEN_END ? Math.min(1, Math.max(0, (-bigHill(wx) - 145) / 35)) : 0);

    // Gelände: Mittellinie und sanfte Wellen (zwei überlagerte Sinuskurven). Die ersten 1200 Einheiten
    // steigen die Wellen langsam an, damit der Start flach ist. Am großen Berg sind die Wellen flacher.
    // y wächst nach unten (Canvas).
    const BASE = 172;
    function groundY(wx) {
        const ramp = Math.min(1, Math.max(0, wx) / 1200);
        const hill = bigHill(wx);
        const damp = 1 - 0.7 * Math.min(1, -hill / 40);
        return BASE + hill + ramp * damp * (26 * Math.sin(wx / 330) + 8 * Math.sin(wx / 127 + 1.3));
    }
    // Gefälle an der Stelle wx: positiv = bergab (nach rechts geht es nach unten)
    const slopeAt = (wx) => (groundY(wx + 4) - groundY(wx - 4)) / 8;
    // Kamera: folgt nur dem großen Berg (340 voraus, damit man in der Abfahrt weit genug sieht), nicht den Wellen
    const cameraY = () => bigHill(bikerWorldX() + 340);

    let colors, state, raf = null, last = 0, best = readBest();

    function readBest() {
        try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
    }
    function writeBest(v) {
        try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* ohne Speicher eben ohne Rekord */ }
    }

    // Tag und Nacht: ab 300 m wird es nach und nach Nacht (Mond, Sterne), nach 200 m wieder Tag, alle 700 m
    // (Nacht also bei 300–500 m, 1000–1200 m, …).
    // Im dunklen Modus der Seite startet das Spiel nachts und der Wechsel läuft umgekehrt.
    const DAY = { bg: '#f1f6f2', fg: '#2a4a3f', far: '#c0cbc5', mid: '#a9b8b0', trees: '#8ea397', ground: '#2a4a3f', text: '#2a4a3f', sky: '#f1f6f2', snow: '#ffffff', flake: '#9fb3a9' };
    const NIGHT = { bg: '#16241f', fg: '#a9c9b8', far: '#24382f', mid: '#2e463c', trees: '#34503f', ground: '#3b5a4d', text: '#e8f0ec', sky: '#e8f0ec', snow: '#dce8e2', flake: '#e8f0ec' };
    const CYCLE = 700, NIGHT_FROM = 300, NIGHT_TO = 500, FADE_MS = 1300;
    const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const DAY_RGB = Object.fromEntries(Object.entries(DAY).map(([k, v]) => [k, hexToRgb(v)]));
    const NIGHT_RGB = Object.fromEntries(Object.entries(NIGHT).map(([k, v]) => [k, hexToRgb(v)]));
    let siteDark = false;

    function mixColors(n) {
        const out = {};
        for (const k of Object.keys(DAY_RGB)) {
            const [r, g, b] = DAY_RGB[k].map((c, i) => Math.round(c + (NIGHT_RGB[k][i] - c) * n));
            out[k] = `rgb(${r}, ${g}, ${b})`;
        }
        return out;
    }

    // Sterne: feste Positionen im oberen Bereich (relativ), funkeln leicht
    const STARS = Array.from({ length: 22 }, (_, i) => ({
        x: ((i * 137.5) % 100) / 100, y: 0.06 + ((i * 53.3) % 100) / 100 * 0.42, s: 0.8 + (i % 3) * 0.45, p: i * 1.7,
    }));

    function sky(now) {
        const n = state.night;
        if (n < 0.02) return;
        ctx.save();
        ctx.globalAlpha = n;
        ctx.fillStyle = colors.sky;
        const shift = (state.dist * 0.02) % W;
        STARS.forEach((st) => {
            const x = (st.x * W - shift + W) % W;
            const a = 0.55 + 0.45 * Math.sin(now / 600 + st.p);
            ctx.globalAlpha = n * a;
            ctx.fillRect(x, st.y * GROUND_TOP, st.s, st.s);
        });
        // Mond als Sichel: heller Kreis, darüber ein Kreis in Himmelsfarbe
        ctx.globalAlpha = n;
        ctx.beginPath(); ctx.arc(W * 0.14, 34, 11, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colors.bg;
        ctx.beginPath(); ctx.arc(W * 0.14 + 5, 30, 9.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    const GROUND_TOP = 140; // Sterne nur oberhalb der Berge

    function reset() {
        state = {
            mode: 'ready',           // ready | run | over
            base: START_SPEED,       // Grundtempo, steigt mit der Zeit
            vel: START_SPEED,        // tatsächliches Tempo (Grundtempo × Gefälle, weich angeglichen)
            dist: 0,                 // gefahrene Strecke = Weltposition des linken Bildrands
            y: groundY(BIKER_X),     // Höhe des Hinterrads (Aufstandspunkt)
            vy: 0,
            air: false,
            angle: 0,
            duck: false,
            obstacles: [],           // Weltkoordinate wx
            nextGap: 380,
            wheel: 0,
            crashAt: 0,
            newBest: false,
            night: siteDark ? 1 : 0, // 0 = Tag, 1 = Nacht (weich überblendet)
            time: 0,                 // Spielzeit in ms (für Gipfel-Einblendung)
            summitAt: -1,            // Spielzeit, zu der der Brocken-Gipfel erreicht wurde (-1 = noch nicht)
            confetti: [],            // Konfetti am Gipfel (Bildschirmkoordinaten)
        };
    }

    const meters = () => Math.floor(state.dist / 40);
    const bikerWorldX = () => state.dist + BIKER_X;

    // ----- Eingabe -----
    function jump() {
        if (state.mode === 'ready') { state.mode = 'run'; announce(''); }
        if (state.mode === 'over') {
            if (performance.now() - state.crashAt > 450) { reset(); state.mode = 'run'; announce(''); }
            return;
        }
        if (!state.air && !state.duck) { state.vy = JUMP_V; state.air = true; }
    }
    function setDuck(on) {
        if (state.mode !== 'run') return;
        state.duck = on;
        if (on && state.air) state.vy = Math.max(state.vy, 0.6); // in der Luft: schneller landen
    }

    function onKey(e) {
        if (!dialog.open) return;
        const k = e.key;
        if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
            e.preventDefault();
            if (e.type === 'keydown' && !e.repeat) jump();
        } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
            e.preventDefault();
            setDuck(e.type === 'keydown');
        }
    }

    let touchY = null, touchDucked = false;
    canvas.addEventListener('touchstart', (e) => {
        touchY = e.touches[0].clientY; touchDucked = false;
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        if (touchY !== null && e.touches[0].clientY - touchY > 25 && !touchDucked) { touchDucked = true; setDuck(true); }
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
        if (touchDucked) setDuck(false); else jump();
        touchY = null;
        e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) jump(); });

    // ----- Hindernisse (Weltkoordinaten) -----
    // Was auf einem Harzer Waldweg so im Weg liegt: Steine, Sitzbänke und Tiere, die entgegenkommen
    // (Wildschwein, Wolf). Zum Ducken: Vögel im Tiefflug, tagsüber Mäusebussard, nachts Eule.
    // Tannen stehen nur im Hintergrund.
    // hw/hh = halbe Breite/Höhe der Trefferfläche, v = Eigentempo nach links (Einheiten pro ms).
    // Nachgerechnet (Simulation, alle Tempi, bergauf/bergab): Absprung-Fenster überall mindestens ca. 125 ms.
    // Dafür: am Anfang kleinere Steine, Bänke erst ab Tempo 0,4 und nicht am Anstieg, Doppelsteine
    // erst ab Tempo 0,5 und nicht am Anstieg.
    const ANIMALS = {
        boar: { w: 40, hw: 16, hh: 21, v: 0.09, from: 40 },    // Wildschwein, rennt entgegen
        wolf: { w: 42, hw: 15, hh: 23, v: 0.12, from: 100 },   // Wolf, schneller (Fenster min. ca. 165 ms)
    };

    function stone(wx, h) {
        const w = h * 1.4;
        return { type: 'stone', wx, h, w, hw: w * 0.38, hh: h * 0.9, v: 0, seed: Math.random() };
    }

    function spawn() {
        const m = meters();
        const wx = state.dist + W + 30;
        if (onSummit(wx)) { state.nextGap = 80; return; } // Gipfel frei lassen
        const uphill = slopeAt(wx) < -0.04;
        const descent = onDescent(wx);
        const birdChance = m >= BIRDS_FROM && !descent ? Math.min(0.3, 0.12 + (m - BIRDS_FROM) / 2000) : 0;
        if (descent) {
            // große Abfahrt: nur Flaches zum Drüberspringen, kein Gegenverkehr, damit man Gas geben kann
            const r = Math.random();
            if (r < 0.45) state.obstacles.push(stone(wx, 14 + Math.random() * 6));
            else if (r < 0.8) {
                const h = 11 + Math.random() * 5, w = h * 1.6;
                state.obstacles.push({ type: 'bush', wx, h, w, hw: w * 0.4, hh: h * 0.9, v: 0, seed: Math.random() });
            } else {
                const h = 20 + Math.random() * 12, w = h * 0.56;
                state.obstacles.push({ type: 'sapling', wx, h, w, hw: w * 0.28, hh: h * 0.9, v: 0 });
            }
        } else if (Math.random() < birdChance) {
            // fliegt entgegen; nachts eine Eule, sonst ein Mäusebussard
            state.obstacles.push({ type: 'bird', owl: state.night > 0.5, wx, hw: 14, v: 0.1, phase: Math.random() * 6 });
        } else {
            // Auswahl nach Gewicht, nur was gerade erlaubt ist
            const options = [['stone', 3], ['sapling', 2], ['bush', 2]];
            if (state.base >= 0.4 && !uphill) options.push(['bench', 2]);
            if (m >= ANIMALS.boar.from) options.push(['boar', 2.5]);
            if (m >= ANIMALS.wolf.from) options.push(['wolf', 2]);
            let r = Math.random() * options.reduce((s, [, wgt]) => s + wgt, 0);
            const type = options.find(([, wgt]) => (r -= wgt) < 0)[0];

            if (type === 'stone') {
                const maxH = state.base < 0.4 ? 20 : (uphill ? 22 : 28);
                if (state.base >= 0.5 && !uphill && Math.random() < 0.3) {
                    // zwei Steine nah beieinander
                    state.obstacles.push(stone(wx, 15 + Math.random() * 7), stone(wx + 11, 15 + Math.random() * 7));
                } else {
                    state.obstacles.push(stone(wx, 14 + Math.random() * (maxH - 14)));
                }
            } else if (type === 'sapling') {
                // Jungtanne, schmal: am Anfang 20–34 hoch, später 24–42 (Fenster min. ca. 133 ms)
                const h = state.base < 0.4 ? 20 + Math.random() * 14 : 24 + Math.random() * 18, w = h * 0.56;
                state.obstacles.push({ type: 'sapling', wx, h, w, hw: w * 0.28, hh: h * 0.9, v: 0 });
            } else if (type === 'bush') {
                // Busch, niedrig und breit; am Anfang höchstens 16 hoch (Fenster min. ca. 125 ms)
                const h = 11 + Math.random() * (state.base < 0.4 ? 5 : 7), w = h * 1.6;
                state.obstacles.push({ type: 'bush', wx, h, w, hw: w * 0.4, hh: h * 0.9, v: 0, seed: Math.random() });
            } else if (type === 'bench') {
                state.obstacles.push({ type: 'bench', wx, w: 44, hw: 17, hh: 19, v: 0 });
            } else {
                const a = ANIMALS[type];
                state.obstacles.push({ type, wx, w: a.w, hw: a.hw, hh: a.hh, v: a.v, phase: Math.random() * 6 });
            }
        }
        // Abstand bis zum nächsten Hindernis wächst mit dem Tempo, damit es fair bleibt (in der Abfahrt mit dem
        // tatsächlichen Tempo). Ab 400 m wird er nach und nach kürzer (bis 1600 m), das Spiel also dichter.
        const tight = Math.min(1, Math.max(0, (m - 400) / 1200));
        state.nextGap = Math.max(state.base, state.vel) * (900 - 180 * tight) + 140 + Math.random() * (260 - 90 * tight);
    }

    function bikerBox() {
        const top = state.y - (state.duck ? 34 : 54);
        // etwas schmaler als das Rad (Radränder zählen nicht), damit knappe Sprünge fair bleiben
        return { x1: BIKER_X - 8, x2: BIKER_X + 38, y1: top, y2: state.y - 2 };
    }
    // Vogel: Flughöhe nach dem höchsten Bodenpunkt unter ihm (am Hang), damit man geduckt immer sicher durchpasst
    const birdBase = (o) => Math.min(groundY(o.wx - o.hw), groundY(o.wx), groundY(o.wx + o.hw));

    function obstacleBox(o) {
        const x = o.wx - state.dist;
        if (o.type !== 'bird') {
            const b = groundY(o.wx);
            return { x1: x - o.hw, x2: x + o.hw, y1: b - o.hh, y2: b };
        }
        const b = birdBase(o);
        return { x1: x - o.hw, x2: x + o.hw, y1: b - 60, y2: b - 40 }; // Vogel: unten 40 über dem Boden, geduckt ist man 34 hoch
    }
    const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

    // ----- Ablauf -----
    function update(dt) {
        if (state.mode !== 'run') return;
        state.base = Math.min(topSpeed, state.base + (state.base < maxSpeed ? ACCEL : ACCEL_LATE) * dt);

        // Tempo nach Gefälle: Ziel = Grundtempo × (1 + Wirkung × Gefälle), weich angeglichen (Schwung).
        // In der großen Abfahrt kommt ein Schub dazu (bis gut das 1,6-Fache).
        const mid = bikerWorldX() + WHEELBASE / 2;
        const slope = slopeAt(mid);
        const boost = DOWNHILL_BOOST * Math.max(0, hillSlopeAt(mid) - 0.04);
        const factor = Math.min(1.3, Math.max(0.8, 1 + SLOPE_EFFECT * slope)) + boost;
        const target = Math.min(velMax, Math.max(MIN_SPEED, state.base * factor));
        state.vel += (target - state.vel) * Math.min(1, dt / 350);

        const dx = state.vel * dt;
        state.dist += dx;
        state.wheel += dx / 11;

        // Sprung und Bodenkontakt (Gelände folgt unter dem Hinterrad)
        const ground = groundY(bikerWorldX());
        if (state.air) {
            state.vy += GRAVITY * dt;
            state.y += state.vy * dt;
            if (state.y >= ground && state.vy >= 0) { state.y = ground; state.vy = 0; state.air = false; }
            state.angle *= Math.max(0, 1 - dt / 300);   // in der Luft langsam waagerecht
        } else {
            state.y = ground;
            const target = Math.atan2(groundY(bikerWorldX() + WHEELBASE) - ground, WHEELBASE);
            state.angle += (target - state.angle) * Math.min(1, dt / 80);
        }

        const phase = meters() % CYCLE;
        const nightPhase = phase >= NIGHT_FROM && phase < NIGHT_TO;
        const nightTarget = nightPhase !== siteDark ? 1 : 0;
        state.night += Math.sign(nightTarget - state.night) * Math.min(Math.abs(nightTarget - state.night), dt / FADE_MS);

        // Tiere laufen entgegen, Beine bewegen sich
        state.obstacles.forEach((o) => {
            if (o.v) o.wx -= o.v * dt;
            if (o.phase !== undefined) o.phase += dt * (0.008 + o.v * 0.12);
        });
        state.obstacles = state.obstacles.filter((o) => o.wx - state.dist > -100);
        state.nextGap -= dx;
        if (state.nextGap <= 0) spawn();

        // Brocken-Gipfel erreicht: Konfetti und Einblendung, danach geht es weiter
        state.time += dt;
        if (state.summitAt < 0 && bikerWorldX() >= BROCKEN.start + BROCKEN.up) {
            state.summitAt = state.time;
            state.confetti = makeConfetti();
            announce(`${t.summit} ${t.summitNext}`);
        }
        state.confetti.forEach((c) => {
            c.vy = Math.min(0.12, c.vy + 0.00009 * dt);
            c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.spin * dt;
        });
        if (state.confetti.length) state.confetti = state.confetti.filter((c) => c.y < HGT + 10);

        const b = bikerBox();
        if (state.obstacles.some((o) => hit(b, obstacleBox(o)))) crash();
    }

    // Konfetti: bunte Schnipsel fallen von oben über das ganze Bild (Farben passend gedeckt zur Seite)
    const CONFETTI_COLORS = ['#e4572e', '#f3a712', '#29a19c', '#a8c256', '#6c8ead', '#d1495b', '#ffffff'];
    function makeConfetti() {
        return Array.from({ length: 110 }, (_, i) => ({
            x: Math.random() * W, y: -10 - Math.random() * 120,
            vx: (Math.random() - 0.5) * 0.08, vy: 0.02 + Math.random() * 0.05,
            rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.02,
            w: 3 + Math.random() * 3, h: 2 + Math.random() * 2, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        }));
    }

    function crash() {
        state.mode = 'over';
        state.crashAt = performance.now();
        const m = meters();
        if (m > best) { best = m; state.newBest = true; writeBest(best); }
        const summit = m >= SUMMIT_M ? ` ${t.summitDone}.` : '';
        announce(`${t.crash} ${m} m.${summit} ${state.newBest ? t.newRecord : t.record + ': ' + best + ' m.'} ${t.again}`);
    }

    function announce(text) { if (status) status.textContent = text; }

    // ----- Zeichnen -----
    function fir(x, base, h, color) {
        const w = h * 0.56;
        const tiers = [[0.30, 0.20], [0.62, 0.34], [1.0, 0.5]];
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, base - h);
        const pts = [];
        tiers.forEach(([end, hw], i) => {
            const y = base - h + end * h;
            pts.push([x + hw * w, y]);
            if (i < tiers.length - 1) pts.push([x + hw * w * 0.45, y]);
        });
        pts.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.lineTo(x + w * 0.5, base + 6);  // bis unter den Boden, damit die Tanne auch am Hang aufsteht
        ctx.lineTo(x - w * 0.5, base + 6);
        pts.slice().reverse().forEach(([px, py]) => ctx.lineTo(2 * x - px, py));
        ctx.closePath();
        ctx.fill();
    }

    function drawBird(x, base, o) {
        // Fliegt nach links, Mitte 50 über dem Boden. Flügel schlagen auf und ab.
        // Tagsüber Mäusebussard (Hakenschnabel, Fächerschwanz), nachts Eule (runder Kopf, Federohren, große Augen).
        const y = base - 50;
        const flap = Math.sin(o.phase * 1.6);           // -1 … 1
        ctx.fillStyle = colors.fg;
        // Flügel: von der Schulter aus, Spitze je nach Schlag oben oder unten
        const wingTip = y - 4 - flap * 13;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 2);
        ctx.quadraticCurveTo(x + 4, wingTip - 4, x + 14, wingTip);
        ctx.lineTo(x + 9, y - 1);
        ctx.closePath();
        ctx.fill();
        if (o.owl) {
            ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 10, 6.5, 0, 0, Math.PI * 2); ctx.fill();        // Körper
            ctx.beginPath(); ctx.arc(x - 8, y - 1, 6, 0, Math.PI * 2); ctx.fill();                     // runder Kopf
            ctx.beginPath(); ctx.moveTo(x - 12, y - 5); ctx.lineTo(x - 12, y - 10); ctx.lineTo(x - 9, y - 6); ctx.closePath(); ctx.fill(); // Federohr
            ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x - 4, y - 10); ctx.lineTo(x - 3, y - 5); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(x + 11, y - 1); ctx.lineTo(x + 17, y + 2); ctx.lineTo(x + 11, y + 4); ctx.closePath(); ctx.fill(); // kurzer Schwanz
            ctx.fillStyle = colors.bg;
            ctx.beginPath(); ctx.arc(x - 10, y - 1.5, 1.8, 0, Math.PI * 2); ctx.fill();               // große Augen
            ctx.beginPath(); ctx.arc(x - 6, y - 1.5, 1.8, 0, Math.PI * 2); ctx.fill();
        } else {
            ctx.beginPath(); ctx.ellipse(x + 1, y + 1, 12, 4.5, -0.05, 0, Math.PI * 2); ctx.fill();    // schlanker Körper
            ctx.beginPath(); ctx.arc(x - 11, y - 1, 4, 0, Math.PI * 2); ctx.fill();                    // Kopf
            ctx.beginPath(); ctx.moveTo(x - 14, y - 2); ctx.lineTo(x - 18, y); ctx.lineTo(x - 14, y + 1.5); ctx.closePath(); ctx.fill(); // Hakenschnabel
            ctx.beginPath(); ctx.moveTo(x + 11, y - 1); ctx.lineTo(x + 20, y - 3); ctx.lineTo(x + 20, y + 5); ctx.lineTo(x + 11, y + 3); ctx.closePath(); ctx.fill(); // Fächerschwanz
            ctx.fillStyle = colors.bg;
            ctx.beginPath(); ctx.arc(x - 12, y - 1.5, 1, 0, Math.PI * 2); ctx.fill();                  // Auge
        }
    }

    function mountains(offset, onTop) {
        // Ferne Kette mit Brocken (Mast), wiederholt sich alle MW Einheiten.
        // onTop (0 … 1): man steht selbst auf dem Brocken, dann verblasst der ferne Mast
        // (der echte steht ja direkt am Weg)
        const o = -(offset % MW);
        for (let k = 0; k < 2; k++) {
            const x0 = o + k * MW;
            ctx.fillStyle = colors.far;
            ctx.beginPath();
            // gleiche Höhe am Anfang und Ende, je 1 Einheit Überlappung: keine Haarlinie zwischen den Kacheln
            ctx.moveTo(x0 - 1, HGT);
            ctx.lineTo(x0 - 1, 130);
            ctx.lineTo(x0, 130);
            ctx.bezierCurveTo(x0 + 80, 130, x0 + 160, 122, x0 + 240, 140);
            ctx.bezierCurveTo(x0 + 300, 150, x0 + 330, 108, x0 + 420, 102);
            ctx.bezierCurveTo(x0 + 500, 98, x0 + 540, 130, x0 + 620, 136);
            ctx.bezierCurveTo(x0 + 700, 140, x0 + 760, 124, x0 + MW, 130);
            ctx.lineTo(x0 + MW + 1, 130);
            ctx.lineTo(x0 + MW + 1, HGT);
            ctx.closePath();
            ctx.fill();
            // Sendemast und Radarkuppel auf dem Brocken
            if (onTop >= 1) continue;
            ctx.globalAlpha = 1 - onTop;
            ctx.fillRect(x0 + 418, 72, 2.4, 31);
            ctx.fillRect(x0 + 419, 64, 0.8, 9);
            ctx.beginPath();
            ctx.arc(x0 + 432, 100, 5, Math.PI, 0);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function brockenAhead(onTop) {
        // Der Brocken kommt näher: ab ca. 1500 m ein verschneites Massiv mit Mast im Hintergrund, das bis zum
        // Gipfel wächst. Oben verschwindet es (man steht ja selbst darauf).
        const p = (bikerWorldX() - (BROCKEN.start - BROCKEN_SEEN)) / (BROCKEN_SEEN + BROCKEN.up);
        if (p <= 0 || p >= 1.05 || onTop >= 1) return;
        const k = Math.min(1, p);
        const fade = Math.min(1, p / 0.08) * (1 - onTop);
        const cx = W * (0.78 - 0.12 * k), base = 150, top = 118 - 88 * k, wid = 120 + 230 * k;
        ctx.save();
        ctx.globalAlpha = fade;
        const shape = () => {
            ctx.beginPath();
            ctx.moveTo(cx - wid, base);
            ctx.bezierCurveTo(cx - wid * 0.55, base - (base - top) * 0.35, cx - wid * 0.3, top, cx, top);
            ctx.bezierCurveTo(cx + wid * 0.3, top, cx + wid * 0.55, base - (base - top) * 0.35, cx + wid, base);
            ctx.closePath();
        };
        ctx.fillStyle = colors.far;
        shape(); ctx.fill();
        // Schneekappe: oberes Drittel hell
        ctx.save();
        shape(); ctx.clip();
        ctx.fillStyle = colors.snow;
        ctx.globalAlpha = fade * 0.85;
        // untere Schneegrenze wellig, damit es nicht wie ein Tafelberg aussieht
        const capY = top + (base - top) * 0.3;
        ctx.beginPath();
        ctx.moveTo(cx - wid, top - 2);
        for (let x = cx - wid; x <= cx + wid; x += 6) ctx.lineTo(x, capY + Math.sin(x * 0.09) * 3 + Math.sin(x * 0.23 + 1) * 1.6);
        ctx.lineTo(cx + wid, top - 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Sendemast und Radarkuppel oben
        ctx.fillStyle = colors.far;
        const mh = 10 + 30 * k;
        ctx.fillRect(cx - 1 - k, top - mh, 2 + 2 * k, mh + 1);
        ctx.beginPath(); ctx.arc(cx + 10 + 14 * k, top + 1, 3 + 5 * k, Math.PI, 0); ctx.fill();
        ctx.restore();
    }

    function hills(offset) {
        const o = -(offset % 400);
        ctx.fillStyle = colors.mid;
        for (let k = 0; k < 3; k++) {
            const x0 = o + k * 400;
            ctx.beginPath();
            ctx.moveTo(x0 - 1, HGT);
            ctx.lineTo(x0 - 1, 166);
            ctx.lineTo(x0, 166);
            ctx.bezierCurveTo(x0 + 90, 148, x0 + 160, 146, x0 + 220, 162);
            ctx.bezierCurveTo(x0 + 280, 176, x0 + 340, 158, x0 + 400, 166);
            ctx.lineTo(x0 + 401, 166);
            ctx.lineTo(x0 + 401, HGT);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Wald im Hintergrund: Tannen am Wegrand, wiederholen sich alle 640 Einheiten (keine Hindernisse).
    // Unten bis zum Rand gezogen, das Gelände davor deckt sie ab; so stehen sie nie in der Luft.
    const FOREST = [[20, 34], [48, 46], [70, 30], [130, 40], [152, 54], [176, 38], [250, 30], [300, 44], [322, 36],
        [410, 50], [432, 38], [455, 28], [520, 42], [548, 34], [600, 46]];
    function forest(offset) {
        const o = -(offset % 640);
        for (let k = 0; k < 3; k++) {
            FOREST.forEach(([x, h]) => {
                const px = o + k * 640 + x;
                if (px < -30 || px > W + 30) return;
                fir(px, 178, h, colors.trees);
                ctx.fillRect(px - 2, 178, 4, HGT - 178);
            });
        }
    }

    function drawStone(x, b, o) {
        // unregelmäßiger Felsbrocken, Form je Stein leicht verschieden
        const h = o.h, w = o.w, k = 0.85 + o.seed * 0.3;
        ctx.fillStyle = colors.fg;
        ctx.beginPath();
        ctx.moveTo(x - w / 2, b + 4);
        ctx.lineTo(x - w * 0.5, b - h * 0.4);
        ctx.lineTo(x - w * 0.3 * k, b - h * 0.88);
        ctx.lineTo(x - w * 0.02, b - h);
        ctx.lineTo(x + w * 0.26 * k, b - h * 0.86);
        ctx.lineTo(x + w * 0.48, b - h * 0.38);
        ctx.lineTo(x + w / 2, b + 4);
        ctx.closePath();
        ctx.fill();
        // kleiner Lichtreflex, damit es nach Stein aussieht
        ctx.fillStyle = colors.bg;
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.moveTo(x - w * 0.24, b - h * 0.78); ctx.lineTo(x - w * 0.04, b - h * 0.9); ctx.lineTo(x - w * 0.12, b - h * 0.6);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    }

    function drawBush(x, b, o) {
        // Busch: drei überlappende Rundungen, Form je Busch leicht verschieden
        const h = o.h, w = o.w, k = 0.8 + o.seed * 0.4;
        ctx.fillStyle = colors.fg;
        ctx.beginPath(); ctx.ellipse(x - w * 0.22, b - h * 0.42, w * 0.28, h * 0.45 * k, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + w * 0.04, b - h * 0.6, w * 0.3, h * 0.42, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + w * 0.27, b - h * 0.38, w * 0.24, h * 0.4 / k, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillRect(x - w * 0.45, b - h * 0.35, w * 0.9, h * 0.35 + 4);   // bis in den Boden
    }

    function drawBench(x, b) {
        // Holzbank von der Seite: Sitz, Lehne, Beine
        ctx.fillStyle = colors.fg;
        ctx.fillRect(x - 22, b - 12, 44, 3.5);          // Sitzfläche
        ctx.fillRect(x - 22, b - 21, 44, 3);            // Lehne
        ctx.fillRect(x - 19, b - 21, 3, 21);            // Bein und Lehnenstütze links
        ctx.fillRect(x + 16, b - 21, 3, 21);            // rechts
        ctx.fillRect(x - 12, b - 12, 2.5, 12);          // mittlere Stützen
        ctx.fillRect(x + 9, b - 12, 2.5, 12);
    }

    function legs(x, b, top, xs, phase, len, width) {
        ctx.strokeStyle = colors.fg; ctx.lineWidth = width; ctx.lineCap = 'round';
        xs.forEach((lx, i) => {
            const swing = Math.sin(phase + (i % 2) * Math.PI) * len * 0.35;
            ctx.beginPath(); ctx.moveTo(x + lx, top); ctx.lineTo(x + lx + swing, b); ctx.stroke();
        });
    }

    function drawBoar(x, b, phase) {
        // Wildschwein, läuft nach links: massiger Körper, Rüssel, Ohr, Borsten, Ringelschwanz
        ctx.fillStyle = colors.fg;
        legs(x, b, b - 7, [-9, -3, 7, 13], phase, 8, 3);
        ctx.beginPath(); ctx.ellipse(x + 2, b - 13, 17, 8.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath();                                  // Kopf mit Rüssel
        ctx.moveTo(x - 11, b - 19); ctx.lineTo(x - 23, b - 10); ctx.lineTo(x - 24, b - 6); ctx.lineTo(x - 12, b - 6);
        ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 11, b - 19); ctx.lineTo(x - 9, b - 25); ctx.lineTo(x - 6, b - 19); ctx.closePath(); ctx.fill(); // Ohr
        for (let i = 0; i < 5; i++) {                     // Borsten auf dem Rücken
            ctx.beginPath();
            ctx.moveTo(x - 6 + i * 5, b - 20); ctx.lineTo(x - 4 + i * 5, b - 24); ctx.lineTo(x - 2 + i * 5, b - 20);
            ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = colors.fg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x + 21, b - 15, 2.5, Math.PI, Math.PI * 2.6); ctx.stroke(); // Ringelschwanz
        ctx.fillStyle = colors.bg;
        ctx.beginPath(); ctx.arc(x - 15, b - 13, 1.2, 0, Math.PI * 2); ctx.fill();          // Auge
    }

    function drawWolf(x, b, phase) {
        // Wolf, läuft nach links: hochbeinig, schlanker Rumpf, Kopf vorgestreckt mit spitzen Ohren,
        // langer, leicht hängender Schwanz
        ctx.fillStyle = colors.fg;
        legs(x, b, b - 10, [-10, -5, 8, 13], phase, 10, 2.6);
        ctx.beginPath(); ctx.ellipse(x + 2, b - 15, 15, 6, -0.05, 0, Math.PI * 2); ctx.fill();          // Rumpf
        ctx.beginPath(); ctx.ellipse(x - 9, b - 15, 7, 7, 0, 0, Math.PI * 2); ctx.fill();               // Brust und Nacken
        ctx.beginPath();                                                                                // Kopf mit Schnauze
        ctx.moveTo(x - 12, b - 22); ctx.lineTo(x - 18, b - 21); ctx.lineTo(x - 26, b - 17);
        ctx.lineTo(x - 25, b - 15); ctx.lineTo(x - 15, b - 13); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 13, b - 21); ctx.lineTo(x - 12, b - 27); ctx.lineTo(x - 9, b - 21); ctx.closePath(); ctx.fill(); // Ohr
        const wag = Math.sin(phase) * 1.5;
        ctx.beginPath(); ctx.ellipse(x + 21, b - 12 + wag, 10, 3, 0.45, 0, Math.PI * 2); ctx.fill();   // Schwanz
        ctx.fillStyle = colors.bg;
        ctx.beginPath(); ctx.arc(x - 17, b - 19, 1.1, 0, Math.PI * 2); ctx.fill();                      // Auge
    }

    function terrain(cam) {
        // Boden als Fläche unter der Geländelinie (bis zum unteren Bildrand, auch wenn die Kamera oben ist),
        // dazu vorbeiziehende Steinchen auf dem Weg
        const bottom = HGT + cam + 2;
        ctx.fillStyle = colors.ground;
        ctx.beginPath();
        ctx.moveTo(0, bottom);
        for (let x = 0; x <= W; x += 6) ctx.lineTo(x, groundY(state.dist + x));
        ctx.lineTo(W, bottom);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = colors.bg;
        const o = state.dist % 60;
        for (let x = -o; x < W; x += 60) ctx.fillRect(x + 20, groundY(state.dist + x + 23) + 9, 6, 2);

        // Schneedecke oben am Brocken: helle Schicht auf der Geländelinie, Deckkraft nach Höhe
        if (state.dist + W < BROCKEN.start || state.dist > BROCKEN_END) return;
        ctx.save();
        ctx.fillStyle = colors.snow;
        for (let x = 0; x < W; x += 6) {
            const a = snowAt(state.dist + x);
            if (a <= 0) continue;
            ctx.globalAlpha = a;
            const y0 = groundY(state.dist + x), y1 = groundY(state.dist + x + 6);
            ctx.beginPath();
            ctx.moveTo(x, y0 - 2); ctx.lineTo(x + 6.5, y1 - 2); ctx.lineTo(x + 6.5, y1 + 7); ctx.lineTo(x, y0 + 7);
            ctx.closePath(); ctx.fill();
        }
        ctx.restore();
    }

    function summitScene() {
        // Brocken-Gipfel aus der Nähe: Gipfelstein mit Höhenangabe, Sendemast, Radarkuppel (kein Brockenhaus)
        const s = BROCKEN.start + BROCKEN.up;
        if (state.dist + W + 60 < s || state.dist - 60 > s + BROCKEN.flat) return;
        ctx.fillStyle = colors.fg;
        // Sendemast: schlanker, nach oben schmaler Turm mit zwei Plattformen und Antenne
        const mx = s + 560 - state.dist, mb = groundY(s + 560) + 4;
        ctx.beginPath(); ctx.moveTo(mx - 8, mb); ctx.lineTo(mx - 3, mb - 112); ctx.lineTo(mx + 3, mb - 112); ctx.lineTo(mx + 8, mb); ctx.closePath(); ctx.fill();
        ctx.fillRect(mx - 9, mb - 78, 18, 6);
        ctx.fillRect(mx - 7, mb - 102, 14, 5);
        ctx.fillRect(mx - 1, mb - 140, 2, 30);
        // Radarkuppel auf kleinem Sockel
        const dx = s + 780 - state.dist, db = groundY(s + 780) + 4;
        ctx.fillRect(dx - 16, db - 16, 32, 16);
        ctx.beginPath(); ctx.arc(dx, db - 16, 17, Math.PI, 0); ctx.fill();
        // Gipfelstein mit Schild "1141 m"
        const gx = s + 160 - state.dist, gb = groundY(s + 160) + 3;
        ctx.beginPath();
        ctx.moveTo(gx - 17, gb); ctx.lineTo(gx - 15, gb - 20); ctx.lineTo(gx - 6, gb - 30); ctx.lineTo(gx + 9, gb - 28);
        ctx.lineTo(gx + 16, gb - 16); ctx.lineTo(gx + 17, gb); ctx.closePath(); ctx.fill();
        ctx.fillStyle = colors.bg;
        ctx.font = '700 7px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('1141 m', gx, gb - 14);
        // Schnee auf Stein und Kuppel
        ctx.fillStyle = colors.snow;
        ctx.beginPath(); ctx.moveTo(gx - 15, gb - 20); ctx.lineTo(gx - 6, gb - 30); ctx.lineTo(gx + 9, gb - 28); ctx.lineTo(gx + 11, gb - 25);
        ctx.lineTo(gx - 6, gb - 26); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.arc(dx, db - 16, 17, Math.PI * 1.15, Math.PI * 1.85); ctx.arc(dx, db - 13, 15, Math.PI * 1.8, Math.PI * 1.2, true); ctx.closePath(); ctx.fill();
    }

    function snowfall(now, cam) {
        // Schneeflocken, sobald man oben am Brocken ist (nur dort ist die Kamera höher als 145)
        const a = Math.min(1, Math.max(0, (-cam - 145) / 40));
        if (a <= 0) return;
        ctx.save();
        ctx.fillStyle = colors.flake;
        const span = W + 20;
        for (let i = 0; i < 46; i++) {
            // treiben nach links (Fahrtwind), fallen unterschiedlich schnell, pendeln leicht
            const drift = now * 0.012 * (1 + (i % 3)) + state.dist * 0.2;
            const x = (((i * 89.7 - drift) % span) + span) % span - 10 + Math.sin(now / 700 + i) * 3;
            const y = (i * 37.3 + now * (0.018 + (i % 4) * 0.006)) % (HGT + 10) - 5;
            ctx.globalAlpha = a * (0.6 + (i % 3) * 0.2);
            ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3) * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }

    function confetti() {
        if (!state.confetti.length) return;
        ctx.save();
        const base = ctx.getTransform();
        state.confetti.forEach((c) => {
            ctx.setTransform(base);
            ctx.translate(c.x, c.y);
            ctx.rotate(c.rot);
            ctx.fillStyle = c.color;
            ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        });
        ctx.restore();
    }

    function hillSign() {
        // Gefälle-Schild oben auf jedem großen Berg (beim Brocken am Ende des Gipfelstücks):
        // Pfahl, dreieckiges Warnschild mit schräger Rampe
        const spots = [BROCKEN.start + BROCKEN.up + BROCKEN.flat - 30];
        const first = Math.max(0, Math.ceil((state.dist - 40 - HILL_FIRST - HILL_UP) / HILL_EVERY));
        for (let k = first; ; k++) {
            const wx = HILL_FIRST + k * HILL_EVERY + HILL_UP - 30;
            if (wx - state.dist > W + 30) break;
            if (hillAt(wx) === REGULAR) spots.push(wx);
        }
        for (const wx of spots) {
            const x = wx - state.dist;
            if (x < -30 || x > W + 30) continue;
            const b = groundY(wx);
            ctx.fillStyle = colors.fg;
            ctx.fillRect(x - 1.5, b - 44, 3, 46);
            ctx.beginPath(); ctx.moveTo(x, b - 66); ctx.lineTo(x + 14, b - 42); ctx.lineTo(x - 14, b - 42); ctx.closePath(); ctx.fill();
            ctx.fillStyle = colors.bg;
            ctx.beginPath(); ctx.moveTo(x, b - 61); ctx.lineTo(x + 10, b - 44.5); ctx.lineTo(x - 10, b - 44.5); ctx.closePath(); ctx.fill();
            ctx.fillStyle = colors.fg;
            ctx.beginPath(); ctx.moveTo(x - 7, b - 51); ctx.lineTo(x + 7, b - 46); ctx.lineTo(x - 7, b - 46); ctx.closePath(); ctx.fill();
        }
    }

    function speedLines() {
        // Fahrtwind hinter dem Biker, wenn es richtig schnell wird (große Abfahrt)
        const a = Math.min(0.55, (state.vel - 0.9) * 1.4);
        if (a <= 0 || state.mode !== 'run') return;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = colors.fg;
        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';
        [[-30, 42, 26], [-38, 30, 18], [-26, 18, 22], [-44, 52, 14]].forEach(([dx, dy, len], i) => {
            const jitter = ((state.dist / 7 + i * 13) % 12) - 6;
            const x = BIKER_X + dx + jitter;
            ctx.beginPath(); ctx.moveTo(x, state.y - dy); ctx.lineTo(x - len, state.y - dy); ctx.stroke();
        });
        ctx.restore();
    }

    function biker() {
        const c = colors.fg;
        const duck = state.duck && state.mode === 'run';
        ctx.save();
        // Hinterrad-Nabe als Ursprung, Rad 11 über dem Aufstandspunkt, ganzes Rad mit dem Hang geneigt
        ctx.translate(BIKER_X, state.y);
        ctx.rotate(state.angle);
        ctx.translate(0, -11);
        ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const rx = 0, fx = WHEELBASE, y = 0;

        // Räder mit Speichen, die sich drehen
        ctx.lineWidth = 3.2;
        [rx, fx].forEach((cx) => {
            ctx.beginPath(); ctx.arc(cx, y, 10.5, 0, Math.PI * 2); ctx.stroke();
            ctx.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
                const a = state.wheel + i * Math.PI / 3;
                ctx.beginPath();
                ctx.moveTo(cx - Math.cos(a) * 9, y - Math.sin(a) * 9);
                ctx.lineTo(cx + Math.cos(a) * 9, y + Math.sin(a) * 9);
                ctx.stroke();
            }
            ctx.lineWidth = 3.2;
        });

        // Rahmen
        const bb = [rx + 15, y];
        const seat = [rx + 9, y - 17];
        const head = [fx - 7, y - 19];
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(rx, y); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(seat[0], seat[1]); ctx.closePath();
        ctx.moveTo(bb[0], bb[1]); ctx.lineTo(head[0], head[1]); ctx.lineTo(seat[0], seat[1]);
        ctx.moveTo(head[0], head[1]); ctx.lineTo(fx, y);
        ctx.moveTo(head[0] - 3, head[1] - 4); ctx.lineTo(head[0] + 4, head[1] - 4); // Lenker
        ctx.stroke();

        // Fahrer: Oberkörper, Arm, tretendes Bein, Kopf mit Helm
        const hip = [seat[0] + 1, seat[1] - 2];
        const shoulder = duck ? [head[0] - 4, head[1] - 9] : [head[0] - 7, head[1] - 18];
        ctx.lineWidth = 4.6;
        ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(shoulder[0], shoulder[1]); ctx.stroke();
        ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.moveTo(shoulder[0], shoulder[1]); ctx.lineTo(head[0] + 1, head[1] - 4); ctx.stroke();
        const pa = state.wheel * 0.9;
        const pedal = [bb[0] + Math.cos(pa) * 5.5, bb[1] + Math.sin(pa) * 5.5];
        const knee = [(hip[0] + pedal[0]) / 2 + 6, (hip[1] + pedal[1]) / 2 - 3];
        ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(hip[0], hip[1]); ctx.lineTo(knee[0], knee[1]); ctx.lineTo(pedal[0], pedal[1]); ctx.stroke();
        const hx = shoulder[0] + (duck ? 6 : 4), hy = shoulder[1] - (duck ? 3 : 5);
        ctx.beginPath(); ctx.arc(hx, hy, 4.4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(hx + 0.5, hy - 2.2, 5.2, 3, -0.15, Math.PI, 0); ctx.fill(); // Helm
        ctx.restore();
    }

    function text(str, x, y, size, align) {
        ctx.fillStyle = colors.text;
        ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = align;
        ctx.fillText(str, x, y);
    }

    // Tacho oben links: Rundskala 0–80 km/h mit Zeiger. Spieltempo × 50 ergibt Fahrrad-Werte
    // (Start ca. 15 km/h, später ca. 50 km/h, in der großen Abfahrt über 70 km/h).
    const KMH = 50, KMH_MAX = 80;
    function speedo() {
        const cx = 34, cy = 38, r = 20;
        const kmh = state.mode === 'ready' ? 0 : state.vel * KMH;
        const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2, a = a0 + (a1 - a0) * Math.min(1, kmh / KMH_MAX);
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = colors.mid;
        ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();
        ctx.strokeStyle = colors.fg;
        if (kmh > 0.5) { ctx.beginPath(); ctx.arc(cx, cy, r, a0, a); ctx.stroke(); }
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); ctx.stroke();
        ctx.fillStyle = colors.fg;
        ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        text(String(Math.round(kmh)), cx, cy + 17, 12, 'center');
        text('km/h', cx, cy + 27, 8, 'center');
    }

    function draw(now) {
        colors = mixColors(state.night);
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, W, HGT);
        sky(now);
        // Kamera am großen Berg: Vordergrund verschiebt sich ganz, Hintergrund weniger (Tiefe). Oben auf dem
        // Berg sinken Wald und Hügel hinter den Hang, wie über der Baumgrenze am Brocken.
        const cam = cameraY();
        const layer = (k, fn) => { ctx.save(); ctx.translate(0, -cam * k); fn(); ctx.restore(); };
        // Mast der fernen Kette ausblenden, solange der große Brocken im Bild ist oder man oben steht
        const onTop = Math.min(1, Math.max(0, (-cam - 145) / 40));
        const ahead = (bikerWorldX() - (BROCKEN.start - BROCKEN_SEEN)) / (BROCKEN_SEEN + BROCKEN.up);
        const aheadFade = ahead > 0 && ahead < 1.05 ? Math.min(1, ahead / 0.08) : 0;
        layer(0.12, () => { mountains(state.dist * 0.08, Math.max(onTop, aheadFade)); brockenAhead(Math.min(1, Math.max(0, (-cam - 270) / 30))); });
        layer(0.3, () => hills(state.dist * 0.3));
        layer(0.5, () => forest(state.dist * 0.5));
        ctx.save();
        ctx.translate(0, -cam);
        summitScene();
        terrain(cam);
        hillSign();

        state.obstacles.forEach((o) => {
            const x = o.wx - state.dist;
            const b = groundY(o.wx);
            if (o.type === 'bird') drawBird(x, birdBase(o), o);
            else if (o.type === 'stone') drawStone(x, b, o);
            else if (o.type === 'sapling') fir(x, b, o.h, colors.fg);
            else if (o.type === 'bush') drawBush(x, b, o);
            else if (o.type === 'bench') drawBench(x, b);
            else if (o.type === 'boar') drawBoar(x, b, o.phase);
            else if (o.type === 'wolf') drawWolf(x, b, o.phase);
        });
        speedLines();
        biker();
        ctx.restore();
        snowfall(now, cam);
        confetti();

        speedo();
        text(`${meters()} m`, W - 16, 26, 18, 'right');
        if (best) {
            const label = `${t.record}: ${best} m`;
            text(label, W - 16, 46, 13, 'right');
            if (best >= SUMMIT_M) {
                // kleines Berg-Symbol mit Schneekappe vor dem Rekord: Brocken schon einmal erreicht
                const x = W - 16 - ctx.measureText(label).width - 8;
                ctx.fillStyle = colors.text;
                ctx.beginPath(); ctx.moveTo(x - 7, 46); ctx.lineTo(x, 36); ctx.lineTo(x + 7, 46); ctx.closePath(); ctx.fill();
                ctx.fillStyle = colors.bg;
                ctx.beginPath(); ctx.moveTo(x - 2.5, 39.6); ctx.lineTo(x, 36); ctx.lineTo(x + 2.5, 39.6); ctx.closePath(); ctx.fill();
            }
        }

        if (state.mode === 'ready') {
            text(t.title, W / 2, 52, 24, 'center');
            text(t.start, W / 2, 80, 15, 'center');
        } else if (state.mode === 'over') {
            const summit = meters() >= SUMMIT_M ? ` · ${t.summitDone}` : '';
            text(t.crash, W / 2, 52, 24, 'center');
            text(state.newBest ? t.newRecord + summit : `${meters()} m${summit}`, W / 2, 78, 16, 'center');
            text(t.again, W / 2, 102, 14, 'center');
        } else if (state.summitAt >= 0 && state.time - state.summitAt < 4500) {
            // Gipfel-Einblendung, blendet nach 4,5 s aus
            const age = state.time - state.summitAt;
            ctx.save();
            ctx.globalAlpha = Math.min(1, age / 300, (4500 - age) / 600);
            text(t.summit, W / 2, 56, 24, 'center');
            text(t.summitNext, W / 2, 80, 14, 'center');
            ctx.restore();
        }
    }

    function frame(now) {
        const dt = Math.min(40, now - last || 16); // nach Tab-Wechsel keine Riesensprünge
        last = now;
        update(dt);
        draw(now);
        raf = requestAnimationFrame(frame);
    }

    function resize() {
        const ratio = window.devicePixelRatio || 1;
        const narrow = (dialog.clientWidth || window.innerWidth) < 600;
        W = narrow ? 480 : 800;
        // kürzere Vorausschau auf dem Handy: etwas langsamer
        maxSpeed = narrow ? 0.6 : 0.78;
        topSpeed = narrow ? 0.75 : 1.0;
        velMax = narrow ? 1.05 : 1.45;
        canvas.style.aspectRatio = W + ' / ' + HGT;
        const cssW = canvas.clientWidth || W;
        canvas.width = Math.round(cssW * ratio);
        canvas.height = Math.round(cssW * HGT / W * ratio);
        ctx.setTransform(canvas.width / W, 0, 0, canvas.height / HGT, 0, 0);
    }

    function stop() {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('keyup', onKey);
        window.removeEventListener('resize', resize);
    }

    function open() {
        siteDark = document.body.classList.contains('theme-dark');
        reset();
        colors = mixColors(state.night);
        announce('');
        dialog.showModal();
        resize();
        document.addEventListener('keydown', onKey);
        document.addEventListener('keyup', onKey);
        window.addEventListener('resize', resize);
        last = performance.now();
        if (!raf) raf = requestAnimationFrame(frame);
        canvas.focus({ preventScroll: true });
    }

    dialog.addEventListener('close', stop);
    dialog.querySelector('.bike-game-close').addEventListener('click', () => dialog.close());
    // Klick auf den abgedunkelten Rand schließt das Fenster
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

    window.BikeGame = { open };
})();
