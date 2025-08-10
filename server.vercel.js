// server.vercel.js - Express app para Vercel usando Postgres (Neon)
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { sql } = require('@vercel/postgres');

const app = express();

const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '151117015962-qhq4at3nbja8q9rq7qvspcc0sunr113u.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

function generateSessionToken() {
  return jwt.sign(
    { timestamp: Date.now(), random: Math.random() },
    process.env.JWT_SECRET || 'tu_secreto_jwt_super_seguro',
    { expiresIn: '30d' }
  );
}

async function verifyGoogleToken(token) {
  const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload();
}

async function initDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      google_id VARCHAR(255) UNIQUE,
      firebase_uid VARCHAR(255) UNIQUE,
      email VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      picture_url TEXT,
      provider VARCHAR(32) DEFAULT 'google',
      is_active BOOLEAN DEFAULT TRUE,
      email_verified BOOLEAN DEFAULT TRUE,
      last_login TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      profile_data JSONB,
      preferences JSONB DEFAULT '{}'::jsonb
    );`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);`;

  await sql`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token VARCHAR(255) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      ip_address VARCHAR(45),
      user_agent TEXT,
      is_active BOOLEAN DEFAULT TRUE
    );`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);`;
}

app.get('/api', async (req, res) => {
  res.json({ message: 'DriveMetrics API (Vercel) ok', db: 'postgres/neon' });
});

app.post('/api/auth/register-user', async (req, res) => {
  try {
    const { google_id, firebase_uid, email, name, picture_url, provider, google_token } = req.body;
    if (!email || !name) return res.status(400).json({ success: false, error: 'Email y nombre son requeridos' });

    let verifiedPayload = null;
    if (google_token) {
      try {
        verifiedPayload = await verifyGoogleToken(google_token);
        if (verifiedPayload.email !== email) {
          return res.status(400).json({ success: false, error: 'El token no coincide con el email proporcionado' });
        }
      } catch (e) {
        // continuar igual
      }
    }

    const { rows: existingUsers } = await sql`
      SELECT * FROM users WHERE email = ${email} OR google_id = ${google_id} LIMIT 1;`;

    let userId;
    let isNewUser = false;
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      userId = existingUser.id;
      const newGoogleId = google_id || existingUser.google_id;
      const newFirebaseUid = firebase_uid || existingUser.firebase_uid;
      await sql`
        UPDATE users SET name = ${name}, picture_url = ${picture_url}, google_id = ${newGoogleId},
               firebase_uid = ${newFirebaseUid}, last_login = NOW(), updated_at = NOW(), is_active = TRUE
        WHERE id = ${userId};`;
    } else {
      const profileData = {
        registration_ip: req.ip,
        registration_user_agent: req.get('User-Agent'),
        google_verified: !!verifiedPayload,
        registration_timestamp: new Date().toISOString()
      };
      const { rows: inserted } = await sql`
        INSERT INTO users (google_id, firebase_uid, email, name, picture_url, provider, profile_data)
        VALUES (${google_id}, ${firebase_uid}, ${email}, ${name}, ${picture_url}, ${provider || 'google'}, ${JSON.stringify(profileData)}::jsonb)
        RETURNING id;`;
      userId = inserted[0].id;
      isNewUser = true;
    }

    const sessionToken = generateSessionToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    await sql`
      INSERT INTO user_sessions (user_id, session_token, expires_at, ip_address, user_agent)
      VALUES (${userId}, ${sessionToken}, ${expiresAt.toISOString()}, ${req.ip}, ${req.get('User-Agent')});`;

    const { rows: userData } = await sql`
      SELECT id, google_id, firebase_uid, email, name, picture_url, provider, created_at, last_login
      FROM users WHERE id = ${userId};`;
    const user = userData[0];

    res.json({ success: true, message: isNewUser ? 'Usuario registrado correctamente' : 'Usuario actualizado correctamente', user_id: userId, session_token: sessionToken, user, is_new_user: isNewUser });
  } catch (error) {
    console.error('❌ Error registrando usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor', message: error.message });
  }
});

app.post('/api/auth/verify-session', async (req, res) => {
  try {
    const { session_token } = req.body;
    if (!session_token) return res.status(400).json({ success: false, error: 'Token de sesión requerido' });

    const { rows: sessions } = await sql`
      SELECT s.*, u.id as user_id, u.email, u.name, u.picture_url, u.is_active
      FROM user_sessions s JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ${session_token} AND s.expires_at > NOW() AND s.is_active = TRUE AND u.is_active = TRUE
      LIMIT 1;`;

    if (sessions.length === 0) return res.status(401).json({ success: false, error: 'Sesión inválida o expirada' });

    await sql`UPDATE user_sessions SET created_at = NOW() WHERE session_token = ${session_token};`;
    const s = sessions[0];
    res.json({ success: true, message: 'Sesión válida', user: { id: s.user_id, email: s.email, name: s.name, picture_url: s.picture_url } });
  } catch (error) {
    console.error('❌ Error verificando sesión:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

app.get('/api/user/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { rows: users } = await sql`
      SELECT id, email, name, picture_url, provider, created_at, last_login, preferences
      FROM users WHERE id = ${userId} AND is_active = TRUE LIMIT 1;`;
    if (users.length === 0) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
    const user = users[0];
    const { rows: sessionCountRows } = await sql`SELECT COUNT(*)::int as total_sessions FROM user_sessions WHERE user_id = ${userId};`;
    res.json({ success: true, user: { ...user, total_sessions: sessionCountRows[0].total_sessions } });
  } catch (error) {
    console.error('❌ Error obteniendo perfil:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const { session_token } = req.body;
    if (session_token) await sql`UPDATE user_sessions SET is_active = FALSE WHERE session_token = ${session_token};`;
    res.json({ success: true, message: 'Sesión cerrada correctamente' });
  } catch (error) {
    console.error('❌ Error cerrando sesión:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const { rows: userStatsRows } = await sql`
      SELECT 
        COUNT(*)::int as total_users,
        SUM(CASE WHEN created_at >= NOW() - INTERVAL '24 HOURS' THEN 1 ELSE 0 END)::int as new_users_today,
        SUM(CASE WHEN last_login >= NOW() - INTERVAL '24 HOURS' THEN 1 ELSE 0 END)::int as active_users_today
      FROM users WHERE is_active = TRUE;`;
    const { rows: sessionStatsRows } = await sql`
      SELECT COUNT(*)::int as active_sessions
      FROM user_sessions WHERE expires_at > NOW() AND is_active = TRUE;`;
    res.json({ success: true, stats: { ...userStatsRows[0], ...sessionStatsRows[0] } });
  } catch (error) {
    console.error('❌ Error obteniendo estadísticas:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// Inicializa tablas en carga de módulo (Vercel lo ejecuta en frío)
initDatabase().catch((e) => console.error('DB init error', e));

module.exports = app;


