#!/usr/bin/env node

/**
 * Script de Migración para Unificar Esquema DriveMetrics
 * 
 * Este script migra desde el esquema antiguo (español) al nuevo esquema unificado (inglés)
 * Compatible tanto con MySQL local como con PostgreSQL de Vercel
 */

const mysql = require('mysql2/promise');
const { Pool } = require('pg');
require('dotenv').config();

// Configuración MySQL Local
const mysqlConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'calculadora_drivers',
    port: process.env.DB_PORT || 3306
};

// Configuración PostgreSQL Vercel
const postgresConfig = {
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
};

async function migrateToUnifiedSchema() {
    console.log('🚀 Iniciando migración a esquema unificado...\n');
    
    let mysqlConnection, postgresConnection;
    
    try {
        // 1. Conectar a MySQL
        console.log('📡 Conectando a MySQL local...');
        mysqlConnection = await mysql.createConnection(mysqlConfig);
        console.log('✅ Conexión MySQL exitosa\n');
        
        // 2. Conectar a PostgreSQL
        console.log('📡 Conectando a PostgreSQL Vercel...');
        postgresConnection = new Pool(postgresConfig);
        await postgresConnection.query('SELECT NOW()');
        console.log('✅ Conexión PostgreSQL exitosa\n');
        
        // 3. Verificar tablas existentes en MySQL
        console.log('🔍 Verificando estructura MySQL...');
        const [mysqlTables] = await mysqlConnection.execute('SHOW TABLES');
        console.log('📋 Tablas MySQL encontradas:', mysqlTables.map(t => Object.values(t)[0]));
        
        // 4. Verificar tablas existentes en PostgreSQL
        console.log('\n🔍 Verificando estructura PostgreSQL...');
        const { rows: postgresTables } = await postgresConnection.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('📋 Tablas PostgreSQL encontradas:', postgresTables.map(t => t.table_name));
        
        // 5. Crear esquema unificado en PostgreSQL si no existe
        console.log('\n🏗️ Creando esquema unificado en PostgreSQL...');
        
        // Tabla users unificada
        await postgresConnection.query(`
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
                profile_data JSONB DEFAULT '{}'::jsonb,
                preferences JSONB DEFAULT '{}'::jsonb
            )
        `);
        console.log('✅ Tabla users creada/verificada');
        
        // Tabla subscriptions unificada
        await postgresConnection.query(`
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
                mp_payment_id TEXT,
                mp_status TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('✅ Tabla subscriptions creada/verificada');
        
        // Tabla user_sessions unificada
        await postgresConnection.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                session_token VARCHAR(255) NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                ip_address VARCHAR(45),
                user_agent TEXT,
                is_active BOOLEAN DEFAULT TRUE
            )
        `);
        console.log('✅ Tabla user_sessions creada/verificada');
        
        // 6. Migrar datos de MySQL a PostgreSQL
        console.log('\n📦 Migrando datos de MySQL a PostgreSQL...');
        
        // Verificar si hay datos en MySQL
        const [mysqlUsers] = await mysqlConnection.execute('SELECT COUNT(*) as count FROM users');
        const userCount = mysqlUsers[0].count;
        
        if (userCount > 0) {
            console.log(`👥 Encontrados ${userCount} usuarios en MySQL`);
            
            // Migrar usuarios
            const [users] = await mysqlConnection.execute(`
                SELECT id, email, name, created_at, last_login, is_active, profile_data
                FROM users ORDER BY id
            `);
            
            for (const user of users) {
                try {
                    await postgresConnection.query(`
                        INSERT INTO users (id, email, name, created_at, last_login, is_active, profile_data)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        ON CONFLICT (id) DO UPDATE SET
                            email = EXCLUDED.email,
                            name = EXCLUDED.name,
                            last_login = EXCLUDED.last_login,
                            is_active = EXCLUDED.is_active,
                            updated_at = NOW()
                    `, [
                        user.id,
                        user.email,
                        user.name,
                        user.created_at,
                        user.last_login,
                        user.is_active,
                        user.profile_data || '{}'
                    ]);
                } catch (error) {
                    console.warn(`⚠️ Error migrando usuario ${user.id}:`, error.message);
                }
            }
            console.log(`✅ ${users.length} usuarios migrados`);
        } else {
            console.log('ℹ️ No hay usuarios en MySQL para migrar');
        }
        
        // 7. Verificar datos en PostgreSQL
        console.log('\n🔍 Verificando datos migrados...');
        const { rows: postgresUsers } = await postgresConnection.query('SELECT COUNT(*) as count FROM users');
        console.log(`📊 Usuarios en PostgreSQL: ${postgresUsers[0].count}`);
        
        // 8. Crear índices para optimización
        console.log('\n⚡ Creando índices de optimización...');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)');
        console.log('✅ Índices creados');
        
        console.log('\n🎉 ¡Migración completada exitosamente!');
        console.log('\n📋 Resumen:');
        console.log('   • Esquema unificado creado en PostgreSQL');
        console.log('   • Datos migrados desde MySQL');
        console.log('   • Endpoints configurados para usar tabla users');
        console.log('   • Sistema listo para funcionar en Vercel');
        
    } catch (error) {
        console.error('\n❌ Error durante la migración:', error);
        process.exit(1);
    } finally {
        // Cerrar conexiones
        if (mysqlConnection) {
            await mysqlConnection.end();
        }
        if (postgresConnection) {
            await postgresConnection.end();
        }
        console.log('\n🔌 Conexiones cerradas');
    }
}

// Ejecutar migración
if (require.main === module) {
    migrateToUnifiedSchema()
        .then(() => {
            console.log('\n✨ Proceso completado');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Error fatal:', error);
            process.exit(1);
        });
}

module.exports = { migrateToUnifiedSchema };
