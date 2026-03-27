import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const PAGE_MAP = {
  home: { label: 'Host/NVMe', path: null },
  pillar1: { label: 'Pillar 1 · FTL', path: '/pillar1' },
  pillar2: { label: 'Pillar 2 · BBT', path: '/pillar2' },
  pillar3: { label: 'Pillar 3 · ECC', path: '/pillar3' },
  pillar4: { label: 'Pillar 4 · Logic', path: '/pillar4' },
  oob: { label: 'OOB Security', path: '/oob' },
  result: { label: 'Result', path: null },
}

const SCENARIO_META = {
  BOOT: { title: 'SSD Boot', icon: '🔌', color: '#6366f1' },
  READ: { title: 'Normal Read', icon: '📖', color: '#06b6d4' },
  WRITE: { title: 'Normal Write', icon: '✏️', color: '#10b981' },
  DEGRADATION: { title: 'Block Degradation', icon: '⚠️', color: '#f59e0b' },
  HOST_CRASH: { title: 'Host Crash (OOB)', icon: '💥', color: '#ef4444' },
  GC: { title: 'Garbage Collection', icon: '♻️', color: '#8b5cf6' },
}

function EventEntry({ event }) {
  return (
    <div className="event-entry">
      <span className="event-source">{event.source}</span>
      <span className="event-type">{event.type}</span>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
        {event.block_id != null ? `Block ${event.block_id}` : ''} {event.details?.message || ''}
      </span>
    </div>
  )
}

