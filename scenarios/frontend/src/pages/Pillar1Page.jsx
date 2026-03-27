import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MAX_PE, SCENARIOS, computeMetrics, DEFS, lstmInfer,
  anomalyLabel, decisionEngine, ldpcTier
} from './p1/P1Engine.js'
import { TimeSeriesChart, FeedbackLoop, MetricCard } from './p1/P1Charts.jsx'

// ── Personal Baseline Hook ────────────────────────────────────────────────────
function useBaseline(snap, tick) {
  const hist = useRef({}); const bl = useRef({}); const LEARN = 25
  useEffect(() => {
    if (!snap) return
    DEFS.forEach(({ f }) => {
      if (!hist.current[f]) hist.current[f] = []
      hist.current[f].push(snap[f] ?? 0)
      if (hist.current[f].length > 200) hist.current[f].shift()
    })
    if (tick >= LEARN) {
      DEFS.forEach(({ f }) => {
        const v = hist.current[f] || []
        if (!v.length) return
        const mean = v.reduce((a, b) => a + b, 0) / v.length
        const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 0.001
        bl.current[f] = { mean, std }
      })
    }
  }, [tick])
  const sigma = (f, val) => { const b = bl.current[f]; if (!b) return 0; return Math.abs((val - b.mean) / b.std) }
  const getHist = (f) => hist.current[f] || []
  return { sigma, getHist, learned: tick >= LEARN, bl: bl.current }
}

// ── OOB simulation ────────────────────────────────────────────────────────────
async function runOOBSeq(drive, snap, lstm, setOobLog, setOobRunning) {
  setOobRunning(true); setOobLog([])
  const add = (msg, c = '#8888a0') => setOobLog(l => [...l, { msg, c }])
  const d = ms => new Promise(r => setTimeout(r, ms))
  add('💥 HOST CRASH DETECTED — NVMe interface silent failure.', '#ef4444'); await d(500)
  add('⚡ OOB channel activating (UART @ 115200 / BLE 5.0)…', '#f59e0b'); await d(400)
  add('🔋 Internal capacitors powering SSD controller…', '#f59e0b'); await d(500)
  add('📋 Assembling diagnostic report…'); await d(300)
  add(`   SMART snapshot: pe_avg=${Math.round(drive.pe_avg)}, bad_blocks=${drive.bad_blocks}`)
  add(`   LSTM: failProb=${(lstm.failProb * 100).toFixed(1)}%, RUL=${lstm.rul}d`)
  add(`   ECC rate: ${snap?.ecc_rate || 0}/hr  RBER: ${(snap?.rber || 1e-8).toExponential(2)}`); await d(500)
  add('🔐 AES-256-GCM encryption…', '#a855f7'); await d(400)
  const iv = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
  add(`   IV: ${iv}`); add('   Mode: GCM (authenticated + integrity tag)'); await d(400)
  add('🗝️ Shamir Secret Sharing (3-of-5)…', '#6366f1'); await d(300)
  ;['Operator', 'Cloud Node', 'UART Port', 'BLE Beacon', 'Escrow'].forEach((h, i) => {
    const sh = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
    add(`   Share ${i + 1} → ${h}: ${sh}…`)
  }); await d(500)
  add('📡 Transmitting encrypted payload via OOB channel…', '#06b6d4'); await d(400)
  add('✅ RECOVERY COMPLETE — Diagnostic secured. Any 3 holders can reconstruct the key.', '#22c55e')
  setOobRunning(false)
}

const TABS = [
  { id: 'scenario', label: '🎯 Scenarios' },
  { id: 'smart',    label: '📊 SMART + Baseline' },
  { id: 'lstm',     label: '🧠 LSTM + FTL' },
  { id: 'pipeline', label: '🔁 System Pipeline' },
  { id: 'oob',      label: '🔐 OOB + Security' },
]
const AC_COLOR = { NOMINAL: '#22c55e', WATCH: '#f59e0b', SLOW_BURN: '#f97316', ACCELERATING: '#f97316', CRITICAL: '#ef4444' }

