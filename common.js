// const host_PC_IP = '192.168.10.51';
// const host_PC_IP = '72.255.62.111';
const host_PC_IP = 'localhost';
const API_BASE_URL = `http://${host_PC_IP}:3001/api`;

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
    link.style.color = '#006effff';
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

function createTable(columns) {
    const tableContainer = document.createElement('div');
    tableContainer.className = 'app-table-container';
    tableContainer.style.backgroundColor = 'var(--bg-surface)';
    tableContainer.style.borderRadius = '5px';
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
        headerRow.appendChild(th);
    });
    headerRow.lastChild.style.borderRight = 'none';

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.id = 'dispenser-table-body';
    table.appendChild(tbody);

    tableContainer.appendChild(table);

    return { tableContainer , tbody };
}

// Shared HTML-escape used by the searchable dropdown.
function _escapeDropdownHtml(s) {
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
            const codePart = `<span class="opt-code">${_escapeDropdownHtml(item.label || '')}</span>`;
            const subPart = item.secondary
                ? `<span class="opt-name">${_escapeDropdownHtml(item.secondary)}</span>`
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
        // else {
        //     uptime.textContent = `At: ${connectedTime}`;
        // }
    } else {
        console.error(`❌ Device card not found for ${deviceType} with ID: ${deviceId}`);
    }
}

async function createCard(address, customer_code) {
    const card = document.createElement('div');
    card.classList.add('app-dispenser-card');
    Object.assign(card.style, {
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 'fit-content',
        width: 'fit-content',
        padding: '11px'
    });

    const titleContainer = document.createElement('div');
    titleContainer.style.display = 'flex';
    titleContainer.style.justifyContent = 'space-between';
    titleContainer.style.alignItems = 'center';
    titleContainer.style.marginBottom = '5px';
    titleContainer.style.marginLeft = '5px';
    titleContainer.style.marginRight = '5px';
    titleContainer.style.position = 'relative';

    const titleText = document.createElement('h2');
    titleText.textContent = address;
    titleText.style.fontSize = '17px';
    titleText.style.margin = '0';

    const statusText = createLink();
    statusText.className = 'conn-status';
    statusText.textContent = 'Connecting...';
    statusText.style.color = 'var(--text-secondary)';
    statusText.title = 'Click to view details';
    // Add click handler
    statusText.addEventListener('click', () => {
        showDevStatusPopup(address);
    });

    titleContainer.appendChild(titleText);
    titleContainer.appendChild(statusText);
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
        const errorContainer = document.createElement('div');
        errorContainer.className = 'dispenser-error-container';
        errorContainer.style.display = 'flex';
        errorContainer.style.alignItems = 'center';
        errorContainer.style.gap = '8px';
        errorContainer.style.cursor = 'pointer';

        const errorIcon = createIconFromImage('assets/graphics/alert-icon.png', 'Errors', '18px');
        errorIcon.style.display = 'none';

        const errorCountSpan = document.createElement('span');
        errorCountSpan.className = 'dispenser-error-count';
        errorCountSpan.style.fontSize = '13px';
        errorCountSpan.style.fontWeight = 'bold';
        errorCountSpan.style.color = 'var(--badge-error-text)';
        errorCountSpan.style.backgroundColor = 'var(--badge-error-bg)';
        errorCountSpan.style.padding = '2px 8px';
        errorCountSpan.style.borderRadius = '12px';
        errorCountSpan.style.display = 'none';

        const count = await fetchErrorCount(address);
        errorCountSpan.textContent = count;

        if (count > 0) {
            errorIcon.style.display = 'inline-block';
            errorCountSpan.style.display = 'inline-block';
        }

        errorContainer.appendChild(errorIcon);
        errorContainer.appendChild(errorCountSpan);

        errorContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.showDevStatusPopup === 'function') {
                window.showDevStatusPopup(address, 'errorLogs');
            }
        });

        const resetContainer = document.createElement('div');
        resetContainer.className = 'dispenser-reset-container';
        resetContainer.style.display = 'flex';
        resetContainer.style.alignItems = 'center';
        resetContainer.style.gap = '8px';
        resetContainer.style.cursor = 'pointer';

        const resetIcon = createIconFromImage('assets/graphics/reset-icon.png', 'Resets', '18px');
        resetIcon.style.display = 'none';

        const resetCountSpan = document.createElement('span');
        resetCountSpan.className = 'dispenser-reset-count';
        resetCountSpan.style.fontSize = '13px';
        resetCountSpan.style.fontWeight = 'bold';
        resetCountSpan.style.color = 'var(--badge-reset-text)';
        resetCountSpan.style.backgroundColor = 'var(--badge-reset-bg)';
        resetCountSpan.style.padding = '2px 8px';
        resetCountSpan.style.borderRadius = '12px';
        resetCountSpan.style.display = 'none';

        // Fetch reset count
        (async () => {
            const resetCount = await fetchResetCount(address);
            resetCountSpan.textContent = resetCount;
            if (resetCount > 0) {
                resetIcon.style.display = 'inline-block';
                resetCountSpan.style.display = 'inline-block';
            }
        })();

        resetContainer.appendChild(resetIcon);
        resetContainer.appendChild(resetCountSpan);

        resetContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.showDevStatusPopup === 'function') {
                window.showDevStatusPopup(address, 'resetLogs');
            }
        });

        leftContainer.appendChild(errorContainer);
        leftContainer.appendChild(resetContainer);
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

    return { card, titleContainer };
}

