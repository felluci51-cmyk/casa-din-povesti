// =====================================================================
// Casa din Povesti — server (Express + sql.js)
// ---------------------------------------------------------------------
// Versiune care NU necesita compilare nativa (fara better-sqlite3).
// Foloseste sql.js (SQLite compilat in WebAssembly) — merge pe orice OS.
//
// Endpoint-uri:
//   GET  /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
//        -> { bookedDates: ["2026-05-10", ...], pricePerNight: 1500 }
//
//   POST /api/reservations
//        body: { checkIn, checkOut, guests, name, email, phone, notes }
//        -> { id, status: "pending" }
//
//   GET  /api/reservations          (admin) — header: X-Admin-Key
//   POST /api/reservations/:id/status (admin) — body: { status }
//   POST /api/blocked-dates         (admin) — body: { from, to, reason }
//   DELETE /api/blocked-dates       (admin) — body: { from, to }
//   POST /api/test-mail             (admin) — body: { to }
// =====================================================================

import express from 'express';
import cors from 'cors';
import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { sendBookingEmails, sendTestEmail } from './mailer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'casa.db');
const PRICE_PER_NIGHT = Number(process.env.PRICE_PER_NIGHT || 1500);
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// -------------------- DB (sql.js) --------------------
// sql.js tine baza de date in memorie si o salvam pe disc periodic + la modificari.

const SQL = await initSqlJs();

let db;
if (fs.existsSync(DB_PATH)) {
  const buffer = fs.readFileSync(DB_PATH);
  db = new SQL.Database(buffer);
  console.log(`  Baza de date incarcata:       ${DB_PATH}`);
} else {
  db = new SQL.Database();
  console.log(`  Baza de date noua:            ${DB_PATH}`);
}

db.run('PRAGMA foreign_keys = ON');

db.run(`
  CREATE TABLE IF NOT EXISTS reservations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    check_in    TEXT    NOT NULL,
    check_out   TEXT    NOT NULL,
    guests      INTEGER NOT NULL DEFAULT 2,
    name        TEXT,
    email       TEXT,
    phone       TEXT,
    notes       TEXT,
    status      TEXT    NOT NULL DEFAULT 'pending',
    total_price INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE INDEX IF NOT EXISTS idx_reservations_dates
    ON reservations(check_in, check_out, status)
`);

db.run(`
  CREATE TABLE IF NOT EXISTS blocked_dates (
    date   TEXT PRIMARY KEY,
    reason TEXT
  )
`);

// Salveaza DB pe disc
function saveDb() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('[db] Eroare la salvare:', err.message);
  }
}

// Salveaza imediat la pornire (creeaza fisierul daca nu exista)
saveDb();

// Auto-save la fiecare 30 secunde (safety net)
setInterval(saveDb, 30000);

// Salveaza la oprire
process.on('SIGINT', () => { saveDb(); process.exit(0); });
process.on('SIGTERM', () => { saveDb(); process.exit(0); });

// -------------------- helpers sql.js --------------------
// sql.js returneaza rezultate ca array de obiecte prin helper-ul de mai jos.

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function runSql(sql, params = []) {
  db.run(sql, params);
  // Returnam un obiect similar cu better-sqlite3
  const lastId = db.exec("SELECT last_insert_rowid() AS id")[0]?.values[0][0] || 0;
  const changes = db.getRowsModified();
  return { lastInsertRowid: lastId, changes };
}

// -------------------- helpers generali --------------------
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function eachNight(checkIn, checkOut) {
  const out = [];
  const d = new Date(checkIn + 'T00:00:00Z');
  const end = new Date(checkOut + 'T00:00:00Z');
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function nightsBetween(a, b) {
  return Math.round(
    (new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000
  );
}

function adminAuth(req, res, next) {
  const key = req.get('X-Admin-Key');
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Neautorizat' });
  }
  next();
}

// -------------------- app --------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- public: availability ----
app.get('/api/availability', (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) {
    return res.status(400).json({ error: 'Parametri invalizi (from, to: YYYY-MM-DD)' });
  }

  const reservations = queryAll(`
    SELECT check_in, check_out
      FROM reservations
     WHERE status IN ('pending','confirmed')
       AND check_out > ?
       AND check_in  < date(?, '+1 day')
  `, [from, to]);

  const blocked = queryAll(`
    SELECT date FROM blocked_dates WHERE date BETWEEN ? AND ?
  `, [from, to]);

  const set = new Set();
  for (const r of reservations) {
    for (const d of eachNight(r.check_in, r.check_out)) {
      if (d >= from && d <= to) set.add(d);
    }
  }
  for (const b of blocked) set.add(b.date);

  res.json({
    bookedDates: [...set].sort(),
    pricePerNight: PRICE_PER_NIGHT,
  });
});

