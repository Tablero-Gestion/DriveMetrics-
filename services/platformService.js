// services/platformService.js (CommonJS)
const axios = require('axios');

class PlatformService {
  constructor() {
    this.apiKeys = {
      uber: process.env.UBER_API_KEY,
      didi: process.env.DIDI_API_KEY,
      pedidosya: process.env.PEDIDOSYA_API_KEY,
      rappi: process.env.RAPPI_API_KEY,
      weather: process.env.OPENWEATHER_API_KEY
    };

    this.baseUrls = {
      uber: 'https://api.uber.com/v1.2',
      didi: 'https://api.didi.com/v2',
      pedidosya: 'https://api.pedidosya.com/v1',
      rappi: 'https://api.rappi.com/v1',
      weather: 'https://api.openweathermap.org/data/2.5'
    };

    this.cache = new Map();
    this.CACHE_DURATION = 2 * 60 * 1000; // 2 minutos
  }

  // Uber
  async getUberData(lat, lng) {
    const cacheKey = `uber_${lat}_${lng}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const headers = {
        Authorization: `Token ${this.apiKeys.uber}`,
        'Accept-Language': 'es',
        'Content-Type': 'application/json'
      };

      const priceResponse = await axios.get(
        `${this.baseUrls.uber}/estimates/price`,
        {
          params: {
            start_latitude: lat,
            start_longitude: lng,
            end_latitude: lat + 0.01,
            end_longitude: lng + 0.01
          },
          headers
        }
      );

      const surgeResponse = await axios.get(
        `${this.baseUrls.uber}/estimates/time`,
        {
          params: { start_latitude: lat, start_longitude: lng },
          headers
        }
      );

      const data = {
        active: Array.isArray(priceResponse.data?.prices) && priceResponse.data.prices.length > 0,
        demand: this.calculateDemandFromSurge(priceResponse.data?.prices),
        surge: this.extractSurgeMultiplier(priceResponse.data?.prices),
        avgEarnings: this.calculateAvgEarnings(priceResponse.data?.prices),
        estimatedTrips: this.estimateTripsPerDayFromTimes(surgeResponse.data?.times),
        zones: await this.getUberHotZones(lat, lng),
        lastUpdate: new Date().toISOString()
      };

      this.setCacheData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching Uber data:', error.message);
      return this.getDefaultPlatformData('uber');
    }
  }

  // Didi
  async getDidiData(lat, lng) {
    const cacheKey = `didi_${lat}_${lng}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    try {
      const headers = {
        Authorization: `Bearer ${this.apiKeys.didi}`,
        'Content-Type': 'application/json'
      };
      // Nota: Endpoint tentativo como ejemplo
      const demandResponse = await axios.get(
        `${this.baseUrls.didi}/driver/demand`,
        { params: { latitude: lat, longitude: lng, radius: 5000 }, headers }
      );

      const data = {
        active: demandResponse.data?.status === 'active',
        demand: demandResponse.data?.demand_level || 50,
        surge: demandResponse.data?.surge_multiplier || 1.0,
        avgEarnings: this.calculateDidiEarnings(demandResponse.data || {}),
        estimatedTrips: demandResponse.data?.estimated_trips || 8,
        zones: await this.getDidiHotZones(lat, lng),
        lastUpdate: new Date().toISOString()
      };
      this.setCacheData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching Didi data:', error.message);
      return this.getDefaultPlatformData('didi');
    }
  }

