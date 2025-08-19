// server.vercel.js - Express app para Vercel usando Postgres (Neon)
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { sql } = require('@vercel/postgres');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();

const PORT = process.env.PORT || 3000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '151117015962-qhq4at3nbja8q9rq7qvspcc0sunr113u.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// MercadoPago setup (nueva API)
const MP_ACCESS_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
const mpClient = MP_ACCESS_TOKEN ? new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN }) : null;

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

  // Subscriptions
  await sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_type TEXT NOT NULL DEFAULT 'monthly',
      status TEXT DEFAULT 'pending',
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      amount NUMERIC(10,2) NOT NULL,
      currency TEXT DEFAULT 'ARS',
      mp_preference_id TEXT,
      mp_subscription_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );`;
  await sql`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);`;

  // Payments
  await sql`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL,
      mp_payment_id TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency TEXT DEFAULT 'ARS',
      status TEXT NOT NULL,
      payment_method TEXT,
      payment_date TIMESTAMPTZ,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );`;
  await sql`CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);`;
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

app.get('/api/subscription/status', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id requerido' });
    const { rows: subs } = await sql`SELECT * FROM subscriptions WHERE user_id=${user_id} ORDER BY created_at DESC LIMIT 1;`;
    if (!subs.length) return res.json({ subscription_status:'none', has_access:false });
    const s = subs[0];
    let hasAccess = false;
    if (s.status === 'active' && s.end_date) {
      hasAccess = new Date(s.end_date) > new Date();
    }
    res.json({ subscription_status: s.status, has_access: hasAccess, subscription_end_date: s.end_date });
  } catch (e) {
    console.error('status error', e);
    res.status(500).json({ error: 'Error obteniendo estado' });
  }
});

app.get('/api/payments/history', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error:'user_id requerido' });
    const { rows } = await sql`SELECT * FROM payments WHERE user_id=${user_id} ORDER BY created_at DESC;`;
    res.json({ payments: rows });
  } catch (e) {
    console.error('history error', e);
    res.status(500).json({ error: 'Error obteniendo historial' });
  }
});

app.post('/api/subscription/cancel', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error:'user_id requerido' });
    await sql`UPDATE subscriptions SET status='cancelled', updated_at=NOW() WHERE user_id=${user_id} AND status='active';`;
    res.json({ message: 'Suscripción cancelada' });
  } catch (e) {
    console.error('cancel error', e);
    res.status(500).json({ error: 'No se pudo cancelar' });
  }
});

// ====== Pagos y Suscripciones (Vercel) ======
app.post('/api/payments/create-preference', async (req, res) => {
  try {
    if (!mpClient) {
      return res.status(400).json({ error: 'MercadoPago no configurado' });
    }

    const { user_id, email, plan_type = 'monthly' } = req.body;
    if (!user_id || !email) return res.status(400).json({ error: 'user_id y email requeridos' });
    const plans = { monthly:{ price:1500, title:'DriveMetrics Pro - Mensual' }, annual:{ price:15000, title:'DriveMetrics Pro - Anual' } };
    const selected = plans[plan_type]; if(!selected) return res.status(400).json({ error:'Plan inválido' });

    const preference = {
      items: [{ title:selected.title, unit_price: selected.price, quantity:1, currency_id:'ARS', description:`Suscripción ${plan_type} a DriveMetrics Pro` }],
      payer: { email },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `user_${user_id}_${plan_type}_${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/payments/webhook`,
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now()+24*60*60*1000).toISOString()
    };

    const pref = new Preference(mpClient);
    const resp = await pref.create({ body: preference });
    await sql`INSERT INTO subscriptions (user_id, plan_type, amount, currency, status, mp_preference_id) VALUES (${user_id}, ${plan_type}, ${selected.price}, 'ARS', 'pending', ${resp.id || resp.body?.id});`;
    res.json({ preference_id: (resp.id || resp.body?.id), init_point: (resp.init_point || resp.body?.init_point), sandbox_init_point: (resp.sandbox_init_point || resp.body?.sandbox_init_point), plan: { type: plan_type, price: selected.price, title: selected.title } });
  } catch (e) {
    console.error('Error creando preferencia:', e);
    res.status(500).json({ error: 'No se pudo crear la preferencia' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    const { type, data } = req.body || {};
    if (type === 'payment' && data?.id) {
      try {
        const paymentClient = new Payment(mpClient);
        const paymentResp = await paymentClient.get({ id: data.id });
        const p = paymentResp?.body || paymentResp || {};
        if (p.status === 'approved') {
          const ref = p.external_reference || '';
          const parts = ref.split('_');
          const userId = Number(parts[1]);
          const planType = parts[2];
          const durationDays = planType === 'annual' ? 365 : 30;
          const endDate = new Date(Date.now() + durationDays*24*60*60*1000);
          const { rows: subs } = await sql`SELECT id FROM subscriptions WHERE user_id=${userId} AND status='pending' ORDER BY created_at DESC LIMIT 1;`;
          const subId = subs.length? subs[0].id : null;
          if (subId) {
            await sql`UPDATE subscriptions SET status='active', start_date=${new Date().toISOString()}, end_date=${endDate.toISOString()}, mp_subscription_id=${String(p.id)}, updated_at=NOW() WHERE id=${subId};`;
          }
          await sql`INSERT INTO payments (user_id, subscription_id, mp_payment_id, amount, currency, status, payment_method, payment_date, description) VALUES (${userId}, ${subId}, ${String(p.id)}, ${Number(p.transaction_amount)||0}, ${p.currency_id||'ARS'}, ${p.status}, ${p.payment_type_id||''}, ${new Date().toISOString()}, ${`Suscripción ${planType} - DriveMetrics Pro`});`;
        }
      } catch (err) {
        console.error('Webhook payment fetch error:', err);
      }
    }
    res.status(200).send('OK');
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(200).send('OK');
  }
});

// ====== ENDPOINT ADMIN USUARIOS (Vercel) ======
app.get('/api/usuarios', async (req, res) => {
  try {
    console.log('🔍 Conectando a PostgreSQL de Vercel...');
    
    // Consulta para obtener usuarios reales
    const { rows } = await sql`
      SELECT 
        u.id,
        u.name,
        u.email,
        u.profile_data->>'phone' as phone,
        u.created_at as registrationDate,
        u.is_active as status,
        u.last_login as lastLogin,
        s.plan_type as plan,
        s.start_date as paymentDate,
        s.status as subscriptionStatus
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
      ORDER BY u.created_at DESC
    `;

    const usuarios = rows.map(user => ({
      id: user.id,
      name: user.name || 'Sin nombre',
      email: user.email || 'Sin email',
      phone: user.phone || 'Sin teléfono',
      city: '🌐 Vercel Real',
      plan: user.plan || 'basic',
      registrationDate: user.registrationdate ? new Date(user.registrationdate).toISOString().split('T')[0] : 'N/A',
      status: user.status ? 'active' : 'inactive',
      lastLogin: user.lastlogin ? new Date(user.lastlogin).toISOString().split('T')[0] : 'N/A',
      trialEndDate: null,
      paymentDate: user.paymentdate ? new Date(user.paymentdate).toISOString().split('T')[0] : null,
      source: '🎯 USUARIO REAL'
    }));

    console.log(`📊 Encontrados ${usuarios.length} usuarios reales en Vercel`);

    // Calcular estadísticas
    const hoy = new Date().toISOString().split('T')[0];
    const usuariosHoy = usuarios.filter(u => u.registrationDate === hoy).length;
    const usuariosActivos = usuarios.filter(u => u.status === 'active').length;
    const usuariosPagados = usuarios.filter(u => u.paymentDate).length;

    res.status(200).json({
      success: true,
      usuarios: usuarios,
      total: usuarios.length,
      stats: {
        vercelUsers: usuarios.length,
        localUsers: 0,
        total: usuarios.length,
        activos: usuariosActivos,
        hoy: usuariosHoy,
        pagados: usuariosPagados
      },
      message: `✅ Mostrando ${usuarios.length} usuarios REALES de Vercel`
    });

  } catch (error) {
    console.error('❌ Error obteniendo usuarios de Vercel:', error);
    
    res.status(500).json({
      success: false,
      message: 'Error conectando a la base de datos de Vercel',
      error: error.message,
      usuarios: [],
      total: 0,
      stats: {
        vercelUsers: 0,
        localUsers: 0,
        total: 0,
        activos: 0,
        hoy: 0,
        pagados: 0
      }
    });
  }
});

// Inicializa tablas en carga de módulo (Vercel lo ejecuta en frío)
initDatabase().catch((e) => console.error('DB init error', e));

module.exports = app;


