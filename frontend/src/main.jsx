import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './errorBoundary.jsx'

// Frame heartbeat: the Python side (core/page_watchdog.py) reloads the page if
// this stops moving while the window is on screen (a black, unpainted window).
let frames = 0
;(function beat() {
  window.__devhub_frames = ++frames
  requestAnimationFrame(beat)
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
