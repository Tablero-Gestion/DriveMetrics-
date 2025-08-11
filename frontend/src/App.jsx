import './App.css'
import { LocationProvider, DriveMetricsApp } from './LocationSystem'

export default function App() {
  return (
    <LocationProvider>
      <DriveMetricsApp />
    </LocationProvider>
  )
}
