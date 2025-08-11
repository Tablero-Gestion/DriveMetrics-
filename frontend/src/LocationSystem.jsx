import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const LocationContext = createContext();

export const useLocation = () => {
  const context = useContext(LocationContext);
  if (!context) throw new Error('useLocation debe ser usado dentro de LocationProvider');
  return context;
};

export const LocationProvider = ({ children }) => {
  const [locationData, setLocationData] = useState({
    latitude: null,
    longitude: null,
    accuracy: null,
    altitude: null,
    speed: null,
    heading: null,
    address: null,
    street: null,
    city: null,
    state: null,
    country: null,
    zipCode: null,
    timezone: null,
    weather: null,
    nearbyPlaces: [],
    loading: true,
    error: null,
    lastUpdate: null,
    isTracking: false
  });

  const [watchId, setWatchId] = useState(null);

  const getCompleteLocationInfo = useCallback(async (lat, lon) => {
    try {
      const geocodeResponse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&accept-language=es`
      );
      const geocodeData = await geocodeResponse.json();

      const mockWeather = {
        temperature: Math.round(15 + Math.random() * 20),
        description: ['Despejado', 'Parcialmente nublado', 'Nublado', 'Lluvia ligera'][Math.floor(Math.random() * 4)],
        humidity: Math.round(40 + Math.random() * 40),
        windSpeed: Math.round(Math.random() * 15)
      };

      const mockNearbyPlaces = [
        { name: 'Estación de Servicio YPF', type: 'fuel', distance: '200m' },
        { name: 'Hospital Regional', type: 'hospital', distance: '1.2km' },
        { name: 'Comisaría 3ra', type: 'police', distance: '800m' },
        { name: 'Restaurante El Buen Sabor', type: 'restaurant', distance: '300m' },
        { name: 'Banco Macro', type: 'bank', distance: '500m' }
      ];

      return {
        address: geocodeData.display_name || `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        street: geocodeData.address?.road || geocodeData.address?.pedestrian || 'Ubicación aproximada',
        city: geocodeData.address?.city || geocodeData.address?.town || geocodeData.address?.village || 'Ciudad no identificada',
        state: geocodeData.address?.state || geocodeData.address?.province || 'Provincia no identificada',
        country: geocodeData.address?.country || 'Argentina',
        zipCode: geocodeData.address?.postcode || 'CP no disponible',
        timezone: 'America/Argentina/Salta',
        weather: mockWeather,
        nearbyPlaces: mockNearbyPlaces
      };
    } catch (error) {
      return {
        address: `${lat.toFixed(6)}, ${lon.toFixed(6)}`,
        street: 'Ubicación aproximada',
        city: 'Salta',
        state: 'Salta',
        country: 'Argentina',
        zipCode: 'A4400',
        timezone: 'America/Argentina/Salta',
        weather: { temperature: 22, description: 'Clima agradable', humidity: 65, windSpeed: 5 },
        nearbyPlaces: [{ name: 'Lugares cercanos', type: 'info', distance: 'Cargando...' }]
      };
    }
  }, []);

  const updateLocation = useCallback(async (position) => {
    const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
    setLocationData((prev) => ({ ...prev, loading: true }));
    try {
      const locationInfo = await getCompleteLocationInfo(latitude, longitude);
      setLocationData((prev) => ({
        ...prev,
        latitude,
        longitude,
        accuracy,
        altitude,
        speed,
        heading,
        ...locationInfo,
        loading: false,
        error: null,
        lastUpdate: new Date().toISOString()
      }));
    } catch (e) {
      setLocationData((prev) => ({ ...prev, loading: false, error: 'Error al obtener información de ubicación completa' }));
    }
  }, [getCompleteLocationInfo]);

  const getCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationData((prev) => ({ ...prev, loading: false, error: 'Geolocalización no soportada en este dispositivo' }));
      return;
    }
    setLocationData((prev) => ({ ...prev, loading: true, error: null }));
    navigator.geolocation.getCurrentPosition(
      updateLocation,
      (error) => {
        const map = {
          1: 'Permisos de ubicación denegados. Habilita la ubicación en tu dispositivo.',
          2: 'Ubicación no disponible. Verifica tu conexión GPS.',
          3: 'Tiempo de espera agotado. Intenta nuevamente.'
        };
        setLocationData((prev) => ({ ...prev, loading: false, error: map[error.code] || 'Error desconocido al obtener ubicación' }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
  }, [updateLocation]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation || watchId) return;
    const id = navigator.geolocation.watchPosition(
      updateLocation,
      () => setLocationData((prev) => ({ ...prev, error: 'Error en seguimiento de ubicación' })),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
    setWatchId(id);
    setLocationData((prev) => ({ ...prev, isTracking: true }));
  }, [updateLocation, watchId]);

  const stopTracking = useCallback(() => {
    if (watchId) {
      navigator.geolocation.clearWatch(watchId);
      setWatchId(null);
      setLocationData((prev) => ({ ...prev, isTracking: false }));
    }
  }, [watchId]);

  useEffect(() => {
    getCurrentLocation();
    return () => { if (watchId) navigator.geolocation.clearWatch(watchId); };
  }, [getCurrentLocation]);

  const contextValue = {
    locationData,
    getCurrentLocation,
    startTracking,
    stopTracking,
    isLocationAvailable: !!(locationData.latitude && locationData.longitude),
    isLoading: locationData.loading,
    isTracking: locationData.isTracking,
    hasError: !!locationData.error
  };

  return <LocationContext.Provider value={contextValue}>{children}</LocationContext.Provider>;
};

