// public/payment-system.js
// Sistema de pagos frontend adaptado a backend Vercel (/api)

(function(){
  class PaymentSystem {
    constructor(){
      this.apiUrl = '/api';
      this.user = JSON.parse(localStorage.getItem('drivemetrics_user') || 'null');
      this.backendUserId = null;
      this.sessionToken = localStorage.getItem('drivemetrics_session_token') || null;
      this.subscriptionStatus = null;
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

    // Registra/actualiza usuario en backend y obtiene user_id + session_token
    async ensureBackendSession(){
      if (this.backendUserId && this.sessionToken) return { user_id: this.backendUserId, session_token: this.sessionToken };
      if (!this.user) throw new Error('Usuario no autenticado');
      const body = {
        google_id: null,
        firebase_uid: this.user.id,
        email: this.user.email,
        name: this.user.name,
        picture_url: this.user.picture,
        provider: 'google'
      };
      const resp = await fetch(`${this.apiUrl}/auth/register-user`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      if (!resp.ok) throw new Error('No se pudo registrar usuario en backend');
      const data = await resp.json();
      this.backendUserId = data.user_id;
      this.sessionToken = data.session_token;
      localStorage.setItem('drivemetrics_session_token', this.sessionToken);
      return { user_id: this.backendUserId, session_token: this.sessionToken };
    }

    // Login local (no modifica login global de Google). Solo para payments.html
    async login(email, password){
      // Simulación mínima: guarda token local y userData
      if(!email || !password) return { success:false, error:'Credenciales requeridas' };
      const user = { email, full_name: email.split('@')[0] };
      localStorage.setItem('authToken', 'local-token');
      localStorage.setItem('userData', JSON.stringify(user));
      // sincronizar con backend (crea/actualiza user y sesión)
      this.user = { id: this.user?.id || null, email: user.email, name: user.full_name, picture: null };
      try { await this.ensureBackendSession(); } catch {}
      return { success:true, data:{ token:'local-token', user } };
    }

    async register(userData){
      if(!userData?.email || !userData?.full_name || !userData?.password){
        return { success:false, error:'Faltan datos' };
      }
      localStorage.setItem('authToken','local-token');
      localStorage.setItem('userData', JSON.stringify(userData));
      this.user = { id: this.user?.id || null, email: userData.email, name: userData.full_name, picture: null };
      try { await this.ensureBackendSession(); } catch {}
      return { success:true, data:{ token:'local-token', user: userData } };
    }

    logout(){
      localStorage.removeItem('authToken');
      localStorage.removeItem('userData');
      localStorage.removeItem('drivemetrics_session_token');
      this.backendUserId = null; this.sessionToken = null; this.user = null;
    }

    // Estado de suscripción (Vercel: por user_id)
    async checkSubscriptionStatus(){
      if (!this.backendUserId) await this.ensureBackendSession();
      const url = new URL(`${this.apiUrl}/subscription/status`, window.location.origin);
      url.searchParams.set('user_id', String(this.backendUserId));
      const resp = await fetch(url.toString());
      if (!resp.ok) return null;
      this.subscriptionStatus = await resp.json();
      return this.subscriptionStatus;
    }

    // Crear preferencia de pago (MercadoPago) y redirigir
    async createSubscriptionPayment(planType = 'monthly'){
      if (!this.backendUserId) await this.ensureBackendSession();
      const payload = { user_id: this.backendUserId, email: this.user?.email, plan_type: planType };
      const resp = await fetch(`${this.apiUrl}/payments/create-preference`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Error creando pago');
      // Redirigir a MercadoPago
      const initUrl = data.init_point || data.sandbox_init_point;
      if (initUrl) window.location.href = initUrl;
      return data;
    }

    async getEnhancedRealTimeData(){
      try {
        if (!this.backendUserId) await this.ensureBackendSession();
      } catch {}
      const status = await this.checkSubscriptionStatus();
      const sim = new (window.RealDataSimulator||function(){ this.getCurrentLocation=async()=>({}); this.generateRealtimeData=()=>({}); })();
      try { await sim.getCurrentLocation(); } catch {}
      const data = sim.generateRealtimeData() || {};
      if (!status || !status.has_access) { data.limited = true; }
      return data;
    }

    // Historial de pagos
    async getPaymentsHistory(){
      if (!this.backendUserId) await this.ensureBackendSession();
      const url = new URL(`${this.apiUrl}/payments/history`, window.location.origin);
      url.searchParams.set('user_id', String(this.backendUserId));
      const resp = await fetch(url.toString());
      if (!resp.ok) throw new Error('No se pudo obtener historial');
      const data = await resp.json();
      return data.payments || [];
    }

    // Cancelar suscripción
    async cancelSubscription(){
      if (!this.backendUserId) await this.ensureBackendSession();
      const resp = await fetch(`${this.apiUrl}/subscription/cancel`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ user_id: this.backendUserId }) });
      if (!resp.ok) throw new Error('No se pudo cancelar');
      return await resp.json();
    }

    // UI helpers mínimos (opcional)
    showSubscriptionModal(){
      // Modal simple
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;';
      modal.innerHTML = `
        <div style="background:#fff;border-radius:12px;max-width:520px;width:92%;padding:20px;">
          <h3 style="margin:0 0 10px 0;">DriveMetrics Pro</h3>
          <p style="margin:0 0 10px 0;color:#374151;">Suscríbete para acceder a funciones premium.</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="dm-sub-month" style="padding:12px;border-radius:8px;border:none;background:#4f46e5;color:#fff;font-weight:700;cursor:pointer;">Mensual $2.999</button>
            <button id="dm-sub-annual" style="padding:12px;border-radius:8px;border:none;background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">Anual $29.999</button>
          </div>
          <div style="text-align:right;margin-top:10px;"><button id="dm-sub-close" style="background:transparent;border:none;color:#6b7280;cursor:pointer;">Cerrar</button></div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#dm-sub-close').onclick = ()=> modal.remove();
      modal.querySelector('#dm-sub-month').onclick = async ()=>{ try { await this.createSubscriptionPayment('monthly'); } catch(e){ alert('Error: '+e.message); } };
      modal.querySelector('#dm-sub-annual').onclick = async ()=>{ try { await this.createSubscriptionPayment('annual'); } catch(e){ alert('Error: '+e.message); } };
    }
  }

  window.PaymentSystem = PaymentSystem;
})();


