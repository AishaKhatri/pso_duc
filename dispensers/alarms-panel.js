// Shared "Alarms" sticky right-side panel used on the dispensers and overview
// pages. Loaded as its own file so both pages can `<script src>` it without
// either having to pull in the other's full module.
//
// Currently hosts a single "Check Prices" tool: scans every visible (i.e. not
// filtered out) dispenser card's cached nozzle data (card._dispenserNozzles,
// kept fresh by each page's 10s tick) and classifies nozzles as matched /
// mismatch / unlisted against the station's filed actual_price. Clicking a
// row scrolls + materializes the target nozzle.
//
// Respects an optional page-level product filter exposed at window._filterState
// (set by the dispensers page; absent on the overview page → treated as 'all').

// Per-session set of nozzles the user has dismissed from the alarms list.
// Keyed by nozzle_id (globally unique since address is). Persists until the
// page reloads — re-clicking "Check Prices" still excludes these.
const _dismissedMismatches = new Set();

// Two prices "match" when they agree to the first decimal place — anything past
// the first decimal (the 2nd paisa digit and finer) is ignored. We key a price
// to integer + first-decimal by snapping to exact paisa first (kills float
// noise), then dropping the last paisa digit (truncate, not round). So 272.34
// and 272.37 both key to 2723 → matched; 272.39 vs 272.40 (2723 vs 2724) don't.
function priceKey1dp(x) {
    return Math.floor(Math.round(x * 100) / 10);
}

// Panel widths (px). The host page's stage paddingRight tracks these via the
// 'alarms-panel-resize' event so cards reclaim the freed space when collapsed.
const ALARMS_PANEL_WIDTH_EXPANDED = 280;
const ALARMS_PANEL_WIDTH_COLLAPSED = 36;
const ALARMS_PANEL_GUTTER = 25;  // right offset (15px) + small breathing room
const ALARMS_COLLAPSED_KEY = 'alarmsPanelCollapsed';

function _emitAlarmsPanelResize(collapsed) {
    const width = collapsed ? ALARMS_PANEL_WIDTH_COLLAPSED : ALARMS_PANEL_WIDTH_EXPANDED;
    window.dispatchEvent(new CustomEvent('alarms-panel-resize', {
        detail: { collapsed, reservedRight: width + ALARMS_PANEL_GUTTER }
    }));
}

