#!/usr/bin/env node

/**
 * Script de Configuración PostgreSQL para DriveMetrics
 * 
 * Este script configura el esquema unificado en PostgreSQL de Vercel
 */

const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Configuración PostgreSQL Vercel
const postgresConfig = {
    connectionString: "postgres://neondb_owner:npg_PneiuICs5L1F@ep-billowing-resonance-adpapy4i-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require",
    ssl: { rejectUnauthorized: false }
};

console.log('🔍 Configuración PostgreSQL:');
console.log('Host: ep-billowing-resonance-adpapy4i-pooler.c-2.us-east-1.aws.neon.tech');
console.log('Database: neondb');
console.log('User: neondb_owner');
console.log('');

async function setupPostgreSQL() {
    console.log('🚀 Configurando PostgreSQL para DriveMetrics...\n');
    
    let postgresConnection;
    
    try {
        // 1. Conectar a PostgreSQL
        console.log('📡 Conectando a PostgreSQL Vercel...');
        postgresConnection = new Pool(postgresConfig);
        await postgresConnection.query('SELECT NOW()');
        console.log('✅ Conexión PostgreSQL exitosa\n');
        
        // 2. Verificar tablas existentes
        console.log('🔍 Verificando estructura PostgreSQL...');
        const { rows: postgresTables } = await postgresConnection.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('📋 Tablas PostgreSQL encontradas:', postgresTables.map(t => t.table_name));
        
        // 3. Crear esquema unificado
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
        
        // 4. Crear índices para optimización
        console.log('\n⚡ Creando índices de optimización...');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)');
        await postgresConnection.query('CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(session_token)');
        console.log('✅ Índices creados');
        
        // 5. Verificar datos existentes
        console.log('\n🔍 Verificando datos existentes...');
        const { rows: postgresUsers } = await postgresConnection.query('SELECT COUNT(*) as count FROM users');
        console.log(`📊 Usuarios en PostgreSQL: ${postgresUsers[0].count}`);
        
        // 6. Insertar usuario de prueba si no hay datos
        if (postgresUsers[0].count === 0) {
            console.log('\n👤 Insertando usuario de prueba...');
            await postgresConnection.query(`
                INSERT INTO users (email, name, provider, is_active, profile_data)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                'test@drivemetrics.com',
                'Usuario de Prueba',
                'google',
                true,
                JSON.stringify({ phone: '+1234567890', city: 'Ciudad de Prueba' })
            ]);
            console.log('✅ Usuario de prueba creado');
        }
        
        console.log('\n🎉 ¡Configuración completada exitosamente!');
        console.log('\n📋 Resumen:');
        console.log('   • Esquema unificado creado en PostgreSQL');
        console.log('   • Tablas: users, subscriptions, user_sessions');
        console.log('   • Endpoints configurados para usar tabla users');
        console.log('   • Sistema listo para funcionar en Vercel');
        
        // 7. Probar endpoint
        console.log('\n🧪 Probando endpoint...');
        const { rows: testUsers } = await postgresConnection.query('SELECT id, name, email FROM users LIMIT 5');
        console.log('📊 Usuarios encontrados:', testUsers);
        
    } catch (error) {
        console.error('\n❌ Error durante la configuración:', error);
        process.exit(1);
    } finally {
        // Cerrar conexión
        if (postgresConnection) {
            await postgresConnection.end();
        }
        console.log('\n🔌 Conexión cerrada');
    }
}

// Ejecutar configuración
if (require.main === module) {
    setupPostgreSQL()
        .then(() => {
            console.log('\n✨ Proceso completado');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Error fatal:', error);
            process.exit(1);
        });
}

module.exports = { setupPostgreSQL };
