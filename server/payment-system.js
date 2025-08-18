// server/payment-system.js
// Sistema completo de pagos con MercadoPago para DriveMetrics

const express = require('express');
const mercadopago = require('mercadopago');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

// Configuración de MercadoPago
mercadopago.configure({
    access_token: 'APP_USR-7537395820571509-081012-d7b15c1c5730b8ab00444c4d80b0c37d-152363070',
    integrator_id: 'dev_152363070'
});

const app = express();
app.use(express.json());

// Base de datos SQLite
const db = new sqlite3.Database('./driveMetrics.db');

// Crear tablas si no existen
db.serialize(() => {
    // Tabla de usuarios
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            registration_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            trial_start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
            subscription_status TEXT DEFAULT 'trial',
            subscription_end_date DATETIME,
            mercadopago_customer_id TEXT,
            last_payment_date DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Tabla de suscripciones
    db.run(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            plan_type TEXT NOT NULL DEFAULT 'monthly',
            status TEXT DEFAULT 'pending',
            start_date DATETIME,
            end_date DATETIME,
            amount DECIMAL(10,2) NOT NULL,
            currency TEXT DEFAULT 'ARS',
            mercadopago_subscription_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);

    // Tabla de pagos
    db.run(`
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            subscription_id INTEGER,
            mercadopago_payment_id TEXT NOT NULL,
            amount DECIMAL(10,2) NOT NULL,
            currency TEXT DEFAULT 'ARS',
            status TEXT NOT NULL,
            payment_method TEXT,
            payment_date DATETIME,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
        )
    `);
});

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acceso requerido' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
};

// Middleware para verificar suscripción activa - CONTROL ESTRICTO DE FECHAS
const checkSubscription = (req, res, next) => {
    db.get(
        `SELECT * FROM users WHERE id = ?`,
        [req.user.id],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error del servidor' });
            }

            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            const now = new Date();
            const trialStart = new Date(user.trial_start_date);
            const trialEnd = new Date(trialStart.getTime() + (15 * 24 * 60 * 60 * 1000)); // 15 días exactos

            console.log(`🔍 Verificando acceso para usuario ${user.id}:`);
            console.log(`📅 Ahora: ${now.toISOString()}`);
            console.log(`🆓 Prueba termina: ${trialEnd.toISOString()}`);
            console.log(`💳 Estado suscripción: ${user.subscription_status}`);
            console.log(`⏰ Suscripción expira: ${user.subscription_end_date}`);

            // VERIFICAR PERÍODO DE PRUEBA (15 días exactos desde registro)
            if (user.subscription_status === 'trial' && now < trialEnd) {
                const daysLeft = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
                const hoursLeft = Math.ceil((trialEnd - now) / (60 * 60 * 1000));
                
                console.log(`✅ Usuario en período de prueba: ${daysLeft} días restantes`);
                
                req.subscription = {
                    status: 'trial',
                    daysLeft: daysLeft,
                    hoursLeft: hoursLeft,
                    trialEnds: trialEnd,
                    access: 'full'
                };
                return next();
            }

            // VERIFICAR SUSCRIPCIÓN PAGADA (verificación estricta por fecha exacta)
            if (user.subscription_status === 'active' && user.subscription_end_date) {
                const subEnd = new Date(user.subscription_end_date);
                
                console.log(`🔍 Verificando suscripción pagada:`);
                console.log(`⏰ Expira: ${subEnd.toISOString()}`);
                console.log(`📅 Ahora: ${now.toISOString()}`);
                
                if (now < subEnd) {
                    const daysLeft = Math.ceil((subEnd - now) / (24 * 60 * 60 * 1000));
                    const hoursLeft = Math.ceil((subEnd - now) / (60 * 60 * 1000));
                    
                    console.log(`✅ Suscripción activa: ${daysLeft} días restantes`);
                    
                    req.subscription = {
                        status: 'active',
                        endDate: subEnd,
                        daysLeft: daysLeft,
                        hoursLeft: hoursLeft,
                        lastPayment: user.last_payment_date,
                        access: 'full'
                    };
                    return next();
                } else {
                    console.log(`❌ Suscripción EXPIRADA - Se venció el ${subEnd.toLocaleDateString('es-AR')}`);
                    
                    // MARCAR COMO EXPIRADA EN LA BASE DE DATOS
                    db.run(
                        `UPDATE users SET subscription_status = 'expired' WHERE id = ?`,
                        [user.id],
                        (err) => {
                            if (err) console.error('Error actualizando estado a expirado:', err);
                        }
                    );
                }
            }

            // SIN ACCESO - Prueba expirada o suscripción vencida
            const isTrialExpired = user.subscription_status === 'trial' && now >= trialEnd;
            const isSubscriptionExpired = user.subscription_status === 'active' && user.subscription_end_date && now >= new Date(user.subscription_end_date);
            const isExpired = user.subscription_status === 'expired';

            console.log(`❌ ACCESO DENEGADO:`);
            console.log(`🆓 Prueba expirada: ${isTrialExpired}`);
            console.log(`💳 Suscripción expirada: ${isSubscriptionExpired}`);
            console.log(`🔒 Estado expirado: ${isExpired}`);

            req.subscription = {
                status: 'expired',
                access: 'denied',
                trialExpired: isTrialExpired,
                subscriptionExpired: isSubscriptionExpired,
                needsPayment: true
            };
            
            res.status(402).json({
                error: 'Suscripción requerida',
                message: isTrialExpired 
                    ? `Tu período de prueba de 15 días expiró el ${trialEnd.toLocaleDateString('es-AR')}. ¡Suscríbete para continuar!`
                    : `Tu suscripción expiró${user.subscription_end_date ? ` el ${new Date(user.subscription_end_date).toLocaleDateString('es-AR')}` : ''}. Renueva tu suscripción para seguir usando DriveMetrics.`,
                subscription: req.subscription,
                pricing: {
                    monthly: { price: 2999, title: 'Plan Mensual' },
                    annual: { price: 29999, title: 'Plan Anual (ahorrás $6.000)' }
                }
            });
        }
    );
};