function createAlarmsPanel() {
    let collapsed = localStorage.getItem(ALARMS_COLLAPSED_KEY) === '1';

    const panel = document.createElement('div');
    panel.id = 'alarms-panel';
    Object.assign(panel.style, {
        position: 'fixed',
        right: '15px',
        top: '90px',
        width: `${collapsed ? ALARMS_PANEL_WIDTH_COLLAPSED : ALARMS_PANEL_WIDTH_EXPANDED}px`,
        maxHeight: 'calc(100vh - 110px)',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: 'var(--shadow-card)',
        padding: collapsed ? '10px 6px' : '12px',
        zIndex: '50',
        boxSizing: 'border-box',
        transition: 'width 0.2s ease, padding 0.2s ease'
    });

    // Header row: title on the left, collapse toggle on the right. When
    // collapsed only the toggle stays visible and the panel becomes a thin
    // vertical tab pinned to the right edge.
    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.alignItems = 'center';
    headerRow.style.justifyContent = collapsed ? 'center' : 'space-between';
    headerRow.style.marginBottom = collapsed ? '0' : '10px';

    const header = document.createElement('h3');
    header.textContent = 'Alarms';
    header.style.margin = '0';
    header.style.fontSize = '16px';
    header.style.color = 'var(--text-heading)';
    header.style.display = collapsed ? 'none' : 'block';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    Object.assign(toggleBtn.style, {
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        padding: '2px 4px',
        lineHeight: '1',
        borderRadius: '3px'
    });
    toggleBtn.textContent = collapsed ? '◀' : '▶';  // ◀ when collapsed (click to expand right→left), ▶ when expanded (click to collapse)
    toggleBtn.title = collapsed ? 'Expand alarms' : 'Collapse alarms';
    toggleBtn.addEventListener('mouseover', () => toggleBtn.style.background = 'var(--bg-surface-2, transparent)');
    toggleBtn.addEventListener('mouseout', () => toggleBtn.style.background = 'transparent');

    headerRow.appendChild(header);
    headerRow.appendChild(toggleBtn);
    panel.appendChild(headerRow);

    // --- Price Check section ---
    const section = document.createElement('div');

    const sectionTitle = document.createElement('div');
    sectionTitle.textContent = 'Price Check';
    sectionTitle.style.fontSize = '12px';
    sectionTitle.style.fontWeight = '600';
    sectionTitle.style.color = 'var(--text-secondary)';
    sectionTitle.style.textTransform = 'uppercase';
    sectionTitle.style.letterSpacing = '0.5px';
    sectionTitle.style.margin = '4px 0 8px';
    section.appendChild(sectionTitle);

    // Button row: Check Prices + Clear All side by side.
    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '6px';

    const checkButton = createActionButton('#004D64', '#00324C');
    checkButton.textContent = 'Check Prices';
    checkButton.style.flex = '1';
    checkButton.style.fontSize = '13px';
    checkButton.style.padding = '8px';

    const clearButton = createActionButton('#626262', '#424242');
    clearButton.textContent = 'Clear All';
    clearButton.style.flex = '1';
    clearButton.style.fontSize = '13px';
    clearButton.style.padding = '8px';

    btnRow.appendChild(checkButton);
    btnRow.appendChild(clearButton);
    section.appendChild(btnRow);

    // Count badge appears between buttons and list once Check Prices has run.
    const countLine = document.createElement('div');
    countLine.style.margin = '8px 0 4px';
    countLine.style.fontSize = '12px';
    countLine.style.fontWeight = '600';
    section.appendChild(countLine);

    const results = document.createElement('div');
    results.style.fontSize = '12px';
    section.appendChild(results);

    // Has any "Check Prices" scan ever run? Used so the count line stays
    // empty until the user actually clicks the button (rather than telling
    // them "0 mismatches" before they've asked).
    let hasScanned = false;
    let lastMismatches = [];
    let lastUnlistedItems = [];
    let lastMatchedCount = 0;

    const render = () => {
        const visibleMismatches = lastMismatches.filter(m => !_dismissedMismatches.has(m.nozzle_id));
        const visibleUnlisted = lastUnlistedItems.filter(m => !_dismissedMismatches.has(m.nozzle_id));
        renderPriceAlarms(results, {
            mismatches: visibleMismatches,
            unlistedItems: visibleUnlisted
        }, () => render());

        if (!hasScanned) {
            countLine.textContent = '';
            countLine.style.color = '';
            return;
        }

        const totalMismatches = lastMismatches.length;
        const totalUnlisted = lastUnlistedItems.length;
        const dismissedCount =
            (totalMismatches - visibleMismatches.length) +
            (totalUnlisted - visibleUnlisted.length);

        // Headline: mismatches found, matched count, and (when non-zero)
        // unlisted (no filed price) + dismissed totals.
        const parts = [
            `${totalMismatches} mismatch${totalMismatches === 1 ? '' : 'es'}`,
            `${lastMatchedCount} matched`
        ];
        if (totalUnlisted > 0) parts.push(`${totalUnlisted} unlisted`);
        if (dismissedCount > 0) parts.push(`${dismissedCount} dismissed`);
        countLine.textContent = parts.join(' · ');

        const anyVisibleAlarm = visibleMismatches.length > 0 || visibleUnlisted.length > 0;
        countLine.style.color = totalMismatches === 0 && totalUnlisted === 0
            ? 'var(--badge-online-text)'
            : (!anyVisibleAlarm
                ? 'var(--text-secondary)'
                : 'var(--badge-reset-text)');
    };

    checkButton.addEventListener('click', () => {
        hasScanned = true;
        const result = collectPriceMismatches();
        lastMismatches = result.mismatches;
        lastUnlistedItems = result.unlistedItems;
        lastMatchedCount = result.matched;
        render();
    });

    // Drop dismissals, drop the last scan, drop the "I've scanned" flag.
    // Next Check Prices is a totally fresh run.
    const resetAll = () => {
        _dismissedMismatches.clear();
        lastMismatches = [];
        lastUnlistedItems = [];
        lastMatchedCount = 0;
        hasScanned = false;
        render();
    };

    clearButton.addEventListener('click', resetAll);

    // Filter selection changed — the last scan was scoped to the previous
    // filter, so clear it. User must click Check Prices again to rescan
    // against the new visible set.
    window.addEventListener('dispenser-filters-changed', resetAll);

    section.style.display = collapsed ? 'none' : 'block';
    panel.appendChild(section);

    // --- GET Data activity log ---
    const getDataSection = document.createElement('div');
    getDataSection.style.display = collapsed ? 'none' : 'block';
    panel.appendChild(getDataSection);

    // Update DOM, persist preference, broadcast new reserved width so the host
    // page can re-flow cards into the freed space. Shared by the toggle button
    // and by external callers that force-expand the panel (beginGetDataLog).
    const setCollapsed = (next) => {
        collapsed = next;
        localStorage.setItem(ALARMS_COLLAPSED_KEY, collapsed ? '1' : '0');
        panel.style.width = `${collapsed ? ALARMS_PANEL_WIDTH_COLLAPSED : ALARMS_PANEL_WIDTH_EXPANDED}px`;
        panel.style.padding = collapsed ? '10px 6px' : '12px';
        header.style.display = collapsed ? 'none' : 'block';
        section.style.display = collapsed ? 'none' : 'block';
        getDataSection.style.display = collapsed ? 'none' : 'block';
        headerRow.style.justifyContent = collapsed ? 'center' : 'space-between';
        headerRow.style.marginBottom = collapsed ? '0' : '10px';
        toggleBtn.textContent = collapsed ? '◀' : '▶';
        toggleBtn.title = collapsed ? 'Expand alarms' : 'Collapse alarms';
        _emitAlarmsPanelResize(collapsed);
    };

    // Toggle handler — flip collapsed state.
    toggleBtn.addEventListener('click', () => setCollapsed(!collapsed));

    // Hooks the GET Data log driver uses to force the panel open and to find
    // where to mount its cards.
    panel._expand = () => { if (collapsed) setCollapsed(false); };
    panel._getDataSection = getDataSection;

    // Broadcast initial state on next tick so listeners attached after this
    // function returns (the host page wires its listener around the same time
    // it mounts the panel) still receive the starting width.
    setTimeout(() => _emitAlarmsPanelResize(collapsed), 0);

    return panel;
}

