const express    = require('express');
const session    = require('express-session');
const pgSession  = require('connect-pg-simple')(session);
const bcrypt     = require('bcryptjs');
const { Pool }   = require('pg');
const { v4: uuid } = require('uuid');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── AUTH HELPERS ──────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  if (req.session?.userId && req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin required' });
}

// ── DATABASE INIT ─────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      name       TEXT,
      role       TEXT DEFAULT 'user',
      active     BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS invites (
      id         SERIAL PRIMARY KEY,
      token      TEXT UNIQUE NOT NULL,
      email      TEXT,
      used       BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clients (
      id         SERIAL PRIMARY KEY,
      user_id    INT REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      phone      TEXT,
      email      TEXT,
      notes      TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS properties (
      id            SERIAL PRIMARY KEY,
      client_id     INT REFERENCES clients(id) ON DELETE CASCADE,
      user_id       INT REFERENCES users(id) ON DELETE CASCADE,
      nickname      TEXT,
      house         TEXT,
      street        TEXT,
      borough       TEXT,
      bin           TEXT,
      bldg_type     TEXT,
      notes         TEXT,
      last_searched TIMESTAMPTZ,
      last_bin      TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS recent_searches (
      id          SERIAL PRIMARY KEY,
      user_id     INT REFERENCES users(id) ON DELETE CASCADE,
      house       TEXT,
      street      TEXT,
      borough     TEXT,
      bin         TEXT,
      label       TEXT,
      searched_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS shares (
      id          SERIAL PRIMARY KEY,
      token       TEXT UNIQUE NOT NULL,
      user_id     INT REFERENCES users(id) ON DELETE CASCADE,
      label       TEXT,
      snapshot    JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
      view_count  INT DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_clients_user   ON clients(user_id);
    CREATE INDEX IF NOT EXISTS idx_props_client   ON properties(client_id);
    CREATE INDEX IF NOT EXISTS idx_searches_user  ON recent_searches(user_id);
    CREATE INDEX IF NOT EXISTS idx_shares_token   ON shares(token);
  `);
  console.log('✓ DB schema ready');
}

// ── START ─────────────────────────────────────────────────────────────────────
async function start() {
  await initDB();

  app.use(session({
    store: new pgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || 'gcc-dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true
    }
  }));

  // ── AUTH ROUTES ─────────────────────────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
      const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND active=true', [email.toLowerCase()]);
      const user = rows[0];
      if (!user || !await bcrypt.compare(password, user.password))
        return res.status(401).json({ error: 'Invalid credentials' });
      req.session.userId = user.id;
      req.session.role   = user.role;
      req.session.name   = user.name;
      res.json({ ok: true, name: user.name, role: user.role });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT id,email,name,role FROM users WHERE id=$1', [req.session.userId]);
    res.json(rows[0] || null);
  });

  app.post('/api/auth/register', async (req, res) => {
    const { token, name, email, password } = req.body;
    if (!token || !name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inv = await client.query('SELECT * FROM invites WHERE token=$1 AND used=false', [token]);
      if (!inv.rows[0]) return res.status(400).json({ error: 'Invalid or expired invite' });
      const hash = await bcrypt.hash(password, 12);
      const { rows } = await client.query(
        'INSERT INTO users(email,password,name) VALUES($1,$2,$3) RETURNING id,name,role',
        [email.toLowerCase(), hash, name]
      );
      await client.query('UPDATE invites SET used=true WHERE token=$1', [token]);
      await client.query('COMMIT');
      req.session.userId = rows[0].id;
      req.session.role   = rows[0].role;
      req.session.name   = rows[0].name;
      res.json({ ok: true, name: rows[0].name });
    } catch(e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') return res.status(400).json({ error: 'Email already registered' });
      res.status(500).json({ error: e.message });
    } finally { client.release(); }
  });

  // ── CLIENT ROUTES ───────────────────────────────────────────────────────────
  app.get('/api/clients', requireAuth, async (req, res) => {
    const { rows: clients } = await pool.query('SELECT * FROM clients WHERE user_id=$1 ORDER BY name', [req.session.userId]);
    const { rows: props }   = await pool.query('SELECT * FROM properties WHERE user_id=$1 ORDER BY nickname,street', [req.session.userId]);
    res.json(clients.map(c => ({ ...c, properties: props.filter(p => p.client_id === c.id) })));
  });

  app.post('/api/clients', requireAuth, async (req, res) => {
    const { name, phone, email, notes } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO clients(user_id,name,phone,email,notes) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [req.session.userId, name, phone||null, email||null, notes||null]
    );
    res.json(rows[0]);
  });

  app.put('/api/clients/:id', requireAuth, async (req, res) => {
    const { name, phone, email, notes } = req.body;
    const { rows } = await pool.query(
      'UPDATE clients SET name=$1,phone=$2,email=$3,notes=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *',
      [name, phone||null, email||null, notes||null, req.params.id, req.session.userId]
    );
    res.json(rows[0] || null);
  });

  app.delete('/api/clients/:id', requireAuth, async (req, res) => {
    await pool.query('DELETE FROM clients WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ ok: true });
  });

  // ── PROPERTY ROUTES ─────────────────────────────────────────────────────────
  app.post('/api/clients/:clientId/properties', requireAuth, async (req, res) => {
    const { nickname, house, street, borough, bin, bldg_type, notes } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO properties(client_id,user_id,nickname,house,street,borough,bin,bldg_type,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.params.clientId, req.session.userId, nickname||null, house||null, street||null,
       borough||null, bin||null, bldg_type||null, notes||null]
    );
    res.json(rows[0]);
  });

  app.put('/api/properties/:id', requireAuth, async (req, res) => {
    const { nickname, house, street, borough, bin, bldg_type, notes, last_bin } = req.body;
    const { rows } = await pool.query(
      `UPDATE properties SET nickname=$1,house=$2,street=$3,borough=$4,bin=$5,
       bldg_type=$6,notes=$7,last_bin=$8,updated_at=NOW() WHERE id=$9 AND user_id=$10 RETURNING *`,
      [nickname||null, house||null, street||null, borough||null, bin||null,
       bldg_type||null, notes||null, last_bin||null, req.params.id, req.session.userId]
    );
    res.json(rows[0] || null);
  });

  app.post('/api/properties/:id/searched', requireAuth, async (req, res) => {
    await pool.query('UPDATE properties SET last_searched=NOW(),last_bin=$1 WHERE id=$2 AND user_id=$3',
      [req.body.bin||null, req.params.id, req.session.userId]);
    res.json({ ok: true });
  });

  app.delete('/api/properties/:id', requireAuth, async (req, res) => {
    await pool.query('DELETE FROM properties WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ ok: true });
  });

  // ── RECENT SEARCHES ─────────────────────────────────────────────────────────
  app.get('/api/searches', requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT * FROM recent_searches WHERE user_id=$1 ORDER BY searched_at DESC LIMIT 10',
      [req.session.userId]
    );
    res.json(rows);
  });

  app.post('/api/searches', requireAuth, async (req, res) => {
    const { house, street, borough, bin, label } = req.body;
    await pool.query(
      `DELETE FROM recent_searches WHERE user_id=$1 AND LOWER(COALESCE(house,''))=LOWER($2) AND LOWER(COALESCE(street,''))=LOWER($3)`,
      [req.session.userId, house||'', street||'']
    );
    const { rows } = await pool.query(
      'INSERT INTO recent_searches(user_id,house,street,borough,bin,label) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.session.userId, house||null, street||null, borough||null, bin||null, label||null]
    );
    await pool.query(
      `DELETE FROM recent_searches WHERE user_id=$1 AND id NOT IN (
         SELECT id FROM recent_searches WHERE user_id=$1 ORDER BY searched_at DESC LIMIT 10
       )`, [req.session.userId]
    );
    res.json(rows[0]);
  });

  app.delete('/api/searches/:id', requireAuth, async (req, res) => {
    await pool.query('DELETE FROM recent_searches WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ ok: true });
  });

  // ── SHARES ──────────────────────────────────────────────────────────────────
  app.post('/api/shares', requireAuth, async (req, res) => {
    const { label, snapshot } = req.body;
    if (!snapshot) return res.status(400).json({ error: 'Snapshot required' });
    const token = uuid();
    const { rows } = await pool.query(
      'INSERT INTO shares(token,user_id,label,snapshot) VALUES($1,$2,$3,$4) RETURNING id,token,label,created_at,expires_at',
      [token, req.session.userId, label||'Property Report', snapshot]
    );
    res.json({ ...rows[0], url: `${req.protocol}://${req.get('host')}/share/${token}` });
  });

  app.get('/api/shares', requireAuth, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT id,token,label,created_at,expires_at,view_count FROM shares WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',
      [req.session.userId]
    );
    const host = `${req.protocol}://${req.get('host')}`;
    res.json(rows.map(r => ({ ...r, url: `${host}/share/${r.token}` })));
  });

  app.get('/api/shares/:token', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM shares WHERE token=$1 AND expires_at > NOW()', [req.params.token]);
    if (!rows[0]) return res.status(404).json({ error: 'Report not found or expired' });
    await pool.query('UPDATE shares SET view_count=view_count+1 WHERE token=$1', [req.params.token]);
    res.json({ label: rows[0].label, snapshot: rows[0].snapshot, created_at: rows[0].created_at, expires_at: rows[0].expires_at, view_count: rows[0].view_count });
  });

  app.delete('/api/shares/:id', requireAuth, async (req, res) => {
    await pool.query('DELETE FROM shares WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    res.json({ ok: true });
  });

  // ── ADMIN ───────────────────────────────────────────────────────────────────
  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const { rows } = await pool.query('SELECT id,email,name,role,active,created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  });

  app.put('/api/admin/users/:id/toggle', requireAdmin, async (req, res) => {
    const { rows } = await pool.query('UPDATE users SET active=NOT active WHERE id=$1 RETURNING id,email,active', [req.params.id]);
    res.json(rows[0]);
  });

  app.post('/api/admin/invite', requireAdmin, async (req, res) => {
    const token = uuid();
    await pool.query('INSERT INTO invites(token,email) VALUES($1,$2)', [token, req.body.email||null]);
    res.json({ token, url: `${req.protocol}://${req.get('host')}/register?token=${token}` });
  });

  app.get('/api/admin/invites', requireAdmin, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM invites ORDER BY created_at DESC LIMIT 20');
    res.json(rows);
  });

  // ── STATIC ──────────────────────────────────────────────────────────────────
  app.get('/share/:token', (req, res) => res.sendFile(path.join(__dirname, 'share.html')));
  app.get('/register',     (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
  app.use(express.static(__dirname));
  app.get('*',             (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

  app.listen(PORT, () => console.log(`GCC Lookup running on port ${PORT}`));
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
