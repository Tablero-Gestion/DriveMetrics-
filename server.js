// server.js - Backend para DriveMetrics con integración SQL
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');
// Cargar variables de entorno priorizando env.local
const fs = require('fs');
const path = require('path');
const localEnvPath = path.join(__dirname, 'env.local');
if (fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath });
  console.log('[dotenv] cargado desde env.local');
} else {
  require('dotenv').config();
  console.log('[dotenv] cargado desde .env');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Google OAuth
const GOOGLE_CLIENT_ID = '151117015962-qhq4at3nbja8q9rq7qvspcc0sunr113u.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5503', 'https://tu-dominio.com'],
    credentials: true
}));
app.use(express.json());
// Servir estáticos desde la carpeta public
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Configuración de la base de datos MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'LuxioT',
    password: process.env.DB_PASSWORD || 'Cerveza2025',
    database: process.env.DB_NAME || 'drivemetrics',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

let pool;

// Inicializar conexión a la base de datos
async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        await createUsersTable();
        console.log('✅ Base de datos inicializada correctamente');
    } catch (error) {
        console.error('❌ Error inicializando base de datos:', error);
        process.exit(1);
    }
}

// Crear tabla de usuarios
async function createUsersTable() {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            google_id VARCHAR(255) UNIQUE,
            firebase_uid VARCHAR(255) UNIQUE,
            email VARCHAR(255) NOT NULL UNIQUE,
            name VARCHAR(255) NOT NULL,
            picture_url TEXT,
            provider ENUM('google', 'facebook', 'email') DEFAULT 'google',
            is_active BOOLEAN DEFAULT TRUE,
            email_verified BOOLEAN DEFAULT TRUE,
            last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            profile_data JSON,
            preferences JSON DEFAULT ('{}'),
            INDEX idx_email (email),
            INDEX idx_google_id (google_id),
            INDEX idx_firebase_uid (firebase_uid)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.execute(createTableQuery);
    console.log('📊 Tabla users verificada/creada');

    const createSessionsTable = `
        CREATE TABLE IF NOT EXISTS user_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            session_token VARCHAR(255) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_session_token (session_token),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    await pool.execute(createSessionsTable);
    console.log('🔐 Tabla user_sessions verificada/creada');
}

// Verificar token de Google
async function verifyGoogleToken(token) {
    const ticket = await client.verifyIdToken({ idToken: token, audience: GOOGLE_CLIENT_ID });
    return ticket.getPayload();
}

// Generar token de sesión
function generateSessionToken() {
    return jwt.sign(
        { timestamp: Date.now(), random: Math.random() },
        process.env.JWT_SECRET || 'tu_secreto_jwt_super_seguro',
        { expiresIn: '30d' }
    );
}

// RUTAS DE LA API
app.get('/api', (req, res) => {
    res.json({ 
        message: 'DriveMetrics API funcionando correctamente',
        version: '1.0.0',
        endpoints: ['/api/auth/register-user', '/api/auth/verify-session', '/api/user/profile/:userId']
    });
});

// Registrar/actualizar usuario desde Google Auth
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
                console.log('⚠️  Warning: Token verification failed, proceeding with provided data');
            }
        }

        const [existingUsers] = await pool.execute(
            'SELECT * FROM users WHERE email = ? OR google_id = ? LIMIT 1',
            [email, google_id]
        );

        let userId;
        let isNewUser = false;
        if (existingUsers.length > 0) {
            const existingUser = existingUsers[0];
            userId = existingUser.id;
            const updateQuery = `
                UPDATE users 
                SET name = ?, picture_url = ?, google_id = ?, firebase_uid = ?, 
                    last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                    is_active = TRUE
                WHERE id = ?`;
            await pool.execute(updateQuery, [
                name, picture_url, google_id || existingUser.google_id, 
                firebase_uid || existingUser.firebase_uid, userId
            ]);
            console.log(`👤 Usuario actualizado: ${email} (ID: ${userId})`);
        } else {
            const insertQuery = `
                INSERT INTO users (google_id, firebase_uid, email, name, picture_url, provider, profile_data)
                VALUES (?, ?, ?, ?, ?, ?, ?)`;
            const profileData = {
                registration_ip: req.ip,
                registration_user_agent: req.get('User-Agent'),
                google_verified: !!verifiedPayload,
                registration_timestamp: new Date().toISOString()
            };
            const [result] = await pool.execute(insertQuery, [
                google_id, firebase_uid, email, name, picture_url, 
                provider || 'google', JSON.stringify(profileData)
            ]);
            userId = result.insertId;
            isNewUser = true;
            console.log(`🆕 Nuevo usuario creado: ${email} (ID: ${userId})`);
        }

        const sessionToken = generateSessionToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        await pool.execute(
            `INSERT INTO user_sessions (user_id, session_token, expires_at, ip_address, user_agent)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, sessionToken, expiresAt, req.ip, req.get('User-Agent')]
        );

        const [userData] = await pool.execute(
            'SELECT id, google_id, firebase_uid, email, name, picture_url, provider, created_at, last_login FROM users WHERE id = ?',
            [userId]
        );
        const user = userData[0];

        res.json({
            success: true,
            message: isNewUser ? 'Usuario registrado correctamente' : 'Usuario actualizado correctamente',
            user_id: userId,
            session_token: sessionToken,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                picture_url: user.picture_url,
                provider: user.provider,
                created_at: user.created_at,
                last_login: user.last_login
            },
            is_new_user: isNewUser
        });
    } catch (error) {
        console.error('❌ Error registrando usuario:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor', message: error.message });
    }
});