  // PedidosYa
  async getPedidosYaData(lat, lng) {
    const cacheKey = `pedidosya_${lat}_${lng}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    try {
      const headers = {
        Authorization: `Bearer ${this.apiKeys.pedidosya}`,
        'Content-Type': 'application/json'
      };
      // Nota: Endpoint tentativo como ejemplo
      const deliveryResponse = await axios.get(
        `${this.baseUrls.pedidosya}/partners/demand`,
        { params: { latitude: lat, longitude: lng, service_type: 'delivery' }, headers }
      );
      const data = {
        active: !!deliveryResponse.data?.available,
        demand: deliveryResponse.data?.demand_percentage || 60,
        surge: deliveryResponse.data?.peak_multiplier || 1.0,
        avgEarnings: this.calculatePedidosYaEarnings(deliveryResponse.data || {}),
        estimatedTrips: deliveryResponse.data?.estimated_deliveries || 10,
        zones: await this.getPedidosYaHotZones(lat, lng),
        lastUpdate: new Date().toISOString()
      };
      this.setCacheData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching PedidosYa data:', error.message);
      return this.getDefaultPlatformData('pedidosya');
    }
  }

  // Rappi
  async getRappiData(lat, lng) {
    const cacheKey = `rappi_${lat}_${lng}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    try {
      const headers = {
        'X-API-Key': this.apiKeys.rappi,
        'Content-Type': 'application/json'
      };
      // Nota: Endpoint tentativo como ejemplo
      const partnerResponse = await axios.get(
        `${this.baseUrls.rappi}/partners/zones/demand`,
        { params: { lat, lng, radius: 3 }, headers }
      );
      const data = {
        active: !!partnerResponse.data?.zone_active,
        demand: partnerResponse.data?.demand_level || 70,
        surge: partnerResponse.data?.bonus_multiplier || 1.0,
        avgEarnings: this.calculateRappiEarnings(partnerResponse.data || {}),
        estimatedTrips: partnerResponse.data?.estimated_orders || 12,
        zones: await this.getRappiHotZones(lat, lng),
        lastUpdate: new Date().toISOString()
      };
      this.setCacheData(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Error fetching Rappi data:', error.message);
      return this.getDefaultPlatformData('rappi');
    }
  }

  // Weather
  async getWeatherImpact(lat, lng) {
    const cacheKey = `weather_${lat}_${lng}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;
    try {
      const response = await axios.get(
        `${this.baseUrls.weather}/weather`,
        { params: { lat, lon: lng, appid: this.apiKeys.weather, units: 'metric', lang: 'es' } }
      );
      const weather = response.data;
      let impact = 1.0;
      if (weather.weather?.[0]?.main === 'Rain') impact += 0.3;
      if (weather.main?.temp > 35 || weather.main?.temp < 5) impact += 0.2;
      if ((weather.wind?.speed || 0) > 10) impact -= 0.1;
      const data = {
        impact,
        condition: weather.weather?.[0]?.main || 'Clear',
        description: weather.weather?.[0]?.description || 'despejado',
        temperature: weather.main?.temp,
        humidity: weather.main?.humidity,
        windSpeed: weather.wind?.speed || 0
      };
      this.setCacheData(cacheKey, data, 10 * 60 * 1000);
      return data;
    } catch (error) {
      console.error('Error fetching weather data:', error.message);
      return { impact: 1.0, condition: 'Clear', description: 'despejado' };
    }
  }

  // Helpers de cálculo
  calculateDemandFromSurge(prices) {
    if (!Array.isArray(prices) || prices.length === 0) return 50;
    const avgSurge = prices.reduce((sum, price) => sum + (price.surge_multiplier || 1), 0) / prices.length;
    return Math.min(100, Math.floor(avgSurge * 50));
  }
  extractSurgeMultiplier(prices) {
    if (!Array.isArray(prices) || prices.length === 0) return 1.0;
    return prices.reduce((max, price) => Math.max(max, price.surge_multiplier || 1), 1.0);
  }
  calculateAvgEarnings(prices) {
    if (!Array.isArray(prices) || prices.length === 0) return 650;
    const avgPrice = prices.reduce((sum, price) => {
      const est = price.estimate;
      if (typeof est === 'string') {
        const parts = est.split('-');
        const val = parts.length > 1 ? parseFloat(parts[1]) : parseFloat(parts[0]);
        return sum + (isNaN(val) ? 0 : val);
      }
      const valNum = Number(est) || 0;
      return sum + valNum;
    }, 0) / prices.length;
    return Math.floor(avgPrice * 0.75);
  }
  calculateDidiEarnings(data) {
    const base = 600;
    const demandMultiplier = (data.demand_level || 50) / 50;
    const surgeMultiplier = data.surge_multiplier || 1;
    return Math.floor(base * demandMultiplier * surgeMultiplier);
  }
  calculatePedidosYaEarnings(data) {
    const base = 750;
    const demandMultiplier = (data.demand_percentage || 60) / 60;
    const peakMultiplier = data.peak_multiplier || 1;
    return Math.floor(base * demandMultiplier * peakMultiplier);
  }
  calculateRappiEarnings(data) {
    const base = 850;
    const demandMultiplier = (data.demand_level || 70) / 70;
    const bonusMultiplier = data.bonus_multiplier || 1;
    return Math.floor(base * demandMultiplier * bonusMultiplier);
  }

  // Zonas calientes
  async getUberHotZones(lat, lng) {
    try {
      const response = await axios.get(
        `${this.baseUrls.uber}/markets`,
        { headers: { Authorization: `Token ${this.apiKeys.uber}` } }
      );
      return this.processHotZones(response.data, lat, lng, 'uber');
    } catch (error) {
      return this.generateMockHotZones(lat, lng, 'uber');
    }
  }
  async getDidiHotZones(lat, lng) { return this.generateMockHotZones(lat, lng, 'didi'); }
  async getPedidosYaHotZones(lat, lng) { return this.generateMockHotZones(lat, lng, 'pedidosya'); }
  async getRappiHotZones(lat, lng) { return this.generateMockHotZones(lat, lng, 'rappi'); }

  // Procesar zonas (placeholder)
  processHotZones(_apiData, lat, lng, platform) {
    return this.generateMockHotZones(lat, lng, platform);
  }
  generateMockHotZones(lat, lng, platform) {
    const zones = [];
    const names = ['Centro','Microcentro','Puerto Madero','Palermo','Belgrano','Villa Crespo','San Telmo','Recoleta','Caballito','Flores'];
    for (let i = 0; i < 5; i++) {
      const offsetLat = (Math.random() - 0.5) * 0.05;
      const offsetLng = (Math.random() - 0.5) * 0.05;
      zones.push({
        id: `${platform}_zone_${i}`,
        name: names[Math.floor(Math.random() * names.length)],
        coordinates: { lat: lat + offsetLat, lng: lng + offsetLng },
        demandLevel: Math.floor(Math.random() * 5) + 1,
        avgWaitTime: Math.floor(Math.random() * 15) + 2,
        surgeMultiplier: 1 + Math.random() * 2
      });
    }
    return zones;
  }

  // Defaults
  getDefaultPlatformData(platform) {
    const defs = {
      uber: { base: 650, demand: 45, surge: 1.1 },
      didi: { base: 600, demand: 40, surge: 1.0 },
      pedidosya: { base: 750, demand: 55, surge: 1.2 },
      rappi: { base: 850, demand: 65, surge: 1.3 }
    };
    const cfg = defs[platform];
    return {
      active: true,
      demand: cfg.demand,
      surge: cfg.surge,
      avgEarnings: cfg.base,
      estimatedTrips: 8 + Math.floor(Math.random() * 6),
      zones: [],
      lastUpdate: new Date().toISOString()
    };
  }

  // Cache helpers
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) return cached.data;
    return null;
  }
  setCacheData(key, data, duration = this.CACHE_DURATION) {
    this.cache.set(key, { data, timestamp: Date.now() });
    setTimeout(() => { this.cache.delete(key); }, duration);
  }

  // Estimate trips helper from Uber time estimates
  estimateTripsPerDayFromTimes(times) {
    if (!Array.isArray(times) || times.length === 0) return 10;
    // naive mapping: lower ETA -> more trips
    const avgEta = times.reduce((s, t) => s + (t.estimate || 300), 0) / times.length; // seconds
    const perHour = Math.max(4, Math.min(12, Math.round(3600 / avgEta)));
    return perHour * 10; // assume 10h active
  }
}

module.exports = { PlatformService };


