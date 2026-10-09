// Price-related helpers: resolving a station's filed price for a product.
// Kept out of server.js so the endpoints stay thin.
const pool = require('./db');

// A station's filed price for a product (PMG/HSD/HOBC) → number|null. Used to
// (re)derive a nozzle's actual_price when it's created or its product changes.
async function stationPriceForProduct(customerCode, product) {
    const col = { PMG: 'price_pmg', HSD: 'price_hsd', HOBC: 'price_hobc' }[String(product).toUpperCase()];
    if (!col) return null;
    const [rows] = await pool.query(`SELECT \`${col}\` AS p FROM stations WHERE customer_code = ?`, [customerCode]);
    return rows[0]?.p ?? null;
}

module.exports = { stationPriceForProduct };
