-- Crear base de datos
CREATE DATABASE calculadora_drivers;
USE calculadora_drivers;

-- Tabla de usuarios
CREATE TABLE usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fecha_expiracion_gratuita DATETIME NOT NULL,
    estado_suscripcion ENUM('trial', 'activa', 'vencida', 'cancelada') DEFAULT 'trial',
    ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    intentos_login INT DEFAULT 0,
    bloqueado_hasta DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Tabla de pagos y suscripciones
CREATE TABLE suscripciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    tipo_plan VARCHAR(50) DEFAULT 'mensual',
    precio DECIMAL(10,2) DEFAULT 1500.00,
    fecha_inicio DATE NOT NULL,
    fecha_vencimiento DATE NOT NULL,
    estado ENUM('pendiente', 'activa', 'vencida', 'cancelada') DEFAULT 'pendiente',
    mercadopago_preference_id VARCHAR(255),
    mercadopago_payment_id VARCHAR(255),
    mercadopago_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabla de sesiones (opcional, para JWT alternativo)
CREATE TABLE sesiones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Tabla de logs de actividad
CREATE TABLE logs_actividad (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT,
    accion VARCHAR(100) NOT NULL,
    detalles JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Índices para optimizar consultas
CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_estado ON usuarios(estado_suscripcion);
CREATE INDEX idx_suscripciones_usuario ON suscripciones(usuario_id);
CREATE INDEX idx_suscripciones_estado ON suscripciones(estado);
CREATE INDEX idx_sesiones_token ON sesiones(token_hash);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);

-- Procedimiento para verificar suscripciones vencidas
DELIMITER //
CREATE PROCEDURE ActualizarSuscripcionesVencidas()
BEGIN
    -- Actualizar usuarios con trial vencido
    UPDATE usuarios 
    SET estado_suscripcion = 'vencida' 
    WHERE estado_suscripcion = 'trial' 
    AND fecha_expiracion_gratuita < NOW();
    
    -- Actualizar suscripciones vencidas
    UPDATE suscripciones 
    SET estado = 'vencida' 
    WHERE estado = 'activa' 
    AND fecha_vencimiento < CURDATE();
    
    -- Actualizar estado de usuarios con suscripción vencida
    UPDATE usuarios u
    INNER JOIN suscripciones s ON u.id = s.usuario_id
    SET u.estado_suscripcion = 'vencida'
    WHERE s.estado = 'vencida' 
    AND u.estado_suscripcion = 'activa';
END //
DELIMITER ;

-- Evento para ejecutar automáticamente la verificación cada hora
CREATE EVENT IF NOT EXISTS verificar_suscripciones
ON SCHEDULE EVERY 1 HOUR
STARTS CURRENT_TIMESTAMP
DO CALL ActualizarSuscripcionesVencidas();


