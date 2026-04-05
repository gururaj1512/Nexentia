const { Pool } = require('pg');
const { runtimeConfig } = require('./runtimeConfig');

let pool;

function getPool() {
  if (pool) return pool;

  const connectionString = runtimeConfig.database?.connectionString;
  if (!connectionString) {
    throw new Error('Database connection string is missing. Set DATABASE_URL or config.database.connectionString.');
  }

  const shouldUseSsl = runtimeConfig.database?.ssl !== false;
  const rejectUnauthorized = !!runtimeConfig.database?.sslRejectUnauthorized;

  pool = new Pool({
    connectionString,
    ssl: shouldUseSsl ? { rejectUnauthorized } : false,
  });

  return pool;
}

async function init() {
  const activePool = getPool();
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[DB] Tables ready');
}

module.exports = { getPool, init };