// ---- public: create reservation ----
app.post('/api/reservations', (req, res) => {
  const { checkIn, checkOut, guests, name, email, phone, notes } = req.body || {};

  if (!isDate(checkIn) || !isDate(checkOut)) {
    return res.status(400).json({ error: 'Datele de check-in/check-out sunt invalide.' });
  }
  if (checkOut <= checkIn) {
    return res.status(400).json({ error: 'Data de check-out trebuie sa fie dupa check-in.' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (checkIn < today) {
    return res.status(400).json({ error: 'Nu poti rezerva pe date din trecut.' });
  }
  if (!name || !email || !phone) {
    return res.status(400).json({ error: 'Numele, emailul si telefonul sunt obligatorii.' });
  }
  const g = Number(guests) || 2;
  if (g < 1 || g > 12) {
    return res.status(400).json({ error: 'Numarul de oaspeti este invalid.' });
  }

  const overlap = queryOne(`
    SELECT id FROM reservations
     WHERE status IN ('pending','confirmed')
       AND check_out > ?
       AND check_in  < ?
     LIMIT 1
  `, [checkIn, checkOut]);
  if (overlap) {
    return res.status(409).json({ error: 'Datele alese nu mai sunt disponibile.' });
  }

  const blockedDay = queryOne(`
    SELECT date FROM blocked_dates
     WHERE date >= ? AND date < ?
     LIMIT 1
  `, [checkIn, checkOut]);
  if (blockedDay) {
    return res.status(409).json({ error: 'Intervalul ales contine zile indisponibile.' });
  }

  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * PRICE_PER_NIGHT;

  const result = runSql(`
    INSERT INTO reservations
      (check_in, check_out, guests, name, email, phone, notes, status, total_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `, [checkIn, checkOut, g, name.trim(), email.trim(), phone.trim(), notes || null, total]);

  // Salveaza pe disc dupa fiecare rezervare noua
  saveDb();

  const reservation = {
    id: result.lastInsertRowid,
    checkIn,
    checkOut,
    nights,
    guests: g,
    name: name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    notes: notes || null,
    totalPrice: total,
  };

  sendBookingEmails(reservation).catch(err => {
    console.error('[mail] sendBookingEmails error:', err.message);
  });

  res.status(201).json({
    id: reservation.id,
    status: 'pending',
    nights,
    totalPrice: total,
    currency: 'MDL',
  });
});

// ---- admin: list reservations ----
app.get('/api/reservations', adminAuth, (req, res) => {
  const rows = queryAll(`
    SELECT * FROM reservations ORDER BY created_at DESC
  `);
  res.json({ reservations: rows });
});

// ---- admin: update status ----
app.post('/api/reservations/:id/status', adminAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Status invalid.' });
  }
  const info = runSql(`
    UPDATE reservations SET status = ? WHERE id = ?
  `, [status, Number(req.params.id)]);
  if (info.changes === 0) return res.status(404).json({ error: 'Rezervare inexistenta.' });
  saveDb();
  res.json({ ok: true });
});

// ---- admin: block / unblock dates ----
app.post('/api/blocked-dates', adminAuth, (req, res) => {
  const { from, to, reason } = req.body || {};
  if (!isDate(from) || !isDate(to) || to < from) {
    return res.status(400).json({ error: 'Interval invalid.' });
  }
  const endDate = new Date(new Date(to + 'T00:00:00Z').getTime() + 86400000)
    .toISOString().slice(0, 10);
  const dates = eachNight(from, endDate);
  for (const d of dates) {
    runSql(`INSERT OR REPLACE INTO blocked_dates (date, reason) VALUES (?, ?)`, [d, reason || null]);
  }
  saveDb();
  res.json({ ok: true, blocked: dates.length });
});

app.delete('/api/blocked-dates', adminAuth, (req, res) => {
  const { from, to } = req.body || {};
  if (!isDate(from) || !isDate(to)) {
    return res.status(400).json({ error: 'Interval invalid.' });
  }
  const info = runSql(`
    DELETE FROM blocked_dates WHERE date BETWEEN ? AND ?
  `, [from, to]);
  saveDb();
  res.json({ ok: true, removed: info.changes });
});

// ---- admin: test SMTP ----
app.post('/api/test-mail', adminAuth, async (req, res) => {
  const to = (req.body && req.body.to) || process.env.NOTIFY_EMAIL;
  if (!to) return res.status(400).json({ error: 'Lipseste destinatarul (body.to sau NOTIFY_EMAIL).' });
  try {
    const r = await sendTestEmail(to);
    if (!r.ok) return res.status(503).json({ error: 'SMTP nu este configurat.', reason: r.reason });
    res.json({ ok: true, sentTo: to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- health ----
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// fallback la index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  Casa din Povesti ruleaza la  http://localhost:${PORT}`);
  console.log(`  Baza de date:                 ${DB_PATH}`);
  console.log(`  Pret/noapte:                  ${PRICE_PER_NIGHT} MDL\n`);
});