// 1. REGISTRO DE USUARIO
app.post('/api/register', [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('full_name').notEmpty().trim()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, full_name, phone } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            `INSERT INTO users (email, password, full_name, phone) VALUES (?, ?, ?, ?)`,
            [email, hashedPassword, full_name, phone],
            function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        return res.status(400).json({ error: 'El email ya está registrado' });
                    }
                    return res.status(500).json({ error: 'Error al crear usuario' });
                }

                const token = jwt.sign(
                    { id: this.lastID, email },
                    process.env.JWT_SECRET || 'your_jwt_secret',
                    { expiresIn: '30d' }
                );

                res.status(201).json({
                    message: 'Usuario registrado exitosamente',
                    token,
                    user: {
                        id: this.lastID,
                        email,
                        full_name,
                        trial_days_left: 15,
                        subscription_status: 'trial'
                    }
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Error del servidor' });
    }
});

// 2. LOGIN
app.post('/api/login', [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    db.get(
        `SELECT * FROM users WHERE email = ?`,
        [email],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error del servidor' });
            }

            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(401).json({ error: 'Credenciales inválidas' });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email },
                process.env.JWT_SECRET || 'your_jwt_secret',
                { expiresIn: '30d' }
            );

            const now = new Date();
            const trialStart = new Date(user.trial_start_date);
            const trialEnd = new Date(trialStart.getTime() + (15 * 24 * 60 * 60 * 1000));
            const trialDaysLeft = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));

            res.json({
                message: 'Login exitoso',
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    full_name: user.full_name,
                    subscription_status: user.subscription_status,
                    trial_days_left: trialDaysLeft,
                    subscription_end_date: user.subscription_end_date
                }
            });
        }
    );
});

