// Simple LocationService for vanilla JS apps
// Provides: init, getCurrentLocation, startTracking, stopTracking, getData, subscribe, unsubscribe
// Adds an optional floating button UI

(function () {
  const locationData = {
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    speed: null,
    heading: null,
    // address info
    address: null,
    street: null,
    city: null,
    state: null,
    country: null,
    zipCode: null,
    // meta
    loading: true,
    error: null,
    lastUpdate: null,
    isTracking: false
  };

  const listeners = new Set();
  let watchId = null;
  let floatingButtonEl = null;
  let lastGeocodeAt = 0;
  const GEOCODE_COOLDOWN_MS = 15000;

  function notify() {
    const snapshot = { ...locationData };
    listeners.forEach((cb) => {
      try { cb(snapshot); } catch (_) { /* noop */ }
    });
    updateFloatingButton();
  }

  function setData(patch) {
    Object.assign(locationData, patch, { lastUpdate: new Date().toISOString() });
    notify();
  }

  async function reverseGeocode(lat, lon, force = false) {
    const now = Date.now();
    if (!force && now - lastGeocodeAt < GEOCODE_COOLDOWN_MS) return null;
    lastGeocodeAt = now;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1&accept-language=es&email=drivemetrics@example.com`;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error('Reverse geocode failed');
      const data = await resp.json();
      return {
        address: data.display_name || null,
        street: data.address?.road || data.address?.pedestrian || null,
        city: data.address?.city || data.address?.town || data.address?.village || null,
        state: data.address?.state || data.address?.province || null,
        country: data.address?.country || null,
        zipCode: data.address?.postcode || null
      };
    } catch (_) {
      return null;
    }
  }

  async function onPosition(position, forceGeocode = false) {
    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    setData({ loading: true, error: null });
    const geo = await reverseGeocode(latitude, longitude, forceGeocode);
    setData({
      latitude,
      longitude,
      accuracy,
      altitude: altitude ?? null,
      speed: speed ?? null,
      heading: heading ?? null,
      ...(geo || {}),
      loading: false,
      error: null
    });
  }

  function onGeoError(error) {
    const map = {
      1: 'Permisos de ubicación denegados',
      2: 'Ubicación no disponible',
      3: 'Tiempo de espera agotado'
    };
    setData({ loading: false, error: map[error.code] || 'Error al obtener ubicación' });
  }

  function getCurrentLocation() {
    if (!('geolocation' in navigator)) {
      setData({ loading: false, error: 'Geolocalización no soportada por este navegador' });
      return;
    }
    setData({ loading: true, error: null });
    navigator.geolocation.getCurrentPosition(
      (pos) => onPosition(pos, true),
      onGeoError,
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
  }

  function startTracking() {
    if (!('geolocation' in navigator) || watchId) return;
    watchId = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos, false),
      (err) => {
        onGeoError(err);
        stopTracking();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
    setData({ isTracking: true });
  }

  function stopTracking() {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    setData({ isTracking: false });
  }

  function getData() {
    return { ...locationData };
  }

  function subscribe(cb) {
    if (typeof cb === 'function') listeners.add(cb);
    return () => listeners.delete(cb);
  }

  function unsubscribe(cb) {
    listeners.delete(cb);
  }

  function createFloatingButton(options = {}) {
    const { compact = false, showAddress = true, style = {} } = options;
    if (floatingButtonEl) return floatingButtonEl;
    const btn = document.createElement('button');
    btn.className = 'dm-location-button';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 1000,
      backgroundColor: '#6366f1',
      color: 'white',
      border: 'none',
      borderRadius: '12px',
      padding: compact ? '8px' : '12px 16px',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      fontSize: compact ? '12px' : '14px',
      fontWeight: '500',
      transition: 'all 0.3s ease',
      maxWidth: compact ? '60px' : '280px',
      minHeight: '44px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      ...style
    });

    const iconSpan = document.createElement('span');
    iconSpan.style.fontSize = '16px';
    const textSpan = document.createElement('span');
    textSpan.style.overflow = 'hidden';
    textSpan.style.textOverflow = 'ellipsis';
    textSpan.style.whiteSpace = 'nowrap';
    if (compact) textSpan.style.display = 'none';

    btn.appendChild(iconSpan);
    btn.appendChild(textSpan);
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      if (locationData.error) {
        getCurrentLocation();
      } else if (locationData.isTracking) {
        stopTracking();
      } else {
        startTracking();
      }
    });

    floatingButtonEl = { root: btn, iconSpan, textSpan, compact, showAddress };
    updateFloatingButton();
    return floatingButtonEl;
  }

  function updateFloatingButton() {
    if (!floatingButtonEl) return;
    const { iconSpan, textSpan, compact, showAddress } = floatingButtonEl;
    // icon
    let icon = '📍';
    if (locationData.loading) icon = '🔄';
    else if (locationData.error) icon = '📍❌';
    else if (locationData.isTracking) icon = '📍🟢';
    iconSpan.textContent = icon;

    // text
    if (!compact) {
      let text = 'Detectar Mi Ubicación';
      if (locationData.loading) text = 'Obteniendo ubicación...';
      else if (locationData.error) text = 'Error de ubicación';
      else if (!showAddress) text = locationData.isTracking ? 'Seguimiento activo' : 'Ubicación detectada';
      else if (locationData.city) text = `${locationData.city}${locationData.country ? `, ${locationData.country}` : ''}`;
      else if (locationData.latitude && locationData.longitude) text = 'Ubicación detectada';
      textSpan.textContent = text;
    }
  }

  function init(options = {}) {
    if (options.floatingButton) createFloatingButton(options);
    getCurrentLocation();
    window.addEventListener('beforeunload', () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    });
  }

  // expose API
  window.LocationService = {
    init,
    getCurrentLocation,
    startTracking,
    stopTracking,
    getData,
    subscribe,
    unsubscribe
  };
})();


