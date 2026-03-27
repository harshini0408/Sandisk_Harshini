import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

// ── SMART metric definitions (mirrors Streamlit section3_smart.py) ─────────────
const SMART_DEFS = [
  { id: 1,  field: 'ecc_rate',        name: 'ECC Rate',          unit: '/hr',  fmt: v => Math.round(v).toLocaleString(), warn: 500,   crit: 2000,  color: '#22c55e', source: 'PILLAR 3' },
  { id: 2,  field: 'uecc_count',      name: 'UECC Count',        unit: '',     fmt: v => v,                               warn: 1,     crit: 5,     color: '#ef4444', source: 'PILLAR 3' },
  { id: 3,  field: 'bad_block_count', name: 'Bad Block Count',   unit: '',     fmt: v => v,                               warn: 5,     crit: 15,    color: '#f59e0b', source: 'PILLAR 2' },
  { id: 4,  field: 'pe_avg',          name: 'P/E Avg',           unit: '',     fmt: v => Math.round(v),                   warn: 1500,  crit: 2500,  color: '#3b82f6', source: 'PILLAR 2' },
  { id: 5,  field: 'wear_level',      name: 'Wear Level',        unit: '%',    fmt: v => v.toFixed(1),                    warn: 60,    crit: 85,    color: '#a855f7', source: 'PILLAR 2' },
  { id: 6,  field: 'rber',            name: 'RBER',              unit: '',     fmt: v => v.toExponential(1),              warn: 1e-6,  crit: 1e-5,  color: '#14b8a6', source: 'PILLAR 3' },
  { id: 7,  field: 'temperature',     name: 'Temperature',       unit: '°C',   fmt: v => Math.round(v),                   warn: 45,    crit: 55,    color: '#f97316', source: 'HARDWARE' },
  { id: 8,  field: 'read_latency_us', name: 'Read Latency',      unit: 'µs',   fmt: v => v.toFixed(1),                    warn: 100,   crit: 300,   color: '#84cc16', source: 'NVMe' },
  { id: 9,  field: 'retry_freq',      name: 'Retry Freq',        unit: '/hr',  fmt: v => Math.round(v),                   warn: 50,    crit: 200,   color: '#06b6d4', source: 'PILLAR 1' },
  { id: 10, field: 'reallocated',     name: 'Reallocated',       unit: '',     fmt: v => v,                               warn: 3,     crit: 10,    color: '#ec4899', source: 'PILLAR 2' },
  { id: 11, field: 'program_fail',    name: 'Program Fail',      unit: '',     fmt: v => v,                               warn: 2,     crit: 8,     color: '#8b5cf6', source: 'NAND' },
  { id: 12, field: 'erase_fail',      name: 'Erase Fail',        unit: '',     fmt: v => v,                               warn: 2,     crit: 8,     color: '#10b981', source: 'NAND' },
]

function getStatus(val, def) {
  // For "higher is worse" metrics except rul/available_spare
  if (val >= def.crit) return 'CRITICAL'
  if (val >= def.warn) return 'WARNING'
  return 'OK'
}

// ── Simulate state from backend data ──────────────────────────────────────────
function buildSmartSnap(state) {
  const sm = state?.smart_metrics || {}
  const blocks = state?.blocks || []
  return {
    ecc_rate:        (sm.ecc_correction_rate || 0) * 10000,
    uecc_count:      sm.media_errors || 0,
    bad_block_count: blocks.filter(b => b.health === 'BAD').length,
    pe_avg:          blocks.length ? blocks.reduce((s,b)=>s+b.pe_cycles,0)/blocks.length : 0,
    wear_level:      blocks.length ? (blocks.reduce((s,b)=>s+b.pe_cycles,0)/blocks.length/3000)*100 : 0,
    rber:            blocks.length ? blocks.reduce((s,b)=>s+b.error_rate,0)/blocks.length : 0,
    temperature:     sm.temperature || 40,
    read_latency_us: 30 + (blocks.filter(b=>b.ecc_tier>=2).length * 2),
    retry_freq:      (sm.crc_errors || 0) * 10,
    reallocated:     sm.reallocated_sectors || 0,
    program_fail:    sm.program_fail_count || 0,
    erase_fail:      sm.erase_fail_count || 0,
  }
}

