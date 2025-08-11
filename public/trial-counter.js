// ============================================
// SISTEMA DE CONTADOR DE DÍAS DE PRUEBA - DRIVEMETRICS
// ============================================

(function() {
    'use strict';
    
    class TrialCounter {
        constructor() {
            this.trialDays = 7; // Días totales de prueba
            this.storageKey = 'drivemetrics_trial_start';
            this.userKey = 'drivemetrics_user';
            this.sessionKey = 'drivemetrics_session_token';
            this.updateInterval = null;
            this.init();
        }

        init() {
            // Esperar a que el DOM esté listo
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setup());
            } else {
                this.setup();
            }
        }

        setup() {
            // Crear el elemento HTML del contador
            this.createTrialBanner();
            
            // Inicializar el contador
            this.startTrial();
            
            // Actualizar cada 30 segundos
            this.updateInterval = setInterval(() => {
                this.updateCounter();
            }, 30000);
            
            // Actualizar inmediatamente
            this.updateCounter();
            
            // Escuchar cambios en localStorage para sincronizar entre pestañas
            window.addEventListener('storage', (e) => {
                if (e.key === this.userKey || e.key === this.storageKey) {
                    this.updateCounter();
                }
            });
        }

        createTrialBanner() {
            // Verificar si ya existe
            if (document.getElementById('trial-banner')) return;

            const banner = document.createElement('div');
            banner.id = 'trial-banner';
            banner.className = 'trial-banner';
            banner.style.display = 'none'; // Oculto por defecto
            
            banner.innerHTML = `
                <div class="trial-content">
                    <div class="trial-info">
                        <div class="trial-icon">⚡</div>
                        <div class="trial-text">
                            <span class="trial-title">Prueba Gratuita</span>
                            <span class="trial-counter" id="trial-counter">Cargando...</span>
                        </div>
                    </div>
                    <button class="trial-upgrade-btn" id="trial-upgrade-btn">
                        Actualizar
                    </button>
                </div>
            `;

            // Insertar al inicio del body
            document.body.insertBefore(banner, document.body.firstChild);
            
            // Agregar evento al botón
            const upgradeBtn = document.getElementById('trial-upgrade-btn');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', () => {
                    this.showSubscriptionModal();
                });
            }
        }

        startTrial() {
            const user = this.getCurrentUser();
            if (!user) return;

            // Verificar si ya tiene una fecha de inicio
            let trialStart = localStorage.getItem(this.storageKey);
            
            if (!trialStart) {
                // Primera vez que inicia sesión
                trialStart = new Date().toISOString();
                localStorage.setItem(this.storageKey, trialStart);
                console.log('DriveMetrics: Prueba gratuita iniciada');
            }
        }

        getCurrentUser() {
            try {
                const userData = localStorage.getItem('userData');
                const authToken = localStorage.getItem('authToken');
                const driveUser = localStorage.getItem(this.userKey);
                
                // Verificar cualquier tipo de usuario logueado
                if (authToken && userData) {
                    return JSON.parse(userData);
                } else if (driveUser) {
                    return JSON.parse(driveUser);
                }
                return null;
            } catch (e) {
                console.warn('Error parsing user data:', e);
                return null;
            }
        }

        getRemainingTime() {
            const trialStart = localStorage.getItem(this.storageKey);
            if (!trialStart) return { days: this.trialDays, hours: 0, minutes: 0 };

            const startDate = new Date(trialStart);
            const endDate = new Date(startDate.getTime() + (this.trialDays * 24 * 60 * 60 * 1000));
            const currentDate = new Date();
            
            const diffTime = endDate - currentDate;
            
            if (diffTime <= 0) {
                return { days: 0, hours: 0, minutes: 0, expired: true };
            }

            const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diffTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));

            return { days, hours, minutes, expired: false };
        }

        hasActiveSubscription() {
            // Verificar si el usuario tiene suscripción activa
            try {
                if (window.paymentSystem?.subscriptionStatus?.has_access) {
                    return true;
                }
                
                // Verificar otros indicadores de suscripción
                const subscriptionData = localStorage.getItem('subscription_status');
                if (subscriptionData) {
                    const status = JSON.parse(subscriptionData);
                    return status.active === true || status.has_access === true;
                }
                
                return false;
            } catch (e) {
                console.warn('Error checking subscription status:', e);
                return false;
            }
        }

        updateCounter() {
            const counterElement = document.getElementById('trial-counter');
            const bannerElement = document.getElementById('trial-banner');
            
            if (!counterElement || !bannerElement) return;

            const user = this.getCurrentUser();
            
            // Si no hay usuario, ocultar el banner
            if (!user) {
                bannerElement.style.display = 'none';
                return;
            }

            // Si tiene suscripción activa, ocultar el banner
            if (this.hasActiveSubscription()) {
                bannerElement.style.display = 'none';
                return;
            }

            // Mostrar el banner
            bannerElement.style.display = 'block';
            const timeRemaining = this.getRemainingTime();

            // Limpiar clases anteriores
            bannerElement.classList.remove('trial-warning', 'trial-urgent', 'trial-expired');

            if (timeRemaining.expired) {
                counterElement.innerHTML = '⚠️ Prueba expirada';
                bannerElement.classList.add('trial-expired');
                this.showExpiredMessage();
            } else if (timeRemaining.days === 0 && timeRemaining.hours === 0) {
                counterElement.innerHTML = `⏰ ${timeRemaining.minutes} min restantes`;
                bannerElement.classList.add('trial-urgent');
            } else if (timeRemaining.days === 0) {
                counterElement.innerHTML = `⏰ ${timeRemaining.hours}h ${timeRemaining.minutes}min restantes`;
                bannerElement.classList.add('trial-urgent');
            } else if (timeRemaining.days === 1) {
                counterElement.innerHTML = `⚠️ ${timeRemaining.days} día restante`;
                bannerElement.classList.add('trial-warning');
            } else {
                counterElement.innerHTML = `✨ ${timeRemaining.days} días restantes`;
            }
        }

        showSubscriptionModal() {
            // Usar el modal del sistema de pagos si existe
            if (window.paymentSystem && typeof window.paymentSystem.showSubscriptionModal === 'function') {
                window.paymentSystem.showSubscriptionModal();
                return;
            }

            // Crear modal simple si no existe el sistema de pagos
            this.createSimpleSubscriptionModal();
        }

        createSimpleSubscriptionModal() {
            // Remover modal existente
            const existingModal = document.getElementById('trial-subscription-modal');
            if (existingModal) {
                existingModal.remove();
            }

            const modal = document.createElement('div');
            modal.id = 'trial-subscription-modal';
            modal.className = 'subscription-modal active';
            
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>🚀 ¡Actualiza a DriveMetrics Pro!</h3>
                        <p>Accede a todas las funciones premium</p>
                    </div>
                    <div class="modal-plans">
                        <div class="plan-option" id="monthly-plan">
                            <div class="plan-info">
                                <div class="plan-details">
                                    <h4>Plan Mensual</h4>
                                    <p>Acceso completo por 1 mes</p>
                                </div>
                                <div class="plan-price">
                                    <div class="amount">$2.999</div>
                                    <div class="period">/mes</div>
                                </div>
                            </div>
                        </div>
                        <div class="plan-option featured" id="annual-plan">
                            <div class="plan-info">
                                <div class="plan-details">
                                    <h4>Plan Anual</h4>
                                    <p>2 meses gratis incluidos</p>
                                </div>
                                <div class="plan-price">
                                    <div class="amount">$29.999</div>
                                    <div class="period">/año</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" id="close-trial-modal">
                            Cerrar
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Agregar eventos
            document.getElementById('close-trial-modal').addEventListener('click', () => {
                modal.remove();
            });

            document.getElementById('monthly-plan').addEventListener('click', () => {
                this.handleSubscriptionClick('monthly');
            });

            document.getElementById('annual-plan').addEventListener('click', () => {
                this.handleSubscriptionClick('annual');
            });

            // Cerrar al hacer clic fuera
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.remove();
                }
            });
        }

        handleSubscriptionClick(planType) {
            if (window.paymentSystem && typeof window.paymentSystem.createSubscriptionPayment === 'function') {
                window.paymentSystem.createSubscriptionPayment(planType);
            } else {
                // Fallback: mostrar alerta o redirigir
                alert('¡Gracias por tu interés! La función de pago se está configurando.');
                console.log(`Usuario seleccionó plan: ${planType}`);
            }
        }

        showExpiredMessage() {
            // Mostrar modal automático solo una vez cuando expire
            const expiredShown = sessionStorage.getItem('trial_expired_shown');
            if (expiredShown) return;

            sessionStorage.setItem('trial_expired_shown', 'true');
            
            setTimeout(() => {
                this.createSimpleSubscriptionModal();
            }, 2000); // Mostrar después de 2 segundos
        }

        // Métodos para administración y testing
        extendTrial(additionalDays) {
            if (typeof additionalDays !== 'number' || additionalDays <= 0) {
                console.error('extendTrial: additionalDays debe ser un número positivo');
                return;
            }
            
            const trialStart = localStorage.getItem(this.storageKey);
            if (trialStart) {
                const startDate = new Date(trialStart);
                startDate.setTime(startDate.getTime() - (additionalDays * 24 * 60 * 60 * 1000));
                localStorage.setItem(this.storageKey, startDate.toISOString());
                this.updateCounter();
                console.log(`Prueba extendida por ${additionalDays} días`);
            }
        }

        resetTrial() {
            localStorage.removeItem(this.storageKey);
            sessionStorage.removeItem('trial_expired_shown');
            const bannerElement = document.getElementById('trial-banner');
            if (bannerElement) {
                bannerElement.classList.remove('trial-warning', 'trial-urgent', 'trial-expired');
            }
            this.startTrial();
            this.updateCounter();
            console.log('Prueba reiniciada');
        }

        isTrialActive() {
            const timeRemaining = this.getRemainingTime();
            return !timeRemaining.expired;
        }

        getTrialStatus() {
            const timeRemaining = this.getRemainingTime();
            const trialStart = localStorage.getItem(this.storageKey);
            
            return {
                isActive: !timeRemaining.expired,
                startDate: trialStart ? new Date(trialStart) : null,
                remainingDays: timeRemaining.days,
                remainingHours: timeRemaining.hours,
                remainingMinutes: timeRemaining.minutes,
                totalDays: this.trialDays,
                hasSubscription: this.hasActiveSubscription()
            };
        }

        destroy() {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
            
            const banner = document.getElementById('trial-banner');
            if (banner) {
                banner.remove();
            }
            
            const modal = document.getElementById('trial-subscription-modal');
            if (modal) {
                modal.remove();
            }
        }
    }

    // Crear instancia global del contador de prueba
    window.trialCounter = new TrialCounter();

    // Integración con el sistema de pagos existente
    if (typeof window.PaymentSystem !== 'undefined') {
        const originalInit = window.PaymentSystem.prototype._init;
        if (originalInit) {
            window.PaymentSystem.prototype._init = async function() {
                await originalInit.call(this);
                // Actualizar el contador cuando cambie el estado de suscripción
                if (window.trialCounter) {
                    window.trialCounter.updateCounter();
                }
            };
        }
    }

    // Log de inicialización
    console.log('✅ TrialCounter inicializado correctamente');
    
    // Comandos de consola para testing (solo en desarrollo)
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log('🔧 Comandos disponibles para testing:');
        console.log('- trialCounter.getTrialStatus()');
        console.log('- trialCounter.extendTrial(3)');
        console.log('- trialCounter.resetTrial()');
    }
})();
