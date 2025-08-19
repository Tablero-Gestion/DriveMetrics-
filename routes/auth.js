const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const moment = require('moment');
const db = require('../db/db');
const router = express.Router();
const { OAuth2Client } = require('google-auth-library');

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

const validateEmail = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Email válido requerido');

const validateName = body('nombre')
  .isLength({ min: 2, max: 100 })
  .trim()
  .withMessage('Nombre debe tener entre 2 y 100 caracteres');

const validatePhone = body('telefono')
  .optional()
  .isMobilePhone('es-AR')
  .withMessage('Teléfono debe ser válido (formato argentino)');

router.post('/registro', [validateEmail, validateName, validatePhone], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, nombre, telefono } = req.body;

    const existingUser = await db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'El email ya está registrado' });
    }

    const trialDays = parseInt(process.env.TRIAL_DAYS, 10) || 15;
    const fechaExpiracion = moment().add(trialDays, 'days').format('YYYY-MM-DD HH:mm:ss');

    const result = await db.query(
      `INSERT INTO users (email, name, profile_data, created_at, is_active)
       VALUES (?, ?, ?, NOW(), true)`,
      [email, nombre, telefono || null, fechaExpiracion]
    );

    const userId = result.insertId;

    const token = jwt.sign(
      { userId, email, estado: 'trial' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    await db.query(
      'INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) VALUES (?, ?, ?, ?)',
      [userId, 'registro', req.ip, req.get('User-Agent')]
    );

    res.status(201).json({
      success: true,
      message: `¡Registro exitoso! Tienes ${trialDays} días gratis`,
      token,
      user: {
        id: userId,
        email,
        nombre,
        estado: 'trial',
        diasRestantes: trialDays,
        fechaExpiracion
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.post('/login', [validateEmail], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    const { email } = req.body;
    const user = await db.queryOne(
      `SELECT id, email, name, profile_data, created_at, is_active
       FROM users WHERE email = ?`,
      [email]
    );
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email no registrado' });
    }
    if (user.bloqueado_hasta && moment().isBefore(user.bloqueado_hasta)) {
      const minutosRestantes = moment(user.bloqueado_hasta).diff(moment(), 'minutes');
      return res.status(423).json({ success: false, message: `Cuenta bloqueada. Intenta en ${minutosRestantes} minutos` });
    }
    let estadoActual = user.estado_suscripcion;
    let diasRestantes = 0;
    if (estadoActual === 'trial') {
      diasRestantes = moment(user.fecha_expiracion_gratuita).diff(moment(), 'days');
      if (diasRestantes <= 0) {
        estadoActual = 'vencida';
        await db.query('UPDATE usuarios SET estado_suscripcion = ? WHERE id = ?', ['vencida', user.id]);
      }
    }
    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    const token = jwt.sign({ userId: user.id, email: user.email, estado: estadoActual }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await db.query('INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) VALUES (?, ?, ?, ?)', [user.id, 'login', req.ip, req.get('User-Agent')]);
    res.json({ success: true, message: 'Login exitoso', token, user: { id: user.id, email: user.email, nombre: user.nombre, estado: estadoActual, diasRestantes: Math.max(0, diasRestantes), fechaExpiracion: user.fecha_expiracion_gratuita } });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

router.get('/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ success: false, message: 'Token requerido' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.queryOne(
      `SELECT id, email, name, created_at, is_active FROM users WHERE id = ?`,
      [decoded.userId]
    );
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no válido' });
    let estadoActual = user.estado_suscripcion;
    let diasRestantes = 0;
    if (estadoActual === 'trial') {
      diasRestantes = moment(user.fecha_expiracion_gratuita).diff(moment(), 'days');
      if (diasRestantes <= 0) {
        estadoActual = 'vencida';
        await db.query('UPDATE usuarios SET estado_suscripcion = ? WHERE id = ?', ['vencida', user.id]);
      }
    }
    res.json({ success: true, user: { id: user.id, email: user.email, nombre: user.nombre, estado: estadoActual, diasRestantes: Math.max(0, diasRestantes), fechaExpiracion: user.fecha_expiracion_gratuita } });
  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      await db.query('INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) VALUES (?, ?, ?, ?)', [decoded.userId, 'logout', req.ip, req.get('User-Agent')]);
    }
    res.json({ success: true, message: 'Logout exitoso' });
  } catch (error) {
    console.error('Error en logout:', error);
    res.json({ success: true, message: 'Logout exitoso' });
  }
});

// Obtener client_id público para el frontend
router.get('/google-client', (req, res) => {
  res.json({ success: true, clientId: process.env.GOOGLE_CLIENT_ID || '' });
});

// Login/registro con Google ID Token
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ success: false, message: 'Falta credential de Google' });
    if (!googleClient) return res.status(500).json({ success: false, message: 'Google Client ID no configurado' });

    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const email = payload?.email;
    const nombre = payload?.name || payload?.given_name || 'Usuario';
    if (!email) return res.status(400).json({ success: false, message: 'No se pudo obtener email de Google' });

    let user = await db.queryOne('SELECT id, email, nombre, estado_suscripcion, fecha_expiracion_gratuita FROM usuarios WHERE email = ?', [email]);
    let userId;
    if (!user) {
      const trialDays = parseInt(process.env.TRIAL_DAYS, 10) || 15;
      const fechaExpiracion = moment().add(trialDays, 'days').format('YYYY-MM-DD HH:mm:ss');
      const result = await db.query(
        `INSERT INTO usuarios (email, nombre, telefono, fecha_expiracion_gratuita, estado_suscripcion)
         VALUES (?, ?, NULL, ?, 'trial')`,
        [email, nombre, fechaExpiracion]
      );
      userId = result.insertId;
      user = { id: userId, email, nombre, estado_suscripcion: 'trial', fecha_expiracion_gratuita: fechaExpiracion };
      await db.query('INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) VALUES (?, ?, ?, ?)', [userId, 'registro_google', req.ip, req.get('User-Agent')]);
    } else {
      userId = user.id;
      await db.query('UPDATE usuarios SET ultima_actividad = NOW() WHERE id = ?', [userId]);
    }

    const token = jwt.sign({ userId, email, estado: user.estado_suscripcion }, process.env.JWT_SECRET, { expiresIn: '30d' });
    await db.query('INSERT INTO logs_actividad (usuario_id, accion, ip_address, user_agent) VALUES (?, ?, ?, ?)', [userId, 'login_google', req.ip, req.get('User-Agent')]);

    // calcular días restantes si está en trial
    let diasRestantes = 0;
    let estadoActual = user.estado_suscripcion;
    if (estadoActual === 'trial' && user.fecha_expiracion_gratuita) {
      diasRestantes = moment(user.fecha_expiracion_gratuita).diff(moment(), 'days');
    }

    res.json({ success: true, token, user: { id: userId, email, nombre: user.nombre, estado: estadoActual, diasRestantes: Math.max(0, diasRestantes), fechaExpiracion: user.fecha_expiracion_gratuita } });
  } catch (error) {
    console.error('Error Google Auth:', error);
    res.status(401).json({ success: false, message: 'Token de Google inválido' });
  }
});

module.exports = router;