async function fetchErrorCount(dispenserTopic) {
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

// Update the dispenser card's error badge. If `precomputedCount` is passed in,
// reuse it instead of re-fetching /error-log — lets callers share one fetch
// across multiple consumers (badge + per-nozzle errorCount).
async function updateErrorCount(dispenserTopic, precomputedCount) {
    const card = document.querySelector(`div[data-address="${dispenserTopic}"]`);
    if (!card) return;

    const errorCountSpan = card.querySelector('.dispenser-error-count');
    const errorIcon = card.querySelector('.dispenser-error-container img');

    if (errorCountSpan) {
        const count = (typeof precomputedCount === 'number')
            ? precomputedCount
            : await fetchErrorCount(dispenserTopic);
        errorCountSpan.textContent = count;

        if (count > 0) {
            errorCountSpan.style.display = 'inline-block';
            if (errorIcon) errorIcon.style.display = 'inline-block';
        } else {
            errorCountSpan.style.display = 'none';
            if (errorIcon) errorIcon.style.display = 'none';
        }
    }
}

async function fetchResetCount(dispenserAddr) {
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

async function updateResetCount(dispenserAddr) {
    const card = document.querySelector(`div[data-address="${dispenserAddr}"]`);
    if (!card) return;
    
    const resetCountSpan = card.querySelector('.dispenser-reset-count');
    const resetIcon = card.querySelector('.dispenser-reset-container img');
    
    if (resetCountSpan) {
        const count = await fetchResetCount(dispenserAddr);
        resetCountSpan.textContent = count;
        
        if (count > 0) {
            resetCountSpan.style.display = 'inline-block';
            if (resetIcon) resetIcon.style.display = 'inline-block';
        } else {
            resetCountSpan.style.display = 'none';
            if (resetIcon) resetIcon.style.display = 'none';
        }
    }
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

function createDeletePopup(confirmationQuestion) {
    const overlay = createModalOverlay();
    const popup = document.createElement('div');
    popup.className = 'popup-modal';
    popup.style.width = '300px';
    popup.style.maxWidth = '90vw';
    
    const header = createHeader();
    
    const title = createTitle();
    title.textContent = 'Confirm Deletion';

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

    const confirmButton = createActionButton('#D32F2F', '#B71C1C');
    confirmButton.textContent = 'Yes';

    const cancelButton = createActionButton('#626262', '#424242');
    cancelButton.textContent = 'No';
    cancelButton.onclick = () => {
        document.body.removeChild(overlay);
    };

    buttonContainer.appendChild(confirmButton);
    buttonContainer.appendChild(cancelButton);
    popup.appendChild(buttonContainer);
    dragPopup(overlay, popup);

    return { overlay, popup, confirmButton, cancelButton, buttonContainer };
}

function createDeleteButton(titleText) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.style.background = 'none';
    deleteBtn.style.border = 'none';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.style.padding = '0';
    
    const deleteIcon = document.createElement('img');
    deleteIcon.className = 'icon';
    deleteIcon.src = 'assets/graphics/delete-icon.png';
    deleteIcon.title = titleText;
    deleteIcon.style.width = '20px';
    deleteIcon.style.height = '20px';
    deleteBtn.appendChild(deleteIcon);

    return deleteBtn    
}

function createEditButton(titleText) {
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.style.background = 'none';
    editBtn.style.border = 'none';
    editBtn.style.cursor = 'pointer';
    editBtn.style.padding = '0';
    
    const editIcon = document.createElement('img');
    editIcon.className = 'icon';
    editIcon.src = 'assets/graphics/edit-icon.png';
    editIcon.title = titleText;
    editIcon.style.width = '20px';
    editIcon.style.height = '20px';
    editBtn.appendChild(editIcon);
                        
    return editBtn
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