import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'

const DEMO_SERVER = 'http://localhost:4021'

const actorColors = {
  client: '#3b82f6',
  server: '#22c55e',
  facilitator: '#a855f7',
  blockchain: '#f59e0b'
}

const actorLabels = {
  client: 'Client',
  server: 'Weather Server',
  facilitator: 'Facilitator',
  blockchain: 'Plasma Blockchain'
}

function StatusPanel({ title, status, details, icon }) {
  return (
    <div className={`status-panel ${status}`}>
      <div className="status-header">
        <span className="status-icon">{icon}</span>
        <h3>{title}</h3>
        <span className={`status-badge ${status}`}>
          {status === 'running' ? 'Running' : status === 'idle' ? 'Idle' : 'Stopped'}
        </span>
      </div>
      {details && (
        <div className="status-details">
          {Object.entries(details).map(([key, value]) => (
            <div key={key} className="detail-row">
              <span className="detail-key">{key}:</span>
              <span className="detail-value">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineStep({ step, isActive, isCompleted }) {
  const { title, description, details, actor, target, timestamp, isError } = step

  return (
    <div className={`timeline-step ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${isError ? 'error' : ''}`}>
      <div className="step-connector">
        <div className={`step-number ${isError ? 'error' : ''}`}>{step.step || '!'}</div>
        <div className="step-line" />
      </div>

      <div className="step-content">
        <div className="step-header">
          <h4>{title}</h4>
          {timestamp && (
            <span className="step-time">
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        <p className="step-description">{description}</p>

        {(actor || target) && (
          <div className="step-actors">
            {actor && (
              <span className="actor-badge" style={{ backgroundColor: actorColors[actor] }}>
                {actorLabels[actor]}
              </span>
            )}
            {target && (
              <>
                <span className="arrow">→</span>
                <span className="actor-badge" style={{ backgroundColor: actorColors[target] }}>
                  {actorLabels[target]}
                </span>
              </>
            )}
          </div>
        )}

        {details && (
          <div className="step-details">
            <pre>{JSON.stringify(details, null, 2)}</pre>
          </div>
        )}

        {details?.explorerUrl && (
          <a
            href={details.explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="explorer-link"
          >
            View on Explorer →
          </a>
        )}
      </div>
    </div>
  )
}

function ArchitectureDiagram({ activeActor }) {
  return (
    <div className="architecture-diagram">
      <div className={`arch-node client ${activeActor === 'client' ? 'active' : ''}`}>
        <div className="node-icon">👤</div>
        <div className="node-label">Client</div>
      </div>

      <div className="arch-connection horizontal">
        <div className="connection-line" />
        <div className="connection-arrow">→</div>
      </div>

      <div className={`arch-node server ${activeActor === 'server' || activeActor === 'facilitator' ? 'active' : ''}`}>
        <div className="node-icon">🌤️</div>
        <div className="node-label">Server</div>
        <div className="node-sublabel">facilitator in-process</div>
      </div>

      <div className="arch-connection horizontal">
        <div className="connection-line" />
        <div className="connection-arrow">→</div>
      </div>

      <div className={`arch-node blockchain ${activeActor === 'blockchain' ? 'active' : ''}`}>
        <div className="node-icon">⛓️</div>
        <div className="node-label">Plasma</div>
        <div className="node-sublabel">USDT0</div>
      </div>
    </div>
  )
}

function App() {
  const [connected, setConnected] = useState(false)
  const [flowActive, setFlowActive] = useState(false)
  const [steps, setSteps] = useState([])
  const [currentStep, setCurrentStep] = useState(0)
  const [activeActor, setActiveActor] = useState(null)
  const [serverStatus, setServerStatus] = useState(null)
  const [error, setError] = useState(null)
  const eventSourceRef = useRef(null)
  const timelineRef = useRef(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${DEMO_SERVER}/demo/status`)
        if (res.ok) {
          const data = await res.json()
          setServerStatus(data)
        }
      } catch (e) {}
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${DEMO_SERVER}/events`)
      eventSourceRef.current = es

      es.onopen = () => {
        console.log('SSE Connected')
        setConnected(true)
        setError(null)
      }

      es.onmessage = (event) => {
        const data = JSON.parse(event.data)
        console.log('SSE Event:', data)

        if (data.type === 'connected') {
          return
        }

        if (data.type === 'flow_reset') {
          setSteps([])
          setCurrentStep(0)
          setActiveActor(null)
          setFlowActive(false)
          setError(null)
          return
        }

        if (data.type === 'flow_error') {
          setError(data.description || data.details?.error)
          setFlowActive(false)
          setSteps(prev => [...prev, { ...data, step: prev.length + 1 }])
          return
        }

        if (data.step) {
          setSteps(prev => [...prev, data])
          setCurrentStep(data.step)
          setActiveActor(data.actor || data.target)
          setFlowActive(true)

          if (data.type === 'settle_completed' || data.type === 'settle_failed') {
            setTimeout(() => {
              setFlowActive(false)
              setActiveActor(null)
            }, 1000)
          }
        }
      }

      es.onerror = () => {
        console.log('SSE Error - reconnecting...')
        setConnected(false)
        es.close()
        setTimeout(connect, 2000)
      }
    }

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (timelineRef.current && steps.length > 0) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight
    }
  }, [steps])

  const startFlow = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`${DEMO_SERVER}/demo/start-flow`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to start flow')
      }
    } catch (err) {
      setError('Failed to connect to demo server')
    }
  }, [])

  const resetFlow = useCallback(async () => {
    setError(null)
    try {
      await fetch(`${DEMO_SERVER}/demo/reset`, { method: 'POST' })
    } catch (err) {
      console.error('Failed to reset flow:', err)
    }
  }, [])

  const formatAddress = (addr) => {
    if (!addr) return 'N/A'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>
            <span className="logo">402</span>
            x402 Payment Flow Demo
            <span className="live-badge">LIVE</span>
          </h1>
          <div className="connection-status">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? 'Connected' : 'Connecting...'}
          </div>
        </div>
      </header>

      <main className="main">
        <section className="architecture-section">
          <h2>System Architecture</h2>
          <ArchitectureDiagram activeActor={activeActor} />
        </section>

        <section className="status-section">
          <h2>Service Status</h2>
          <div className="status-grid">
            <StatusPanel
              title="Server (facilitator in-process)"
              status={serverStatus ? 'running' : 'idle'}
              icon="🌤️"
              details={{
                'Port': serverStatus?.server?.port || '4021',
                'Endpoint': 'GET /weather',
                'Price': '0.0001 USDT0',
                'Chain': 'Plasma (9745)',
                'Address': formatAddress(serverStatus?.server?.address),
                'Pay To': formatAddress(serverStatus?.server?.payTo)
              }}
            />
          </div>
        </section>

        {error && (
          <section className="error-section">
            <div className="error-banner">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
              <button onClick={() => setError(null)}>×</button>
            </div>
          </section>
        )}

        <section className="action-section">
          <button
            className={`action-button ${flowActive ? 'disabled' : ''}`}
            onClick={startFlow}
            disabled={!connected || flowActive}
          >
            {flowActive ? (
              <>
                <span className="spinner" />
                Payment in Progress...
              </>
            ) : (
              <>
                <span className="button-icon">🌤️</span>
                Access Weather App
              </>
            )}
          </button>

          {steps.length > 0 && !flowActive && (
            <button className="reset-button" onClick={resetFlow}>
              Reset Demo
            </button>
          )}
        </section>

        <section className="timeline-section">
          <h2>
            Payment Flow Timeline
            {steps.length > 0 && (
              <span className="step-counter">
                Step {currentStep} of 10
              </span>
            )}
          </h2>

          <div className="timeline" ref={timelineRef}>
            {steps.length === 0 ? (
              <div className="timeline-empty">
                <p>Click "Access Weather App" to start a <strong>real</strong> payment flow</p>
                <p className="timeline-hint">
                  This will execute an actual USDT0 transfer on Plasma blockchain
                </p>
              </div>
            ) : (
              steps.map((step, index) => (
                <TimelineStep
                  key={step.timestamp || index}
                  step={step}
                  isActive={index === steps.length - 1 && flowActive}
                  isCompleted={index < steps.length - 1 || !flowActive}
                />
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>
          x402 Protocol Demo — Real payments with USDT0 on Plasma
        </p>
        <p className="footer-links">
          <a href="https://x402.org" target="_blank" rel="noopener">x402.org</a>
          <span className="separator">•</span>
          <a href="https://plasma.to" target="_blank" rel="noopener">plasma.to</a>
          <span className="separator">•</span>
          <a href="https://explorer.plasma.to" target="_blank" rel="noopener">Explorer</a>
        </p>
      </footer>
    </div>
  )
}

export default App