// 3. CREAR PREFERENCIA DE PAGO PARA SUSCRIPCIÓN
app.post('/api/create-subscription-payment', authenticateToken, async (req, res) => {
    const { plan_type = 'monthly' } = req.body;
    const userId = req.user.id;

    // Precios de los planes
    const plans = {
        monthly: { price: 2999, title: 'DriveMetrics Pro - Mensual' },
        annual: { price: 29999, title: 'DriveMetrics Pro - Anual' }
    };

    const selectedPlan = plans[plan_type];
    if (!selectedPlan) {
        return res.status(400).json({ error: 'Plan inválido' });
    }

    try {
        // Crear preferencia de MercadoPago
        const preference = {
            items: [
                {
                    title: selectedPlan.title,
                    unit_price: selectedPlan.price,
                    quantity: 1,
                    currency_id: 'ARS',
                    description: `Suscripción ${plan_type} a DriveMetrics Pro - Acceso completo a métricas en tiempo real`
                }
            ],
            payer: {
                email: req.user.email
            },
            back_urls: {
                success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/success`,
                failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/failure`,
                pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/pending`
            },
            auto_return: 'approved',
            external_reference: `user_${userId}_${plan_type}_${Date.now()}`,
            notification_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhook/mercadopago`,
            expires: true,
            expiration_date_from: new Date().toISOString(),
            expiration_date_to: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 horas
        };

        const response = await mercadopago.preferences.create(preference);

        // Guardar información de la suscripción pendiente
        db.run(
            `INSERT INTO subscriptions (user_id, plan_type, amount, currency, status) 
             VALUES (?, ?, ?, ?, ?)`,
            [userId, plan_type, selectedPlan.price, 'ARS', 'pending'],
            function(err) {
                if (err) {
                    console.error('Error saving subscription:', err);
                }
            }
        );

        res.json({
            preference_id: response.body.id,
            init_point: response.body.init_point,
            sandbox_init_point: response.body.sandbox_init_point,
            plan: {
                type: plan_type,
                price: selectedPlan.price,
                title: selectedPlan.title
            }
        });

    } catch (error) {
        console.error('Error creating payment preference:', error);
        res.status(500).json({ error: 'Error al crear preferencia de pago' });
    }
});

// 4. WEBHOOK DE MERCADOPAGO
app.post('/api/webhook/mercadopago', async (req, res) => {
    const { type, data, action } = req.body;

    if (type === 'payment') {
        try {
            // Obtener información del pago
            const payment = await mercadopago.payment.findById(data.id);
            const paymentData = payment.body;

            console.log('Payment webhook received:', paymentData);

            if (paymentData.status === 'approved') {
                // Extraer información del external_reference
                const externalRef = paymentData.external_reference;
                const refParts = externalRef.split('_');
                const userId = parseInt(refParts[1]);
                const planType = refParts[2];

                // Activar suscripción
                await activateSubscription(userId, planType, paymentData);
            }

        } catch (error) {
            console.error('Error processing webhook:', error);
        }
    }

    res.status(200).send('OK');
});

// Función para activar suscripción - PAGO POR MES EXACTO
async function activateSubscription(userId, planType, paymentData) {
    const paymentDate = new Date(); // Fecha exacta del pago
    let endDate;

    // Calcular fecha de expiración exacta desde el momento del pago
    if (planType === 'monthly') {
        endDate = new Date(paymentDate);
        endDate.setMonth(endDate.getMonth() + 1); // Exactamente 1 mes desde hoy
    } else if (planType === 'annual') {
        endDate = new Date(paymentDate);
        endDate.setFullYear(endDate.getFullYear() + 1); // Exactamente 1 año desde hoy
    }

    console.log(`💰 Activando suscripción para usuario ${userId}:`);
    console.log(`📅 Fecha de pago: ${paymentDate.toISOString()}`);
    console.log(`⏰ Expira el: ${endDate.toISOString()}`);
    console.log(`💳 Plan: ${planType}`);

    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Actualizar usuario - ACTIVAR POR TIEMPO EXACTO
            db.run(
                `UPDATE users 
                 SET subscription_status = 'active', 
                     subscription_end_date = ?, 
                     last_payment_date = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [endDate.toISOString(), paymentDate.toISOString(), userId],
                (err) => {
                    if (err) {
                        console.error('❌ Error actualizando usuario:', err);
                        db.run('ROLLBACK');
                        return reject(err);
                    }
                    console.log('✅ Usuario actualizado correctamente');
                }
            );

            // Crear nueva suscripción (no actualizar pendiente, crear nueva)
            db.run(
                `INSERT INTO subscriptions 
                 (user_id, plan_type, status, start_date, end_date, amount, currency, mercadopago_subscription_id)
                 VALUES (?, ?, 'active', ?, ?, ?, ?, ?)`,
                [
                    userId, 
                    planType, 
                    paymentDate.toISOString(), 
                    endDate.toISOString(),
                    paymentData.transaction_amount,
                    paymentData.currency_id,
                    paymentData.id
                ],
                function(err) {
                    if (err) {
                        console.error('❌ Error creando suscripción:', err);
                        db.run('ROLLBACK');
                        return reject(err);
                    }
                    console.log('✅ Suscripción creada correctamente');

                    const subscriptionId = this.lastID;

                    // Registrar pago vinculado a la suscripción
                    db.run(
                        `INSERT INTO payments 
                         (user_id, subscription_id, mercadopago_payment_id, amount, currency, status, payment_method, payment_date, description)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            userId,
                            subscriptionId,
                            paymentData.id,
                            paymentData.transaction_amount,
                            paymentData.currency_id,
                            paymentData.status,
                            paymentData.payment_type_id,
                            paymentDate.toISOString(),
                            `Suscripción ${planType} - DriveMetrics Pro (Válida hasta ${endDate.toLocaleDateString('es-AR')})`
                        ],
                        (err) => {
                            if (err) {
                                console.error('❌ Error registrando pago:', err);
                                db.run('ROLLBACK');
                                return reject(err);
                            }

                            console.log('✅ Pago registrado correctamente');
                            
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    console.error('❌ Error en commit:', err);
                                    return reject(err);
                                }
                                console.log('🎉 Suscripción activada exitosamente');
                                resolve();
                            });
                        }
                    );
                }
            );
        });
    });
}

