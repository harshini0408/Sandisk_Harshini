import { DEFS, STATUS_COLOR, metricStatus } from './P1Engine.js'

// ── Sparkline ────────────────────────────────────────────────────────────────
export function Sparkline({ vals, color }) {
  if (!vals || vals.length < 2) return null
  const max = Math.max(...vals, 1), w = 110, h = 38
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * (h - 2) + 1}`)
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity={0.13} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  )
}

// ── Multi-line Time Series Chart ─────────────────────────────────────────────
export function TimeSeriesChart({ history, baseline }) {
  const W = 900, H = 160, PAD = 36
  const IW = W - PAD * 2, IH = H - PAD * 2

  const series = [
    { key: 'ecc_rate',    label: 'ECC Rate', color: '#22c55e', maxHint: 5000 },
    { key: 'wear_level',  label: 'Wear %',   color: '#a855f7', maxHint: 100  },
    { key: 'temperature', label: 'Temp °C',  color: '#f97316', maxHint: 100  },
  ]

  const n = Math.max(...series.map(s => (history[s.key] || []).length), 2)

  function toPath(vals, maxH) {
    if (!vals || vals.length < 2) return ''
    const max = Math.max(...vals, maxH * 0.1)
    return vals.map((v, i) => {
      const x = PAD + (i / (vals.length - 1)) * IW
      const y = PAD + IH - (v / max) * IH
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }

  // Detect acceleration: compare slope of last 5 vs first 5 points
  function getAcceleration(vals) {
    if (!vals || vals.length < 12) return null
    const half = Math.floor(vals.length / 2)
    const early = vals.slice(0, half), late = vals.slice(half)
    const slopeEarly = (early[early.length-1] - early[0]) / early.length
    const slopeLate  = (late[late.length-1] - late[0]) / late.length
    return slopeLate > slopeEarly * 1.8 ? { x: PAD + (half / vals.length) * IW } : null
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }}>
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={PAD} y1={PAD + IH * t} x2={PAD + IW} y2={PAD + IH * t}
            stroke="rgba(255,255,255,0.05)" strokeDasharray="4,4" />
        ))}
        {/* Baseline band for ECC if available */}
        {baseline?.ecc_rate && (() => {
          const { mean, std } = baseline.ecc_rate
          const maxH = 5000
          const y1 = PAD + IH - Math.min(1, (mean + std) / maxH) * IH
          const y2 = PAD + IH - Math.min(1, Math.max(0, mean - std) / maxH) * IH
          return <rect x={PAD} y={y1} width={IW} height={y2 - y1} fill="rgba(34,197,94,0.07)" />
        })()}
        {/* Series lines */}
        {series.map(s => {
          const vals = history[s.key] || []
          const accel = getAcceleration(vals)
          return (
            <g key={s.key}>
              <path d={toPath(vals, s.maxHint)} fill="none" stroke={s.color} strokeWidth="2" opacity="0.9" />
              {accel && (
                <g>
                  <line x1={accel.x} y1={PAD} x2={accel.x} y2={PAD + IH}
                    stroke="#f97316" strokeDasharray="5,3" strokeWidth="1.5" opacity="0.7" />
                  <text x={accel.x + 4} y={PAD + 12} fill="#f97316" fontSize="9" fontFamily="monospace">
                    ↑ accel
                  </text>
                </g>
              )}
            </g>
          )
        })}
        {/* Axes */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={PAD + IH} stroke="rgba(255,255,255,0.15)" />
        <line x1={PAD} y1={PAD + IH} x2={PAD + IW} y2={PAD + IH} stroke="rgba(255,255,255,0.15)" />
        {/* Legend */}
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${PAD + i * 120}, ${H - 10})`}>
            <rect width={18} height={4} y={-2} rx={2} fill={s.color} />
            <text x={22} fill={s.color} fontSize="10" fontFamily="monospace" dominantBaseline="middle">{s.label}</text>
          </g>
        ))}
        <text x={PAD + IW / 2} y={H - 2} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="middle" fontFamily="monospace">
          ← {n} ticks →
        </text>
      </svg>
    </div>
  )
}

// ── Feedback Loop Diagram ─────────────────────────────────────────────────────
export function FeedbackLoop({ tick, dec }) {
  const nodes = [
    { label: 'SMART\nMetrics', color: '#3b82f6' },
    { label: 'LSTM\nEngine',   color: '#a855f7' },
    { label: 'Decision\nEngine', color: dec.color },
    { label: 'FTL +\nECC',    color: '#f59e0b' },
    { label: 'Updated\nBehavior', color: '#22c55e' },
  ]
  const pulse = tick % nodes.length
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '1rem 0' }}>
      {nodes.map((n, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            padding: '6px 14px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
            fontFamily: 'var(--mono)', whiteSpace: 'pre', textAlign: 'center',
            background: `${n.color}20`,
            border: `1.5px solid ${pulse === i ? n.color : n.color + '50'}`,
            color: n.color,
            boxShadow: pulse === i ? `0 0 14px ${n.color}88` : 'none',
            transition: 'all 0.4s',
          }}>
            {n.label}
          </div>
          {i < nodes.length - 1 && (
            <div style={{ color: pulse === i ? '#fff' : 'rgba(255,255,255,0.2)', fontSize: '1.1rem', transition: 'color 0.4s' }}>→</div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── SMART Metric Card ─────────────────────────────────────────────────────────
export function MetricCard({ def, val, hist, sigma, learned, bl, selected, onSelect }) {
  const st = metricStatus(val, def)
  const dc = STATUS_COLOR[st]
  const sig = sigma(def.f, val)
  const display = def.f === 'rber' ? val.toExponential(1) : (Number.isInteger(val) ? val : val?.toFixed(1))
  return (
    <div onClick={onSelect} className="card card-sm"
      style={{ background: 'var(--bg-card2)', border: `1px solid ${dc}44`, cursor: 'pointer',
               boxShadow: selected ? `0 0 12px ${dc}55` : 'none', transition: 'all 0.2s' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.67rem', fontFamily: 'var(--mono)' }}>#{def.id} {def.name}</span>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: dc, display: 'inline-block', boxShadow: `0 0 5px ${dc}` }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ color: def.color, fontSize: '1.3rem', fontWeight: 700, fontFamily: 'var(--mono)' }}>{display}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{def.unit}</span>
        {learned && sig >= 2 && (
          <span style={{ background: sig >= 3 ? '#ef444422' : '#f59e0b22', border: `1px solid ${sig >= 3 ? '#ef4444' : '#f59e0b'}`,
                         color: sig >= 3 ? '#ef4444' : '#f59e0b', padding: '0px 4px', borderRadius: 6, fontSize: 9, fontWeight: 700 }}>
            {sig.toFixed(1)}σ
          </span>
        )}
      </div>
      <div style={{ color: '#3a3a50', fontSize: '0.61rem', marginBottom: 3 }}>FROM {def.src}</div>
      {learned && bl && (
        <div style={{ color: '#4a4a60', fontSize: '0.61rem', marginBottom: 2, fontFamily: 'var(--mono)' }}>
          μ={bl.mean.toFixed(1)} σ={bl.std.toFixed(1)}
        </div>
      )}
      <Sparkline vals={hist.slice(-20)} color={dc} />
    </div>
  )
}
