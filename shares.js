const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Users (invite-only)
      CREATE TABLE IF NOT EXISTS users (
        id          SERIAL PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        name        TEXT,
        role        TEXT DEFAULT 'user',  -- 'admin' or 'user'
        active      BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Invite tokens
      CREATE TABLE IF NOT EXISTS invites (
        id          SERIAL PRIMARY KEY,
        token       TEXT UNIQUE NOT NULL,
        email       TEXT,
        created_by  INT REFERENCES users(id),
        used        BOOLEAN DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Clients
      CREATE TABLE IF NOT EXISTS clients (
        id          SERIAL PRIMARY KEY,
        user_id     INT REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        phone       TEXT,
        email       TEXT,
        notes       TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Properties
      CREATE TABLE IF NOT EXISTS properties (
        id          SERIAL PRIMARY KEY,
        client_id   INT REFERENCES clients(id) ON DELETE CASCADE,
        user_id     INT REFERENCES users(id) ON DELETE CASCADE,
        nickname    TEXT,
        house       TEXT,
        street      TEXT,
        borough     TEXT,
        bin         TEXT,
        bldg_type   TEXT,
        notes       TEXT,
        last_searched TIMESTAMPTZ,
        last_bin    TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Recent searches
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

      -- Shared report snapshots
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

      -- Watched properties (auto-refresh)
      CREATE TABLE IF NOT EXISTS watches (
        id            SERIAL PRIMARY KEY,
        user_id       INT REFERENCES users(id) ON DELETE CASCADE,
        property_id   INT REFERENCES properties(id) ON DELETE CASCADE,
        interval_hours INT DEFAULT 24,
        last_checked  TIMESTAMPTZ,
        last_snapshot JSONB,
        new_violations INT DEFAULT 0,
        active        BOOLEAN DEFAULT true,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_clients_user    ON clients(user_id);
      CREATE INDEX IF NOT EXISTS idx_properties_client ON properties(client_id);
      CREATE INDEX IF NOT EXISTS idx_searches_user   ON recent_searches(user_id);
      CREATE INDEX IF NOT EXISTS idx_shares_token    ON shares(token);
      CREATE INDEX IF NOT EXISTS idx_watches_user    ON watches(user_id);
    `);
    console.log('✓ Database schema ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