// 5. VERIFICAR ESTADO DE SUSCRIPCIÓN - CON CONTROL ESTRICTO DE TIEMPO
app.get('/api/subscription/status', authenticateToken, (req, res) => {
    db.get(
        `SELECT u.*, 
                s.plan_type, s.start_date as sub_start_date, s.end_date as sub_end_date,
                p.payment_date as last_payment_date
         FROM users u
         LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
         LEFT JOIN payments p ON u.id = p.user_id 
         WHERE u.id = ?
         ORDER BY p.payment_date DESC
         LIMIT 1`,
        [req.user.id],
        (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Error del servidor' });
            }

            if (!user) {
                return res.status(404).json({ error: 'Usuario no encontrado' });
            }

            const now = new Date();
            const trialStart = new Date(user.trial_start_date);
            const trialEnd = new Date(trialStart.getTime() + (15 * 24 * 60 * 60 * 1000));

            let status = {
                user_id: user.id,
                email: user.email,
                full_name: user.full_name,
                subscription_status: user.subscription_status,
                has_access: false,
                trial_days_left: 0,
                subscription_end_date: user.subscription_end_date,
                plan_type: user.plan_type,
                days_left_total: 0,
                hours_left_total: 0,
                is_trial: false,
                is_active_paid: false,
                is_expired: true,
                last_payment_date: user.last_payment_date,
                next_payment_needed: null
            };

            console.log(`📊 Estado de suscripción para usuario ${user.id}:`);
            console.log(`📅 Ahora: ${now.toISOString()}`);
            console.log(`🆓 Prueba de ${trialStart.toISOString()} a ${trialEnd.toISOString()}`);

            // VERIFICAR PERÍODO DE PRUEBA
            if (user.subscription_status === 'trial' && now < trialEnd) {
                const daysLeft = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
                const hoursLeft = Math.ceil((trialEnd - now) / (60 * 60 * 1000));
                
                status.has_access = true;
                status.is_trial = true;
                status.is_expired = false;
                status.trial_days_left = daysLeft;
                status.days_left_total = daysLeft;
                status.hours_left_total = hoursLeft;
                status.next_payment_needed = trialEnd;
                
                console.log(`✅ Usuario en PRUEBA GRATUITA - ${daysLeft} días restantes`);
            }
            // VERIFICAR SUSCRIPCIÓN PAGADA
            else if (user.subscription_status === 'active' && user.subscription_end_date) {
                const subEnd = new Date(user.subscription_end_date);
                
                if (now < subEnd) {
                    const daysLeft = Math.ceil((subEnd - now) / (24 * 60 * 60 * 1000));
                    const hoursLeft = Math.ceil((subEnd - now) / (60 * 60 * 1000));
                    
                    status.has_access = true;
                    status.is_active_paid = true;
                    status.is_expired = false;
                    status.days_left_total = daysLeft;
                    status.hours_left_total = hoursLeft;
                    status.subscription_end_date = subEnd;
                    
                    // Calcular cuándo necesita pagar de nuevo
                    const nextPaymentDate = new Date(subEnd);
                    status.next_payment_needed = nextPaymentDate;
                    
                    console.log(`✅ Suscripción ACTIVA - ${daysLeft} días restantes hasta ${subEnd.toLocaleDateString('es-AR')}`);
                } else {
                    console.log(`❌ Suscripción EXPIRADA - Se venció el ${subEnd.toLocaleDateString('es-AR')}`);
                    
                    // Auto-expirar en la base de datos
                    db.run(
                        `UPDATE users SET subscription_status = 'expired' WHERE id = ?`,
                        [user.id],
                        (err) => {
                            if (err) console.error('Error actualizando a expirado:', err);
                        }
                    );
                    
                    status.subscription_status = 'expired';
                    status.next_payment_needed = now; // Necesita pagar ahora
                }
            }
            // PRUEBA EXPIRADA O SIN SUSCRIPCIÓN
            else {
                const isTrialExpired = user.subscription_status === 'trial' && now >= trialEnd;
                
                if (isTrialExpired) {
                    console.log(`❌ PRUEBA GRATUITA EXPIRADA - Se venció el ${trialEnd.toLocaleDateString('es-AR')}`);
                    status.next_payment_needed = trialEnd;
                    
                    // Marcar como expirada si aún está como trial
                    db.run(
                        `UPDATE users SET subscription_status = 'expired' WHERE id = ?`,
                        [user.id],
                        (err) => {
                            if (err) console.error('Error actualizando trial expirado:', err);
                        }
                    );
                } else {
                    console.log(`❌ SIN ACCESO - Estado: ${user.subscription_status}`);
                    status.next_payment_needed = now;
                }
            }

            res.json(status);
        }
    );
});

