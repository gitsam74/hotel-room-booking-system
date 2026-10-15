const express = require('express');
const path = require('path');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Local development uses a real SQLite file. For persistent Vercel deployments,
// configure Turso (SQLite-compatible) with TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
const remoteUrl = process.env.TURSO_DATABASE_URL;
const db = createClient(remoteUrl
  ? { url: remoteUrl, authToken: process.env.TURSO_AUTH_TOKEN }
  : { url: `file:${path.join(__dirname, '..', 'hotel_booking.db')}` });
let initPromise;
async function initDb() {
  if (!initPromise) initPromise = (async () => {
    await db.batch([
      `CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, roomNo TEXT NOT NULL UNIQUE, type TEXT NOT NULL, price REAL NOT NULL, createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, roomId INTEGER NOT NULL, guestName TEXT NOT NULL, checkIn TEXT NOT NULL, checkOut TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Booked', createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, cancelledAt TEXT, FOREIGN KEY(roomId) REFERENCES rooms(id))`,
      `CREATE INDEX IF NOT EXISTS idx_bookings_room_dates ON bookings(roomId, status, checkIn, checkOut)`
    ], 'write');
  })();
  return initPromise;
}
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value));
const rowObj = row => row ? { ...row } : null;
const overlapSql = `SELECT id FROM bookings WHERE roomId = ? AND status = 'Booked' AND checkIn < ? AND checkOut > ? LIMIT 1`;

app.get('/api/health', async (_req, res) => {
  try { await initDb(); await db.execute('SELECT 1'); res.json({ ok: true, database: 'connected', engine: 'SQLite', persistent: Boolean(remoteUrl) }); }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

app.get('/api/rooms', async (req, res) => {
  try {
    await initDb();
    let sql = 'SELECT * FROM rooms'; const args = [];
    if (req.query.type && req.query.type !== 'All types') { sql += ' WHERE type = ?'; args.push(req.query.type); }
    sql += ' ORDER BY roomNo';
    const result = await db.execute({ sql, args });
    let rooms = result.rows.map(rowObj);
    if (req.query.checkIn && req.query.checkOut) {
      if (!validDate(req.query.checkIn) || !validDate(req.query.checkOut) || req.query.checkIn >= req.query.checkOut) return res.status(400).json({ error: 'Enter valid dates: check-out must be after check-in.' });
      const busy = await db.execute({ sql: `SELECT DISTINCT roomId FROM bookings WHERE status='Booked' AND checkIn < ? AND checkOut > ?`, args: [req.query.checkOut, req.query.checkIn] });
      const busyIds = new Set(busy.rows.map(r => Number(r.roomId)));
      rooms = rooms.map(r => ({ ...r, available: !busyIds.has(Number(r.id)) }));
    }
    res.json(rooms);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/rooms', async (req, res) => {
  try {
    const roomNo = String(req.body.roomNo || '').trim(); const type = String(req.body.type || '').trim(); const price = Number(req.body.price);
    if (!roomNo || !type || !Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Room number, room type and a positive price are required.' });
    await initDb();
    const result = await db.execute({ sql: 'INSERT INTO rooms(roomNo,type,price) VALUES(?,?,?)', args: [roomNo,type,price] });
    res.status(201).json({ id: Number(result.lastInsertRowid), roomNo, type, price });
  } catch (e) { res.status(e.message.includes('UNIQUE') ? 409 : 500).json({ error: e.message.includes('UNIQUE') ? 'That room number already exists.' : e.message }); }
});

app.put('/api/rooms/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid room id.' });
    const fields = []; const args = [];
    if (req.body.roomNo !== undefined) { fields.push('roomNo=?'); args.push(String(req.body.roomNo).trim()); }
    if (req.body.type !== undefined) { fields.push('type=?'); args.push(String(req.body.type).trim()); }
    if (req.body.price !== undefined) { const p = Number(req.body.price); if (!Number.isFinite(p) || p <= 0) return res.status(400).json({ error: 'Provide a positive price.' }); fields.push('price=?'); args.push(p); }
    if (!fields.length) return res.status(400).json({ error: 'Provide valid room fields to update.' });
    await initDb(); args.push(id);
    try { const r = await db.execute({ sql: `UPDATE rooms SET ${fields.join(',')} WHERE id=?`, args }); if (!Number(r.rowsAffected)) return res.status(404).json({ error: 'Room not found.' }); }
    catch(e) { if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'That room number already exists.' }); throw e; }
    const updated = await db.execute({ sql: 'SELECT * FROM rooms WHERE id=?', args: [id] }); res.json(rowObj(updated.rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/rooms/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid room id.' });
    await initDb(); const active = await db.execute({ sql: "SELECT id FROM bookings WHERE roomId=? AND status='Booked' LIMIT 1", args: [id] });
    if (active.rows.length) return res.status(409).json({ error: 'Cancel this room’s active bookings before deleting the room.' });
    const result = await db.execute({ sql: 'DELETE FROM rooms WHERE id=?', args: [id] }); if (!Number(result.rowsAffected)) return res.status(404).json({ error: 'Room not found.' });
    res.json({ message: 'Room deleted.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bookings', async (_req, res) => {
  try {
    await initDb(); const result = await db.execute(`SELECT b.id,b.guestName,b.checkIn,b.checkOut,b.status,b.roomId,r.roomNo,r.type AS roomType,r.price FROM bookings b LEFT JOIN rooms r ON r.id=b.roomId ORDER BY b.createdAt DESC,b.id DESC`);
    res.json(result.rows.map(r => ({ ...rowObj(r), id: Number(r.id), roomId: Number(r.roomId), roomNo: r.roomNo || 'Deleted room', roomType: r.roomType || '', price: Number(r.price || 0) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const guestName = String(req.body.guestName || '').trim(); const roomId = Number(req.body.roomId); const { checkIn, checkOut } = req.body;
    if (!guestName || guestName.length > 100 || !Number.isInteger(roomId) || roomId < 1 || !validDate(checkIn) || !validDate(checkOut) || checkIn >= checkOut) return res.status(400).json({ error: 'Enter a guest name, room, valid check-in and check-out dates (check-out after check-in).' });
    await initDb(); const roomResult = await db.execute({ sql: 'SELECT * FROM rooms WHERE id=?', args: [roomId] }); const room = rowObj(roomResult.rows[0]);
    if (!room) return res.status(404).json({ error: 'Selected room does not exist.' });
    const conflict = await db.execute({ sql: overlapSql, args: [roomId, checkOut, checkIn] });
    if (conflict.rows.length) return res.status(409).json({ error: 'This room is already booked for overlapping dates. Choose another room or date range.' });
    const result = await db.execute({ sql: "INSERT INTO bookings(roomId,guestName,checkIn,checkOut,status) VALUES(?,?,?,?,'Booked')", args: [roomId,guestName,checkIn,checkOut] });
    res.status(201).json({ id: Number(result.lastInsertRowid), roomId, guestName, checkIn, checkOut, status: 'Booked', roomNo: room.roomNo, roomType: room.type, price: Number(room.price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid booking id.' });
    await initDb(); const result = await db.execute({ sql: "UPDATE bookings SET status='Cancelled',cancelledAt=CURRENT_TIMESTAMP WHERE id=? AND status='Booked'", args: [id] });
    if (!Number(result.rowsAffected)) return res.status(404).json({ error: 'Active booking not found; it may already be cancelled.' });
    res.json({ message: 'Booking cancelled.', id, status: 'Cancelled' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Unexpected server error.' }); });
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log(`Hotel Booking API running on port ${process.env.PORT || 3000}`));
module.exports = app;
