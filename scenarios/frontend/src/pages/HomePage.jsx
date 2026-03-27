import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SCENARIOS = [
  {
    id: 'BOOT',
    icon: '🔌',
    title: 'SSD Boot',
    color: '#6366f1',
    desc: 'Power-ON initialization — rebuilds BBT, seeds SMART/LSTM, initializes ECC pipeline.',
    pillars: ['P2','P1','P3','P4'],
    pages: ['BBT','SMART','ECC','Logic'],
  },
  {
    id: 'READ',
    icon: '📖',
    title: 'Normal Read Request',
    color: '#06b6d4',
    desc: 'Host → NVMe → FTL → BBT gate → ECC decode → data delivered to OS.',
    pillars: ['P1','P2','P3'],
    pages: ['FTL','BBT','ECC'],
  },
  {
    id: 'WRITE',
    icon: '✏️',
    title: 'Normal Write Request',
    color: '#10b981',
    desc: 'Host write → FTL wear-leveling → block selection → BCH encode → NAND write.',
    pillars: ['P1','P2','P3'],
    pages: ['FTL','Block','ECC','NAND'],
  },
  {
    id: 'DEGRADATION',
    icon: '⚠️',
    title: 'Progressive Block Degradation',
    color: '#f59e0b',
    desc: 'Wear ↑ → LDPC iterations ↑ → LSTM triggers PRE_FAILURE → relocation → BBT retire.',
    pillars: ['P3','P1','P2','P4'],
    pages: ['ECC','Predict','Relocate','BBT'],
  },
  {
    id: 'HOST_CRASH',
    icon: '💥',
    title: 'Host Crash (OOB + Security)',
    color: '#ef4444',
    desc: 'Host offline → OOB activated → AES-256 encrypt → Shamir 3-of-5 key split → UART transmit.',
    pillars: ['P1'],
    pages: ['OOB','Encrypt','KeySplit','TX'],
  },
  {
    id: 'GC',
    icon: '♻️',
    title: 'Garbage Collection',
    color: '#8b5cf6',
    desc: 'Low space → worn block selection → re-encode data → erase & reclaim blocks.',
    pillars: ['P1','P2','P3','P4'],
    pages: ['Trigger','Move','ECC','Update'],
  },
]

export default function HomePage() {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState(null)

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* Hero */}
        <div style={{ textAlign: 'center', padding: '3rem 0 2.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <span className="badge badge-info" style={{ fontSize: '0.8rem', marginBottom: '1rem' }}>
              ⚡ Event-Driven SSD Firmware Simulation
            </span>
          </div>
          <h1 className="title-xl" style={{ marginBottom: '1.2rem' }}>AURA Firmware Simulator</h1>
          <p className="subtitle" style={{ maxWidth: 600, margin: '0 auto 2rem' }}>
            A real-time, event-driven SSD firmware ecosystem with 4 pillars,
            6 real-world scenarios, predictive failure prevention &amp; secure OOB recovery.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { label: '4 Pillars', sub: 'FTL · BBT · ECC · Logic' },
              { label: '6 Scenarios', sub: 'Boot to Crash Recovery' },
              { label: 'AES-256', sub: '+Shamir 3-of-5' },
              { label: 'Event-Driven', sub: 'No fixed pipeline' },
            ].map(m => (
              <div key={m.label} className="card card-sm" style={{ minWidth: 130, textAlign: 'center' }}>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--accent)' }}>{m.label}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Scenario Grid */}
        <h2 className="title-md" style={{ marginBottom: '1rem', opacity: 0.8 }}>
          Select a Scenario to Simulate
        </h2>
        <div className="grid-2" style={{ gap: '1.2rem' }}>
          {SCENARIOS.map(s => (
            <div
              key={s.id}
              className="scenario-card"
              style={{ borderColor: hovered === s.id ? s.color + '66' : undefined }}
              onMouseEnter={() => setHovered(s.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => navigate('/simulation', { state: { scenario: s.id } })}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  fontSize: '2.2rem', background: s.color + '22',
                  width: 56, height: 56, borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `1px solid ${s.color}44`,
                }}>
                  {s.icon}
                </div>
                <div>
                  <div className="scenario-title">{s.title}</div>
                  <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem' }}>
                    {s.pillars.map(p => (
                      <span key={p} className="badge badge-info" style={{ fontSize: '0.68rem' }}>{p}</span>
                    ))}
                  </div>
                </div>
              </div>
              <p className="scenario-desc">{s.desc}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  {s.pages.map(p => (
                    <span key={p} className="badge badge-cyan" style={{ fontSize: '0.65rem' }}>{p}</span>
                  ))}
                </div>
                <span style={{ color: s.color, fontSize: '1.2rem' }}>→</span>
              </div>
            </div>
          ))}
        </div>

        {/* System Architecture Diagram */}
        <div className="card" style={{ marginTop: '2rem' }}>
          <h3 className="title-md" style={{ marginBottom: '1.2rem' }}>System Architecture</h3>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            flexWrap: 'wrap', justifyContent: 'center',
          }}>
            {[
              { label: 'User / App', color: '#6366f1' },
              { label: '→', color: 'var(--text-muted)', noBox: true },
              { label: 'Host OS', color: '#8b5cf6' },
              { label: '→', color: 'var(--text-muted)', noBox: true },
              { label: 'NVMe', color: '#06b6d4' },
              { label: '→', color: 'var(--text-muted)', noBox: true },
              { label: 'SSD Controller', color: '#f59e0b', wide: true },
              { label: '→', color: 'var(--text-muted)', noBox: true },
              { label: 'NAND Flash', color: '#10b981' },
            ].map((item, i) => item.noBox ? (
              <span key={i} style={{ color: item.color, fontSize: '1.4rem' }}>{item.label}</span>
            ) : (
              <div key={i} style={{
                padding: '0.5rem 1rem', borderRadius: 10,
                border: `1px solid ${item.color}55`,
                background: item.color + '15',
                color: item.color, fontWeight: 600, fontSize: '0.9rem',
                whiteSpace: 'nowrap',
              }}>{item.label}</div>
            ))}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
            gap: '1rem', marginTop: '1.5rem',
          }}>
            {[
              { p: 'Pillar 1', name: 'FTL + SMART + LSTM', color: '#6366f1', icon: '🧠' },
              { p: 'Pillar 2', name: 'BBT (Bloom+Bitmap+Hash)', color: '#06b6d4', icon: '🗺️' },
              { p: 'Pillar 3', name: 'ECC Engine (3-tier)', color: '#f59e0b', icon: '🔧' },
              { p: 'Pillar 4', name: 'Logic Optimization', color: '#10b981', icon: '⚡' },
            ].map(p => (
              <div key={p.p} style={{
                background: p.color + '12', border: `1px solid ${p.color}33`,
                borderRadius: 12, padding: '0.8rem', textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.5rem' }}>{p.icon}</div>
                <div style={{ color: p.color, fontWeight: 700, fontSize: '0.85rem', marginTop: '0.3rem' }}>{p.p}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