// Walks every visible card and classifies its nozzles into:
//   - matched:        filed price exists AND matches live price (count only)
//   - mismatches[]:   filed price exists AND differs from live price
//   - unlistedItems[]: no filed actual_price yet (station hasn't been priced)
// Both mismatches and unlistedItems are returned as full items so the panel
// can list each individual nozzle, not just a count.
function collectPriceMismatches() {
    const filterState = (typeof window !== 'undefined' && window._filterState) || {};
    const productFilter = filterState.product || 'all';

    const mismatches = [];
    const unlistedItems = [];
    let matched = 0;
    document.querySelectorAll('.app-dispenser-card').forEach(card => {
        // Hidden by city/station/connection/address/product — skip cards the
        // page filter is already excluding.
        if (!card.offsetParent) return;

        const nozzles = card._dispenserNozzles || [];
        const dispenser = card._dispenserData || {};
        nozzles.forEach(n => {
            const product = String(n.product || '').toUpperCase();
            if (productFilter !== 'all' && product !== productFilter) return;

            const filed = Number(n.actual_price);
            const live = Number(n.price_per_liter);
            const baseItem = {
                nozzle_id: n.nozzle_id,
                product,
                customer_code: dispenser.customer_code,
                dispenser_id: dispenser.dispenser_id
            };
            if (!Number.isFinite(filed) || filed <= 0) {
                unlistedItems.push({ ...baseItem, type: 'unlisted', live: Number.isFinite(live) ? live : null });
                return;
            }
            if (!Number.isFinite(live)) {
                unlistedItems.push({ ...baseItem, type: 'unlisted', live: null });
                return;
            }
            if (priceKey1dp(filed) === priceKey1dp(live)) {
                matched++;
                return;
            }
            mismatches.push({ ...baseItem, type: 'mismatch', filed, live });
        });
    });
    return { mismatches, unlistedItems, matched };
}

