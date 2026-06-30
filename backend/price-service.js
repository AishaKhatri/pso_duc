// Price-related helpers: parsing the PSO price-change workbook and resolving a
// station's filed price for a product. Kept out of server.js so the price
// endpoints stay thin.
const pool = require('./db');

// Pull the per-customer-code prices out of one of the price-file sheets.
// Sheet layout (row 0 = date, row 1 = headers, row 2+ = data):
//   col B Customer Code | col D New Code | col G {Product} Price
// Returns { prices, listed }:
//   prices  Map<customerCode, price> — rows with a valid (>0) price.
//   listed  Set<customerCode>        — every row that names a code, even when
//                                      its price cell is blank/invalid. Lets the
//                                      caller tell "listed but no price" apart
//                                      from "not in the file at all".
// When New Code differs from Customer Code, the New Code wins — that's how the
// file signals a re-mapped outlet.
function parsePriceSheet(sheet) {
    const XLSX = require('xlsx');
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const prices = new Map();
    const listed = new Set();
    for (let i = 2; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const customerCode = r[1];
        const newCode = r[3];
        const price = r[6];
        const code = (newCode != null && newCode !== '') ? newCode : customerCode;
        if (code == null || code === '') continue;
        listed.add(String(code));
        if (price == null || price === '') continue;
        const priceNum = Number(price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) continue;
        prices.set(String(code), priceNum);
    }
    return { prices, listed };
}

// A station's filed price for a product (PMG/HSD/HOBC) → number|null. Used to
// (re)derive a nozzle's actual_price when it's created or its product changes.
async function stationPriceForProduct(customerCode, product) {
    const col = { PMG: 'price_pmg', HSD: 'price_hsd', HOBC: 'price_hobc' }[String(product).toUpperCase()];
    if (!col) return null;
    const [rows] = await pool.query(`SELECT \`${col}\` AS p FROM stations WHERE customer_code = ?`, [customerCode]);
    return rows[0]?.p ?? null;
}

module.exports = { parsePriceSheet, stationPriceForProduct };
