import { useState, useEffect } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const SHARE_HOLDERS = ['Operator', 'Cloud Node', 'UART Port', 'BLE Beacon', 'Escrow']

export default function OOBPage() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [simResult, setSimResult] = useState(null)
  const [simRunning, setSimRunning] = useState(false)
  const [phase, setPhase] = useState(0) // 0=idle, 1=crash, 2=oob, 3=encrypt, 4=shamir, 5=tx

  useEffect(() => {
    axios.get(`${API}/state`).then(r => { setState(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  async function runOOBSim() {
    setSimRunning(true)
    setPhase(1)
    setSimResult(null)
    try {
      // Animate phases
      const delays = [0, 1200, 2400, 3600, 4800]
      delays.forEach((d, i) => setTimeout(() => setPhase(i + 1), d))
      const res = await axios.post(`${API}/start-simulation`, { scenario: 'HOST_CRASH' })
      setTimeout(() => {
        setSimResult(res.data)
        setSimRunning(false)
        setPhase(5)
      }, 5500)
    } catch (e) {
      console.error(e)
      setSimRunning(false)
    }
  }

  const PHASES = [
    { id: 1, label: 'Host Crash', icon: '💥', color: '#ef4444' },
    { id: 2, label: 'OOB Activated', icon: '📡', color: '#f59e0b' },
    { id: 3, label: 'AES-256 Encrypt', icon: '🔐', color: '#6366f1' },
    { id: 4, label: 'Shamir Split', icon: '🗝️', color: '#8b5cf6' },
    { id: 5, label: 'UART Transmit', icon: '📤', color: '#10b981' },
  ]

  // Extract step data from simulation result
  const oobSteps = simResult?.steps || []
  const encryptStep = oobSteps.find(s => s.event === 'ENCRYPT_REPORT')
  const shamirStep = oobSteps.find(s => s.event === 'SHAMIR_SPLIT')
  const txStep = oobSteps.find(s => s.event === 'OOB_TRANSMIT')

  return (
    <div className="page fade-in">
      <div className="page-inner">
        <div style={{ marginBottom: '1.5rem' }}>
          <div className="badge badge-bad" style={{ marginBottom: '0.5rem' }}>OOB Security Layer</div>
          <h1 className="title-lg">Out-of-Band Recovery + Encryption</h1>
          <p className="subtitle">Host crash → capacitor-powered SSD → UART/BLE OOB → AES-256-GCM + Shamir Secret Sharing</p>
        </div>

        {/* Phase timeline */}
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 className="title-md" style={{ marginBottom: '1.2rem' }}>OOB Recovery Flow</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', overflowX: 'auto' }}>
            {PHASES.map((p, i) => (
              <>
                <div key={p.id} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem',
                  minWidth: 90,
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '50%',
                    background: phase >= p.id ? p.color + '33' : 'var(--bg-card2)',
                    border: `2px solid ${phase >= p.id ? p.color : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.5rem', transition: 'all 0.5s',
                    boxShadow: phase === p.id ? `0 0 20px ${p.color}66` : 'none',
                  }}>
                    {p.icon}
                  </div>
                  <div style={{
                    fontSize: '0.72rem', fontWeight: 600, textAlign: 'center',
                    color: phase >= p.id ? p.color : 'var(--text-muted)',
                    transition: 'color 0.3s',
                  }}>
                    {p.label}
                  </div>
                </div>
                {i < PHASES.length - 1 && (
                  <div key={`l${i}`} style={{
                    flex: 1, height: 2, minWidth: 30,
                    background: phase > p.id ? p.color : 'var(--border)',
                    transition: 'background 0.5s', marginBottom: 24,
                  }} />
                )}
              </>
            ))}
          </div>
          <button
            className="btn btn-danger"
            style={{ marginTop: '1.5rem' }}
            onClick={runOOBSim}
            disabled={simRunning}
          >
            {simRunning ? '⏳ Simulating crash…' : '💥 Simulate Host Crash → OOB'}
          </button>
        </div>

        <div className="grid-2">
          {/* AES + Encryption result */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card">
              <h3 className="title-md" style={{ marginBottom: '1rem' }}>AES-256-GCM Encryption</h3>
              {encryptStep ? (
                <div className="fade-in">
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-good">ENCRYPTED</span>
                    {encryptStep.data?.simulated && <span className="badge badge-warn">SIMULATED</span>}
                    <span className="badge badge-info">AES-256-GCM</span>
                  </div>
                  {[
                    ['Plaintext Size', `${encryptStep.data?.plaintext_size || '—'} bytes`],
                    ['IV (Nonce)', encryptStep.data?.iv_hex?.slice(0, 24) + '…'],
                    ['Mode', 'GCM (authenticated)'],
                    ['Key Length', '256 bits'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{k}</span>
                      <span style={{ color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>{v}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: '1rem' }}>
                    <div className="metric-label" style={{ marginBottom: '0.4rem' }}>Ciphertext (preview)</div>
                    <div className="share-card" style={{ color: 'var(--accent)' }}>
                      {encryptStep.data?.ciphertext_b64 || '—'}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                  <div style={{ fontSize: '2rem' }}>🔐</div>
                  <p style={{ marginTop: '0.5rem' }}>Run simulation to see encryption result</p>
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="title-md" style={{ marginBottom: '0.5rem' }}>Transmission Status</h3>
              {txStep ? (
                <div className="fade-in">
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <span className="badge badge-good">TRANSMITTED</span>
                    <span className="badge badge-cyan">UART/BLE</span>
                  </div>
                  {[
                    ['Channel', txStep.data?.oob_channel],
                    ['Bytes Sent', txStep.data?.bytes_sent],
                    ['Status', txStep.data?.status],
                    ['Power Source', 'Capacitor (SSD internal)'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{k}</span>
                      <span style={{ color: 'var(--green)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Waiting for simulation…</p>
              )}
            </div>
          </div>

          {/* Shamir shares */}
          <div>
            <div className="card">
              <h3 className="title-md" style={{ marginBottom: '0.5rem' }}>Shamir Secret Sharing</h3>
              <div className="badge badge-info" style={{ marginBottom: '1rem' }}>3-of-5 Threshold</div>
              {shamirStep ? (
                <div className="fade-in">
                  <div className="highlight-box" style={{ marginBottom: '1rem' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                      AES key split into <strong style={{color:'var(--text)'}}>5 shares</strong>.
                      Any <strong style={{color:'var(--accent)'}}>3 of 5</strong> can reconstruct the key.
                      Each share holder can independently verify authenticity.
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {(shamirStep.data?.shares || []).map((share, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: '0.8rem', alignItems: 'flex-start',
                        padding: '0.7rem', background: 'var(--bg-card2)',
                        borderRadius: 10, border: '1px solid var(--border)',
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%',
                          background: 'rgba(99,102,241,0.2)', border: '1px solid var(--accent)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0,
                        }}>
                          S{i + 1}
                        </div>
                        <div>
                          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--accent2)', marginBottom: '0.2rem' }}>
                            {SHARE_HOLDERS[i]}
                          </div>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--accent3)', wordBreak: 'break-all' }}>
                            {share}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: '1rem', padding: '0.8rem', background: 'rgba(16,185,129,0.08)', borderRadius: 10, border: '1px solid rgba(16,185,129,0.25)' }}>
                    <p style={{ fontSize: '0.82rem', color: 'var(--green)', fontWeight: 600 }}>
                      ✅ Engineer needs only 3 shares to reconstruct key and decrypt health report
                    </p>
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 2rem' }}>
                  <div style={{ fontSize: '3rem' }}>🗝️</div>
                  <p style={{ marginTop: '0.5rem' }}>Run simulation to see Shamir shares</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
