const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const moment = require('moment');
const db = require('../db/db');
const router = express.Router();

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

    const existingUser = await db.queryOne('SELECT id FROM usuarios WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'El email ya está registrado' });
    }

    const trialDays = parseInt(process.env.TRIAL_DAYS, 10) || 15;
    const fechaExpiracion = moment().add(trialDays, 'days').format('YYYY-MM-DD HH:mm:ss');

    const result = await db.query(
      `INSERT INTO usuarios (email, nombre, telefono, fecha_expiracion_gratuita, estado_suscripcion)
       VALUES (?, ?, ?, ?, 'trial')`,
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
      `SELECT id, email, nombre, estado_suscripcion, fecha_expiracion_gratuita, intentos_login, bloqueado_hasta
       FROM usuarios WHERE email = ?`,
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
    await db.query('UPDATE usuarios SET intentos_login = 0, bloqueado_hasta = NULL, ultima_actividad = NOW() WHERE id = ?', [user.id]);
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
      `SELECT id, email, nombre, estado_suscripcion, fecha_expiracion_gratuita FROM usuarios WHERE id = ?`,
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

module.exports = router;


