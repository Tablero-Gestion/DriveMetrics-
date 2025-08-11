// public/payment-system.js
// Sistema de pagos frontend adaptado con precios actualizados y manejo de errores mejorado
(function(){
  class PaymentSystem {
    constructor(){
      this.apiUrl = '/api';
      this.user = JSON.parse(localStorage.getItem('drivemetrics_user') || 'null');
      this.backendUserId = null;
      this.sessionToken = localStorage.getItem('drivemetrics_session_token') || null;
      this.subscriptionStatus = null;
      this.retryAttempts = 3;
      this._init();
    }

    async _init(){
      try{
        if (this.user) {
          await this.ensureBackendSession();
          await this.checkSubscriptionStatus();
        }
      }catch(e){ console.warn('PaymentSystem init warning', e); }
    }

    // Registra/actualiza usuario en backend con mejor manejo de errores
    async ensureBackendSession(){
      if (this.backendUserId && this.sessionToken) {
        return { user_id: this.backendUserId, session_token: this.sessionToken };
      }

      if (!this.user) {
        // Intentar obtener usuario de otras fuentes
        const userData = localStorage.getItem('userData');
        const authToken = localStorage.getItem('authToken');
        if (userData && authToken) {
          const user = JSON.parse(userData);
          this.user = {
            id: user.id || 'local_' + Date.now(),
            email: user.email,
            name: user.full_name || user.name || user.email.split('@')[0],
            picture: user.picture || null
          };
        } else {
          throw new Error('Usuario no autenticado');
        }
      }

      const body = {
        google_id: null,
        firebase_uid: this.user.id,
        email: this.user.email,
        name: this.user.name,
        picture_url: this.user.picture,
        provider: 'local'
      };

      for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
        try {
          const resp = await fetch(`${this.apiUrl}/auth/register-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });

          if (resp.ok) {
            const data = await resp.json();
            this.backendUserId = data.user_id;
            this.sessionToken = data.session_token;
            localStorage.setItem('drivemetrics_session_token', this.sessionToken);
            return { user_id: this.backendUserId, session_token: this.sessionToken };
          } else if (resp.status >= 500 && attempt < this.retryAttempts) {
            await this.delay(1000 * attempt);
            continue;
          }
        } catch (networkError) {
          console.warn(`Intento ${attempt} fallido:`, networkError.message);
          if (attempt < this.retryAttempts) {
            await this.delay(1000 * attempt);
            continue;
          }
        }
      }

      // Si falla el backend, generar IDs locales para continuar
      console.warn('Backend no disponible, usando modo local');
      this.backendUserId = 'local_' + Date.now();
      this.sessionToken = 'local_token_' + Date.now();
      localStorage.setItem('drivemetrics_session_token', this.sessionToken);
      return { user_id: this.backendUserId, session_token: this.sessionToken };
    }

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    // Login local (solo payments.html u otros)
    async login(email, password){
      if(!email || !password) return { success:false, error:'Credenciales requeridas' };
      const user = { id: 'local_' + Date.now(), email, full_name: email.split('@')[0], picture: null };
      localStorage.setItem('authToken', 'local-token');
      localStorage.setItem('userData', JSON.stringify(user));
      this.user = { id: user.id, email: user.email, name: user.full_name, picture: null };
      try { await this.ensureBackendSession(); } catch{ console.warn('Backend no disponible, modo local'); }
      return { success:true, data:{ token:'local-token', user } };
    }

    async register(userData){
      if(!userData?.email || !userData?.full_name || !userData?.password){
        return { success:false, error:'Faltan datos' };
      }
      const user = { id: 'local_' + Date.now(), email: userData.email, full_name: userData.full_name, picture: null };
      localStorage.setItem('authToken','local-token');
      localStorage.setItem('userData', JSON.stringify(user));
      this.user = { id: user.id, email: userData.email, name: userData.full_name, picture: null };
      try { await this.ensureBackendSession(); } catch{ console.warn('Backend no disponible, modo local'); }
      return { success:true, data:{ token:'local-token', user: userData } };
    }

    logout(){
      localStorage.removeItem('authToken');
      localStorage.removeItem('userData');
      localStorage.removeItem('drivemetrics_session_token');
      this.backendUserId = null; this.sessionToken = null; this.user = null;
    }

    // Estado de suscripción
    async checkSubscriptionStatus(){
      try {
        if (!this.backendUserId) await this.ensureBackendSession();
        const url = new URL(`${this.apiUrl}/subscription/status`, window.location.origin);
        url.searchParams.set('user_id', String(this.backendUserId));
        const resp = await fetch(url.toString());
        if (!resp.ok) { this.subscriptionStatus = { has_access: false, active: false }; return this.subscriptionStatus; }
        this.subscriptionStatus = await resp.json();
        return this.subscriptionStatus;
      } catch (error) {
        console.warn('Error checking subscription:', error);
        this.subscriptionStatus = { has_access: false, active: false };
        return this.subscriptionStatus;
      }
    }

    // Crear preferencia de pago (MercadoPago) con precios actualizados
    async createSubscriptionPayment(planType = 'monthly'){
      try {
        if (!this.backendUserId) await this.ensureBackendSession();
        const payload = { user_id: this.backendUserId, email: this.user?.email, plan_type: planType };
        const resp = await fetch(`${this.apiUrl}/payments/create-preference`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
        if (!resp.ok) { const errorData = await resp.json().catch(()=>({})); throw new Error(errorData.error || 'Error creando pago'); }
        const data = await resp.json();
        const initUrl = data.init_point || data.sandbox_init_point;
        if (initUrl) { window.location.href = initUrl; } else { throw new Error('URL de pago no disponible'); }
        return data;
      } catch (error) {
        console.error('Error en createSubscriptionPayment:', error);
        this.showPaymentError(error.message);
        throw error;
      }
    }

    showPaymentError(message){
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:400px;width:92%;padding:20px;text-align:center;">
          <h3 style="margin:0 0 10px 0;color:#dc2626;">⚠️ Error de Pago</h3>
          <p style="margin:0 0 20px 0;color:#374151;">${message}</p>
          <p style="margin:0 0 20px 0;color:#6b7280;font-size:14px;">Por favor, intenta nuevamente o contacta soporte.</p>
          <button onclick="this.parentElement.parentElement.remove()" style="background:#4f46e5;color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;">Cerrar</button>
        </div>`;
      document.body.appendChild(modal);
    }

    async getEnhancedRealTimeData(){
      try { if (!this.backendUserId) await this.ensureBackendSession(); } catch{ console.warn('Backend no disponible para datos en tiempo real'); }
      const status = await this.checkSubscriptionStatus();
      const sim = new (window.RealDataSimulator||function(){ this.getCurrentLocation=async()=>({}); this.generateRealtimeData=()=>({}); })();
      try { await sim.getCurrentLocation(); } catch{}
      const data = sim.generateRealtimeData() || {};
      if (!status || !status.has_access) { data.limited = true; }
      return data;
    }

    async getPaymentsHistory(){
      try {
        if (!this.backendUserId) await this.ensureBackendSession();
        const url = new URL(`${this.apiUrl}/payments/history`, window.location.origin);
        url.searchParams.set('user_id', String(this.backendUserId));
        const resp = await fetch(url.toString());
        if (!resp.ok) throw new Error('No se pudo obtener historial');
        const data = await resp.json();
        return data.payments || [];
      } catch (error) {
        console.warn('Error obteniendo historial:', error);
        return [];
      }
    }

    async cancelSubscription(){
      try {
        if (!this.backendUserId) await this.ensureBackendSession();
        const resp = await fetch(`${this.apiUrl}/subscription/cancel`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ user_id: this.backendUserId }) });
        if (!resp.ok) throw new Error('No se pudo cancelar');
        return await resp.json();
      } catch (error) {
        console.error('Error cancelando suscripción:', error);
        throw error;
      }
    }

    // UI helpers con precios actualizados
    showSubscriptionModal(){
      const existingModal = document.querySelector('.subscription-modal');
      if (existingModal) existingModal.remove();
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;backdrop-filter:blur(4px);';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:520px;width:92%;padding:20px;">
          <h3 style="margin:0 0 10px 0;">🚀 DriveMetrics Pro</h3>
          <p style="margin:0 0 20px 0;color:#374151;">Suscríbete para acceder a funciones premium.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
            <button id="dm-sub-month" style="padding:12px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer;">Mensual $1.500</button>
            <button id="dm-sub-annual" style="padding:12px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Anual $15.000</button>
          </div>
          <div style="text-align:right;margin-top:10px;">
            <button id="dm-sub-close" style="background:transparent;border:none;color:#6b7280;cursor:pointer;padding:8px 16px;">Cerrar</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#dm-sub-close').onclick = ()=> modal.remove();
      modal.querySelector('#dm-sub-month').onclick = async ()=>{ try { await this.createSubscriptionPayment('monthly'); } catch(e){ console.error('Error en pago mensual:', e); } };
      modal.querySelector('#dm-sub-annual').onclick = async ()=>{ try { await this.createSubscriptionPayment('annual'); } catch(e){ console.error('Error en pago anual:', e); } };
      modal.addEventListener('click', (e)=>{ if (e.target === modal) modal.remove(); });
    }
  }

  window.PaymentSystem = PaymentSystem;
})();