// ── Sparkline (mini SVG) ───────────────────────────────────────────────────────
function Sparkline({ values, color }) {
  if (!values || values.length < 2) return null
  const max = Math.max(...values, 1)
  const w = 120, h = 40
  const pts = values.map((v, i) => `${(i/(values.length-1))*w},${h - (v/max)*h}`)
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" opacity="0.8" />
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity="0.1" />
    </svg>
  )
}

// ── Presets and inject buttons (sidebar-equivalent panel) ─────────────────────
function SimControls({ state, onReset, onInject }) {
  const [mode, setMode] = useState('normal')
  const [preset, setPreset] = useState('fresh')
  const [speed, setSpeed] = useState(1)
  const [blockNum, setBlockNum] = useState(32)

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div className="title-md" style={{ marginBottom: '1rem' }}>🎮 Simulation Controls</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
        <div>
          <div className="metric-label">Mode</div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.3rem', flexWrap:'wrap' }}>
            {['normal','stress','aging','crash'].map(m => (
              <button key={m} className={`pill ${mode===m?'active':''}`} onClick={() => setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="metric-label" style={{ marginBottom: '0.4rem' }}>Preset</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            {[
              { id: 'fresh', label: '🥏 Fresh' },
              { id: 'middle', label: '📀 Mid-Age' },
              { id: 'end_of_life', label: '🌡️ End-Life' },
              { id: 'critical', label: '🚨 Critical' },
            ].map(p => (
              <button key={p.id} className="btn btn-outline btn-sm" onClick={() => { setPreset(p.id); onReset(p.id) }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="metric-label" style={{ marginBottom: '0.4rem' }}>Manual Inject</div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <input type="number" min={0} max={63} value={blockNum}
              onChange={e => setBlockNum(+e.target.value)}
              style={{ width: 60, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '0.3rem 0.5rem', fontFamily: 'var(--mono)' }} />
            <button className="btn btn-danger btn-sm" onClick={() => onInject('force_bad', blockNum)}>💥 Force Bad</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
          <button className="btn btn-outline btn-sm" onClick={() => onInject('thermal')}>🌡️ Thermal</button>
          <button className="btn btn-outline btn-sm" onClick={() => onInject('write_storm')}>⚡ Storm</button>
          <button className="btn btn-danger btn-sm" onClick={() => onInject('kill_host')}>💀 Kill</button>
        </div>
      </div>
    </div>
  )
}

// ── Tab: SMART Analytics ───────────────────────────────────────────────────────
function SmartTab({ state }) {
  const snap = buildSmartSnap(state)
  const rul = state?.smart_metrics?.rul_days || 0
  const health = Math.min(100, Math.max(0, (rul/1000)*100))
  const healthColor = health > 70 ? '#22c55e' : health > 40 ? '#f59e0b' : '#ef4444'
  const anomaly = health > 70 ? 'NONE' : health > 50 ? 'WATCH' : health > 30 ? 'ACCELERATING' : 'CRITICAL'
  const anomalyColors = { NONE:'#22c55e', WATCH:'#f59e0b', ACCELERATING:'#f97316', CRITICAL:'#ef4444' }
  const ac = anomalyColors[anomaly] || '#888'

  // LSTM attention simulation
  const featNames = ['ECC','UECC','BadBlks','P/E','Wear','RBER','Temp','Latency','Retry','Realloc','ProgFail','EraseFail']
  const attn = featNames.map((_, i) => Math.random() * 0.3 + (i===0||i===5 ? 0.6 : 0.1))
  const maxAttn = Math.max(...attn)

  return (
    <div>
      {/* Health hero + LSTM */}
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <div className="card" style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))' }}>
          <div className="metric-label">Health Score (LSTM)</div>
          <div style={{ fontSize: '5rem', fontWeight: 800, fontFamily: 'var(--mono)', color: healthColor, lineHeight: 1, margin: '0.5rem 0' }}>
            {Math.round(health)}
          </div>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 8, height: 16, overflow: 'hidden', marginBottom: '1rem' }}>
            <div style={{ width: `${health}%`, height: '100%', background: healthColor, borderRadius: 8, transition: 'width 0.8s' }} />
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div>
              <div className="metric-label">RUL</div>
              <div style={{ color: '#3b82f6', fontWeight: 700, fontFamily: 'var(--mono)' }}>~{rul} days</div>
            </div>
            <div>
              <div className="metric-label">Anomaly</div>
              <div style={{ background: ac+'22', border: `1px solid ${ac}`, color: ac, padding: '2px 10px', borderRadius: 12, fontSize: '0.78rem', fontWeight: 700, display: 'inline-block' }}>{anomaly}</div>
            </div>
            <div>
              <div className="metric-label">Failure Prob</div>
              <div style={{ color: '#ef4444', fontWeight: 700, fontFamily: 'var(--mono)' }}>{(100-health).toFixed(1)}%</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="title-md" style={{ marginBottom: '0.8rem' }}>LSTM Attention Weights</div>
          <div className="metric-label" style={{ marginBottom: '0.5rem' }}>What drove this prediction?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {featNames.map((name, i) => (
              <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ width: 70, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{name}</div>
                <div style={{ flex: 1, background: 'var(--bg-card2)', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                  <div style={{ width: `${(attn[i]/maxAttn)*100}%`, height: '100%', background: `hsl(${260 - i*18},70%,60%)`, borderRadius: 3 }} />
                </div>
                <div style={{ width: 36, fontSize: '0.68rem', color: 'var(--text-muted)', textAlign: 'right', fontFamily: 'var(--mono)' }}>{attn[i].toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 12 SMART metric cards */}
      <div className="title-md" style={{ marginBottom: '1rem' }}>📊 12 SMART Metrics — Live Feed</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.7rem', marginBottom: '1.5rem' }}>
        {SMART_DEFS.map(def => {
          const val = snap[def.field] ?? 0
          const status = getStatus(val, def)
          const dotColor = { OK:'#22c55e', WARNING:'#f59e0b', CRITICAL:'#ef4444' }[status]
          const display = def.fmt(val) + def.unit
          // mock sparkline data
          const sparks = Array.from({length:12}, (_,i) => val*(0.7 + Math.random()*0.6))
          return (
            <div key={def.id} className="card card-sm" style={{ background: 'var(--bg-card2)', border: `1px solid ${dotColor}33` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'var(--mono)' }}>⓪{def.id} {def.name}</span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, display: 'inline-block', boxShadow: `0 0 6px ${dotColor}` }} />
              </div>
              <div style={{ color: def.color, fontSize: '1.4rem', fontWeight: 700, fontFamily: 'var(--mono)', margin: '2px 0' }}>{display}</div>
              <div style={{ color: '#4a4a60', fontSize: '0.65rem', marginBottom: '4px' }}>FROM {def.source}</div>
              <Sparkline values={sparks} color={dotColor} />
            </div>
          )
        })}
      </div>

      {/* LSTM Commands */}
      <div className="card">
        <div className="title-md" style={{ marginBottom: '1rem' }}>🔗 LSTM Engine → Pillar 2 & 3 Commands</div>
        <div className="grid-2">
          <div className="highlight-box">
            <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem' }}>⚡ Predictive Block Retirement</div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              When RBER P/E trajectory crosses threshold → LSTM fires PRE_FAILURE →
              Pillar 1 FTL copies block → Pillar 2 BBT bit flipped → Zero data loss.
            </p>
          </div>
          <div className="highlight-box">
            <div style={{ fontWeight: 600, color: '#f59e0b', marginBottom: '0.5rem' }}>📈 LDPC Ceiling Raise</div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              LSTM detects RBER spike on worn block cluster → raises LDPC cap 8→20 →
              Context-aware 2.5× correction power applied to critical range.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Hardware Monitor ──────────────────────────────────────────────────────
function HardwareTab({ state }) {
  const sm = state?.smart_metrics || {}
  const blocks = state?.blocks || []

  const hwMetrics = [
    { label: 'In-Band (NVMe)', val: state?.host_status==='DOWN' ? '✗ DOWN' : '✓ ACTIVE', color: state?.host_status==='DOWN'?'#ef4444':'#22c55e' },
    { label: 'BLE Status', val: 'BROADCASTING', color: '#3b82f6' },
    { label: 'AES Encryption', val: 'ARMED', color: '#a855f7' },
    { label: 'OOB Channel', val: state?.oob_active ? '● ACTIVE' : '○ STANDBY', color: state?.oob_active?'#f59e0b':'#4a4a60' },
    { label: 'Temperature', val: `${sm.temperature||40}°C`, color: (sm.temperature||40)>50?'#ef4444':sm.temperature>45?'#f59e0b':'#22c55e' },
    { label: 'Power-On Hours', val: `${sm.power_on_hours||0}h`, color: 'var(--accent)' },
    { label: 'Unsafe Shutdowns', val: sm.unsafe_shutdowns||0, color: (sm.unsafe_shutdowns||0)>2?'#ef4444':'#22c55e' },
    { label: 'CRC Errors', val: sm.crc_errors||0, color: (sm.crc_errors||0)>0?'#f59e0b':'#22c55e' },
  ]

  return (
    <div>
      <div style={{ marginBottom: '1rem', padding: '0.8rem 1.2rem', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:10, fontFamily:'var(--mono)', fontSize:'0.82rem' }}>
        <span style={{color:'var(--text-muted)'}}>Drive:</span> <b style={{color:'var(--text)'}}>AURA-AEGIS #7</b>
        &nbsp;&nbsp;<span style={{color:'var(--text-muted)'}}>NAND:</span> <b style={{color:'var(--text)'}}>TLC (3000 P/E max)</b>
        &nbsp;&nbsp;<span style={{color:'var(--text-muted)'}}>Blocks:</span> <b style={{color:'var(--text)'}}>64 total</b>
        &nbsp;&nbsp;<span style={{color:'var(--text-muted)'}}>Mode:</span> <b style={{color:'var(--accent)'}}>{state?.host_status||'NORMAL'}</b>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.8rem', marginBottom: '1.5rem' }}>
        {hwMetrics.map(m => (
          <div key={m.label} className="metric-tile">
            <div className="metric-label">{m.label}</div>
            <div style={{ color: m.color, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '1rem', marginTop: '0.3rem' }}>{m.val}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="title-md" style={{ marginBottom: '1rem' }}>Drive Health Overview</div>
          {[
            { label: 'Good Blocks',  val: blocks.filter(b=>b.health==='GOOD').length,  color: '#22c55e', max: 64 },
            { label: 'Warn Blocks',  val: blocks.filter(b=>b.health==='WARN').length,  color: '#f59e0b', max: 64 },
            { label: 'Bad Blocks',   val: blocks.filter(b=>b.health==='BAD').length,   color: '#ef4444', max: 64 },
            { label: 'ECC Corrections', val: sm.ecc_correction_rate ? (sm.ecc_correction_rate * 10000).toFixed(0) : 0, color: '#a855f7', max: 5000 },
          ].map(item => (
            <div key={item.label} style={{ marginBottom: '0.8rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{item.label}</span>
                <span style={{ fontFamily: 'var(--mono)', color: item.color, fontWeight: 700 }}>{item.val}</span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${Math.min(100,(item.val/item.max)*100)}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="title-md" style={{ marginBottom: '1rem' }}>Event Ticker</div>
          <div style={{ fontFamily:'var(--mono)', fontSize:'0.78rem', color:'#22c55e', background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:8, padding:'0.8rem', maxHeight:200, overflowY:'auto' }}>
            {(state?.event_log||[]).slice(-10).reverse().map((e,i)=>(
              <div key={i} style={{ marginBottom: '0.3rem', color: e.type?.includes('FAIL')||e.type?.includes('BAD')?'#ef4444':e.type?.includes('OOB')?'#a855f7':'#22c55e' }}>
                [{e.source}] {e.type}{e.block_id!=null?` → Block ${e.block_id}`:''}
              </div>
            ))}
            {!(state?.event_log?.length) && <div style={{color:'var(--text-muted)'}}>Simulation initializing...</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Security & OOB ────────────────────────────────────────────────────────
function SecurityTab({ state }) {
  const [oobResult, setOobResult] = useState(null)
  const [running, setRunning] = useState(false)

  async function runCrash() {
    setRunning(true)
    const res = await axios.post(`${API}/start-simulation`, { scenario: 'HOST_CRASH' })
    setOobResult(res.data)
    setRunning(false)
  }

  const SHARE_HOLDERS = ['Operator', 'Cloud Node', 'UART Port', 'BLE Beacon', 'Escrow']
  const encStep = oobResult?.steps?.find(s=>s.event==='ENCRYPT_REPORT')
  const shamirStep = oobResult?.steps?.find(s=>s.event==='SHAMIR_SPLIT')

  return (
    <div>
      <div className="card" style={{ marginBottom:'1.5rem' }}>
        <div className="title-md" style={{ marginBottom:'0.8rem' }}>🔐 Security & OOB Overview</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.8rem' }}>
          {[
            { label: 'Encryption', val: 'AES-256-GCM', color: '#a855f7' },
            { label: 'Key Sharing', val: 'Shamir 3-of-5', color: '#6366f1' },
            { label: 'OOB Channel', val: 'UART / BLE', color: '#06b6d4' },
            { label: 'Trigger', val: 'Host crash / NVMe silent', color: '#f59e0b' },
            { label: 'Power', val: 'Internal capacitors', color: '#10b981' },
            { label: 'Status', val: state?.oob_active?'ACTIVE':'ARMED', color: state?.oob_active?'#f59e0b':'#22c55e' },
          ].map(m => (
            <div key={m.label} className="metric-tile">
              <div className="metric-label">{m.label}</div>
              <div style={{ color: m.color, fontWeight: 700, fontSize: '0.9rem', marginTop: '0.3rem', fontFamily: 'var(--mono)' }}>{m.val}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-danger" style={{ marginTop:'1rem' }} onClick={runCrash} disabled={running}>
          {running ? '⏳ Simulating…' : '💥 Simulate Host Crash → OOB Recovery'}
        </button>
      </div>

      {oobResult && (
        <div className="grid-2 fade-in">
          <div className="card">
            <div className="title-md" style={{ marginBottom:'0.8rem' }}>AES-256-GCM Encryption</div>
            {encStep && (
              <>
                <div style={{ display:'flex', gap:'0.5rem', marginBottom:'0.8rem' }}>
                  <span className="badge badge-good">ENCRYPTED</span>
                  <span className="badge badge-info">AES-256-GCM</span>
                  {encStep.data?.simulated && <span className="badge badge-warn">SIMULATED</span>}
                </div>
                {[
                  ['Plaintext', `${encStep.data?.plaintext_size||'?'} bytes`],
                  ['IV (nonce)', encStep.data?.iv_hex?.slice(0,24)+'…'],
                  ['Mode', 'GCM (authenticated encryption)'],
                ].map(([k,v])=>(
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'0.35rem 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>{k}</span>
                    <span style={{ color:'var(--text)', fontFamily:'var(--mono)', fontSize:'0.78rem' }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop:'0.8rem' }}>
                  <div className="metric-label" style={{ marginBottom:'0.3rem' }}>Ciphertext preview</div>
                  <div className="share-card">{encStep.data?.ciphertext_b64||'—'}</div>
                </div>
              </>
            )}
          </div>
          <div className="card">
            <div className="title-md" style={{ marginBottom:'0.5rem' }}>🗝️ Shamir Shares (3-of-5)</div>
            {shamirStep ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                {(shamirStep.data?.shares||[]).map((s,i)=>(
                  <div key={i} style={{ display:'flex', gap:'0.6rem', alignItems:'flex-start', padding:'0.6rem', background:'var(--bg-card2)', borderRadius:8, border:'1px solid var(--border)' }}>
                    <div style={{ width:28, height:28, borderRadius:'50%', background:'rgba(99,102,241,0.2)', border:'1px solid var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.7rem', fontWeight:700, color:'var(--accent)', flexShrink:0 }}>S{i+1}</div>
                    <div>
                      <div style={{ fontSize:'0.72rem', fontWeight:600, color:'#a855f7', marginBottom:'0.1rem' }}>{SHARE_HOLDERS[i]}</div>
                      <div style={{ fontFamily:'var(--mono)', fontSize:'0.65rem', color:'var(--accent3)', wordBreak:'break-all' }}>{s}</div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop:'0.5rem', color:'#22c55e', fontWeight:600, fontSize:'0.82rem' }}>
                  ✅ Any 3/5 shares → reconstruct key → decrypt health report
                </div>
              </div>
            ) : <div style={{color:'var(--text-muted)',textAlign:'center',padding:'2rem'}}>Run crash simulation first</div>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function Pillar1Page() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('hw')
  const [autoRun, setAutoRun] = useState(false)
  const intervalRef = useRef(null)

  async function fetchState() {
    const r = await axios.get(`${API}/state`)
    setState(r.data)
    setLoading(false)
  }

  async function handleReset(preset) {
    await axios.post(`${API}/reset`)
    fetchState()
  }

  async function handleInject(type, block) {
    if (type === 'kill_host') {
      await axios.post(`${API}/start-simulation`, { scenario: 'HOST_CRASH' })
    } else if (type === 'write_storm') {
      await axios.post(`${API}/start-simulation`, { scenario: 'WRITE' })
    } else if (type === 'force_bad') {
      // Simulate degradation on that block
      await axios.post(`${API}/start-simulation`, { scenario: 'DEGRADATION' })
    }
    fetchState()
  }

  useEffect(() => {
    fetchState()
  }, [])

  useEffect(() => {
    if (autoRun) {
      intervalRef.current = setInterval(fetchState, 2000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [autoRun])

  const sm = state?.smart_metrics || {}
  const blocks = state?.blocks || []
  const badCount = blocks.filter(b=>b.health==='BAD').length
  const rul = sm.rul_days || 0
  const health = Math.min(100, (rul/1000)*100)
  const healthColor = health>70?'#22c55e':health>40?'#f59e0b':'#ef4444'
  const anomaly = health>70?'NONE':health>50?'WATCH':health>30?'ACCELERATING':'CRITICAL'
  const anomalyColors = { NONE:'#22c55e', WATCH:'#f59e0b', ACCELERATING:'#f97316', CRITICAL:'#ef4444' }

  const TABS = [
    { id: 'hw', label: '🔌 Hardware Monitor' },
    { id: 'smart', label: '📊 SMART Analytics + LSTM' },
    { id: 'sec', label: '🔐 Security & OOB' },
  ]

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* Header bar */}
        <div style={{ background:'linear-gradient(135deg,#12121a,#1a1a2e)', border:'1px solid var(--border)', borderRadius:14, padding:'1rem 1.5rem', marginBottom:'1.2rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
            <div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'1.1rem', fontWeight:700, color:'var(--text)' }}>🧠 PILLAR 1 — Health Monitoring & Diagnostics</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'var(--text-muted)' }}>DEMO UNIT #7 · TLC · 64 BLOCKS · 3000 P/E MAX</div>
            </div>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontFamily:'var(--mono)', fontSize:'3.5rem', fontWeight:800, color:healthColor, lineHeight:1 }}>{Math.round(health)}</div>
              <div style={{ color:'var(--text-muted)', fontSize:'0.7rem' }}>HEALTH SCORE</div>
              <div style={{ color:'#3b82f6', fontSize:'0.85rem', fontWeight:600 }}>RUL: ~{rul} days</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <span style={{ background:anomalyColors[anomaly]+'22', border:`1px solid ${anomalyColors[anomaly]}`, color:anomalyColors[anomaly], padding:'3px 12px', borderRadius:20, fontWeight:700, fontSize:'0.78rem' }}>{anomaly}</span>
              <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'var(--text-muted)', marginTop:6 }}>
                In-band: <b style={{color:state?.host_status==='DOWN'?'#ef4444':'#22c55e'}}>{state?.host_status==='DOWN'?'✗ DOWN':'✓ ACTIVE'}</b>
                &nbsp;&nbsp;BLE: <b style={{color:'#3b82f6'}}>BROADCASTING</b>
                &nbsp;&nbsp;AES: <b style={{color:'#a855f7'}}>ARMED</b>
              </div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'0.7rem', color:'var(--text-muted)', marginTop:3 }}>
                Bad blocks: <b style={{color:'#ef4444'}}>{badCount}</b> &nbsp;|&nbsp;
                ECC: {(sm.ecc_correction_rate||0)*10000|0} corrections &nbsp;|&nbsp;
                Wear: <b>{blocks.length?(blocks.reduce((s,b)=>s+b.pe_cycles,0)/blocks.length/3000*100).toFixed(1):0}%</b>
              </div>
            </div>
          </div>
        </div>

        {/* Event ticker */}
        <div style={{ background:'var(--bg-card2)', border:'1px solid var(--border)', borderRadius:8, padding:'0.5rem 1rem', marginBottom:'1.2rem', fontFamily:'var(--mono)', fontSize:'0.75rem', color:'#22c55e', overflow:'hidden', whiteSpace:'nowrap' }}>
          📡 {state?.event_log?.slice(-6).map(e=>`[${e.source}] ${e.type}`).join(' ‖ ') || 'Simulation initializing...'}
        </div>

        <div style={{ color:'var(--text-dim)', fontSize:'0.85rem', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:8, padding:'0.7rem 1rem', marginBottom:'1.2rem' }}>
          <b>Pillar 1</b> is the central intelligence hub. It reads health signals from Pillar 2 (bad block events) and Pillar 3 (ECC corrections), then issues commands back: retire a block early, or raise the LDPC correction ceiling.
        </div>

        <div className="grid-2" style={{ gridTemplateColumns: '220px 1fr' }}>
          {/* Controls panel */}
          <div>
            <SimControls state={state} onReset={handleReset} onInject={handleInject} />
            <div className="card card-sm">
              <div className="metric-label" style={{ marginBottom:'0.5rem' }}>Auto Run</div>
              <label style={{ display:'flex', alignItems:'center', gap:'0.5rem', cursor:'pointer' }}>
                <input type="checkbox" checked={autoRun} onChange={e=>setAutoRun(e.target.checked)} />
                <span style={{ fontSize:'0.85rem', color:'var(--text-dim)' }}>▶ Auto-refresh (2s)</span>
              </label>
              <button className="btn btn-outline btn-sm" style={{ marginTop:'0.5rem', width:'100%' }} onClick={fetchState}>⟳ Refresh State</button>
            </div>
          </div>

          {/* Main content area */}
          <div>
            {/* Tabs */}
            <div style={{ display:'flex', gap:'0', borderBottom:'1px solid var(--border)', marginBottom:'1.2rem' }}>
              {TABS.map(t => (
                <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
                  padding:'0.6rem 1.2rem', border:'none', background:'transparent',
                  color: activeTab===t.id ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: activeTab===t.id ? '2px solid var(--accent)' : '2px solid transparent',
                  cursor:'pointer', fontFamily:'var(--font)', fontSize:'0.88rem', fontWeight:600,
                  transition:'all 0.2s',
                }}>{t.label}</button>
              ))}
            </div>

            {loading ? (
              <div style={{ color:'var(--text-muted)', padding:'2rem', textAlign:'center' }}>Loading state from backend…</div>
            ) : (
              <>
                {activeTab === 'hw' && <HardwareTab state={state} />}
                {activeTab === 'smart' && <SmartTab state={state} />}
                {activeTab === 'sec' && <SecurityTab state={state} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