// 6. RUTA PROTEGIDA PARA DATOS PREMIUM
app.get('/api/premium/metrics', authenticateToken, checkSubscription, (req, res) => {
    // Esta ruta solo es accesible para usuarios con suscripción activa o en período de prueba
    res.json({
        message: 'Datos premium de DriveMetrics',
        realtime_data: {
            // Aquí irían los datos reales de la aplicación
            platforms: {
                uber: { demand: 85, surge: 1.5, avgEarnings: 1200 },
                didi: { demand: 72, surge: 1.3, avgEarnings: 950 },
                pedidosya: { demand: 90, surge: 1.8, avgEarnings: 1400 },
                rappi: { demand: 88, surge: 1.6, avgEarnings: 1300 }
            },
            recommendations: [
                {
                    type: 'platform',
                    priority: 'high',
                    message: 'Cambia a PedidosYa',
                    detail: 'Ganancias promedio: $1400/viaje (1.8x surge)'
                }
            ],
            subscription: req.subscription
        }
    });
});

// 7. HISTORIAL DE PAGOS
app.get('/api/payments/history', authenticateToken, (req, res) => {
    db.all(
        `SELECT p.*, s.plan_type 
         FROM payments p
         LEFT JOIN subscriptions s ON p.subscription_id = s.id
         WHERE p.user_id = ?
         ORDER BY p.created_at DESC`,
        [req.user.id],
        (err, payments) => {
            if (err) {
                return res.status(500).json({ error: 'Error del servidor' });
            }

            res.json({ payments });
        }
    );
});