export default function SimulationPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const scenario = location.state?.scenario || 'BOOT'
  const meta = SCENARIO_META[scenario] || SCENARIO_META.BOOT

  const [steps, setSteps] = useState([])
  const [events, setEvents] = useState([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [resultData, setResultData] = useState(null)
  const timerRefs = useRef([])

  const currentStep = steps[activeIdx] || null

  async function startSimulation() {
    setLoading(true)
    setStarted(true)
    setFinished(false)
    setActiveIdx(-1)
    setSteps([])
    setEvents([])
    timerRefs.current.forEach(clearTimeout)
    try {
      const res = await axios.post(`${API}/start-simulation`, { scenario })
      const { steps: s, state } = res.data
      setSteps(s)
      setEvents(state?.event_log || [])
      // Auto-advance through steps
      s.forEach((step, i) => {
        const t = setTimeout(() => {
          setActiveIdx(i)
          if (i === s.length - 1) setFinished(true)
        }, i * 2500)
        timerRefs.current.push(t)
      })
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  useEffect(() => {
    return () => timerRefs.current.forEach(clearTimeout)
  }, [])

  const progressPct = steps.length > 0 ? Math.round(((activeIdx + 1) / steps.length) * 100) : 0

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            background: meta.color + '22', border: `1px solid ${meta.color}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem',
          }}>{meta.icon}</div>
          <div>
            <h1 className="title-lg">{meta.title}</h1>
            <p className="subtitle">Scenario: {scenario}</p>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.8rem' }}>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/')}>← Back</button>
            <button className="btn btn-primary" onClick={startSimulation} disabled={loading || (started && !finished)}>
              {loading ? '⏳ Loading…' : started && !finished ? '⏳ Running…' : '▶ Run Simulation'}
            </button>
          </div>
        </div>

        {!started && (
          <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>{meta.icon}</div>
            <h2 className="title-lg" style={{ marginBottom: '0.5rem' }}>{meta.title}</h2>
            <p className="subtitle" style={{ marginBottom: '2rem' }}>
              Click "Run Simulation" to start the automated event-driven walkthrough
            </p>
            <button className="btn btn-primary" onClick={startSimulation}>
              ▶ Run Simulation
            </button>
          </div>
        )}

        {started && (
          <>
            {/* Progress */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span className="subtitle">Progress</span>
                <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{progressPct}%</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{
                  width: `${progressPct}%`,
                  background: `linear-gradient(90deg, ${meta.color}, var(--accent2))`,
                }} />
              </div>

              {/* Step pips */}
              <div className="step-bar" style={{ marginTop: '1rem', marginBottom: 0 }}>
                {steps.map((s, i) => (
                  <>
                    <div key={i} className={`step-pip ${i < activeIdx ? 'done' : i === activeIdx ? 'active' : ''}`}>
                      {i + 1}
                    </div>
                    {i < steps.length - 1 && (
                      <div key={`c${i}`} className={`step-connector ${i < activeIdx ? 'done' : ''}`} />
                    )}
                  </>
                ))}
              </div>
            </div>

            <div className="grid-2">
              {/* Current Step */}
              <div>
                <div className="card glow-border" style={{ marginBottom: '1rem', minHeight: 260 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <span className="title-md">Current Step</span>
                    {currentStep && (
                      <span className="badge badge-info" style={{ cursor: 'pointer' }}
                        onClick={() => currentStep.page !== 'home' && currentStep.page !== 'result' &&
                          navigate(`/${currentStep.page}`)}>
                        {PAGE_MAP[currentStep?.page]?.label || currentStep?.page}
                      </span>
                    )}
                  </div>
                  {currentStep ? (
                    <div className="fade-in">
                      <div className="highlight-box" style={{ marginBottom: '1rem' }}>
                        <p style={{ color: 'var(--text)', fontWeight: 600, lineHeight: 1.6 }}>
                          {currentStep.message}
                        </p>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                        {Object.entries(currentStep.data || {}).slice(0, 8).map(([k, v]) => (
                          <div key={k} className="card card-sm" style={{ background: 'var(--bg-card2)' }}>
                            <div className="metric-label">{k.replace(/_/g,' ')}</div>
                            <div style={{
                              fontFamily: 'var(--mono)', fontSize: '0.85rem',
                              color: 'var(--accent)', fontWeight: 600,
                              wordBreak: 'break-all',
                            }}>
                              {typeof v === 'boolean' ? (v ? '✓ Yes' : '✗ No') :
                                Array.isArray(v) ? v.join(', ') :
                                String(v).length > 30 ? String(v).slice(0, 30) + '…' : String(v)}
                            </div>
                          </div>
                        ))}
                      </div>
                      {currentStep.page !== 'home' && currentStep.page !== 'result' && (
                        <button
                          className="btn btn-outline btn-sm"
                          style={{ marginTop: '1rem' }}
                          onClick={() => navigate(`/${currentStep.page}`)}
                        >
                          Open {PAGE_MAP[currentStep.page]?.label || currentStep.page} →
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '3rem' }}>
                      ⏳ Waiting for first step…
                    </div>
                  )}
                </div>

                {/* All steps list */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>All Steps</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{
                        padding: '0.5rem 0.8rem', borderRadius: 8,
                        background: i === activeIdx ? 'rgba(99,102,241,0.12)' : 'var(--bg-card2)',
                        border: i === activeIdx ? '1px solid var(--accent)' : '1px solid transparent',
                        display: 'flex', gap: '0.6rem', alignItems: 'center',
                        transition: 'all 0.3s',
                      }}>
                        <span style={{
                          color: i < activeIdx ? 'var(--green)' : i === activeIdx ? 'var(--accent)' : 'var(--text-muted)',
                          fontWeight: 700, fontSize: '0.8rem', minWidth: 20,
                        }}>
                          {i < activeIdx ? '✓' : i === activeIdx ? '▶' : `${i+1}`}
                        </span>
                        <span style={{ fontSize: '0.82rem', color: i <= activeIdx ? 'var(--text)' : 'var(--text-muted)' }}>
                          {s.message.slice(0, 80)}{s.message.length > 80 ? '…' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Event Log */}
              <div>
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>
                    Event Log
                    <span className="badge badge-info" style={{ marginLeft: '0.5rem', fontSize: '0.72rem' }}>
                      {events.length} events
                    </span>
                  </div>
                  <div className="event-log">
                    {events.slice(0, activeIdx + 1).map((e, i) => (
                      <EventEntry key={i} event={e} />
                    ))}
                  </div>
                </div>

                {finished && (
                  <div className="card glow-border fade-in" style={{ borderColor: 'var(--green)' }}>
                    <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</div>
                      <div className="title-md" style={{ color: 'var(--green)', marginBottom: '0.5rem' }}>
                        Simulation Complete
                      </div>
                      <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
                        {steps[steps.length - 1]?.message}
                      </p>
                      {steps[steps.length - 1]?.data && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', textAlign: 'left' }}>
                          {Object.entries(steps[steps.length - 1].data).map(([k, v]) => (
                            <div key={k} className="metric-tile">
                              <div className="metric-label">{k.replace(/_/g,' ')}</div>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', color: 'var(--green)', fontWeight: 700 }}>
                                {String(v)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.8rem', justifyContent: 'center' }}>
                        <button className="btn btn-outline" onClick={() => navigate('/')}>← Scenarios</button>
                        <button className="btn btn-primary" onClick={startSimulation}>↺ Retry</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
