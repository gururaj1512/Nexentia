const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getPool } = require('./db');
const { runtimeConfig } = require('./runtimeConfig');

const tokenExpiry = runtimeConfig.auth?.tokenExpiry || '44h';
const saltRounds = Number.isInteger(runtimeConfig.auth?.saltRounds)
  ? runtimeConfig.auth.saltRounds
  : 10;

function getJwtSecret() {
  const jwtSecret = runtimeConfig.auth?.jwtSecret;
  if (!jwtSecret) {
    throw new Error('JWT secret is missing. Set JWT_SECRET or config.auth.jwtSecret.');
  }
  return jwtSecret;
}

async function register(username, email, password) {
  const pool = getPool();
  const hash = await bcrypt.hash(password, saltRounds);
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
    [username, email, hash]
  );
  return rows[0];
}

async function login(email, password) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  if (rows.length === 0) throw new Error('Invalid credentials');

  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new Error('Invalid credentials');

  const token = jwt.sign({ userId: user.id, username: user.username }, getJwtSecret(), {
    expiresIn: tokenExpiry
  });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, token, expiresAt]
  );

  return { token, user: { id: user.id, username: user.username, email: user.email } };
}

async function logout(token) {
  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

async function isTokenRevoked(token) {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT id FROM sessions WHERE token = $1 AND expires_at > NOW()',
    [token]
  );
  return rows.length === 0;
}

module.exports = { register, login, logout, verifyToken, isTokenRevoked };