// Verificar sesión de usuario
app.post('/api/auth/verify-session', async (req, res) => {
    try {
        const { session_token } = req.body;
        if (!session_token) return res.status(400).json({ success: false, error: 'Token de sesión requerido' });

        const [sessions] = await pool.execute(`
            SELECT s.*, u.id as user_id, u.email, u.name, u.picture_url, u.is_active
            FROM user_sessions s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.session_token = ? AND s.expires_at > NOW() AND s.is_active = TRUE AND u.is_active = TRUE
            LIMIT 1`, [session_token]);

        if (sessions.length === 0) return res.status(401).json({ success: false, error: 'Sesión inválida o expirada' });

        const session = sessions[0];
        await pool.execute('UPDATE user_sessions SET created_at = CURRENT_TIMESTAMP WHERE session_token = ?', [session_token]);

        res.json({ success: true, message: 'Sesión válida', user: { id: session.user_id, email: session.email, name: session.name, picture_url: session.picture_url } });
    } catch (error) {
        console.error('❌ Error verificando sesión:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Obtener perfil de usuario
app.get('/api/user/profile/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const [users] = await pool.execute(`
            SELECT id, email, name, picture_url, provider, created_at, last_login, preferences
            FROM users 
            WHERE id = ? AND is_active = TRUE
            LIMIT 1`, [userId]);

        if (users.length === 0) return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        const user = users[0];
        const [sessionCount] = await pool.execute('SELECT COUNT(*) as total_sessions FROM user_sessions WHERE user_id = ?', [userId]);
        res.json({ success: true, user: { ...user, total_sessions: sessionCount[0].total_sessions } });
    } catch (error) {
        console.error('❌ Error obteniendo perfil:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Cerrar sesión
app.post('/api/auth/logout', async (req, res) => {
    try {
        const { session_token } = req.body;
        if (session_token) await pool.execute('UPDATE user_sessions SET is_active = FALSE WHERE session_token = ?', [session_token]);
        res.json({ success: true, message: 'Sesión cerrada correctamente' });
    } catch (error) {
        console.error('❌ Error cerrando sesión:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Stats
app.get('/api/stats', async (req, res) => {
    try {
        const [userStats] = await pool.execute(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as new_users_today,
                COUNT(CASE WHEN last_login >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 END) as active_users_today
            FROM users 
            WHERE is_active = TRUE`);
        const [sessionStats] = await pool.execute(`
            SELECT COUNT(*) as active_sessions
            FROM user_sessions 
            WHERE expires_at > NOW() AND is_active = TRUE`);
        res.json({ success: true, stats: { ...userStats[0], ...sessionStats[0] } });
    } catch (error) {
        console.error('❌ Error obteniendo estadísticas:', error);
        res.status(500).json({ success: false, error: 'Error interno del servidor' });
    }
});

// Error handler
app.use((error, req, res, next) => {
    console.error('❌ Error no manejado:', error);
    res.status(500).json({ success: false, error: 'Error interno del servidor', message: process.env.NODE_ENV === 'development' ? error.message : 'Algo salió mal' });
});

// Inicializar servidor
async function startServer() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            console.log(`🚀 Servidor DriveMetrics ejecutándose en puerto ${PORT}`);
            console.log(`📍 URL: http://localhost:${PORT}`);
            console.log(`🗄️  Base de datos: ${dbConfig.host}/${dbConfig.database}`);
        });
    } catch (error) {
        console.error('❌ Error iniciando servidor:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏹️  Cerrando servidor...');
    if (pool) {
        await pool.end();
        console.log('🗄️  Conexiones de base de datos cerradas');
    }
    process.exit(0);
});

// En Vercel no debemos levantar el listener; solo exportar el app y preparar DB
if (process.env.VERCEL) {
    initDatabase().catch((err) => console.error('❌ DB init (Vercel) error:', err));
} else {
    startServer();
}

module.exports = app;