// Render a single nozzle row inside one of the alarm sub-lists.
function _renderNozzleAlarmItem(m, onDismiss) {
    const item = document.createElement('div');
    Object.assign(item.style, {
        position: 'relative',
        padding: '6px 26px 6px 8px',  // right padding leaves room for dismiss
        border: '1px solid var(--border)',
        borderRadius: '4px',
        marginBottom: '4px',
        cursor: 'pointer',
        background: 'var(--bg-surface-2, var(--bg-surface))'
    });

    const top = document.createElement('div');
    top.style.fontWeight = '600';
    top.textContent = `${m.nozzle_id} · ${m.product}`;

    const detail = document.createElement('div');
    detail.style.fontSize = '11px';
    detail.style.color = 'var(--text-secondary)';
    detail.style.marginTop = '2px';
    if (m.type === 'unlisted') {
        const livePart = m.live != null ? ` ·  Live ${m.live.toFixed(2)}` : '';
        detail.textContent = `Station ${m.customer_code}${livePart}  ·  No filed price`;
    } else {
        detail.textContent = `Station ${m.customer_code}  ·  Live ${m.live.toFixed(2)} → Filed ${m.filed.toFixed(2)}`;
    }

    item.appendChild(top);
    item.appendChild(detail);

    // Dismiss (×) button — stops propagation so it doesn't also scroll.
    const dismiss = document.createElement('button');
    dismiss.textContent = '×';
    dismiss.title = 'Dismiss';
    Object.assign(dismiss.style, {
        position: 'absolute',
        top: '4px',
        right: '4px',
        width: '20px',
        height: '20px',
        lineHeight: '18px',
        padding: '0',
        border: 'none',
        background: 'transparent',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: '16px',
        fontWeight: '700',
        borderRadius: '3px'
    });
    dismiss.addEventListener('mouseover', () => dismiss.style.background = 'var(--bg-surface, transparent)');
    dismiss.addEventListener('mouseout', () => dismiss.style.background = 'transparent');
    dismiss.addEventListener('click', (e) => {
        e.stopPropagation();
        _dismissedMismatches.add(m.nozzle_id);
        if (typeof onDismiss === 'function') onDismiss();
    });
    item.appendChild(dismiss);

    item.addEventListener('click', () => scrollToNozzle(m));
    return item;
}

function renderPriceAlarms(container, { mismatches, unlistedItems }, onChange) {
    container.innerHTML = '';

    if (mismatches.length === 0 && unlistedItems.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Nothing to flag.';
        empty.style.color = 'var(--badge-online-text)';
        empty.style.padding = '8px 4px';
        container.appendChild(empty);
        return;
    }

    const subHeader = (text, color) => {
        const h = document.createElement('div');
        h.textContent = text;
        h.style.fontSize = '11px';
        h.style.fontWeight = '700';
        h.style.textTransform = 'uppercase';
        h.style.letterSpacing = '0.5px';
        h.style.color = color;
        h.style.margin = '8px 0 4px';
        return h;
    };

    if (mismatches.length > 0) {
        container.appendChild(subHeader(`Mismatches (${mismatches.length})`, 'var(--badge-reset-text)'));
        mismatches.forEach(m => container.appendChild(_renderNozzleAlarmItem(m, onChange)));
    }

    if (unlistedItems.length > 0) {
        container.appendChild(subHeader(`Unlisted (${unlistedItems.length})`, 'var(--text-secondary)'));
        unlistedItems.forEach(m => container.appendChild(_renderNozzleAlarmItem(m, onChange)));
    }
}

