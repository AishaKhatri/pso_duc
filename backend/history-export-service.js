// Nozzle-history export for the super_admin Export History page. Kept out of
// server.js so the route stays a thin HTTP layer.
const pool = require('./db');
const { addressOutSql } = require('./backend-services');

// Hard ceiling on rows per export — the .xlsx is built in the browser, so an
// unbounded range across every dispenser could exhaust the tab's memory.
const MAX_EXPORT_ROWS = 100000;

// Nozzle-history snapshots between `from` and `to` (YYYY-MM-DD, inclusive) for
// the given dispenser row ids (dispensers.id). An empty `dispenserIds` means
// every dispenser. Returns { rows } or { tooMany: count } when over the cap.
async function fetchNozzleHistoryForExport({ from, to, dispenserIds }) {
    const where = ['h.created_at >= ?', 'h.created_at < DATE_ADD(?, INTERVAL 1 DAY)'];
    const params = [from, to];
    if (dispenserIds.length) {
        where.push(`d.id IN (${dispenserIds.map(() => '?').join(',')})`);
        params.push(...dispenserIds);
    }
    const fromSql = `FROM nozzle_history h
             JOIN dispensers d
               ON d.customer_code = h.customer_code
              AND d.dispenser_id  = h.dispenser_id
             LEFT JOIN stations s ON s.customer_code = h.customer_code
             WHERE ${where.join(' AND ')}`;

    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n ${fromSql}`, params);
    if (n > MAX_EXPORT_ROWS) return { tooMany: n };

    const [rows] = await pool.query(
        `SELECT h.created_at, h.customer_code, s.station_id, s.city,
                h.dispenser_id, ${addressOutSql('d')} AS address, h.nozzle_id,
                h.product, h.status, h.total_quantity
         ${fromSql}
         ORDER BY h.customer_code, d.address, h.created_at, h.id`,
        params
    );
    return { rows };
}

module.exports = { fetchNozzleHistoryForExport, MAX_EXPORT_ROWS };
