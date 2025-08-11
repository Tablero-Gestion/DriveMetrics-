// public/quickImplementation.js
// Implementación rápida de un simulador de datos reales
(function(global){
  class RealDataSimulator {
    constructor(){
      this.location = { province:null, city:null, coordinates:null };
      this.timer = null;
    }

    async getCurrentLocation(){
      if (!('geolocation' in navigator)) {
        this.location = { province:'CABA', city:'Buenos Aires', coordinates:{ lat:-34.6037, lng:-58.3816 } };
        return this.location;
      }
      const pos = await new Promise((resolve, reject)=>{
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy:true, timeout:10000, maximumAge:60000 });
      }).catch(()=>null);

      if (!pos) {
        this.location = { province:'CABA', city:'Buenos Aires', coordinates:{ lat:-34.6037, lng:-58.3816 } };
        return this.location;
      }

      const { latitude:lat, longitude:lng } = pos.coords;
      try{
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=es`);
        const data = await r.json();
        this.location = {
          province: data.principalSubdivision || 'Provincia',
          city: data.city || data.locality || 'Ciudad',
          coordinates: { lat, lng }
        };
      }catch{
        this.location = { province:'CABA', city:'Buenos Aires', coordinates:{ lat, lng } };
      }
      return this.location;
    }

    generateRealtimeData(){
      const coords = this.location.coordinates || { lat:-24.7859, lng:-65.4117 }; // Salta fallback
      const time = new Date();
      const h = time.getHours();
      const isPeak = (h>=7&&h<=9)||(h>=12&&h<=14)||(h>=19&&h<=22);
      const isNight = h>=22 || h<=6;
      let demandBoost = 1 + (isPeak?0.4:0) + (isNight?0.2:0);

      const mk = (baseDemand, baseEarning) => {
        const demand = Math.min(100, Math.floor(baseDemand + Math.random()*20*demandBoost));
        const surge = Number((1 + Math.random()*0.8*demandBoost).toFixed(1));
        const avgEarnings = Math.floor(baseEarning * surge * demandBoost);
        return { demand, surge, avgEarnings };
      };

      const uber = mk(60, 800);
      const didi = mk(55, 700);
      const pedidosya = mk(70, 900);
      const rappi = mk(75, 1000);

      const platforms = {
        uber: { active:true, ...uber, estimatedTrips: 10 + Math.floor(Math.random()*6) },
        didi: { active:true, ...didi, estimatedTrips: 9 + Math.floor(Math.random()*6) },
        pedidosya: { active:true, ...pedidosya, estimatedTrips: 11 + Math.floor(Math.random()*6) },
        rappi: { active:true, ...rappi, estimatedTrips: 12 + Math.floor(Math.random()*6) }
      };

      // Best platform
      const entries = Object.entries(platforms);
      const best = entries.reduce((b,[k,v])=>{
        const score = v.avgEarnings * v.surge * (v.demand/100);
        return !b || score > b.score ? { key:k, score, v } : b;
      }, null);

      const recommendations = [];
      if (best) {
        const names = { uber:'Uber', didi:'DiDi', pedidosya:'PedidosYa', rappi:'Rappi' };
        recommendations.push({
          type: 'platform',
          priority: 'high',
          message: `Cambia a ${names[best.key]}`,
          detail: `Ganancias promedio: $${best.v.avgEarnings}/viaje (${best.v.surge}x surge)`,
          platform: best.key
        });
      }
      if (isPeak || (h>=18 && h<=22)) {
        recommendations.push({ type:'timing', priority:'medium', message:'Hora pico nocturna detectada', detail:'Gran demanda hasta las 22:00' });
      }

      return {
        location: this.location.coordinates ? this.location : { province:'Salta', city:'Salta', coordinates: coords },
        platforms,
        recommendations,
        timestamp: new Date().toISOString()
      };
    }

    startRealTimeUpdates(callback){
      this.stopRealTimeUpdates();
      this.timer = setInterval(()=>{
        const d = this.generateRealtimeData();
        try{ callback && callback(d); }catch{}
      }, 120000); // 2 minutos
    }
    stopRealTimeUpdates(){ if(this.timer){ clearInterval(this.timer); this.timer=null; } }
  }

  // UMD-like export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RealDataSimulator };
  }
  global.RealDataSimulator = RealDataSimulator;
})(typeof window !== 'undefined' ? window : globalThis);