function scrollToNozzle({ nozzle_id }) {
    // nozzle_id is "<D-address>-<suffix>" — globally unique because the
    // address is. Pull the card via its D-address prefix.
    const dispenserTopic = nozzle_id.split('-')[0];
    const card = document.getElementById(`dispenser-${dispenserTopic}`);
    if (!card) return;

    // Force materialize so the nozzle <div> exists even if the card was
    // off-screen and lazy.
    if (typeof card._materialize === 'function') card._materialize();

    // Center the card first (helps the user see context); after a brief
    // delay (so layout settles after materialize), center the nozzle and
    // pulse it so the click target is obvious.
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
        const el = document.getElementById(`nozzle-${nozzle_id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prevOutline = el.style.outline;
        const prevOffset = el.style.outlineOffset;
        const prevTransition = el.style.transition;
        el.style.transition = 'outline-color 0.4s ease';
        el.style.outline = '3px solid var(--accent, #FFB300)';
        el.style.outlineOffset = '4px';
        setTimeout(() => {
            el.style.outline = prevOutline;
            el.style.outlineOffset = prevOffset;
            el.style.transition = prevTransition;
        }, 1800);
    }, 350);
}

// Driven by sendGetCommandsForDispenser
function beginGetDataLog(dispenser) {
    const panel = document.getElementById('alarms-panel');
    if (!panel || !panel._getDataSection) return null;
    if (typeof panel._expand === 'function') panel._expand();

    const container = panel._getDataSection;
    container.innerHTML = '';  // keep only the latest run

    const card = document.createElement('div');
    Object.assign(card.style, {
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '8px',
        marginTop: '10px',
        background: 'var(--bg-surface-2, var(--bg-surface))',
        fontSize: '12px'
    });

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.justifyContent = 'space-between';
    titleRow.style.alignItems = 'baseline';
    titleRow.style.gap = '8px';
    titleRow.style.marginBottom = '6px';

    const title = document.createElement('div');
    title.textContent = `GET Data · ${dispenser.address || dispenser.dispenser_id || ''}`;
    title.style.fontWeight = '700';
    title.style.color = 'var(--text-heading)';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    title.style.whiteSpace = 'nowrap';

    const status = document.createElement('div');
    status.textContent = 'Fetching data…';
    status.style.color = 'var(--text-secondary)';
    status.style.fontSize = '11px';
    status.style.flexShrink = '0';

    titleRow.appendChild(title);
    titleRow.appendChild(status);
    card.appendChild(titleRow);

    const rows = document.createElement('div');
    card.appendChild(rows);

    container.appendChild(card);

    // Add one "<what was published>" row; returns setters to move it through its
    // states as the reply (or timeout) resolves.
    const addRow = (label) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '8px',
            padding: '3px 0',
            borderTop: '1px solid var(--border)'
        });

        const left = document.createElement('span');
        left.textContent = label;
        left.style.color = 'var(--text-secondary)';
        left.style.whiteSpace = 'nowrap';

        const right = document.createElement('span');
        right.textContent = '…';
        right.style.textAlign = 'right';
        right.style.overflow = 'hidden';
        right.style.textOverflow = 'ellipsis';

        row.appendChild(left);
        row.appendChild(right);
        rows.appendChild(row);

        const set = (text, color, weight) => {
            right.textContent = text;
            right.style.color = color;
            right.style.fontWeight = weight;
        };

        return {
            setWaiting() { set('waiting…', 'var(--text-secondary)', '400'); },
            setError(msg) { set(msg || 'publish failed', 'var(--badge-reset-text)', '600'); },
            setReply(value) {
                const v = (value === null || value === undefined || value === '') ? '' : String(value);
                set(v ? `✓ ${v}` : '✓', 'var(--badge-online-text)', '600');
            },
            setNoReply() { set('no reply', 'var(--badge-reset-text)', '600'); }
        };
    };

    return {
        addRow,
        setStatus(text) { status.textContent = text; },
        finish(text, ok) {
            status.textContent = text;
            status.style.color = ok ? 'var(--badge-online-text)' : 'var(--badge-reset-text)';
        }
    };
}

window.createAlarmsPanel = createAlarmsPanel;
window.beginGetDataLog = beginGetDataLog;
