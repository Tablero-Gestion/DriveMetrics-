import { Pool } from 'pg';

// Configuración de PostgreSQL desde variables de entorno de Vercel
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Método no permitido' });
  }

  try {
    console.log('🔍 Conectando a PostgreSQL de Vercel...');
    
    // Consulta para obtener usuarios reales
    const query = `
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

    const result = await pool.query(query);
    const usuarios = result.rows.map(user => ({
      id: user.id,
      name: user.name || 'Sin nombre',
      email: user.email || 'Sin email',
      phone: user.phone || 'Sin teléfono',
      city: '🌐 Vercel Real',
      plan: user.plan || 'basic',
      registrationDate: user.registrationdate ? new Date(user.registrationdate).toISOString().split('T')[0] : 'N/A',
      status: user.status || 'active',
      lastLogin: user.lastlogin ? new Date(user.lastlogin).toISOString().split('T')[0] : 'N/A',
      trialEndDate: user.trialenddate ? new Date(user.trialenddate).toISOString().split('T')[0] : null,
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
}