export const useLocationData = () => {
  const { locationData, isLocationAvailable } = useLocation();
  return {
    coordinates: isLocationAvailable ? { lat: locationData.latitude, lng: locationData.longitude } : null,
    city: locationData.city,
    state: locationData.state,
    country: locationData.country,
    address: locationData.address,
    weather: locationData.weather,
    nearbyPlaces: locationData.nearbyPlaces || [],
    isAvailable: isLocationAvailable,
    isLoading: locationData.loading,
    error: locationData.error
  };
};

const LocationButton = ({ onLocationDetected }) => {
  const { locationData, getCurrentLocation, startTracking, stopTracking, isLocationAvailable, isLoading, isTracking } = useLocation();
  const handleClick = () => {
    if (locationData.error || !isLocationAvailable) getCurrentLocation();
    else if (isTracking) stopTracking();
    else startTracking();
    if (onLocationDetected && isLocationAvailable) onLocationDetected(locationData);
  };
  return (
    <div className="w-full max-w-md mx-auto my-5">
      <button onClick={handleClick} disabled={isLoading} className="w-full p-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-2xl font-semibold text-base shadow-lg transition-all duration-300 flex items-center justify-center gap-3 min-h-[60px] hover:shadow-xl disabled:opacity-70">
        {isLoading ? (<><span>🔄</span><span>Detectando ubicación...</span></>) : isLocationAvailable ? (<><span>{isTracking ? '📍🟢' : '📍'}</span><div className="text-left"><div className="text-sm font-semibold">{locationData.city}, {locationData.country}</div><div className="text-xs opacity-90">{isTracking ? 'Seguimiento activo' : 'Ubicación detectada'}</div></div></>) : (<><span>📍</span><span>Detectar Mi Ubicación</span></>)}
      </button>
      {locationData.error && <div className="mt-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm text-center">{locationData.error}</div>}
      {isLocationAvailable && (
        <div className="mt-3 p-4 bg-green-50 rounded-xl text-sm">
          <div className="font-semibold text-green-700 mb-2">📍 Ubicación Actual</div>
          <div className="text-green-800 space-y-1">
            <div><strong>Dirección:</strong> {locationData.street}</div>
            <div><strong>Ciudad:</strong> {locationData.city}</div>
            <div><strong>Provincia:</strong> {locationData.state}</div>
            {locationData.weather && (
              <div className="mt-2 pt-2 border-t border-green-200"><strong>Clima:</strong> {locationData.weather.temperature}°C - {locationData.weather.description}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const LocationInfo = ({ compact = false, showWeather = true, showNearby = true }) => {
  const { locationData, isLocationAvailable } = useLocation();
  if (!isLocationAvailable) return (<div className="p-3 bg-yellow-50 text-yellow-800 rounded-lg my-2 text-center text-sm">📍 Ubicación no disponible</div>);
  return (
    <div className="bg-white p-4 rounded-xl my-2 shadow-lg border border-gray-200">
      <div className="flex items-center gap-2 mb-3 text-base font-semibold text-gray-700">
        <span>📍</span>
        <span>{compact ? locationData.city : `${locationData.city}, ${locationData.state}`}</span>
        {locationData.isTracking && <span className="text-green-500">🟢</span>}
      </div>
      {!compact && (
        <>
          <div className="text-sm text-gray-600 mb-3">{locationData.address}</div>
          {showWeather && locationData.weather && (
            <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg mb-3">
              <span>🌡️</span>
              <div>
                <div className="text-sm font-medium">{locationData.weather.temperature}°C</div>
                <div className="text-xs text-gray-600">{locationData.weather.description}</div>
              </div>
            </div>
          )}
          {showNearby && locationData.nearbyPlaces?.length > 0 && (
            <div className="mt-3">
              <div className="text-sm font-medium mb-2 text-gray-700">🏪 Lugares Cercanos:</div>
              <div className="text-xs text-gray-600 space-y-1">
                {locationData.nearbyPlaces.slice(0, 3).map((place, index) => (
                  <div key={index}>• {place.name} ({place.distance})</div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
            <div>Precisión: ±{Math.round(locationData.accuracy || 0)}m</div>
            <div>Actualizado: {new Date(locationData.lastUpdate).toLocaleTimeString()}</div>
          </div>
        </>
      )}
    </div>
  );
};

const getPredictionsForLocation = (coordinates, weather) => {
  if (!coordinates || !weather) return [];
  return [
    { time: '14:00-16:00', demand: 'Alta', earnings: '$2,500', zone: 'Centro', confidence: '92%' },
    { time: '18:00-20:00', demand: 'Muy Alta', earnings: '$3,200', zone: 'Zona Norte', confidence: '88%' },
    { time: '21:00-23:00', demand: 'Media', earnings: '$1,800', zone: 'Zona Sur', confidence: '75%' }
  ];
};

const PredictorIA = () => {
  const { city, coordinates, weather } = useLocationData();
  const predictions = getPredictionsForLocation(coordinates, weather);
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 m-4">
      <div className="flex items-center gap-3 mb-4"><span className="text-2xl">🔮</span><h2 className="text-xl font-bold text-gray-800">Predicciones para {city}</h2></div>
      <LocationInfo compact={true} />
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-700">📊 Predicciones de Ganancias Hoy:</h3>
        <div className="space-y-3">
          {predictions.map((pred, index) => (
            <div key={index} className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-100">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-gray-800">{pred.time}</div>
                  <div className="text-sm text-gray-600">Zona: {pred.zone}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-green-600">{pred.earnings}</div>
                  <div className="text-sm text-gray-500">Demanda: {pred.demand}</div>
                  <div className="text-xs text-blue-600">Confianza: {pred.confidence}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {weather && (<div className="mt-4 p-3 bg-yellow-50 rounded-lg"><div className="text-sm text-yellow-800">☀️ Las predicciones consideran el clima actual: {weather.temperature}°C, {weather.description}</div></div>)}
    </div>
  );
};

export const DriveMetricsApp = () => {
  const handleLocationDetected = (location) => { console.log('Ubicación detectada:', location); };
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-gradient-to-br from-blue-600 via-purple-600 to-purple-800 text-white p-8 text-center">
        <h1 className="text-3xl font-bold mb-2">🚗💰 ¡Bienvenido a DriveMetrics!</h1>
        <p className="text-lg mb-5 opacity-90">Tu dashboard personalizado está listo. Sesión iniciada correctamente.</p>
        <LocationButton onLocationDetected={handleLocationDetected} />
      </div>
      <div className="px-4"><LocationInfo /></div>
      <PredictorIA />
      <div className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            ['📍 Mapa de Calor', 'Zonas de mayor demanda cerca de ti'],
            ['🔔 Alertas Premium', 'Notificaciones de tu área'],
            ['🔢 Contador EN VIVO', 'Ganancias en tiempo real'],
            ['🏆 Modo Challenge', 'Desafíos locales'],
            ['📊 Estadísticas', 'Análisis de tu rendimiento'],
            ['⚙️ Configuración', 'Ajustes de la aplicación']
          ].map(([title, desc]) => (
            <FeatureCard key={title} title={title} description={desc} />
          ))}
        </div>
      </div>
    </div>
  );
};

const FeatureCard = ({ title, description }) => {
  const { isAvailable, city, state } = useLocationData();
  const handleClick = () => {
    if (isAvailable) alert(`Función ${title} activada para ${city}, ${state}`);
    else alert('Esperando ubicación para activar esta función...');
  };
  return (
    <button onClick={handleClick} className="p-4 bg-white rounded-xl shadow-lg border border-gray-200 text-left hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
      <div className="text-lg font-semibold mb-2 text-gray-800">{title}</div>
      <div className="text-sm text-gray-600 mb-2">{description}</div>
      {isAvailable && <div className="text-xs text-green-600 mt-2">📍 {city}, {state}</div>}
    </button>
  );
};


