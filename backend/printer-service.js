// Thermal receipt printer helpers (WiFi / ESC-POS over raw TCP). Node port of
// "printer/from daniyal POS Printer Code/receipt.cpp". Kept out of server.js so
// the print endpoint stays thin.
//
// The printer listens on TCP 9100 and speaks raw ESC/POS, so we just open a
// socket and write the command bytes — no npm dependency needed. The PSO logo
// is the exact monochrome raster the firmware prints (extracted from its
// logo_bitmap.h into assets/bitmap/pso-logo.bin), so nothing is decoded at
// runtime — cheapest option for an embedded PC like the OrangePi.
const net = require('net');
const fs = require('fs');
const path = require('path');

const PRINTER_IP = process.env.PRINTER_IP || '192.168.0.175';
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const CONNECT_TIMEOUT_MS = 5000;

const LOGO_WIDTH_PX = 150;
const LOGO_HEIGHT_PX = 148;

// Load the logo once at module load; a missing file just skips the logo, not
// the whole print.
let logoBitmap = null;
try {
    logoBitmap = fs.readFileSync(path.join(__dirname, '..', 'assets', 'bitmap', 'pso-logo.bin'));
} catch (e) {
    console.warn('Receipt logo bitmap not found — receipts will print without it.');
}

// A tiny ESC/POS command builder mirroring thermal_printer.cpp. Collects Buffers
// and concatenates once, so binary logo bytes and text coexist cleanly.
function escpos() {
    const ESC = 0x1B, GS = 0x1D;
    const parts = [];
    const push = (...bytes) => parts.push(Buffer.from(bytes));
    const api = {
        init()            { push(ESC, 0x40); return api; },
        align(n)          { push(ESC, 0x61, n); return api; },        // 0 left, 1 center, 2 right
        bold(on)          { push(ESC, 0x45, on ? 1 : 0); return api; },
        // widthMult/heightMult 1..8 -> GS ! n, matching printer_char_size().
        charSize(w, h)    { push(GS, 0x21, ((Math.min(8, Math.max(1, w)) - 1) << 4) | (Math.min(8, Math.max(1, h)) - 1)); return api; },
        resetCharSize()   { return api.charSize(1, 1); },
        text(s)           { parts.push(Buffer.from(s, 'latin1')); return api; },
        line(s = '')      { return api.text(s + '\n'); },
        repeat(ch, n)     { return api.text(ch.repeat(n)); },
        feed(n)           { push(ESC, 0x64, n); return api; },
        // Right-pad `left` so `right` ends at column `width` (printer_two_column).
        twoColumn(left, right, width = 32) {
            const pad = Math.max(1, width - left.length - right.length);
            return api.line(left + ' '.repeat(pad) + right);
        },
        bitmap(data, widthPx, heightPx) {
            const widthBytes = Math.ceil(widthPx / 8);
            push(GS, 0x76, 0x30, 0, widthBytes & 0xFF, (widthBytes >> 8) & 0xFF, heightPx & 0xFF, (heightPx >> 8) & 0xFF);
            parts.push(data);
            return api;
        },
        cut(full = true)  { push(GS, 0x56, full ? 0 : 1); return api; },
        beep(times, dur)  { push(ESC, 0x42, Math.min(9, Math.max(1, times)), Math.min(9, Math.max(1, dur))); return api; },
        build()           { return Buffer.concat(parts); }
    };
    return api;
}

// Send raw bytes to the network printer, resolving once flushed or rejecting on
// connect/timeout error so the caller can report status.
function sendToPrinter(buffer) {
    return new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(CONNECT_TIMEOUT_MS);
        socket.once('error', reject);
        socket.once('timeout', () => {
            socket.destroy();
            reject(new Error(`Printer ${PRINTER_IP}:${PRINTER_PORT} not responding`));
        });
        socket.connect(PRINTER_PORT, PRINTER_IP, () => {
            socket.write(buffer, () => socket.end());
        });
        socket.once('close', () => resolve());
    });
}

// Monotonic invoice counter for the process lifetime (mirrors the firmware's
// static invoiceNo — resets on restart, fine for the POC).
let invoiceNo = 0;

const pad2 = (n) => String(n).padStart(2, '0');

// Build the ESC/POS byte stream for one fuel-sale receipt. Layout mirrors
// receipt.cpp: logo, "PAKISTAN STATE OIL", station lines, date/time/invoice,
// product + qty + price, bold amount, "CUSTOMER COPY", cut + beep.
// sale = { product, volume, pricePerLitre, amount?, stationId?, customerCode? }
// Returns { buffer, invoice }.
function buildFuelReceipt(sale = {}) {
    const product = String(sale.product || 'FUEL');
    const volume = Number(sale.volume) || 0;
    const pricePerLitre = Number(sale.pricePerLitre) || 0;
    // Trust the caller's amount if given, else derive it (volume * price).
    const amount = sale.amount != null ? Number(sale.amount) : volume * pricePerLitre;
    const stationId = String(sale.stationId || '*Station Name Missing*');
    const customerCode = String(sale.customerCode || '*Customer Code Missing*');

    const now = new Date();
    const dateStr = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${String(now.getFullYear()).slice(-2)}`;
    const timeStr = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
    const invoiceStr = String(invoiceNo++).padStart(3, '0');

    const p = escpos().init();

    p.align(1);
    if (logoBitmap) p.bitmap(logoBitmap, LOGO_WIDTH_PX, LOGO_HEIGHT_PX).feed(2);

    p.bold(true).charSize(2, 2).line('PAKISTAN STATE OIL').resetCharSize().bold(false);
    p.charSize(1, 1).text('Powered by: ').bold(true).line('Stingray Tech').resetCharSize().bold(false);
    p.feed(1);

    if (stationId) p.line(stationId);
    if (customerCode) p.line(customerCode);

    p.feed(1).repeat('-', 32).text('\n');
    p.twoColumn('DATE:', dateStr);
    p.twoColumn('TIME:', timeStr);
    p.twoColumn('INVOICE:', invoiceStr);
    p.feed(1);

    p.line(product);
    p.line(`Qty: ${volume.toFixed(2)} Ltr`);
    p.line(`Price: ${pricePerLitre.toFixed(2)} Rs`);
    p.repeat('-', 32).text('\n');

    p.bold(true).charSize(1, 1).twoColumn('AMOUNT', `Rs ${amount.toFixed(2)}`, 22).resetCharSize().bold(false);
    p.feed(1);
    p.align(1).line('**CUSTOMER COPY**');
    p.feed(4).cut(true).beep(2, 5);

    return { buffer: p.build(), invoice: invoiceStr };
}

// Format and print a fuel-sale receipt. Returns { invoice, printer }.
async function printFuelReceipt(sale) {
    const { buffer, invoice } = buildFuelReceipt(sale);
    await sendToPrinter(buffer);
    return { invoice, printer: `${PRINTER_IP}:${PRINTER_PORT}` };
}

module.exports = {
    PRINTER_IP,
    PRINTER_PORT,
    escpos,
    sendToPrinter,
    buildFuelReceipt,
    printFuelReceipt,
};