// ═══════════════════════════════════════════════════════════════════════════════
export default function Pillar1Page() {
  const [scenario, setScenario] = useState('healthy')
  const cfg = SCENARIOS[scenario]

  const [drive, setDrive] = useState(() => ({ ...cfg, spiking: false }))
  const [snap, setSnap]   = useState(null)
  const [tick, setTick]   = useState(0)
  const [autoRun, setAutoRun] = useState(true)
  const [activeTab, setActiveTab] = useState('scenario')
  const [selectedMetric, setSelectedMetric] = useState(null)
  const [oobLog, setOobLog] = useState([])
  const [oobRunning, setOobRunning] = useState(false)
  const fullHist = useRef({})
  const spikeTimer = useRef(null)

  const { sigma, getHist, learned, bl } = useBaseline(snap, tick)

  // Switch scenario — reset drive state
  function switchScenario(s) {
    setScenario(s)
    const c = SCENARIOS[s]
    setDrive({ ...c, spiking: false })
    setTick(0)
    fullHist.current = {}
    setSelectedMetric(null)
  }

  const tick_ = useCallback(() => {
    setDrive(d => {
      const c = SCENARIOS[scenario]
      const new_pe = Math.min(MAX_PE * 1.05, d.pe_avg + c.pe_rate + Math.random() * 3)
      const new_bad = d.bad_blocks + (Math.random() < c.bad_rate ? 1 : 0)
      return { ...d, pe_avg: new_pe, bad_blocks: new_bad }
    })
    setTick(t => t + 1)
  }, [scenario])

  useEffect(() => {
    const m = computeMetrics(drive, scenario)
    setSnap(m)
    DEFS.forEach(({ f }) => {
      if (!fullHist.current[f]) fullHist.current[f] = []
      fullHist.current[f].push(m[f])
      if (fullHist.current[f].length > 60) fullHist.current[f].shift()
    })
  }, [tick, drive, scenario])

  useEffect(() => {
    if (!autoRun) return
    const id = setInterval(tick_, 1800)
    return () => clearInterval(id)
  }, [autoRun, tick_])

  function triggerSpike() {
    setDrive(d => ({ ...d, spiking: true }))
    clearTimeout(spikeTimer.current)
    spikeTimer.current = setTimeout(() => setDrive(d => ({ ...d, spiking: false })), 9000)
  }

  function resetSim() {
    const c = SCENARIOS[scenario]
    setDrive({ ...c, spiking: false })
    setTick(0)
    fullHist.current = {}
    clearTimeout(spikeTimer.current)
  }

  const lstm = snap ? lstmInfer(fullHist.current, drive, scenario) : { failProb: 0, rul: 730, l1: 0, l2: 0, wearF: 0, eccF: 0, badF: 0, tempF: 0 }
  const dec  = decisionEngine(lstm)
  const health = Math.round((1 - lstm.failProb) * 100)
  const healthColor = health > 70 ? '#22c55e' : health > 40 ? '#f59e0b' : '#ef4444'
  const anomaly = snap ? anomalyLabel(scenario, lstm.failProb) : 'NOMINAL'
  const acColor = AC_COLOR[anomaly] || '#22c55e'
  const ldpc = snap ? ldpcTier(snap.ecc_rate) : { tier: 1, iters: 8, label: 'Tier 1', color: '#22c55e' }
  const rulAlert = lstm.rul <= 21 && lstm.rul > 0

  // Attention weights
  const weights = DEFS.map(d => {
    const base = [0.42, 0.18, 0.15, 0.12, 0.08, 0.28, 0.07, 0.09, 0.06, 0.05, 0.04, 0.03][d.id - 1] || 0.05
    return base * (1 + (snap?.[d.f] || 0) / Math.max(d.crit, 1) * 0.5)
  })
  const maxW = Math.max(...weights)

  return (
    <div className="page fade-in">
      <div className="page-inner">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ background: 'linear-gradient(135deg,#12121a,#1a1a2e)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700 }}>🧠 PILLAR 1 — Health Monitoring & Diagnostics</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', fontFamily: 'var(--mono)', marginTop: 3 }}>
                SMART Observe → Baseline Learn → LSTM Predict → Decide → FTL Act → Secure → Recover
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-outline btn-sm" onClick={triggerSpike}
                  style={{ color: drive.spiking ? '#f97316' : undefined }}>
                  {drive.spiking ? '🔥 Spike Active' : '⚡ Trigger Spike'}
                </button>
                <button className="btn btn-outline btn-sm" onClick={resetSim}>↺ Reset</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.82rem', color: 'var(--text-dim)' }}>
                  <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} />
                  Auto-tick
                </label>
                <button className="btn btn-outline btn-sm" onClick={tick_}>⏭ Step</button>
                <button className="btn btn-outline btn-sm"
                  onClick={() => setDrive(d => ({ ...d, stress: !d.stress }))}
                  style={{ color: drive.stress ? '#ef4444' : 'var(--text-muted)' }}>
                  {drive.stress ? '🔴 STRESS ON' : '💤 STRESS OFF'}
                </button>
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '3.8rem', fontWeight: 800, color: healthColor, lineHeight: 1 }}>{health}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>HEALTH SCORE</div>
              <div style={{ color: '#3b82f6', fontSize: '0.85rem', fontWeight: 600 }}>RUL: ~{lstm.rul}d</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ background: acColor + '22', border: `1px solid ${acColor}`, color: acColor, padding: '4px 14px', borderRadius: 20, fontWeight: 700, fontSize: '0.82rem' }}>
                {anomaly}
              </span>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 8 }}>
                Tick: <b style={{ color: 'var(--accent)' }}>{tick}</b> &nbsp;·&nbsp;
                P/E: <b>{Math.round(drive.pe_avg)}/{MAX_PE}</b> &nbsp;·&nbsp;
                Bad: <b style={{ color: '#ef4444' }}>{drive.bad_blocks}</b>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: learned ? '#22c55e' : '#60a5fa', marginTop: 3 }}>
                {learned ? '✅ Baseline learned' : `📚 Learning ${tick}/25…`}
              </div>
              {/* LDPC Tier indicator */}
              <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: '0.68rem', color: ldpc.color,
                background: ldpc.color + '18', border: `1px solid ${ldpc.color}55`, borderRadius: 6, padding: '3px 8px', display: 'inline-block' }}>
                ECC {ldpc.label} · {ldpc.iters} iters
              </div>
            </div>
          </div>
        </div>

        {/* ── RUL Alert Banner ─────────────────────────────────────────── */}
        {rulAlert && (
          <div className="fade-in" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 10, padding: '0.8rem 1.2rem', marginBottom: '1rem', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.9rem' }}>⚠ RUL = {lstm.rul}d — Failure risk high — triggering protective mechanisms</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: '#f59e0b' }}>Pillar 2: Block retirement initiated</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: '#a855f7' }}>Pillar 3: ECC strength increased → {ldpc.iters} iters</span>
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.2rem', overflowX: 'auto' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '0.6rem 1.2rem', border: 'none', background: 'transparent',
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.87rem', fontWeight: 600, transition: 'all 0.2s', whiteSpace: 'nowrap'
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ TAB 0: Scenarios ═══════════════════════════════════════════ */}
        {activeTab === 'scenario' && (
          <div className="fade-in">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
              {Object.entries(SCENARIOS).map(([key, c]) => (
                <div key={key} onClick={() => switchScenario(key)}
                  className="card"
                  style={{ cursor: 'pointer', borderColor: scenario === key ? c.color : 'var(--border)',
                    boxShadow: scenario === key ? `0 0 20px ${c.color}44` : 'none', transition: 'all 0.3s',
                    background: scenario === key ? `${c.color}10` : 'var(--bg-card)' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{c.label.split(' ')[0]}</div>
                  <div style={{ color: c.color, fontWeight: 700, fontSize: '0.95rem', marginBottom: 6 }}>{c.label.slice(3)}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem', lineHeight: 1.6, marginBottom: 12 }}>{c.desc}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>
                    {[
                      ['Health', `${c.health_range[0]}–${c.health_range[1]}`],
                      ['RUL', `${c.rul_range[0]}–${c.rul_range[1]}d`],
                      ['Anomaly', c.anomaly],
                      ['Fail Prob', `<${Math.round(c.fail_prob_max * 100)}%`],
                    ].map(([k, v]) => (
                      <div key={k} style={{ background: 'var(--bg-card2)', borderRadius: 6, padding: '4px 8px' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{k}</div>
                        <div style={{ color: c.color, fontWeight: 600 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {scenario === key && (
                    <div style={{ marginTop: 10, color: c.color, fontWeight: 700, fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>● ACTIVE</div>
                  )}
                </div>
              ))}
            </div>

            {/* Scenario behavior explanation */}
            <div className="card" style={{ marginBottom: '1.2rem' }}>
              <div className="title-md" style={{ marginBottom: '1rem' }}>📈 Scenario Behavior Patterns</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem' }}>
                {[
                  { title: '🟢 Healthy', items: ['Small fluctuations only', 'No anomaly detection', 'ECC rate: low & stable', 'Bad blocks: not growing', 'LSTM: NOMINAL output'], color: '#22c55e' },
                  { title: '🟡 Pre-Failure', items: ['ECC accelerating slowly', 'SLOW_BURN anomaly label', 'Occasional retries', 'Bad blocks creeping up', 'RUL 10–30 days'], color: '#f59e0b' },
                  { title: '🔴 Critical', items: ['UECC events appear', 'Rapid bad block growth', 'High latency + retries', 'CRITICAL state triggered', 'FTL + ECC max response'], color: '#ef4444' },
                ].map(s => (
                  <div key={s.title} style={{ background: `${s.color}0d`, border: `1px solid ${s.color}33`, borderRadius: 10, padding: '0.8rem' }}>
                    <div style={{ color: s.color, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                    {s.items.map((item, i) => (
                      <div key={i} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 4 }}>• {item}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Live time-series chart */}
            <div className="card">
              <div className="title-md" style={{ marginBottom: '0.5rem' }}>📉 Live Time-Series — ECC Rate · Wear Level · Temperature</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.8rem' }}>
                Shaded band = learned baseline normal range. Orange dashed line = acceleration detected.
              </div>
              <TimeSeriesChart history={fullHist.current} baseline={learned ? bl : null} />
              {scenario === 'prefailure' && tick > 20 && (
                <div style={{ marginTop: 8, color: '#f97316', fontSize: '0.8rem', fontFamily: 'var(--mono)' }}>
                  ⚠ Acceleration detected — slope increasing. SLOW_BURN pattern confirmed.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ TAB 1: SMART + Baseline ════════════════════════════════════ */}
        {activeTab === 'smart' && snap && (
          <div className="fade-in">
            <div style={{ background: learned ? 'rgba(34,197,94,0.08)' : 'rgba(59,130,246,0.08)', border: `1px solid ${learned ? 'rgba(34,197,94,0.3)' : 'rgba(59,130,246,0.3)'}`, borderRadius: 8, padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
              {learned
                ? <span style={{ color: '#22c55e' }}>✅ <b>Personal Baseline Active</b> — Each metric vs this drive's learned normal. σ badges show deviations.</span>
                : <span style={{ color: '#60a5fa' }}>📚 <b>Learning Phase {tick}/25</b> — Observing normal degradation. Anomaly detection activates at tick 25.</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.65rem', marginBottom: '1.2rem' }}>
              {DEFS.map(def => (
                <MetricCard key={def.id} def={def} val={snap[def.f] ?? 0}
                  hist={getHist(def.f)} sigma={sigma} learned={learned}
                  bl={bl[def.f]} selected={selectedMetric === def.f}
                  onSelect={() => setSelectedMetric(selectedMetric === def.f ? null : def.f)} />
              ))}
            </div>
            {/* Selected metric detail */}
            {selectedMetric && (() => {
              const def = DEFS.find(d => d.f === selectedMetric)
              const val = snap[selectedMetric] ?? 0
              const sig = sigma(selectedMetric, val)
              const bl_ = bl[selectedMetric]
              return (
                <div className="card fade-in" style={{ borderLeft: `4px solid ${def.color}`, marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ color: def.color, fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>#{def.id} {def.name}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.83rem', marginBottom: 8 }}>{def.why}</div>
                    </div>
                    <button onClick={() => setSelectedMetric(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.5rem' }}>
                    {[
                      { label: 'Current', val: def.f === 'rber' ? val.toExponential(2) : `${val}${def.unit}` },
                      { label: 'Warn threshold', val: `${def.warn}${def.unit}` },
                      { label: 'Crit threshold', val: `${def.crit}${def.unit}` },
                      { label: 'Sigma', val: learned && bl_ ? `${sig.toFixed(2)}σ` : 'learning…' },
                    ].map(m => (
                      <div key={m.label} className="metric-tile">
                        <div className="metric-label">{m.label}</div>
                        <div style={{ color: def.color, fontFamily: 'var(--mono)', fontWeight: 700 }}>{m.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ══ TAB 2: LSTM + FTL ═════════════════════════════════════════ */}
        {activeTab === 'lstm' && (
          <div className="fade-in">
            <div className="grid-2" style={{ marginBottom: '1.2rem' }}>
              {/* Health + LSTM output */}
              <div className="card" style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))' }}>
                <div className="metric-label" style={{ marginBottom: 4 }}>Health Score (LSTM 2-Layer Output)</div>
                <div style={{ fontSize: '5rem', fontWeight: 800, fontFamily: 'var(--mono)', color: healthColor, lineHeight: 1, margin: '0.5rem 0' }}>{health}</div>
                <div style={{ background: 'var(--bg-card2)', borderRadius: 8, height: 14, overflow: 'hidden', marginBottom: '1rem' }}>
                  <div style={{ width: `${health}%`, height: '100%', background: healthColor, borderRadius: 8, transition: 'width 0.8s' }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.8rem' }}>
                  {[
                    { label: 'Failure Prob', val: `${(lstm.failProb * 100).toFixed(1)}%`, color: '#ef4444' },
                    { label: 'RUL', val: `~${lstm.rul} days`, color: '#3b82f6' },
                    { label: 'L1 ECC Trend', val: lstm.l1 > 0 ? `↑ ${lstm.l1}` : lstm.l1 < 0 ? `↓ ${Math.abs(lstm.l1)}` : '→ stable', color: '#f59e0b' },
                    { label: 'Anomaly', val: anomaly, color: acColor },
                  ].map(m => (
                    <div key={m.label} className="metric-tile">
                      <div className="metric-label">{m.label}</div>
                      <div style={{ color: m.color, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.9rem' }}>{m.val}</div>
                    </div>
                  ))}
                </div>
                {/* L2 gate breakdown */}
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: '0.6rem', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Layer 2 gate weights:</div>
                  {[
                    { label: 'Wear factor', val: lstm.wearF, color: '#a855f7' },
                    { label: 'ECC factor',  val: lstm.eccF,  color: '#22c55e' },
                    { label: 'Block factor',val: lstm.badF,  color: '#f59e0b' },
                    { label: 'Temp factor', val: lstm.tempF, color: '#f97316' },
                  ].map(g => (
                    <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ color: 'var(--text-muted)', minWidth: 80 }}>{g.label}</span>
                      <div style={{ flex: 1, background: 'var(--bg-card2)', borderRadius: 3, height: 7, overflow: 'hidden' }}>
                        <div style={{ width: `${g.val * 100}%`, height: '100%', background: g.color, borderRadius: 3 }} />
                      </div>
                      <span style={{ color: g.color, minWidth: 36, textAlign: 'right' }}>{g.val.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* FTL Integration Panel */}
              <div className="card">
                <div className="title-md" style={{ marginBottom: '0.8rem' }}>⚙️ FTL Integration — Execution Layer</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.8rem' }}>LSTM does not just predict — it controls the system</div>
                {[
                  { cond: lstm.failProb > 0.5, label: 'FTL: Retiring weak blocks', color: '#ef4444', detail: 'Bitmap marked, data migrated to spare pool' },
                  { cond: snap?.uecc_count > 0, label: 'FTL: Reallocating data', color: '#f97316', detail: 'UECC detected — remapping logical→physical' },
                  { cond: lstm.failProb > 0.25, label: 'Wear leveling adjusted', color: '#f59e0b', detail: 'Hot blocks paused, cold blocks rotated in' },
                  { cond: snap?.ecc_rate >= 500, label: `LDPC: ${ldpc.iters} iterations active`, color: ldpc.color, detail: ldpc.label },
                  { cond: snap?.bad_block_count >= 5, label: 'P2: BBT update triggered', color: '#a855f7', detail: 'Bad block table written to NAND' },
                  { cond: lstm.failProb <= 0.25, label: 'FTL: Normal operation', color: '#22c55e', detail: 'No interventions needed' },
                ].filter(a => a.cond).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8, padding: '8px 12px',
                    background: `${a.color}10`, border: `1px solid ${a.color}33`, borderRadius: 8 }}>
                    <span style={{ color: a.color, fontSize: '0.82rem', fontFamily: 'var(--mono)', fontWeight: 700, minWidth: 160 }}>{a.label}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>— {a.detail}</span>
                  </div>
                ))}
                {/* LDPC tier visual */}
                <div style={{ marginTop: 8, padding: '0.7rem', background: 'rgba(0,0,0,0.3)', borderRadius: 8 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginBottom: 6, fontFamily: 'var(--mono)' }}>ECC / LDPC Tier Escalation:</div>
                  {[
                    { t: 1, label: 'Tier 1 — BCH / Fast LDPC', iters: 8,  ecc: '<500',   color: '#22c55e' },
                    { t: 2, label: 'Tier 2 — Medium LDPC',     iters: 12, ecc: '500–2000', color: '#f59e0b' },
                    { t: 3, label: 'Tier 3 — Soft-decode LDPC',iters: 20, ecc: '>2000',   color: '#ef4444' },
                  ].map(tier => (
                    <div key={tier.t} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: ldpc.tier === tier.t ? tier.color : 'transparent',
                        border: `2px solid ${tier.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', fontWeight: 700, color: tier.color }}>
                        {tier.t}
                      </div>
                      <span style={{ color: ldpc.tier === tier.t ? tier.color : 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'var(--mono)' }}>
                        {tier.label} ({tier.iters} iters) — ECC {tier.ecc}/hr
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Decision Engine */}
            <div className="card" style={{ borderLeft: `4px solid ${dec.color}`, background: `${dec.color}08`, marginBottom: '1.2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: dec.color, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Decision Engine → {dec.level}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginTop: 4 }}>{dec.action}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {dec.cmds.map((c, i) => (
                    <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: dec.color, background: dec.color + '11', border: `1px solid ${dec.color}33`, borderRadius: 6, padding: '3px 10px' }}>{c}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* Decision levels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.7rem' }}>
              {[
                { level: 'NOMINAL', p: '<25%', color: '#22c55e', action: 'Monitor. No action.' },
                { level: 'WARNING', p: '25-50%', color: '#f59e0b', action: 'Tighten baseline. Increase checks.' },
                { level: 'CRITICAL', p: '50-75%', color: '#f97316', action: '🚨 Relocate data from worn blocks.' },
                { level: 'SEVERE', p: '>75%', color: '#ef4444', action: 'Emergency retire + OOB alert.' },
              ].map(c => (
                <div key={c.level} className="card" style={{ borderLeft: `4px solid ${c.color}`, opacity: dec.level === c.level ? 1 : 0.45, transition: 'opacity 0.3s' }}>
                  <div style={{ color: c.color, fontWeight: 700, fontFamily: 'var(--mono)', fontSize: '0.82rem' }}>{c.level}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: 2 }}>failProb {c.p}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 6 }}>{c.action}</div>
                  {dec.level === c.level && <div style={{ marginTop: 8, color: c.color, fontSize: '0.72rem', fontWeight: 700 }}>← ACTIVE NOW</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TAB 3: System Pipeline ═════════════════════════════════════ */}
        {activeTab === 'pipeline' && (
          <div className="fade-in">
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '0.8rem' }}>🔁 Closed Feedback Loop</div>
              <FeedbackLoop tick={tick} dec={dec} />
              <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                Each tick the animated node shows which stage is actively processing.
              </div>
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '1rem' }}>🔁 Complete Closed-Loop System Flow</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', lineHeight: 2.2, background: '#0a0a14', borderRadius: 8, padding: '1rem' }}>
                {[
                  ['#14b8a6', 'PILLAR 3', `Syndrome calc detects RBER spike → LDPC tier escalation → health monitor fires PRE_FAILURE`],
                  ['#6366f1', 'PILLAR 1', `SMART engine receives ECC update → metric #1 = ${snap?.ecc_rate || 0}/hr`],
                  ['#6366f1', 'PILLAR 1', 'Personal Baseline: compare vs learned μ±σ → deviation flagged if >2σ'],
                  ['#a855f7', 'LSTM L1',  `Short-term ECC trend = ${lstm.l1} → hour-scale fluctuations`],
                  ['#a855f7', 'LSTM L2',  `Long-term: wear=${lstm.wearF.toFixed(2)}, ecc=${lstm.eccF.toFixed(2)} → failProb=${(lstm.failProb * 100).toFixed(1)}%`],
                  ['#f97316', 'DECISION', `${dec.level}: ${dec.action}`],
                  ['#f59e0b', 'PILLAR 2', 'Receives PRE_RETIRE → Bitmap[N]=0 → data copied → BBT updated'],
                  ['#22c55e', 'PILLAR 3', `Receives RAISE_LDPC_CAP → max_iters updated to ${ldpc.iters} for worn blocks`],
                  ['#22c55e', 'RESULT',   'Zero data loss. Block retired before UECC occurred.'],
                ].map(([col, src, msg], i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 2 }}>
                    <span style={{ color: col, minWidth: 80, fontWeight: 700 }}>{src}</span>
                    <span style={{ color: '#555' }}>→</span>
                    <span style={{ color: 'var(--text-dim)' }}>{msg}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{ marginBottom: '0.8rem' }}>What Pillar 1 Actually Is</div>
                {[
                  ['Data Collector', 'Reads 12 metrics from P2 (wear, bad blocks) and P3 (ECC, RBER, latency)'],
                  ['AI Brain', '2-layer LSTM over rolling time-series. Layer 1=hours, Layer 2=weeks.'],
                  ['Decision Engine', '4-level decision (NOMINAL/WARNING/CRITICAL/SEVERE) → cross-pillar commands'],
                  ['Comm Layer', 'In-band (NVMe) when host alive. OOB (UART/BLE + caps) on crash.'],
                  ['Security Layer', 'AES-256-GCM encryption + Shamir 3-of-5 key split before transmit'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 10, marginBottom: 10, padding: '8px', background: 'var(--bg-card2)', borderRadius: 7 }}>
                    <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: 130, fontSize: '0.82rem' }}>{k}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="title-md" style={{ marginBottom: '0.8rem' }}>Why Personal Baseline?</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.84rem', lineHeight: 1.7 }}>
                  <div style={{ marginBottom: 10, padding: '0.7rem', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)' }}>
                    <b style={{ color: '#ef4444' }}>Generic threshold:</b>&nbsp;ECC &gt; 400 = bad
                    <br /><span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Problem: A fresh drive at 400 = normal. An old drive at 400 = healthy.</span>
                  </div>
                  <div style={{ padding: '0.7rem', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)' }}>
                    <b style={{ color: '#22c55e' }}>Personal baseline:</b>&nbsp;
                    "This drive's ECC is normally {bl['ecc_rate']?.mean?.toFixed(0) ?? '~learning'}±{bl['ecc_rate']?.std?.toFixed(0) ?? '…'}/hr"
                    <br /><span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>A rise = anomaly here. Not a generic cutoff.</span>
                  </div>
                  <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    → Adapts to workload type<br />
                    → Detects slow, creeping failures<br />
                    → Avoids false alarms on high-write drives
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB 4: OOB + Security ══════════════════════════════════════ */}
        {activeTab === 'oob' && (
          <div className="fade-in">
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '0.8rem' }}>📡 Out-of-Band (OOB) Recovery Architecture</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.8rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Channel', val: 'UART 115200 / BLE 5.0', color: '#06b6d4' },
                  { label: 'Power', val: 'Internal capacitors', color: '#10b981' },
                  { label: 'Trigger', val: 'Host crash / NVMe dead', color: '#ef4444' },
                  { label: 'Encryption', val: 'AES-256-GCM', color: '#a855f7' },
                  { label: 'Key Sharing', val: 'Shamir 3-of-5', color: '#6366f1' },
                  { label: 'Status', val: 'ARMED', color: '#22c55e' },
                ].map(m => (
                  <div key={m.label} className="metric-tile">
                    <div className="metric-label">{m.label}</div>
                    <div style={{ color: m.color, fontWeight: 700, fontSize: '0.9rem', marginTop: '0.3rem', fontFamily: 'var(--mono)' }}>{m.val}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-danger"
                onClick={() => runOOBSeq(drive, snap, lstm, setOobLog, setOobRunning)}
                disabled={oobRunning} style={{ marginBottom: '1rem' }}>
                {oobRunning ? '⏳ Transmitting…' : '💥 Simulate Host Crash → OOB Recovery'}
              </button>
              {oobLog.length > 0 && (
                <div style={{ background: '#050510', border: '1px solid var(--border)', borderRadius: 8, padding: '0.8rem', maxHeight: 320, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '0.76rem' }}>
                  {oobLog.map((e, i) => <div key={i} style={{ color: e.c, marginBottom: 4 }}>{e.msg}</div>)}
                </div>
              )}
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{ marginBottom: '0.8rem' }}>🔐 AES-256-GCM Encryption</div>
                {[
                  ['Why AES-256', 'Quantum-resistant key size. GCM mode provides confidentiality + integrity.'],
                  ['What is encrypted', '12 SMART metrics + LSTM prediction + BBT state + failure root cause'],
                  ['IV/Nonce', '128-bit random nonce. Never reused. Prevents replay attacks.'],
                  ['Auth Tag', '128-bit GCM tag. Any bit flip in ciphertext invalidates it.'],
                ].map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 8, padding: '7px 10px', background: 'rgba(168,85,247,0.07)', borderRadius: 7, border: '1px solid rgba(168,85,247,0.15)' }}>
                    <div style={{ color: '#a855f7', fontWeight: 700, fontSize: '0.8rem', marginBottom: 2 }}>{k}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="title-md" style={{ marginBottom: '0.8rem' }}>🗝️ Shamir Secret Sharing (3-of-5)</div>
                {[
                  ['Operators', '5 key shares distributed to 5 holders'],
                  ['Threshold', 'Any 3 holders can reconstruct the original key'],
                  ['Security', 'Any 2 shares reveal zero information (information-theoretic)'],
                  ['Holders', ['Operator A', 'Cloud Node', 'UART Port', 'BLE Beacon', 'Escrow Agent'].join(' · ')],
                ].map(([k, v]) => (
                  <div key={k} style={{ marginBottom: 8, padding: '7px 10px', background: 'rgba(99,102,241,0.07)', borderRadius: 7, border: '1px solid rgba(99,102,241,0.15)' }}>
                    <div style={{ color: '#6366f1', fontWeight: 700, fontSize: '0.8rem', marginBottom: 2 }}>{k}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>{v}</div>
                  </div>
                ))}
                <div style={{ marginTop: 12, padding: '0.7rem', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.2)', fontSize: '0.82rem', color: '#22c55e', fontWeight: 600 }}>
                  ✅ Recovery possible even when host is dead, NVMe is silent, and drive is physically removed.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
