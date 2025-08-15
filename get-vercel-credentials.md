# 🔑 Obtener Credenciales de PostgreSQL de Vercel

## Para conectar tu panel local con los usuarios REALES de Vercel:

### 1. 📱 Ve al Dashboard de Vercel
- Ve a: https://vercel.com/dashboard
- Inicia sesión con tu cuenta

### 2. 📁 Selecciona tu proyecto
- Busca y selecciona: **drive-metrics-psi**

### 3. 🗄️ Ve a Storage/Database
- En el menú lateral, ve a **Storage**
- Busca tu base de datos PostgreSQL (puede llamarse algo como "postgres" o "neon")

### 4. ⚙️ Ve a Settings/Configuración  
- Dentro de tu base de datos PostgreSQL
- Ve a la pestaña **Settings** o **Configuración**

### 5. 📋 Copia las credenciales
Busca las variables de entorno que se ven así:

```bash
POSTGRES_URL="postgresql://username:password@host:5432/database"
POSTGRES_PRISMA_URL="postgresql://username:password@host:5432/database?pgbouncer=true&connect_timeout=15"
POSTGRES_URL_NON_POOLING="postgresql://username:password@host:5432/database"
POSTGRES_USER="username"
POSTGRES_HOST="host"
POSTGRES_PASSWORD="password"
POSTGRES_DATABASE="database"
```

### 6. ✏️ Reemplaza en env.local
- Abre el archivo `env.local`
- Reemplaza las líneas que dicen "username", "password", "host", "database" con los valores reales
- Guarda el archivo

### 7. 🔄 Reinicia el servidor
- Para en el terminal: `Ctrl + C`
- Ejecuta: `npm start`

### 8. 🎯 ¡Listo!
Tu panel mostrará los usuarios REALES que se registraron en tu aplicación.

---

## 📞 ¿No encuentras las credenciales?

Si no puedes encontrar las credenciales, puedes:

1. **Desde Vercel CLI:**
   ```bash
   npx vercel env ls
   ```

2. **Desde el proyecto en Vercel:**
   - Ve a Settings → Environment Variables
   - Busca las variables que empiecen con `POSTGRES_`

3. **Si no tienes base de datos:**
   - Ve a Storage → Create Database
   - Selecciona PostgreSQL (Neon)
   - Sigue las instrucciones

---

## 🚨 IMPORTANTE
- **NO compartas estas credenciales** en repositorios públicos
- Mantenlas solo en tu archivo `env.local` (que está en .gitignore)
- Son las credenciales de tu base de datos de producción donde están los usuarios reales
