const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const moment = require('moment');
const db = require('../db/db');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const preference = new Preference(client);
const payment = new Payment(client);

router.post('/create-preference', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.user;
    const precio = parseFloat(process.env.MONTHLY_PRICE) || 1500;

    const usuario = await db.queryOne('SELECT id, email, nombre FROM usuarios WHERE id = ?', [userId]);
    if (!usuario) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const preferenceData = {
      items: [
        {
          id: 'calculadora_premium_monthly',
          title: 'DriveMetrics Pro - Suscripción Mensual',
          description: 'Acceso premium a herramientas avanzadas para drivers',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: precio
        }
      ],
      payer: { email: usuario.email, name: usuario.nombre },
      payment_methods: { excluded_payment_methods: [], excluded_payment_types: [], installments: 1 },
      back_urls: {
        success: `${process.env.DOMAIN_URL}/payment/success`,
        failure: `${process.env.DOMAIN_URL}/payment/failure`,
        pending: `${process.env.DOMAIN_URL}/payment/pending`
      },
      auto_return: 'approved',
      external_reference: `USER_${userId}_${Date.now()}`,
      notification_url: `${process.env.DOMAIN_URL}/api/payments/webhook`,
      metadata: { user_id: userId, plan: 'monthly' }
    };

    const mpPreference = await preference.create({ body: preferenceData });

    const fechaInicio = moment().format('YYYY-MM-DD');
    const fechaVencimiento = moment().add(1, 'month').format('YYYY-MM-DD');
    await db.query(
      `INSERT INTO suscripciones (usuario_id, precio, fecha_inicio, fecha_vencimiento, mercadopago_preference_id, estado)
       VALUES (?, ?, ?, ?, ?, 'pendiente')`,
      [userId, precio, fechaInicio, fechaVencimiento, mpPreference.id]
    );
    await db.query(
      'INSERT INTO logs_actividad (usuario_id, accion, detalles) VALUES (?, ?, ?)',
      [userId, 'crear_preferencia_pago', JSON.stringify({ preference_id: mpPreference.id, precio })]
    );

    res.json({ success: true, preference_id: mpPreference.id, init_point: mpPreference.init_point, sandbox_init_point: mpPreference.sandbox_init_point, precio });
  } catch (error) {
    console.error('Error creando preferencia:', error);
    res.status(500).json({ success: false, message: 'Error creando preferencia de pago' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const { type, data } = req.body || {};
    if (type === 'payment') {
      const paymentId = data.id;
      const paymentInfo = await payment.get({ id: paymentId });
      const status = paymentInfo.status;
      const metadata = paymentInfo.metadata || {};
      const userId = metadata.user_id;
      if (!userId) return res.status(200).send('OK');

      const suscripcion = await db.queryOne(
        `SELECT id FROM suscripciones WHERE usuario_id = ? AND estado = 'pendiente' ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (!suscripcion) return res.status(200).send('OK');

      if (status === 'approved') {
        await db.transaction(async (conn) => {
          await conn.execute(
            `UPDATE suscripciones SET estado = 'activa', mercadopago_payment_id = ?, mercadopago_status = ? WHERE id = ?`,
            [paymentId, status, suscripcion.id]
          );
          await conn.execute('UPDATE usuarios SET estado_suscripcion = ? WHERE id = ?', ['activa', userId]);
          await conn.execute(
            'INSERT INTO logs_actividad (usuario_id, accion, detalles) VALUES (?, ?, ?)',
            [userId, 'pago_aprobado', JSON.stringify({ payment_id: paymentId, amount: paymentInfo.transaction_amount })]
          );
        });
      } else if (status === 'rejected' || status === 'cancelled') {
        await db.query(
          `UPDATE suscripciones SET mercadopago_payment_id = ?, mercadopago_status = ?, estado = 'cancelada' WHERE id = ?`,
          [paymentId, status, suscripcion.id]
        );
      }
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error en webhook:', error);
    res.status(500).send('Error');
  }
});

router.get('/status/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.userId !== parseInt(userId)) return res.status(403).json({ success: false, message: 'No autorizado' });
    const usuario = await db.queryOne(
      `SELECT u.id, u.email, u.nombre, u.estado_suscripcion, u.fecha_expiracion_gratuita,
              s.id as suscripcion_id, s.estado as estado_suscripcion, s.fecha_vencimiento,
              s.mercadopago_status, s.precio
       FROM usuarios u
       LEFT JOIN suscripciones s ON u.id = s.usuario_id AND s.estado IN ('activa', 'pendiente')
       WHERE u.id = ?
       ORDER BY s.created_at DESC LIMIT 1`,
      [userId]
    );
    if (!usuario) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    let diasRestantes = 0;
    let tipoRestante = 'trial';
    if (usuario.estado_suscripcion === 'trial') diasRestantes = moment(usuario.fecha_expiracion_gratuita).diff(moment(), 'days');
    else if (usuario.estado_suscripcion === 'activa' && usuario.fecha_vencimiento) {
      diasRestantes = moment(usuario.fecha_vencimiento).diff(moment(), 'days');
      tipoRestante = 'suscripcion';
    }
    res.json({ success: true, usuario: { id: usuario.id, email: usuario.email, nombre: usuario.nombre, estado: usuario.estado_suscripcion, diasRestantes: Math.max(0, diasRestantes), tipoRestante, fechaExpiracion: usuario.estado_suscripcion === 'trial' ? usuario.fecha_expiracion_gratuita : usuario.fecha_vencimiento, suscripcion: usuario.suscripcion_id ? { id: usuario.suscripcion_id, estado: usuario.estado_suscripcion, precio: usuario.precio, fechaVencimiento: usuario.fecha_vencimiento, mercadopago_status: usuario.mercadopago_status } : null } });
  } catch (error) {
    console.error('Error obteniendo estado:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;