// 8. CANCELAR SUSCRIPCIÓN
app.post('/api/subscription/cancel', authenticateToken, (req, res) => {
    db.run(
        `UPDATE users 
         SET subscription_status = 'cancelled',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.user.id],
        (err) => {
            if (err) {
                return res.status(500).json({ error: 'Error del servidor' });
            }

            res.json({ message: 'Suscripción cancelada exitosamente' });
        }
    );
});

const PORT = process.env.PORT || 5000;

// JOB AUTOMÁTICO: Revisar suscripciones vencidas cada hora
function checkExpiredSubscriptions() {
    const now = new Date();
    console.log(`🔍 Revisando suscripciones vencidas - ${now.toISOString()}`);

    // Expirar pruebas gratuitas vencidas
    db.run(`
        UPDATE users 
        SET subscription_status = 'expired'
        WHERE subscription_status = 'trial' 
        AND datetime('now') > datetime(trial_start_date, '+15 days')
    `, (err) => {
        if (err) {
            console.error('❌ Error expirando pruebas:', err);
        } else {
            console.log('✅ Pruebas gratuitas vencidas actualizadas');
        }
    });

    // Expirar suscripciones pagadas vencidas
    db.run(`
        UPDATE users 
        SET subscription_status = 'expired'
        WHERE subscription_status = 'active' 
        AND subscription_end_date IS NOT NULL
        AND datetime('now') > datetime(subscription_end_date)
    `, function(err) {
        if (err) {
            console.error('❌ Error expirando suscripciones pagadas:', err);
        } else if (this.changes > 0) {
            console.log(`🔒 ${this.changes} suscripciones pagadas expiradas`);
        } else {
            console.log('✅ No hay suscripciones pagadas vencidas');
        }
    });

    // Obtener estadísticas
    db.get(`
        SELECT 
            COUNT(CASE WHEN subscription_status = 'trial' THEN 1 END) as trials_activos,
            COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as pagados_activos,
            COUNT(CASE WHEN subscription_status = 'expired' THEN 1 END) as expirados,
            COUNT(*) as total_usuarios
        FROM users
    `, (err, stats) => {
        if (!err && stats) {
            console.log(`📊 ESTADÍSTICAS:`);
            console.log(`🆓 Pruebas activas: ${stats.trials_activos}`);
            console.log(`💳 Suscripciones activas: ${stats.pagados_activos}`);
            console.log(`🔒 Expirados: ${stats.expirados}`);
            console.log(`👥 Total usuarios: ${stats.total_usuarios}`);
        }
    });
}

// Ejecutar revisión cada hora
setInterval(checkExpiredSubscriptions, 60 * 60 * 1000);

// Ejecutar una vez al iniciar el servidor
setTimeout(checkExpiredSubscriptions, 5000);

app.listen(PORT, () => {
    console.log(`🚀 DriveMetrics API ejecutándose en puerto ${PORT}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/api/webhook/mercadopago`);
    console.log(`🔐 Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log(`⏰ Job de expiración: Ejecutándose cada hora`);
});

module.exports = app;







