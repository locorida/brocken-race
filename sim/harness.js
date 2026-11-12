// Lädt bike-game.js ohne Browser: DOM und Canvas sind Attrappen, gezeichnet wird nichts.
// Die Simulationen bekommen über window.BikeGame.T Zugriff auf Zustand und Spiellogik (reset, update, Gelände).
const fs = require('fs');
const path = require('path');

function loadGame({ narrow = false, file = path.join(__dirname, '..', 'bike-game.js') } = {}) {
    const hook = 'window.BikeGame = { open };';
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(hook)) throw new Error('bike-game.js: Export "' + hook + '" nicht gefunden');
    const exported = src.replace(hook,
        'window.BikeGame = { open, T: { get state() { return state; }, set state(v) { state = v; }, reset, update, resize, ' +
        'groundY, slopeAt, onDescent, bigHill, HILL_FIRST, HILL_EVERY, HILL_UP, HILL_DOWN, BROCKEN, ' +
        'get W() { return W; }, get topSpeed() { return topSpeed; } } };');

    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop, set: () => true });
    const canvas = { getContext: () => ctx, addEventListener: noop, style: {}, clientWidth: narrow ? 400 : 800, focus: noop };
    const dialog = {
        dataset: { texts: '{}' },
        querySelector: (s) => (s === 'canvas' ? canvas : { addEventListener: noop, textContent: '' }),
        addEventListener: noop,
        clientWidth: narrow ? 400 : 900,
    };
    global.window = global;
    global.devicePixelRatio = 1;
    global.innerWidth = narrow ? 400 : 1200;
    global.document = { getElementById: () => dialog, body: { classList: { contains: () => false } }, addEventListener: noop, removeEventListener: noop };
    global.requestAnimationFrame = noop;
    global.cancelAnimationFrame = noop;
    // eslint-disable-next-line no-eval
    (0, eval)(exported);
    const G = global.BikeGame.T;
    G.resize();
    return G;
}

module.exports = { loadGame };
