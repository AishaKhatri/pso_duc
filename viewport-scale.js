// Uniform layout scaling for the onsite console panels.
//
// Every dimension in this app is authored in px against the 10-inch panel
// (1280x800). Rather than maintain a second set of sizes for the 7-inch panel
// (1024x600 / 1080x600), the whole document renders at a single CSS `zoom`
// factor chosen so the design box fits the physical screen. Both panels then
// show an identical layout — same rows per table, same wrapping, same
// proportions — differing only in physical size.
//
// `zoom` rather than `transform: scale()` is deliberate. zoom is a layout-level
// scale, so position:fixed chrome (topbar, sidebar, alarms panel), scrolling
// and hit-testing all keep working. It also scales the inline `element.style.*`
// px values this codebase sets from JS, which a media query could never reach.
//
// Loaded from <head> on every page, before first paint, so the layout is never
// shown at the wrong scale.
(function () {
    // The 10-inch panel the UI is laid out against.
    const DESIGN_WIDTH = 1280;
    const DESIGN_HEIGHT = 800;
    // Floor, so a badly-sized window shrinks text but never to nothing.
    const MIN_SCALE = 0.6;

    function computeScale() {
        // window.innerWidth/innerHeight report the REAL viewport and are not
        // affected by the zoom set below, so this cannot feed back on itself.
        // (documentElement.clientWidth/Height would be — don't use them here.)
        const w = window.innerWidth || DESIGN_WIDTH;
        const h = window.innerHeight || DESIGN_HEIGHT;
        // Fit the design box on both axes; never scale up, a bigger screen just
        // gets more room. On both target panels height is the binding axis:
        // 1024x600 -> min(0.80, 0.75) = 0.75, 1080x600 -> min(0.84, 0.75) = 0.75.
        const raw = Math.min(1, w / DESIGN_WIDTH, h / DESIGN_HEIGHT);
        // Round so a 1px resize jitter doesn't churn the whole layout.
        return Math.max(MIN_SCALE, Math.round(raw * 1000) / 1000);
    }

    let applied = null;

    function apply() {
        const scale = computeScale();
        if (scale === applied) return;
        applied = scale;

        const root = document.documentElement;
        root.style.zoom = String(scale);
        // Exposed so viewport-relative sizes can divide it back out: vh/vw
        // resolve against the unzoomed viewport, so a bare 100vh under zoom 0.75
        // would only cover 75% of the screen. See --vh100/--vw100 in styles.css.
        root.style.setProperty('--ui-scale', String(scale));
        // Spare width beyond the design box, in scaled CSS px. Height is the
        // binding axis on both panels, so the shorter one ends up wider than
        // 1280 once scaled (1024x600 -> 1365, 1080x600 -> 1440). Layouts that
        // must wrap identically on every panel subtract this from their width.
        const slack = Math.max(0, window.innerWidth / scale - DESIGN_WIDTH);
        root.style.setProperty('--width-slack', slack.toFixed(2) + 'px');

        window.dispatchEvent(new CustomEvent('uiscalechange', { detail: { scale } }));
    }

    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);

    window.AppScale = {
        get: () => applied,
        refresh: apply
    };
})();
