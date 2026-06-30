// Dashboard / statistics query helpers. Kept out of server.js so the route file
// stays a thin HTTP layer and this logic is independently reusable/testable.
const pool = require('./db');
const { fetchStationSheetRows } = require('./backend-services');

// Map a dashboard division to the customer codes that belong to it, using the
// same station sheet the dashboard counts come from (transactions carry only
// customer_code, not division). Returns [] when the division has no stations —
// callers should then report zeroed sales.
async function customerCodesForDivision(division) {
    const sheet = await fetchStationSheetRows();
    const want = String(division || '').trim().toLowerCase();
    return sheet
        .filter(s => String(s.division || '').trim().toLowerCase() === want)
        .map(s => String(s.customer_code || '').trim())
        .filter(Boolean);
}

// Build the shared transaction-query filter (customer_code / dispenser_id /
// division) used by the dashboard endpoints. Returns { params, clause, tClause }
// where `clause` targets an un-aliased transactions table and `tClause` the
// `t.`-aliased products query. Returns null when a division filter resolves to
// no stations — the caller should then report an empty/zeroed result.
async function txnFilters(req) {
    const customerCode = (req.query.customer_code || '').trim();
    const dispenserId  = (req.query.dispenser_id  || '').toString().trim();
    const division     = (req.query.division || '').trim();
    const cols = [], params = [];
    if (customerCode) { cols.push('customer_code = ?'); params.push(customerCode); }
    if (dispenserId)  { cols.push('dispenser_id = ?');  params.push(dispenserId); }
    if (division) {
        const codes = await customerCodesForDivision(division);
        if (codes.length === 0) return null;
        cols.push(`customer_code IN (${codes.map(() => '?').join(',')})`);
        params.push(...codes);
    }
    const join = (prefix) => cols.length ? 'AND ' + cols.map(c => prefix + c).join(' AND ') : '';
    return { params, clause: join(''), tClause: join('t.') };
}

module.exports = { customerCodesForDivision, txnFilters };
