// Same-origin: the Node server serves both this HTML/JS and /api/* on a
// single port (see backend/server.js + .env PORT). A relative URL means
// the frontend works on whatever host:port it was loaded from.
const API_BASE_URL = '/api';

// Auto-attach the auth token to every API_BASE_URL request so the backend
// can identify the user on each call. Without this, only signin/signout
// (which set the header explicitly) get logged with username/role.
(function attachAuthHeaderToApiFetch() {
    if (typeof window === 'undefined' || !window.fetch) return;
    const originalFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            if (url.startsWith(API_BASE_URL)) {
                const token = localStorage.getItem('authToken');
                if (token) {
                    init = init || {};
                    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
                    if (!headers.has('Authorization')) {
                        headers.set('Authorization', `Bearer ${token}`);
                    }
                    init.headers = headers;
                }
            }
        } catch (_) { /* never break fetch */ }
        return originalFetch(input, init);
    };
})();

const pages = {};

const userRoles = ['super_admin', 'admin', 'operator', 'viewer'];

const NOZZLE_LAYOUTS = {
    FULL: 'full',      // Full layout with all metrics (for main page)
    SUMMARY: 'summary'  // Summary layout with limited info (for overview page)
};

const productColorConfig = {
      'PMG': { header: '#FF7043', accent: '#FFCCBC' }, // Coral, Peach
      'HSD': { header: '#FFB300', accent: '#FFE0B2' }, // Amber, Golden
      'HOBC': { header: '#1E88E5', accent: '#90CAF9' } // Terracotta, Beige
    };

// The canonical product list, derived from productColorConfig so products are
// defined in exactly one place. Used by the dispenser-config and filter UIs.
const PRODUCT_OPTIONS = Object.keys(productColorConfig);

const DASHBOARD_REFRESH_MS = 30 * 1000;

// Dispenser address normalization. Canonical form is D-prefixed (e.g. "D01").
// Helpers tolerate either input so legacy code paths and legacy API payloads
// keep working through the transition.
function ensureDAddress(addr) {
    if (addr == null) return addr;
    const s = String(addr);
    if (s === '') return s;
    return s.startsWith('D') ? s : `D${s}`;
}

function stripDAddress(addr) {
    return String(addr ?? '').replace(/^D/, '');
}

// Title-case a string: "karachi city" -> "Karachi City". Used by filter
// dropdowns and CSV/table rendering across pages.
function titleCase(s) {
    return (s || '').split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

// Shared number/currency formatters (dashboard KPIs, station header, etc.).
function formatCount(value) {
    return (Number(value) || 0).toLocaleString();
}
function formatCurrencyFull(value) {
    return 'Rs ' + (Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Wire an (already-created and styled) button as a theme toggle: paints its
// ☀/☽ icon + title from the current theme, flips AppTheme on click, and keeps
// in sync with external 'themechange' events. Used by the topbar and signin.
function wireThemeToggle(btn, { aria = false } = {}) {
    const setIcon = () => {
        const isDark = window.AppTheme && window.AppTheme.get() === 'dark';
        btn.textContent = isDark ? '☀' : '☽';
        btn.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
        if (aria) btn.setAttribute('aria-label', btn.title);
    };
    setIcon();
    btn.addEventListener('click', () => {
        if (window.AppTheme) window.AppTheme.toggle();
        setIcon();
    });
    window.addEventListener('themechange', setIcon);
    return btn;
}

function applyInputStyles(el) {
    el.style.padding = '8px';
    el.style.border = '1px solid var(--border)';
    el.style.backgroundColor = 'var(--bg-surface)';
    el.style.color = 'var(--text-primary)';
    el.style.borderRadius = '4px';
    return el;
}

// Build an <input> with standard styling. Pass any of {type, value,
// placeholder, required, name}.
function createTextInput(opts = {}) {
    const input = document.createElement('input');
    input.type = opts.type || 'text';
    if (opts.value != null) input.value = opts.value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.required) input.required = true;
    if (opts.name) input.name = opts.name;
    return applyInputStyles(input);
}

function createDateInput(value = '') {
    return createTextInput({ type: 'date', value });
}

// Flex column ("stack") with optional gap.
function createFlexColumn(gap = '5px') {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = gap;
    return el;
}

// Flex row with optional gap/justify/align.
function createFlexRow({ gap = '10px', justify, align, wrap } = {}) {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.gap = gap;
    if (justify) el.style.justifyContent = justify;
    if (align) el.style.alignItems = align;
    if (wrap) el.style.flexWrap = wrap;
    return el;
}

// Label + control wrapped in a flex column. `required` appends "*".
// Returns the wrapper; the control is whatever was passed in (input,
// select, etc.) so the caller can still hold a reference to it.
function createLabeledField({ label, control, required = false, gap = '5px', marginTop }) {
    const wrap = createFlexColumn(gap);
    if (marginTop) wrap.style.marginTop = marginTop;
    if (label) {
        const lab = document.createElement('label');
        lab.textContent = required ? `${label} *` : label;
        lab.style.fontWeight = 'bold';
        wrap.appendChild(lab);
    }
    if (control) wrap.appendChild(control);
    return wrap;
}

// Append a single styled <td> with text. Returns the cell so callers can
// tweak further if they need to.
function appendCell(tr, text, opts = {}) {
    const td = document.createElement('td');
    td.style.padding = opts.padding || '12px';
    if (opts.verticalAlign) td.style.verticalAlign = opts.verticalAlign;
    if (opts.maxWidth) td.style.maxWidth = opts.maxWidth;
    if (text instanceof Node) {
        td.appendChild(text);
    } else {
        td.textContent = text == null || text === '' ? '-' : text;
    }
    tr.appendChild(td);
    return td;
}

// Batch-append cells from an array of values (strings, numbers, or DOM nodes).
function appendCells(tr, values, opts) {
    values.forEach(v => appendCell(tr, v, opts));
}

// Standard table row with bottom border. Pass values to fill cells in one shot.
function createTableRow(values) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    if (Array.isArray(values)) appendCells(tr, values);
    return tr;
}

function renderApp(pageTitle) {
    const app = document.getElementById('app');
    app.innerHTML = `
        <div id="topbar"></div>
        <div id="sidebar"></div>
        <div class="content-wrapper" id="content"></div>
    `;
    renderTopbar(pageTitle);
    renderSidebar();
}

async function loadStationsFromDB() {
    try {
        const response = await fetch(`${API_BASE_URL}/stations`);
        if (!response.ok) throw new Error('Failed to fetch stations');
        return await response.json();
    } catch (error) {
        console.error('Error loading stations:', error);
        return [];
    }
}

async function loadUsersFromDB() {
    try {
        const response = await fetch(`${API_BASE_URL}/users`);
        if (!response.ok) throw new Error('Failed to fetch users');
        return await response.json();
    } catch (error) {
        console.error('Error loading users:', error);
        return [];
    }
}

function createCloseButton(overlay) {
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.className = 'modal-close-button';
    closeButton.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });
    return closeButton;
}

function createModalOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
    return overlay;
}

function dragPopup(overlay, popup, centerPopupVertically = true) {
    document.body.appendChild(popup);

    function centerPopup() {
        const initialX = (window.innerWidth - popup.offsetWidth) / 2;
        const initialY = (window.innerHeight - popup.offsetHeight) / 2;
        popup.style.left = `${initialX}px`;
        popup.style.top = `${initialY}px`;
        return { x: initialX, y: initialY };
    }

    requestAnimationFrame(() => {
        let position = centerPopupVertically ? centerPopup() : { 
            x: (window.innerWidth - popup.offsetWidth) / 2,
            y: parseFloat(popup.style.top) || 0
        };

        let currentX = position.x;
        let currentY = position.y;
        let isDragging = false;
        let initialXOffset = 0;
        let initialYOffset = 0;

        popup.addEventListener('mousedown', (e) => {
            isDragging = true;
            initialXOffset = e.clientX - currentX;
            initialYOffset = e.clientY - currentY;
            popup.style.cursor = 'move';
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialXOffset;
                currentY = e.clientY - initialYOffset;
                currentX = Math.max(0, Math.min(currentX, window.innerWidth - popup.offsetWidth));
                currentY = Math.max(0, Math.min(currentY, window.innerHeight - popup.offsetHeight));
                popup.style.left = `${currentX}px`;
                popup.style.top = `${currentY}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            popup.style.cursor = 'default';
        });

        if (centerPopupVertically) {
            const resizeObserver = new ResizeObserver(() => {
                if (!isDragging) {
                    position = centerPopup();
                    currentX = position.x;
                    currentY = position.y;
                }
            });
            resizeObserver.observe(popup);
        }
    });

    overlay.appendChild(popup);
    document.body.appendChild(overlay);
    
    return popup;
}

function renderMainContainer(pageTitle) {
    const mainContainer = document.createElement('div');
    mainContainer.className = 'main-container';
    
    const mainHeader = document.createElement('div');
    mainHeader.className = 'main-header';
    const title = document.createElement('h2');
    title.textContent = pageTitle;
    mainHeader.appendChild(title);
    mainContainer.appendChild(mainHeader);

    return { mainHeader, mainContainer };
}

function createHeader(){
    const header = document.createElement('div');
    header.style.paddingBottom = '5px';
    header.style.borderBottom = '2px solid var(--accent)';
    header.style.marginBottom = '15px';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    return header;
}

// Common title creation function
function createTitle() {
    const title = document.createElement('h2');
    title.style.color = 'var(--text-heading)';
    title.style.margin = '0';
    title.style.fontSize = '18px';

    return title;
}

function createLink() {
    const link = document.createElement('div');
    link.style.fontSize = '16px';
    link.style.color = 'var(--link)';
    link.style.cursor = 'pointer';
    link.style.transition = 'text-decoration 0.2s ease';
    link.style.textAlign = 'center';

    link.addEventListener('mouseover', () => {
        link.style.textDecoration = 'underline';
    });
    
    link.addEventListener('mouseout', () => {
        link.style.textDecoration = 'none';
    });

    return link;
}

function createActionButton(mainColor, hoverColor) {
    const button = document.createElement('button');
    button.className = 'action-button';
    button.style.backgroundColor = mainColor || '#004D64';

    button.addEventListener('mouseover', () => {
        button.style.backgroundColor = hoverColor || '#00324C';
    });

    button.addEventListener('mouseout', () => {
        button.style.backgroundColor = mainColor || '#004D64';
    });

    return button;
}

function createMainButton() {
    const button = createActionButton('#004D64', '#00324C');
    button.style.borderRadius = '8px';
    button.style.padding = '12px 16px';
    button.style.marginLeft = '10px';
    button.style.width = '120px';
    button.style.fontSize = '15px';
    button.style.boxShadow = '0 4px 4px rgba(0,0,0,0.4)';

    return button;
};


// Function to create no data message
function createNoDataMessage(message) {
    const noData = document.createElement('div');
    noData.textContent = message;
    noData.style.color = 'var(--text-secondary)';
    noData.style.textAlign = 'center';
    noData.style.padding = '20px';
    return noData;
}

function makeTableSortable(table) {
    if (!table || table._sortableWired) return;
    const headRow = table.tHead && table.tHead.rows[0];
    const tbody = table.tBodies && table.tBodies[0];
    if (!headRow || !tbody) return;
    table._sortableWired = true;

    const ths = Array.from(headRow.cells);
    let sortCol = null;
    let sortDir = 1; // 1 = ascending, -1 = descending

    const cellValue = (row, ci) => {
        const cell = row.cells[ci];
        if (!cell) return '';
        const ds = cell.dataset ? cell.dataset.sort : null;
        return ds != null ? ds : cell.textContent.trim();
    };

    const apply = () => {
        const rows = Array.from(tbody.rows);
        rows.sort((a, b) =>
            String(cellValue(a, sortCol)).localeCompare(
                String(cellValue(b, sortCol)), undefined,
                { numeric: true, sensitivity: 'base' }) * sortDir);
        const frag = document.createDocumentFragment();
        rows.forEach(r => frag.appendChild(r));
        tbody.appendChild(frag);
        ths.forEach((th, ci) => {
            if (th.dataset.noSort) return;
            const arrow = ci === sortCol ? (sortDir === 1 ? '  ▲' : '  ▼') : '';
            th.textContent = th.dataset.sortLabel + arrow;
        });
    };

    ths.forEach((th, ci) => {
        if (th.dataset.noSort) return;
        th.dataset.sortLabel = th.textContent; // base label, sans arrow
        th.classList.add('sortable-th');
        th.addEventListener('click', () => {
            if (sortCol === ci) sortDir = -sortDir;
            else { sortCol = ci; sortDir = 1; }
            apply();
        });
    });
}
window.makeTableSortable = makeTableSortable;

function createTable(columns) {
    const tableContainer = document.createElement('div');
    tableContainer.className = 'app-table-container';
    tableContainer.style.backgroundColor = 'var(--bg-surface)';
    tableContainer.style.borderRadius = '5px';
    tableContainer.style.border = '1px solid var(--border)';
    tableContainer.style.boxShadow = 'var(--shadow-card)';
    tableContainer.style.overflow = 'hidden';

    const table = document.createElement('table');
    table.className = 'app-table';
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.fontFamily = 'Arial, sans-serif';
    table.style.fontSize = '14px';
    table.style.color = 'var(--text-primary)';

    const thead = document.createElement('thead');

    const headerRow = document.createElement('tr');
    headerRow.style.backgroundColor = 'var(--bg-table-head)';
    columns.forEach(headerText => {
        const th = document.createElement('th');
        th.style.padding = '12px';
        th.style.textAlign = 'left';
        th.style.borderBottom = '1px solid var(--border)';
        th.style.fontWeight = '600';
        th.style.color = 'var(--text-primary)';
        th.textContent = headerText;
        // Action/button columns (and blank headers) carry no sortable value.
        const label = String(headerText || '').trim().toLowerCase();
        if (label === '' || label === 'actions') th.dataset.noSort = '1';
        headerRow.appendChild(th);
    });
    headerRow.lastChild.style.borderRight = 'none';

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'dispenser-table-body';
    table.appendChild(tbody);

    tableContainer.appendChild(table);

    // Every createTable-based table gets click-to-sort headers for free. Rows
    // are read live on click, so this is fine even though callers add them after.
    makeTableSortable(table);

    return { tableContainer , tbody };
}

// Escape HTML special characters for safe interpolation into innerHTML. Shared
// by the searchable dropdown, dashboard alerts, donut/legend rendering, etc.
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

/**
 * Searchable dropdown styled with .filter-search-wrap.
 * This is the canonical helper for every filter/search combobox in the app —
 * use it instead of hand-rolling another filter-search-wrap.
 *
 * @param {Object}    opts
 * @param {string}    opts.placeholder
 * @param {string}   [opts.width]               CSS width, e.g. "200px"
 * @param {Array|Function} opts.items           [{ value, label, secondary?, search? }] or a function
 *                                                returning that array. Pass a function when the
 *                                                source data can change after construction (so the
 *                                                option list stays in sync on each open/keypress).
 *                                                secondary: optional second line in the option row
 *                                                search:    extra strings included in the match
 * @param {string}   [opts.initialQuery=""]     initial text in the input
 * @param {boolean}  [opts.bgWhite=false]       adds .bg-white modifier
 * @param {string}   [opts.emptyText="No matches"]
 * @param {number}   [opts.maxResults=50]
 * @param {Function} [opts.onInput]             (query) => void  — fires while typing
 * @param {Function} [opts.onSelect]            (value, item) => void  — fires when a row is picked
 *
 * @returns {{
 *   wrap: HTMLElement,
 *   input: HTMLInputElement,
 *   setItems: (items: Array) => void,
 *   setQuery: (q: string) => void,
 *   getQuery: () => string,
 *   close: () => void
 * }}
 */
function createSearchableDropdown(opts) {
    const {
        placeholder = '',
        width,
        items: initialItems = [],
        initialQuery = '',
        bgWhite = false,
        emptyText = 'No matches',
        maxResults = 50,
        onInput,
        onSelect
    } = opts || {};

    // items can be an array (static) or a function (re-read on every render).
    let itemsSource = initialItems;
    const currentItems = () => typeof itemsSource === 'function' ? (itemsSource() || []) : (itemsSource || []);

    const wrap = document.createElement('div');
    wrap.className = bgWhite ? 'filter-search-wrap bg-white' : 'filter-search-wrap';
    if (width) wrap.style.width = width;

    const icon = document.createElement('img');
    icon.className = 'filter-search-icon';
    icon.src = 'assets/graphics/search-icon.svg';
    icon.alt = '';
    wrap.appendChild(icon);

    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'filter-search';
    input.style.height = '38px';
    input.style.borderRadius = '6px';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.value = initialQuery;

    const dropdown = document.createElement('div');
    dropdown.className = 'filter-search-dropdown';
    dropdown.hidden = true;

    const close = () => { dropdown.hidden = true; };
    const open = () => { renderOptions(); dropdown.hidden = false; };

    function matches(query) {
        const q = (query || '').trim().toLowerCase();
        const list = currentItems();
        if (!q) return list.slice(0, maxResults);
        return list.filter(it => {
            if ((it.label || '').toLowerCase().includes(q)) return true;
            if ((it.secondary || '').toLowerCase().includes(q)) return true;
            if (Array.isArray(it.search)) {
                for (const extra of it.search) {
                    if ((extra || '').toString().toLowerCase().includes(q)) return true;
                }
            }
            return false;
        }).slice(0, maxResults);
    }

    function renderOptions() {
        const results = matches(input.value);
        dropdown.innerHTML = '';
        if (results.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'filter-search-empty';
            empty.textContent = emptyText;
            dropdown.appendChild(empty);
            return;
        }
        results.forEach(item => {
            const row = document.createElement('div');
            row.className = 'filter-search-option';
            const codePart = `<span class="opt-code">${escapeHtml(item.label || '')}</span>`;
            const subPart = item.secondary
                ? `<span class="opt-name">${escapeHtml(item.secondary)}</span>`
                : '';
            row.innerHTML = codePart + subPart;
            // mousedown so picking fires before the input's blur handler closes us.
            row.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = item.label || '';
                close();
                if (typeof onSelect === 'function') onSelect(item.value, item);
            });
            dropdown.appendChild(row);
        });
    }

    input.addEventListener('input', () => {
        renderOptions();
        dropdown.hidden = false;
        if (typeof onInput === 'function') onInput(input.value);
    });
    input.addEventListener('focus', open);
    input.addEventListener('blur', () => { setTimeout(close, 120); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); input.blur(); }
    });

    wrap.appendChild(input);
    wrap.appendChild(dropdown);

    return {
        wrap,
        input,
        setItems(newItems) {
            itemsSource = newItems || [];
            if (!dropdown.hidden) renderOptions();
        },
        setQuery(q) { input.value = q || ''; },
        getQuery() { return input.value; },
        close
    };
}

/**
 * Create a centered spinner + label element that callers can append while data
 * is being fetched, then remove() once the content is ready.
 *
 * Usage:
 *   const loader = createPageLoader();
 *   content.appendChild(loader);
 *   // ... await fetches ...
 *   loader.remove();
 */
function createPageLoader(message = 'Loading…') {
    const wrap = document.createElement('div');
    wrap.className = 'page-loader';

    const spinner = document.createElement('div');
    spinner.className = 'page-loader-spinner';
    wrap.appendChild(spinner);

    const label = document.createElement('div');
    label.textContent = message;
    wrap.appendChild(label);

    return wrap;
}

function createDropdown(placeholderText) {
    const dropdown = document.createElement('select');
    dropdown.style.padding = '8px';
    dropdown.style.border = '1px solid var(--border)';
    dropdown.style.borderRadius = '6px';
    dropdown.style.width = '100%';
    dropdown.style.marginBottom = '20px';
    dropdown.style.backgroundColor = 'var(--bg-surface)';
    dropdown.style.color = 'var(--text-primary)';

    if (placeholderText != null) {
        const placeholderOption = createPlaceholder(placeholderText);
        dropdown.appendChild(placeholderOption);
    }
    return dropdown;
}

function createPlaceholder(text) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = text;
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.style.color = 'var(--text-secondary)';

    return placeholder;
}

// Wrap a native <select> with a typeable combobox while keeping the <select>
// as the data model. All existing reads (.value, .options, .selectedOptions)
// and 'change' listeners continue to work; programmatic .value writes are
// intercepted so the visible input stays in sync, and option mutations are
// observed so cascading repopulation reflects in the dropdown automatically.
function enhanceSelectAsSearchable(selectEl, opts = {}) {
    if (!selectEl || selectEl.dataset.searchableEnhanced === '1') return;
    selectEl.dataset.searchableEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'searchable-select-wrap';
    if (selectEl.style.width) wrap.style.width = selectEl.style.width;
    if (selectEl.style.marginBottom) wrap.style.marginBottom = selectEl.style.marginBottom;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'searchable-select-input';
    input.autocomplete = 'off';

    const list = document.createElement('div');
    list.className = 'searchable-select-list';
    list.hidden = true;

    const parent = selectEl.parentNode;
    if (parent) parent.insertBefore(wrap, selectEl);
    wrap.appendChild(input);
    wrap.appendChild(list);
    wrap.appendChild(selectEl);
    selectEl.style.display = 'none';

    function getPlaceholderText() {
        if (opts.placeholder) return opts.placeholder;
        const ph = Array.from(selectEl.options).find(o => o.disabled);
        return (ph && ph.textContent) || (selectEl.options[0]?.textContent) || 'Select…';
    }

    function syncInputFromSelect() {
        input.placeholder = getPlaceholderText();
        const sel = selectEl.selectedOptions[0];
        input.value = (sel && !sel.disabled) ? (sel.textContent || '') : '';
    }

    function pickOption(opt) {
        selectEl.value = opt.value;
        input.value = opt.textContent || '';
        list.hidden = true;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderList(filter = '') {
        const q = (filter || '').trim().toLowerCase();
        list.innerHTML = '';
        const matches = [];
        for (const opt of selectEl.options) {
            if (opt.disabled) continue;
            const label = (opt.textContent || '').toLowerCase();
            const value = (opt.value || '').toLowerCase();
            if (!q || label.includes(q) || value.includes(q)) matches.push(opt);
        }
        if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'searchable-select-empty';
            empty.textContent = 'No matches';
            list.appendChild(empty);
            return;
        }
        matches.forEach(opt => {
            const item = document.createElement('div');
            item.className = 'searchable-select-item';
            if (opt.value === selectEl.value) item.classList.add('selected');
            item.textContent = opt.textContent || '';
            // mousedown so picking fires before the input's blur handler closes us.
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                pickOption(opt);
            });
            list.appendChild(item);
        });
    }

    input.addEventListener('focus', () => {
        input.select();
        renderList('');
        list.hidden = false;
    });
    input.addEventListener('input', () => {
        renderList(input.value);
        list.hidden = false;
    });
    input.addEventListener('blur', () => {
        setTimeout(() => {
            list.hidden = true;
            syncInputFromSelect();
        }, 140);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            list.hidden = true;
            input.blur();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const q = input.value.trim().toLowerCase();
            const first = Array.from(selectEl.options).find(o =>
                !o.disabled && ((o.textContent || '').toLowerCase().includes(q) ||
                                (o.value || '').toLowerCase().includes(q))
            );
            if (first) pickOption(first);
        }
    });

    // Intercept programmatic .value writes so the visible input stays in sync.
    const baseDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    if (baseDesc && baseDesc.get && baseDesc.set) {
        Object.defineProperty(selectEl, 'value', {
            configurable: true,
            enumerable: true,
            get() { return baseDesc.get.call(this); },
            set(v) {
                baseDesc.set.call(this, v);
                syncInputFromSelect();
            }
        });
    }

    // Cascading code calls innerHTML='' + appendChild(opt) — observe and re-sync.
    const observer = new MutationObserver(() => syncInputFromSelect());
    observer.observe(selectEl, { childList: true });

    syncInputFromSelect();
}

async function updateConnStatus(deviceId, connStatus, connected_at, deviceType = 'dispenser') {
    let deviceCard;

    if (deviceType === 'dispenser') {
        deviceCard = document.querySelector(`div[data-address="${deviceId}"]`);
    }

    if (deviceCard) {
        const connStatusText = deviceCard.querySelector('.conn-status');
        const uptime = deviceCard.querySelector('.uptime');

        connStatusText.style.background = connStatus === 1 ? 'var(--badge-online-bg)' : 'var(--badge-offline-bg)';
        connStatusText.style.color = connStatus === 1 ? 'var(--badge-online-text)' : 'var(--badge-offline-text)';
        connStatusText.style.fontWeight = '500';
        connStatusText.style.padding = '4px 10px';
        connStatusText.style.borderRadius = '20px';
        connStatusText.style.fontSize = '14px';
        connStatusText.style.width = 'fit-content';
        connStatusText.textContent = connStatus === 1 ? 'CONNECTED' : 'DISCONNECTED';  
        
        const connectedTime = new Date(connected_at).toLocaleString();
        
        if (connStatus === 1 && connected_at) {            
            uptime.textContent = `At: ${connectedTime}`;
        } 
        else {
            uptime.textContent = `At: ${connectedTime}`;
        }
    } else {
        console.error(`❌ Device card not found for ${deviceType} with ID: ${deviceId}`);
    }
}

// Build a click-to-open count indicator (hidden icon + pill badge) for a
// dispenser card. The error and reset badges are identical apart from their
// classes, icon, colors and target popup tab. Returns { container, setCount }.
function _buildCountIndicator({ containerClass, spanClass, iconSrc, iconAlt, textVar, bgVar, address, popupTab }) {
    const container = document.createElement('div');
    container.className = containerClass;
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.style.cursor = 'pointer';

    const icon = createIconFromImage(iconSrc, iconAlt, '18px');
    icon.style.display = 'none';

    const span = document.createElement('span');
    span.className = spanClass;
    span.style.fontSize = '13px';
    span.style.fontWeight = 'bold';
    span.style.color = textVar;
    span.style.backgroundColor = bgVar;
    span.style.padding = '2px 8px';
    span.style.borderRadius = '12px';
    span.style.display = 'none';

    container.appendChild(icon);
    container.appendChild(span);
    container.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof window.showDevStatusPopup === 'function') {
            window.showDevStatusPopup(address, popupTab);
        }
    });

    return { container, setCount: count => _applyBadgeCount(icon, span, count) };
}

// opts: { dispenserId, brand } — when supplied, the card title reads
// "Dispenser ID: <x>" (styled small, like the brand) and the prominent
// D-address moves into a floating tab that straddles the card's top edge.
async function createCard(address, customer_code, opts = {}) {
    const card = document.createElement('div');
    card.classList.add('app-dispenser-card');
    Object.assign(card.style, {
        position: 'relative',
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 'fit-content',
        width: 'fit-content',
        // Extra top padding leaves room for the floating address/brand tab that
        // straddles the card's top edge (built at the end of this function).
        padding: '24px 16px 16px',
        marginTop: '10px'
    });

    const titleContainer = document.createElement('div');
    titleContainer.style.display = 'flex';
    titleContainer.style.justifyContent = 'space-between';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.marginBottom = '5px';
    titleContainer.style.marginLeft = '5px';
    titleContainer.style.marginRight = '5px';
    titleContainer.style.position = 'relative';

    // Title: "Dispenser ID: <x>" when an id is supplied (small, same weight as
    // the brand). Otherwise fall back to the D-address in the original
    // prominent style.
    const titleText = document.createElement('h2');
    titleText.style.margin = '0';
    const hasDispId = opts.dispenserId != null && opts.dispenserId !== '';
    if (hasDispId) {
        titleText.textContent = `Dispenser: ${opts.dispenserId}`;
        titleText.style.fontSize = '16px';
        titleText.style.fontWeight = '500';
        titleText.style.color = 'var(--text-primary)';
    } else {
        titleText.textContent = 'N/A';
        titleText.style.fontSize = '17px';
    }

    const statusText = createLink();
    statusText.className = 'conn-status';
    statusText.textContent = 'Connecting...';
    statusText.style.color = 'var(--text-secondary)';
    statusText.title = 'Click to view details';
    // Add click handler
    statusText.addEventListener('click', () => {
        showDevStatusPopup(address);
    });

    // The status sits in a right-aligned group so callers can append adornments
    // (e.g. the dispenser refresh button) immediately to its right.
    const statusContainer = document.createElement('div');
    statusContainer.style.display = 'flex';
    statusContainer.style.alignItems = 'center';
    statusContainer.style.gap = '8px';
    statusContainer.appendChild(statusText);

    titleContainer.appendChild(titleText);
    titleContainer.appendChild(statusContainer);
    card.appendChild(titleContainer);

    const nextContainer = document.createElement('div');
    nextContainer.style.display = 'flex';
    nextContainer.style.justifyContent = 'space-between';
    nextContainer.style.alignItems = 'center';
    nextContainer.style.marginLeft = '5px';
    nextContainer.style.marginRight = '5px';

    // Errors and resets are hidden from operators
    const cardUserRole = window.StationAuth?.getUserInfo?.()?.role;
    const showErrorsAndResets = cardUserRole !== 'operator';

    // Left side container for errors and resets
    const leftContainer = document.createElement('div');
    leftContainer.style.display = 'flex';
    leftContainer.style.alignItems = 'center';
    leftContainer.style.gap = '15px';

    if (showErrorsAndResets) {
        const errorIndicator = _buildCountIndicator({
            containerClass: 'dispenser-error-container',
            spanClass: 'dispenser-error-count',
            iconSrc: 'assets/graphics/alert-icon.png',
            iconAlt: 'Errors',
            textVar: 'var(--badge-error-text)',
            bgVar: 'var(--badge-error-bg)',
            address,
            popupTab: 'errorLogs'
        });
        errorIndicator.setCount(await fetchErrorCount(address));

        const resetIndicator = _buildCountIndicator({
            containerClass: 'dispenser-reset-container',
            spanClass: 'dispenser-reset-count',
            iconSrc: 'assets/graphics/reset-icon.png',
            iconAlt: 'Resets',
            textVar: 'var(--badge-reset-text)',
            bgVar: 'var(--badge-reset-bg)',
            address,
            popupTab: 'resetLogs'
        });
        // Reset count is fetched without blocking card creation (prior behavior).
        (async () => { resetIndicator.setCount(await fetchResetCount(address)); })();

        leftContainer.appendChild(errorIndicator.container);
        leftContainer.appendChild(resetIndicator.container);
    }

    // Right side container for uptime
    const uptime = document.createElement('div');
    uptime.className = 'uptime';
    uptime.style.fontSize = '12px';
    uptime.style.color = 'var(--text-secondary)';
    uptime.style.textAlign = 'right';

    nextContainer.appendChild(leftContainer);
    nextContainer.appendChild(uptime);
    card.appendChild(nextContainer);

    // Floating tab straddling the top edge: "<D-address> | <brand>". The
    // D-address is the most prominent element on the card (light blue + bold,
    // 17px — the size the title used to be); the brand is smaller and in the
    // normal text colour, not blue.
    const tab = document.createElement('div');
    tab.className = 'dispenser-card-tab';
    Object.assign(tab.style, {
        position: 'absolute',
        top: '0',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '2',
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
        background: 'var(--bg-surface-2)',
        border: '2px solid var(--border)',
        borderRadius: '20px',
        padding: '4px 16px',
        whiteSpace: 'nowrap',
        boxShadow: 'var(--shadow-tag)'
    });

    const addrSpan = document.createElement('span');
    addrSpan.textContent = address;
    // Theme-aware: dark grey (#333, as before) in light theme, light blue
    // (#4fc3f7) in dark theme. Bold, 17px — same prominence as the old title.
    addrSpan.style.color = 'var(--dispenser-addr-color)';
    addrSpan.style.fontWeight = '700';
    addrSpan.style.fontSize = '20px';
    tab.appendChild(addrSpan);

    const brandText = (opts.brand || '').toString().trim();
    if (brandText) {
        const sep = document.createElement('span');
        sep.textContent = '|';
        sep.style.fontSize = '16px';
        sep.style.color = 'var(--text-secondary)';
        const brandSpan = document.createElement('span');
        brandSpan.textContent = brandText;
        brandSpan.style.color = 'var(--text-primary)';
        brandSpan.style.fontWeight = '500';
        brandSpan.style.fontSize = '16px';
        tab.appendChild(sep);
        tab.appendChild(brandSpan);
    }

    card.appendChild(tab);

    return { card, titleContainer, statusContainer };
}

// Remark/comment block shown below a dispenser's nozzle cards. Shows the latest
// remark inline (text + time) for every role, plus a link that opens the
// device-status popup on its "Remarks" tab — where the full archived timeline
// (with author + IP) lives and, for admin / super_admin, the add-remark box.
// The latest value comes from the dispenser row already returned by
// /api/dispensers[-full]. Returns a DOM node the card builders append after the
// nozzle grid.
function buildDispenserRemarkSection(dispenser) {
    const role = window.StationAuth?.getUserInfo?.()?.role;
    const canEdit = role === 'admin' || role === 'super_admin';

    const wrap = document.createElement('div');
    wrap.className = 'dispenser-remark';
    Object.assign(wrap.style, {
        marginTop: '14px',
        paddingTop: '10px',
        borderTop: '1px solid var(--border-soft)'
    });

    // Header row: "Remark" label + link into the Remarks tab.
    const headRow = document.createElement('div');
    Object.assign(headRow.style, {
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: '6px'
    });
    const label = document.createElement('div');
    label.textContent = 'Remark';
    Object.assign(label.style, { fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' });
    const historyLink = document.createElement('span');
    historyLink.textContent = canEdit ? 'View / add remarks' : 'View history';
    Object.assign(historyLink.style, { fontSize: '12px', color: 'var(--link)', cursor: 'pointer' });
    historyLink.addEventListener('click', () => {
        if (typeof window.showDevStatusPopup === 'function') {
            window.showDevStatusPopup(ensureDAddress(dispenser.address), 'remarks');
        }
    });
    headRow.appendChild(label);
    headRow.appendChild(historyLink);
    wrap.appendChild(headRow);

    // Latest remark + when it was added (author/IP live in the Remarks tab).
    const current = document.createElement('div');
    Object.assign(current.style, {
        fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
    });
    const hasRemark = dispenser.remark && String(dispenser.remark).trim() !== '';
    current.textContent = hasRemark ? dispenser.remark : 'No remark added.';
    current.style.color = hasRemark ? 'var(--text-primary)' : 'var(--text-secondary)';
    current.style.fontStyle = hasRemark ? 'normal' : 'italic';
    wrap.appendChild(current);

    if (dispenser.remark_at) {
        const meta = document.createElement('div');
        Object.assign(meta.style, { fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' });
        const dt = new Date(dispenser.remark_at);
        meta.textContent = `Logged at: ${isNaN(dt.getTime()) ? dispenser.remark_at : dt.toLocaleString()}`;
        wrap.appendChild(meta);
    }

    return wrap;
}

// Re-render a card's inline remark block from fresh dispenser data. Called by
// the periodic refresh so a remark added via the popup (or by another user)
// shows up without a page reload.
function refreshDispenserRemarkSection(card, dispenser) {
    if (!card) return;
    const existing = card.querySelector('.dispenser-remark');
    if (existing) existing.replaceWith(buildDispenserRemarkSection(dispenser));
}

function createInterfaceStatusIndicator(dispenser) {
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '45%';
    container.style.transform = 'translateX(-25%)';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';

    const isKeypad = (dispenser.interface_type || '').toLowerCase() === 'keypad';
    const iconSrc = isKeypad ? 'assets/graphics/keypad-icon.png' : 'assets/graphics/ir-control-icon.png';
    const iconAlt = isKeypad ? 'Keypad' : 'IR Control';
    // Keypad icon sits inside a thin bordered box (visual cue distinguishing
    // it from the IR icon, which is rendered bare).
    const interfaceIcon = createIconFromImage(iconSrc, iconAlt, isKeypad ? '16px' : '20px');

    let iconNode = interfaceIcon;
    if (isKeypad) {
        const box = document.createElement('div');
        box.style.border = '1px solid var(--text-primary)';
        box.style.borderRadius = '4px';
        box.style.padding = '2px';
        box.style.display = 'flex';
        box.style.alignItems = 'center';
        box.style.justifyContent = 'center';
        box.appendChild(interfaceIcon);
        iconNode = box;
    }

    const lockIcon = createIconFromImage('assets/graphics/green-lock.png', null, '20px');
    lockIcon.className = 'interface-lock-icon';
    lockIcon.src = dispenser.interface_lock_status
        ? 'assets/graphics/green-lock.png'
        : 'assets/graphics/red-unlock.png';
    lockIcon.alt = dispenser.interface_lock_status ? 'Locked' : 'Unlocked';

    container.appendChild(iconNode);
    container.appendChild(lockIcon);
    return container;
}

function createRefreshConnStatusButton() {
    const role = window.StationAuth?.getUserInfo?.()?.role;
    if (role !== 'super_admin') return null;

    const btn = createMainButton();
    btn.textContent = 'Refresh Conn Status';
    btn.title = 'Re-subscribe to all conn_status topics and reset debounce timers';
    btn.style.width = 'auto';
    btn.style.padding = '12px 14px';

    btn.addEventListener('click', () => {
        const { overlay, confirmButton } = createDeletePopup(
            'Re-subscribe the server to all conn_status topics and clear the 30-minute disconnect-debounce timers?',
            {
                title: 'Refresh Connection Status',
                confirmText: 'Refresh',
                confirmColor: '#004D64',
                confirmHoverColor: '#00324C'
            }
        );

        confirmButton.onclick = async () => {
            document.body.removeChild(overlay);
            const original = btn.textContent;
            btn.disabled = true;
            btn.style.opacity = '0.6';
            btn.textContent = 'Refreshing…';
            try {
                const resp = await fetch(`${API_BASE_URL}/admin/refresh-conn-status`, { method: 'POST' });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    throw new Error(data.error || `HTTP ${resp.status}`);
                }
                window.showNotification?.(
                    `Conn-status refreshed — ${data.resubscribed} topics re-subscribed, ${data.timersCleared} timers cleared.`,
                    'success'
                );
            } catch (e) {
                console.error('refresh-conn-status failed:', e);
                window.showNotification?.(`Refresh failed: ${e.message}`, 'error')
                    ?? alert(`Refresh failed: ${e.message}`);
            } finally {
                btn.disabled = false;
                btn.style.opacity = '';
                btn.textContent = original;
            }
        };
    });
    return btn;
}

// Small popup menu anchored beneath an element. `items` is an array of
// { label, onClick }. Opens on hover (mouse) and on click/tap (touch); closes
// when the cursor leaves both the anchor and the menu, on outside-click, on
// Escape, or after an item is chosen. Generic — reusable for any per-element
// action menu.
function createAnchoredMenu(anchorEl, items) {
    let menu = null;

    const onDocClick = (e) => {
        if (menu && !menu.contains(e.target) && e.target !== anchorEl) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    const close = () => {
        if (!menu) return;
        menu.remove();
        menu = null;
        document.removeEventListener('click', onDocClick, true);
        document.removeEventListener('keydown', onKey);
    };

    const open = () => {
        if (menu) return;
        menu = document.createElement('div');
        Object.assign(menu.style, {
            position: 'fixed',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            boxShadow: 'var(--shadow-card)',
            padding: '4px',
            zIndex: '9000',
            display: 'flex',
            flexDirection: 'column',
            minWidth: '120px'
        });

        items.forEach(item => {
            const opt = document.createElement('button');
            opt.type = 'button';
            opt.textContent = item.label;
            Object.assign(opt.style, {
                background: 'none',
                border: 'none',
                textAlign: 'left',
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: '14px',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap'
            });
            opt.addEventListener('mouseover', () => { opt.style.background = 'var(--bg-sidebar-hover)'; });
            opt.addEventListener('mouseout', () => { opt.style.background = 'none'; });
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                close();
                item.onClick?.();
            });
            menu.appendChild(opt);
        });

        // Close when the cursor leaves the menu for anywhere but the anchor.
        menu.addEventListener('mouseleave', (e) => {
            if (e.relatedTarget !== anchorEl && !anchorEl.contains(e.relatedTarget)) close();
        });

        document.body.appendChild(menu);

        // Position flush under the anchor (no gap, so the cursor can move from
        // the anchor into the menu without crossing dead space and dismissing
        // it), nudged left if it would overflow the right edge.
        const a = anchorEl.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        const left = Math.min(a.left, window.innerWidth - m.width - 8);
        menu.style.top = `${a.bottom}px`;
        menu.style.left = `${Math.max(8, left)}px`;

        // Defer outside-click wiring so the opening click doesn't instantly close it.
        setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
        document.addEventListener('keydown', onKey);
    };

    // Mouse: hover to open, leave (without heading into the menu) to close.
    anchorEl.addEventListener('mouseenter', open);
    anchorEl.addEventListener('mouseleave', (e) => {
        if (!menu || (e.relatedTarget !== menu && !menu.contains(e.relatedTarget))) close();
    });
    // Touch / click: toggle.
    anchorEl.addEventListener('click', (e) => {
        e.stopPropagation();
        menu ? close() : open();
    });

    return { open, close };
}

// Per-dispenser conn_status refresh — the per-card "Refresh Status" action.
// Mirrors the bulk "Refresh Conn Status" button but scoped to one address.
async function refreshDispenserConnStatus(dispenser) {
    const addr = ensureDAddress(dispenser.address);
    try {
        const resp = await fetch(`${API_BASE_URL}/dispensers/refresh-conn-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
        window.showNotification?.(`Connection status refresh requested for ${addr}`, 'success');
    } catch (e) {
        console.error('refresh-conn-status (single) failed:', e);
        window.showNotification?.(`Refresh failed: ${e.message}`, 'error');
    }
}

// The dispenser card's refresh icon + its hover/tap action menu:
//   - "GET Data"       → request fresh values from the dispenser (sendGetCommandsForDispenser)
//   - "Refresh Status" → re-cycle this dispenser's conn_status subscription
// Available to every role. Returns the icon element to drop next to the status.
function createDispenserRefreshButton(dispenser) {
    const refreshButton = createIconFromImage('assets/graphics/refresh-icon.png', null, '20px');
    refreshButton.style.cursor = 'pointer';
    refreshButton.style.transition = 'transform 0.2s ease';
    refreshButton.addEventListener('mouseover', () => { refreshButton.style.transform = 'scale(1.05)'; });
    refreshButton.addEventListener('mouseout', () => { refreshButton.style.transform = 'scale(1)'; });

    createAnchoredMenu(refreshButton, [
        { label: 'GET Data', onClick: () => window.sendGetCommandsForDispenser?.(dispenser) },
        { label: 'Refresh Status', onClick: () => refreshDispenserConnStatus(dispenser) }
    ]);

    return refreshButton;
}

// Bulk-prefetch uncleared error/reset counts for the whole page (or a single
// station) in one request each, then serve per-card lookups from these maps
// instead of one network round trip per dispenser. The dispensers page calls
// these once on load and again on every periodic tick; other pages that never
// prefetch fall through to the per-address fetch below.
async function prefetchErrorCounts(customerCode) {
    try {
        const url = customerCode
            ? `${API_BASE_URL}/error-counts?customer_code=${encodeURIComponent(customerCode)}`
            : `${API_BASE_URL}/error-counts`;
        const resp = await fetch(url);
        if (!resp.ok) return false;
        const data = await resp.json();
        const map = new Map();
        for (const [addr, cnt] of Object.entries(data || {})) {
            map.set(ensureDAddress(addr), Number(cnt) || 0);
        }
        window.__errorCountMap = map;
        window.__errorCountReady = true;
        return true;
    } catch (error) {
        console.error('Error prefetching error counts:', error);
        return false;
    }
}

async function prefetchResetCounts(customerCode) {
    try {
        const url = customerCode
            ? `${API_BASE_URL}/reset-counts?customer_code=${encodeURIComponent(customerCode)}`
            : `${API_BASE_URL}/reset-counts`;
        const resp = await fetch(url);
        if (!resp.ok) return false;
        const data = await resp.json();
        const map = new Map();
        for (const [addr, cnt] of Object.entries(data || {})) {
            map.set(ensureDAddress(addr), Number(cnt) || 0);
        }
        window.__resetCountMap = map;
        window.__resetCountReady = true;
        return true;
    } catch (error) {
        console.error('Error prefetching reset counts:', error);
        return false;
    }
}

async function fetchErrorCount(dispenserTopic, { bypassCache = false } = {}) {
    // Serve from the bulk-prefetched map when available (absent address == 0).
    if (!bypassCache && window.__errorCountReady && window.__errorCountMap instanceof Map) {
        return window.__errorCountMap.get(ensureDAddress(dispenserTopic)) || 0;
    }
    try {
        const address = stripDAddress(dispenserTopic);
        const response = await fetch(`${API_BASE_URL}/error-log/${address}?showCleared=false`);
        if (response.ok) {
            const errors = await response.json();
            return errors.length;
        }
        return 0;
    } catch (error) {
        console.error('Error fetching error count:', error);
        return 0;
    }
}

// Show the icon + count span when count > 0, hide both otherwise. Shared by the
// card builder and the update* functions so the badge rule lives in one place.
function _applyBadgeCount(icon, span, count) {
    if (!span) return;
    span.textContent = count > 499 ? '499+' : count;
    const display = count > 0 ? 'inline-block' : 'none';
    span.style.display = display;
    if (icon) icon.style.display = display;
}

// Update the dispenser card's error badge. If `precomputedCount` is passed in,
// reuse it instead of re-fetching /error-log — lets callers share one fetch
// across multiple consumers (badge + per-nozzle errorCount).
async function updateErrorCount(dispenserTopic, precomputedCount, { bypassCache = false } = {}) {
    const card = document.querySelector(`div[data-address="${dispenserTopic}"]`);
    const errorCountSpan = card?.querySelector('.dispenser-error-count');
    if (!errorCountSpan) return;

    const count = (typeof precomputedCount === 'number')
        ? precomputedCount
        : await fetchErrorCount(dispenserTopic, { bypassCache });
    _applyBadgeCount(card.querySelector('.dispenser-error-container img'), errorCountSpan, count);
}

async function fetchResetCount(dispenserAddr, { bypassCache = false } = {}) {
    // Serve from the bulk-prefetched map when available (absent address == 0).
    if (!bypassCache && window.__resetCountReady && window.__resetCountMap instanceof Map) {
        return window.__resetCountMap.get(ensureDAddress(dispenserAddr)) || 0;
    }
    try {
        const response = await fetch(`${API_BASE_URL}/power-status/${dispenserAddr}`);
        if (response.ok) {
            const powerStatuses = await response.json();
            if (Array.isArray(powerStatuses) && powerStatuses.length > 0) {
                const clearedResponse = await fetch(`${API_BASE_URL}/cleared-resets/${dispenserAddr}`);
                let clearedIds = new Set();
                if (clearedResponse.ok) {
                    const clearedData = await clearedResponse.json();
                    clearedIds = new Set(clearedData.ids || []);
                }
                // Return ONLY uncleared count
                return powerStatuses.filter(status => !clearedIds.has(status.id)).length;
            }
        }
        return 0;
    } catch (error) {
        console.error('Error fetching reset count:', error);
        return 0;
    }
}

async function updateResetCount(dispenserAddr, bypassCache = false) {
    const card = document.querySelector(`div[data-address="${dispenserAddr}"]`);
    const resetCountSpan = card?.querySelector('.dispenser-reset-count');
    if (!resetCountSpan) return;

    const count = await fetchResetCount(dispenserAddr, { bypassCache });
    _applyBadgeCount(card.querySelector('.dispenser-reset-container img'), resetCountSpan, count);
}

function renderPageHeader(pageTitleText) {
    const headerContainer = document.createElement('div');
    headerContainer.style.display = 'flex';
    headerContainer.style.justifyContent = 'space-between';
    headerContainer.style.alignItems = 'center';
    headerContainer.style.backgroundColor = 'var(--bg-surface)';
    headerContainer.style.color = 'var(--text-primary)';
    headerContainer.style.padding = '20px';
    headerContainer.style.border = '1px solid var(--border)';
    headerContainer.style.borderRadius = '10px';
    headerContainer.style.marginBottom = '20px';
    headerContainer.style.boxShadow = 'var(--shadow-card)';

    const pageTitle = document.createElement('h1');
    pageTitle.style.fontSize = '32px';
    pageTitle.textContent = pageTitleText;
    headerContainer.appendChild(pageTitle);

    const optionsContainer = document.createElement('div');
    optionsContainer.style.display = 'flex';
    optionsContainer.style.alignItems = 'center';

    const gridContainer = document.createElement('div');
    gridContainer.style.display = 'flex';
    gridContainer.style.flexWrap = 'wrap';
    gridContainer.style.gap = '15px';
    gridContainer.style.justifyContent = 'flex-start';

    return { headerContainer, optionsContainer, gridContainer };
}

// Generic Yes/No confirmation popup. Defaults read "Confirm Deletion" with a
// red confirm button (preserves the original behavior for existing callers);
// pass `opts` to repurpose it for any other confirmation.
function createDeletePopup(confirmationQuestion, opts = {}) {
    const {
        title: titleText = 'Confirm Deletion',
        confirmText = 'Yes',
        cancelText = 'No',
        confirmColor = '#D32F2F',
        confirmHoverColor = '#B71C1C'
    } = opts;

    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '300px';
    popup.style.maxWidth = '90vw';

    const header = createHeader();

    const title = createTitle();
    title.textContent = titleText;

    const closeButton = createCloseButton(overlay);

    header.appendChild(title);
    header.appendChild(closeButton);
    popup.appendChild(header);

    const message = document.createElement('p');
    message.textContent = confirmationQuestion;
    message.style.marginBottom = '20px';
    message.style.textAlign = 'center';
    popup.appendChild(message);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.gap = '10px';

    const confirmButton = createActionButton(confirmColor, confirmHoverColor);
    confirmButton.textContent = confirmText;

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = cancelText;
    cancelButton.onclick = () => {
        document.body.removeChild(overlay);
    };

    buttonContainer.appendChild(confirmButton);
    buttonContainer.appendChild(cancelButton);
    popup.appendChild(buttonContainer);
    dragPopup(overlay, popup);

    return { overlay, popup, confirmButton, cancelButton, buttonContainer };
}

// A borderless icon-only button (used for the delete/edit row actions).
function createIconButton(btnClass, iconSrc, titleText) {
    const btn = document.createElement('button');
    btn.className = btnClass;
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.padding = '0';

    const icon = document.createElement('img');
    icon.className = 'icon';
    icon.src = iconSrc;
    icon.title = titleText;
    icon.style.width = '20px';
    icon.style.height = '20px';
    btn.appendChild(icon);

    return btn;
}

function createDeleteButton(titleText) {
    return createIconButton('delete-btn', 'assets/graphics/delete-icon.png', titleText);
}

function createEditButton(titleText) {
    return createIconButton('edit-btn', 'assets/graphics/edit-icon.png', titleText);
}

function createChangePasswordButton(titleText) {
    return createIconButton('change-pw-btn', 'assets/graphics/reset-password.svg', titleText);
}

// Append a standard Edit + Delete action cell to a table row. With
// `enabled: false` the buttons render disabled (not-allowed cursor, no handlers).
function appendRowActions(tr, { onEdit, onDelete, onChangePassword, editTitle = 'Edit', deleteTitle = 'Delete', changePasswordTitle = 'Change password', enabled = true } = {}) {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';

    // Optional change-password action — only rendered when a handler is passed,
    // so rows/pages that don't offer it stay unchanged.
    if (onChangePassword) {
        const pwBtn = createChangePasswordButton(changePasswordTitle);
        if (enabled) pwBtn.addEventListener('click', onChangePassword);
        else pwBtn.style.cursor = 'not-allowed';
        wrap.appendChild(pwBtn);
    }

    const editBtn = createEditButton(editTitle);
    const deleteBtn = createDeleteButton(deleteTitle);
    if (enabled) {
        if (onEdit) editBtn.addEventListener('click', onEdit);
        if (onDelete) deleteBtn.addEventListener('click', onDelete);
    } else {
        editBtn.style.cursor = 'not-allowed';
        deleteBtn.style.cursor = 'not-allowed';
    }
    wrap.appendChild(editBtn);
    wrap.appendChild(deleteBtn);
    appendCell(tr, wrap);
}

async function deleteFromDB(url) {
    try {
    const response = await fetch(
      url, 
      {
        method: 'DELETE'
      }
    );
    
    if (!response.ok) {
      throw new Error('Failed to delete');
    }
  } catch (error) {
    console.error('Database delete error:', error);
    throw error;
  }
}

function configPage(pageTitle, backButtonText, backToPage, addButtonText) {
    const content = document.getElementById('content');
    if (!content) {
        console.error('Content element not found');
        return;
    }
    content.innerHTML = '';

    // Page title now lives in the topbar; this row only carries the back button.
    const headerContainer = document.createElement('div');
    headerContainer.style.display = 'flex';
    headerContainer.style.alignItems = 'left';
    headerContainer.style.marginBottom = '16px';
    headerContainer.style.width = '100%';

    const backButton = createActionButton();
    backButton.textContent = backButtonText;
    backButton.addEventListener('click', () => {
        window.location.href = backToPage;
    });

    headerContainer.appendChild(backButton);
    content.appendChild(headerContainer);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '10px';
    buttonContainer.style.marginBottom = '20px';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.alignItems = 'right';

    const addButton = createActionButton();
    addButton.textContent = addButtonText;

    buttonContainer.appendChild(addButton);
    content.appendChild(buttonContainer);

    return { content, addButton };
}

// Build a CSV string and trigger a browser download. `columns` is an array of
// { header, get(row) | key }, `rows` is the data. Used by the per-page CSV
// export buttons (config-dispensers, site-management).
function downloadCsv(filename, rows, columns) {
    const esc = v => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = columns.map(c => esc(c.header)).join(',');
    const body = rows.map(r =>
        columns.map(c => esc(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')
    ).join('\n');
    // BOM so Excel reads UTF-8 correctly.
    const blob = new Blob(['﻿' + header + '\n' + body + (body ? '\n' : '')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

function createIconFromImage(imagePath, titleText, height, width = null) {
    const icon = document.createElement('img');
    icon.src = imagePath;
    icon.style.height = height;
    icon.style.width = width || 'auto';
    if (titleText) {
        icon.alt = titleText;
        icon.title = titleText;
    }

    return icon;
}