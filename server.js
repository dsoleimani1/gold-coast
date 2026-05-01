const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
  if (!email || !password) { console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD'); process.exit(1); }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users(email,password,name,role) VALUES($1,$2,'Admin','admin') ON CONFLICT(email) DO UPDATE SET password=$2,role='admin'`,
    [email.toLowerCase(), hash]
  );
  console.log('✓ Admin created:', email); process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
