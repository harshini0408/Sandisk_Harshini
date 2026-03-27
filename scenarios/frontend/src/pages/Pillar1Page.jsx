import { useState, useEffect, useRef, useCallback } from 'react'

// ── Physics-based SSD simulation engine (no backend) ─────────────────────────
const MAX_PE = 3000
const WORKLOAD_MULT = { sequential: 0.7, random: 1.4, mixed: 1.0 }

function computeMetrics(drive) {
  const pef = drive.pe_avg / MAX_PE  // 0→1
  const wm  = WORKLOAD_MULT[drive.workload] || 1
  const temp_bonus = drive.stress ? 15 : 0
  const temp = 40 + (Math.random() - 0.5) * 6 + temp_bonus

  const ecc_rate    = Math.round(5 * Math.exp(pef * 4) * wm * (0.9 + Math.random()*0.2))
  const uecc_count  = (pef > 0.95 && Math.random() > 0.6) ? 1 : 0
  const bad_blocks  = drive.bad_blocks
  const pe_avg      = drive.pe_avg
  const wear_level  = +(pef * 100).toFixed(1)
  const rber        = +(1e-8 * Math.exp(pe_avg / 800)).toFixed(12)
  const temperature = +temp.toFixed(1)
  const read_latency= +(30 + pef * 120 + (drive.stress ? 40 : 0)).toFixed(1)
  const retry_freq  = Math.round(pef > 0.8 ? (pef - 0.8) * 500 * wm : 0)
  const reallocated = bad_blocks * 4
  const program_fail= pef > 0.9 ? (Math.random() > 0.85 ? 1 : 0) : 0
  const erase_fail  = pef > 0.85 ? (Math.random() > 0.88 ? 1 : 0) : 0

  return { ecc_rate, uecc_count, bad_block_count: bad_blocks, pe_avg: Math.round(pe_avg),
           wear_level, rber, temperature, read_latency, retry_freq, reallocated,
           program_fail, erase_fail }
}

// ── SMART metric definitions ──────────────────────────────────────────────────
const DEFS = [
  { id:1,  f:'ecc_rate',       name:'ECC Correction Rate', unit:'/hr',  warn:500,  crit:2000, color:'#22c55e', src:'P3',
    why:'Bit errors fixed/hr. Grows exponentially with wear.' },
  { id:2,  f:'uecc_count',     name:'UECC Count',          unit:'',     warn:1,    crit:5,    color:'#ef4444', src:'P3',
    why:'Uncorrectable errors = data corruption. Any non-zero is critical.' },
  { id:3,  f:'bad_block_count',name:'Bad Block Count',     unit:'',     warn:5,    crit:15,   color:'#f59e0b', src:'P2',
    why:'Active BBT entries. Factory + runtime failures combined.' },
  { id:4,  f:'pe_avg',         name:'P/E Avg',             unit:'',     warn:1500, crit:2700, color:'#3b82f6', src:'P2',
    why:'Primary wear indicator. Max 3000 for TLC NAND.' },
  { id:5,  f:'wear_level',     name:'Wear Level',          unit:'%',    warn:60,   crit:85,   color:'#a855f7', src:'P2',
    why:'(pe_avg/3000)×100. 100% = end of rated endurance.' },
  { id:6,  f:'rber',           name:'RBER',                unit:'',     warn:1e-6, crit:1e-5, color:'#14b8a6', src:'P3',
    why:'Raw bit error rate. 1e-8 fresh → 1e-4 = distress.' },
  { id:7,  f:'temperature',    name:'Temperature',         unit:'°C',   warn:45,   crit:70,   color:'#f97316', src:'HW',
    why:'Every +10°C doubles wear rate. >85°C critical.' },
  { id:8,  f:'read_latency',   name:'Read Latency',        unit:'µs',   warn:100,  crit:300,  color:'#84cc16', src:'P3',
    why:'Avg read time. Climbs as more reads need Tier 2/3 ECC.' },
  { id:9,  f:'retry_freq',     name:'Retry Frequency',     unit:'/hr',  warn:50,   crit:200,  color:'#06b6d4', src:'P3',
    why:'HW-level retries. Tier 3 soft-decode count × 10.' },
  { id:10, f:'reallocated',    name:'Reallocated Sectors', unit:'',     warn:3,    crit:10,   color:'#ec4899', src:'P2',
    why:'Sectors remapped from bad region. Never decreases.' },
  { id:11, f:'program_fail',   name:'Program Fail',        unit:'',     warn:2,    crit:8,    color:'#8b5cf6', src:'NND',
    why:'Write ops failed at hardware level → Phase C triggered.' },
  { id:12, f:'erase_fail',     name:'Erase Fail',          unit:'',     warn:2,    crit:8,    color:'#10b981', src:'NND',
    why:'Erase ops failed → block cannot be reused → retire.' },
]

const STATUS_COLOR = { OK:'#22c55e', WARN:'#f59e0b', CRIT:'#ef4444' }
function status(val, def) {
  if (val >= def.crit) return 'CRIT'
  if (val >= def.warn) return 'WARN'
  return 'OK'
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ vals, color }) {
  if (!vals || vals.length < 2) return null
  const max = Math.max(...vals, 1), w = 110, h = 38
  const pts = vals.map((v,i) => `${(i/(vals.length-1))*w},${h-(v/max)*(h-2)+1}`)
  return (
    <svg width={w} height={h} style={{display:'block'}}>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={color} opacity={0.12}/>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8"/>
    </svg>
  )
}

// ── Personal Baseline Engine ──────────────────────────────────────────────────
function useBaseline(snap, tick) {
  const hist = useRef({})
  const bl   = useRef({})
  const LEARN = 30

  useEffect(() => {
    if (!snap) return
    DEFS.forEach(({f}) => {
      if (!hist.current[f]) hist.current[f] = []
      hist.current[f].push(snap[f] ?? 0)
      if (hist.current[f].length > 200) hist.current[f].shift()
    })
    if (tick >= LEARN) {
      DEFS.forEach(({f}) => {
        const v = hist.current[f] || []
        if (!v.length) return
        const mean = v.reduce((a,b)=>a+b,0)/v.length
        const std  = Math.sqrt(v.reduce((a,b)=>a+(b-mean)**2,0)/v.length) || 0.001
        bl.current[f] = { mean, std }
      })
    }
  }, [tick])

  const sigma = (f, val) => {
    const b = bl.current[f]; if (!b) return 0
    return Math.abs((val - b.mean) / b.std)
  }
  const getHist = (f) => hist.current[f] || []
  return { sigma, getHist, learned: tick >= LEARN, bl: bl.current }
}

// ── 2-layer LSTM simulation ───────────────────────────────────────────────────
function lstmInfer(snapHistory, drive) {
  if (!snapHistory.ecc_rate || snapHistory.ecc_rate.length < 3) {
    return { failProb: drive.pe_avg / MAX_PE * 0.5, rul: 730, l1: 0, l2: 0 }
  }
  const rec = snapHistory.ecc_rate.slice(-8)
  // Layer 1: short-term ECC trend (hours scale)
  const l1 = rec.length > 1 ? (rec[rec.length-1] - rec[0]) / (rec.length * Math.max(rec[0], 1)) : 0
  // Layer 2: long-term integration (days scale)
  const wearF = drive.pe_avg / MAX_PE
  const eccF  = Math.min(1, (rec[rec.length-1] || 0) / 3000)
  const badF  = Math.min(1, drive.bad_blocks / 12)
  const tempF = Math.max(0, (drive.stress ? 55 : 40) - 40) / 45
  const l2    = wearF*0.4 + eccF*0.3 + badF*0.2 + tempF*0.1
  const failProb = Math.min(0.99, l2 + Math.max(0, l1) * 0.05)
  const rul = Math.max(0, Math.round((1 - failProb) * 730))
  return { failProb, rul, l1: +l1.toFixed(4), l2: +l2.toFixed(3), wearF, eccF, badF, tempF }
}

// ── Decision Engine ───────────────────────────────────────────────────────────
function decisionEngine(lstm) {
  const p = lstm.failProb
  if (p > 0.75) return {
    level:'SEVERE', color:'#ef4444',
    action:'Emergency data migration. Block retirement imminent.',
    cmds:['→ Pillar 2: FORCE_RETIRE_WORN_BLOCKS','→ Pillar 3: MAX_ECC (iters=20)','→ OOB: TRANSMIT_CRITICAL_REPORT'],
  }
  if (p > 0.50) return {
    level:'CRITICAL', color:'#f97316',
    action:'Move data from highest-worn blocks. Alert operator.',
    cmds:['→ Pillar 2: PRE_RETIRE (bitmap update)','→ Pillar 3: RAISE_LDPC_CAP (8→20)'],
  }
  if (p > 0.25) return {
    level:'WARNING', color:'#f59e0b',
    action:'Monitor closely. Tighten baseline sigma threshold.',
    cmds:['→ Pillar 1: TIGHTEN_BASELINE (2σ→1.5σ)','→ Pillar 2: INCREASE_WEAR_CHECK_FREQ'],
  }
  return {
    level:'NOMINAL', color:'#22c55e',
    action:'Normal operation. Continue monitoring.',
    cmds:['→ No action required'],
  }
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Pillar1Page() {
  // ── Drive state ────────────────────────────────────────────────────────────
  const [drive, setDrive] = useState({ pe_avg:200, bad_blocks:2, workload:'mixed', stress:false })
  const [snap, setSnap]   = useState(null)
  const [tick, setTick]   = useState(0)
  const [autoRun, setAutoRun] = useState(true)
  const [activeTab, setActiveTab] = useState('smart')
  const [oobLog, setOobLog] = useState([])
  const [oobRunning, setOobRunning] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState(null)

  const { sigma, getHist, learned, bl } = useBaseline(snap, tick)

  // accumulate full history for LSTM
  const fullHist = useRef({})

  const tick_ = useCallback(() => {
    setDrive(d => {
      // Advance simulation: each tick ≈ some hours of drive operation
      const stress_pe = d.stress ? 12 : 4
      const new_pe = Math.min(MAX_PE * 1.05, d.pe_avg + stress_pe + Math.random()*3)
      const new_bad = d.bad_blocks + (Math.random() > 0.97 ? 1 : 0)
      return { ...d, pe_avg: new_pe, bad_blocks: new_bad }
    })
    setTick(t => t + 1)
  }, [])

  useEffect(() => {
    const m = computeMetrics(drive)
    setSnap(m)
    DEFS.forEach(({f}) => {
      if (!fullHist.current[f]) fullHist.current[f] = []
      fullHist.current[f].push(m[f])
      if (fullHist.current[f].length > 60) fullHist.current[f].shift()
    })
  }, [tick, drive])

  useEffect(() => {
    if (!autoRun) return
    const id = setInterval(tick_, 1800)
    return () => clearInterval(id)
  }, [autoRun, tick_])

  const lstm = snap ? lstmInfer(fullHist.current, drive) : { failProb:0, rul:730, l1:0, l2:0, wearF:0, eccF:0, badF:0, tempF:0 }
  const dec  = decisionEngine(lstm)
  const health = Math.round((1 - lstm.failProb) * 100)
  const healthColor = health > 70 ? '#22c55e' : health > 40 ? '#f59e0b' : '#ef4444'
  const anomaly = health>70?'NOMINAL':health>50?'WATCH':health>30?'ACCELERATING':'CRITICAL'
  const acColor = {NOMINAL:'#22c55e',WATCH:'#f59e0b',ACCELERATING:'#f97316',CRITICAL:'#ef4444'}[anomaly]

  // Attention weights (driven by live values)
  const maxVal = DEFS.reduce((mx,d)=>Math.max(mx,(snap?.[d.f]||0)/Math.max(d.crit,1)),0) || 1
  const weights = DEFS.map(d => {
    const base = [0.42,0.18,0.15,0.12,0.08,0.28,0.07,0.09,0.06,0.05,0.04,0.03][d.id-1] || 0.05
    return base * (1 + (snap?.[d.f]||0) / Math.max(d.crit,1) * 0.5)
  })
  const maxW = Math.max(...weights)

  // Preset handler
  function applyPreset(p) {
    const presets = {
      fresh:    { pe_avg:100,  bad_blocks:2,  workload:'sequential', stress:false },
      mid:      { pe_avg:1200, bad_blocks:5,  workload:'mixed',      stress:false },
      eol:      { pe_avg:2500, bad_blocks:10, workload:'random',     stress:false },
      critical: { pe_avg:2900, bad_blocks:14, workload:'random',     stress:true  },
    }
    if (presets[p]) { setDrive(presets[p]); setTick(0); fullHist.current = {} }
  }

  // OOB simulation
  async function runOOB() {
    setOobRunning(true); setOobLog([])
    const add = (msg, c='#8888a0') => setOobLog(l => [...l, {msg,c}])
    const delay = ms => new Promise(r => setTimeout(r, ms))
    add('💥 HOST CRASH DETECTED — NVMe interface silent failure.','#ef4444')
    await delay(500)
    add('⚡ OOB channel activating (UART @ 115200 / BLE 5.0)…','#f59e0b')
    await delay(400)
    add('🔋 Internal capacitors powering SSD controller…','#f59e0b')
    await delay(500)
    add('📋 Assembling diagnostic report…','#8888a0')
    await delay(300)
    add(`   SMART snapshot: pe_avg=${Math.round(drive.pe_avg)}, bad_blocks=${drive.bad_blocks}`)
    add(`   LSTM result: failProb=${(lstm.failProb*100).toFixed(1)}%, RUL=${lstm.rul} days`)
    add(`   ECC rate: ${snap?.ecc_rate || 0}/hr  RBER: ${(snap?.rber||1e-8).toExponential(2)}`)
    await delay(500)
    add('🔐 AES-256-GCM encryption…','#a855f7')
    await delay(400)
    const iv = Array.from({length:16},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('')
    add(`   IV (nonce): ${iv}`)
    add(`   Mode: GCM (authenticated encryption + integrity tag)`)
    await delay(400)
    add('🗝️ Shamir Secret Sharing (3-of-5)…','#6366f1')
    await delay(300)
    const holders = ['Operator','Cloud Node','UART Port','BLE Beacon','Escrow']
    holders.forEach((h,i) => {
      const share = Array.from({length:8},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('')
      add(`   Share ${i+1} → ${h}: ${share}…`)
    })
    await delay(500)
    add('📡 Transmitting encrypted payload via OOB channel…','#06b6d4')
    await delay(400)
    add('✅ RECOVERY COMPLETE — Diagnostic secured. Any 3 holders can reconstruct the key.','#22c55e')
    add('  "Your data is safe even when the host is completely dead."','#22c55e')
    setOobRunning(false)
  }

  const TABS = [
    { id:'smart',    label:'📊 SMART + Baseline' },
    { id:'lstm',     label:'🧠 LSTM + Decision' },
    { id:'pipeline', label:'🔁 System Pipeline' },
    { id:'oob',      label:'🔐 OOB + Security' },
  ]

  return (
    <div className="page fade-in">
      <div className="page-inner">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{background:'linear-gradient(135deg,#12121a,#1a1a2e)',border:'1px solid var(--border)',borderRadius:14,padding:'1rem 1.5rem',marginBottom:'1rem'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
            <div>
              <div style={{fontFamily:'var(--mono)',fontSize:'1.1rem',fontWeight:700}}>🧠 PILLAR 1 — Intelligence Hub</div>
              <div style={{color:'var(--text-muted)',fontSize:'0.72rem',fontFamily:'var(--mono)',marginTop:3}}>
                Observe → Learn Baseline → LSTM Predict → Decide → Act → Secure → Recover
              </div>
              <div style={{marginTop:8,display:'flex',gap:6,flexWrap:'wrap'}}>
                {[['fresh','🥏 Fresh'],['mid','📀 Mid'],['eol','🌡️ EOL'],['critical','🚨 Critical']].map(([p,l])=>(
                  <button key={p} className="btn btn-outline btn-sm" onClick={()=>applyPreset(p)}>{l}</button>
                ))}
                <button className="btn btn-outline btn-sm" onClick={()=>setDrive(d=>({...d,stress:!d.stress}))}
                  style={{color:drive.stress?'#ef4444':'var(--text-muted)'}}>
                  {drive.stress?'🔥 STRESS ON':'💤 STRESS OFF'}
                </button>
                <select value={drive.workload} onChange={e=>setDrive(d=>({...d,workload:e.target.value}))}
                  style={{background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'3px 8px',fontFamily:'var(--font)',fontSize:'0.8rem'}}>
                  <option value="sequential">Sequential</option>
                  <option value="mixed">Mixed</option>
                  <option value="random">Random Write</option>
                </select>
                <label style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',fontSize:'0.82rem',color:'var(--text-dim)'}}>
                  <input type="checkbox" checked={autoRun} onChange={e=>setAutoRun(e.target.checked)}/>
                  Auto-tick
                </label>
                <button className="btn btn-outline btn-sm" onClick={tick_}>⏭ Step</button>
              </div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:'4rem',fontWeight:800,color:healthColor,lineHeight:1}}>{health}</div>
              <div style={{color:'var(--text-muted)',fontSize:'0.7rem'}}>HEALTH SCORE</div>
              <div style={{color:'#3b82f6',fontSize:'0.85rem',fontWeight:600}}>RUL: ~{lstm.rul}d</div>
            </div>
            <div style={{textAlign:'right'}}>
              <span style={{background:acColor+'22',border:`1px solid ${acColor}`,color:acColor,padding:'4px 14px',borderRadius:20,fontWeight:700,fontSize:'0.82rem'}}>{anomaly}</span>
              <div style={{fontFamily:'var(--mono)',fontSize:'0.72rem',color:'var(--text-muted)',marginTop:8}}>
                Tick: <b style={{color:'var(--accent)'}}>{tick}</b> &nbsp;·&nbsp;
                P/E: <b>{Math.round(drive.pe_avg)}/{MAX_PE}</b> &nbsp;·&nbsp;
                Bad: <b style={{color:'#ef4444'}}>{drive.bad_blocks}</b>
              </div>
              <div style={{fontFamily:'var(--mono)',fontSize:'0.7rem',color:learned?'#22c55e':'#60a5fa',marginTop:3}}>
                {learned ? '✅ Baseline learned' : `📚 Learning ${tick}/30…`}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.2rem'}}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              padding:'0.6rem 1.2rem',border:'none',background:'transparent',
              color:activeTab===t.id?'var(--accent)':'var(--text-muted)',
              borderBottom:activeTab===t.id?'2px solid var(--accent)':'2px solid transparent',
              cursor:'pointer',fontFamily:'var(--font)',fontSize:'0.87rem',fontWeight:600,transition:'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ TAB 1: SMART + Baseline ═══════════════════════════════════════ */}
        {activeTab==='smart' && snap && (
          <div>
            <div style={{background:learned?'rgba(34,197,94,0.08)':'rgba(59,130,246,0.08)',border:`1px solid ${learned?'rgba(34,197,94,0.3)':'rgba(59,130,246,0.3)'}`,borderRadius:8,padding:'0.6rem 1rem',marginBottom:'1rem',fontSize:'0.82rem'}}>
              {learned ? (
                <span style={{color:'#22c55e'}}>✅ <b>Personal Baseline Active</b> — Each metric compared against THIS drive's learned normal. σ badges show deviations.</span>
              ) : (
                <span style={{color:'#60a5fa'}}>📚 <b>Learning Phase {tick}/30</b> — Observing normal degradation pattern. Anomaly detection activates after 30 ticks. Mean ± std computed per metric.</span>
              )}
            </div>

            {/* 12 SMART metric cards */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.65rem',marginBottom:'1.2rem'}}>
              {DEFS.map(def => {
                const val = snap[def.f] ?? 0
                const st  = status(val, def)
                const dc  = STATUS_COLOR[st]
                const sig = sigma(def.f, val)
                const hist = getHist(def.f).slice(-20)
                const baseline_val = bl[def.f]
                const display = def.f==='rber' ? val.toExponential(1) : typeof val==='number' ? (Number.isInteger(val)?val:val.toFixed(1)) : val
                const isSelected = selectedMetric===def.f
                return (
                  <div key={def.id} onClick={()=>setSelectedMetric(isSelected?null:def.f)}
                    className="card card-sm"
                    style={{background:'var(--bg-card2)',border:`1px solid ${dc}44`,cursor:'pointer',transition:'all 0.2s',boxShadow:isSelected?`0 0 12px ${dc}55`:'none'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:2}}>
                      <span style={{color:'var(--text-muted)',fontSize:'0.67rem',fontFamily:'var(--mono)'}}>#{def.id} {def.name}</span>
                      <span style={{width:7,height:7,borderRadius:'50%',background:dc,display:'inline-block',boxShadow:`0 0 5px ${dc}`}}/>
                    </div>
                    <div style={{display:'flex',alignItems:'baseline',gap:3}}>
                      <span style={{color:def.color,fontSize:'1.3rem',fontWeight:700,fontFamily:'var(--mono)'}}>{display}</span>
                      <span style={{color:'var(--text-muted)',fontSize:'0.68rem'}}>{def.unit}</span>
                      {learned && sig >= 2 && (
                        <span style={{background:sig>=3?'#ef444422':'#f59e0b22',border:`1px solid ${sig>=3?'#ef4444':'#f59e0b'}`,color:sig>=3?'#ef4444':'#f59e0b',padding:'0px 4px',borderRadius:6,fontSize:9,fontWeight:700}}>
                          {sig.toFixed(1)}σ
                        </span>
                      )}
                    </div>
                    <div style={{color:'#3a3a50',fontSize:'0.61rem',marginBottom:3}}>FROM {def.src}</div>
                    {learned && baseline_val && (
                      <div style={{color:'#4a4a60',fontSize:'0.61rem',marginBottom:2,fontFamily:'var(--mono)'}}>
                        μ={baseline_val.mean.toFixed(2)} σ={baseline_val.std.toFixed(2)}
                      </div>
                    )}
                    <Sparkline vals={hist} color={dc}/>
                  </div>
                )
              })}
            </div>

            {/* Selected metric detail */}
            {selectedMetric && (() => {
              const def = DEFS.find(d=>d.f===selectedMetric)
              const val = snap[selectedMetric] ?? 0
              const sig = sigma(selectedMetric, val)
              const bl_ = bl[selectedMetric]
              return (
                <div className="card fade-in" style={{borderLeft:`4px solid ${def.color}`,marginBottom:'1rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{color:def.color,fontWeight:700,fontSize:'1rem',marginBottom:4}}>#{def.id} {def.name}</div>
                      <div style={{color:'var(--text-dim)',fontSize:'0.83rem',marginBottom:8}}>{def.why}</div>
                    </div>
                    <button onClick={()=>setSelectedMetric(null)} style={{background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:'1.2rem'}}>✕</button>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.5rem'}}>
                    {[
                      {label:'Current', val: def.f==='rber'?(val).toExponential(2):`${val}${def.unit}`},
                      {label:'Warn threshold', val:`${def.warn}${def.unit}`},
                      {label:'Crit threshold', val:`${def.crit}${def.unit}`},
                      {label:'Sigma', val: learned&&bl_?`${sig.toFixed(2)}σ`:'learning…'},
                    ].map(m=>(
                      <div key={m.label} className="metric-tile">
                        <div className="metric-label">{m.label}</div>
                        <div style={{color:def.color,fontFamily:'var(--mono)',fontWeight:700}}>{m.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* ══ TAB 2: LSTM + Decision ═══════════════════════════════════════ */}
        {activeTab==='lstm' && (
          <div>
            <div className="grid-2" style={{marginBottom:'1.2rem'}}>
              {/* Health gauge */}
              <div className="card" style={{background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))'}}>
                <div className="metric-label" style={{marginBottom:4}}>Health Score (LSTM 2-Layer Output)</div>
                <div style={{fontSize:'5rem',fontWeight:800,fontFamily:'var(--mono)',color:healthColor,lineHeight:1,margin:'0.5rem 0'}}>{health}</div>
                <div style={{background:'var(--bg-card2)',borderRadius:8,height:14,overflow:'hidden',marginBottom:'1rem'}}>
                  <div style={{width:`${health}%`,height:'100%',background:healthColor,borderRadius:8,transition:'width 0.8s'}}/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'0.8rem'}}>
                  {[
                    {label:'Failure Prob',val:`${(lstm.failProb*100).toFixed(1)}%`,color:'#ef4444'},
                    {label:'RUL',         val:`~${lstm.rul} days`,                color:'#3b82f6'},
                    {label:'L1 ECC Trend',val:lstm.l1 > 0 ? `↑ ${lstm.l1}` : lstm.l1 < 0 ? `↓ ${Math.abs(lstm.l1)}` : '→ stable', color:'#f59e0b'},
                    {label:'L2 Composite',val:lstm.l2.toFixed(3),               color:'#a855f7'},
                  ].map(m=>(
                    <div key={m.label} className="metric-tile">
                      <div className="metric-label">{m.label}</div>
                      <div style={{color:m.color,fontFamily:'var(--mono)',fontWeight:700,fontSize:'0.9rem'}}>{m.val}</div>
                    </div>
                  ))}
                </div>
                {/* L2 breakdown */}
                <div style={{background:'rgba(0,0,0,0.3)',borderRadius:8,padding:'0.6rem',fontFamily:'var(--mono)',fontSize:'0.72rem'}}>
                  <div style={{color:'var(--text-muted)',marginBottom:4}}>Layer 2 gate weights:</div>
                  {[
                    {label:'Wear factor',  val:lstm.wearF, color:'#a855f7'},
                    {label:'ECC factor',   val:lstm.eccF,  color:'#22c55e'},
                    {label:'Block factor', val:lstm.badF,  color:'#f59e0b'},
                    {label:'Temp factor',  val:lstm.tempF, color:'#f97316'},
                  ].map(g=>(
                    <div key={g.label} style={{display:'flex',alignItems:'center',gap:6,marginBottom:3}}>
                      <span style={{color:'var(--text-muted)',minWidth:80}}>{g.label}</span>
                      <div style={{flex:1,background:'var(--bg-card2)',borderRadius:3,height:7,overflow:'hidden'}}>
                        <div style={{width:`${g.val*100}%`,height:'100%',background:g.color,borderRadius:3}}/>
                      </div>
                      <span style={{color:g.color,minWidth:36,textAlign:'right'}}>{g.val.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Attention weights */}
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.5rem'}}>LSTM Attention Weights</div>
                <div className="metric-label" style={{marginBottom:'0.6rem',fontSize:'0.72rem'}}>Layer 2 gate outputs — what drives this prediction?</div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {DEFS.map((def,i) => {
                    const w=weights[i], pct=(w/maxW)*100
                    const col=`hsl(${260-i*18},70%,60%)`
                    return (
                      <div key={def.f} style={{display:'flex',alignItems:'center',gap:6}}>
                        <div style={{width:72,fontSize:'0.68rem',color:'var(--text-muted)',fontFamily:'var(--mono)',flexShrink:0}}>{def.name.split(' ')[0]}</div>
                        <div style={{flex:1,background:'var(--bg-card2)',borderRadius:3,height:8,overflow:'hidden'}}>
                          <div style={{width:`${pct}%`,height:'100%',background:col,borderRadius:3,transition:'width 0.5s'}}/>
                        </div>
                        <div style={{width:32,fontSize:'0.66rem',color:'var(--text-muted)',textAlign:'right',fontFamily:'var(--mono)'}}>{w.toFixed(2)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Decision Engine */}
            <div className="card" style={{borderLeft:`4px solid ${dec.color}`,background:`${dec.color}08`,marginBottom:'1.2rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{fontFamily:'var(--mono)',fontSize:'0.72rem',color:dec.color,fontWeight:700,letterSpacing:1,textTransform:'uppercase'}}>Decision Engine → {dec.level}</div>
                  <div style={{color:'var(--text-dim)',fontSize:'0.85rem',marginTop:4}}>{dec.action}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {dec.cmds.map((c,i)=>(
                    <div key={i} style={{fontFamily:'var(--mono)',fontSize:'0.78rem',color:dec.color,background:dec.color+'11',border:`1px solid ${dec.color}33`,borderRadius:6,padding:'3px 10px'}}>{c}</div>
                  ))}
                </div>
              </div>
            </div>

            {/* All 4 cases */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.7rem'}}>
              {[
                {level:'NOMINAL',  p:'<25%',  color:'#22c55e', action:'Monitor. No action.'},
                {level:'WARNING',  p:'25-50%', color:'#f59e0b', action:'Tighten baseline. Increase checks.'},
                {level:'CRITICAL', p:'50-75%', color:'#f97316', action:'🚨 Relocate data from worn blocks.'},
                {level:'SEVERE',   p:'>75%',   color:'#ef4444', action:'Emergency retire + OOB alert.'},
              ].map(c=>(
                <div key={c.level} className="card" style={{borderLeft:`4px solid ${c.color}`,opacity:dec.level===c.level?1:0.45,transition:'opacity 0.3s'}}>
                  <div style={{color:c.color,fontWeight:700,fontFamily:'var(--mono)',fontSize:'0.82rem'}}>{c.level}</div>
                  <div style={{color:'var(--text-muted)',fontSize:'0.7rem',marginTop:2}}>failProb {c.p}</div>
                  <div style={{color:'var(--text-dim)',fontSize:'0.75rem',marginTop:6}}>{c.action}</div>
                  {dec.level===c.level && <div style={{marginTop:8,color:c.color,fontSize:'0.72rem',fontWeight:700}}>← ACTIVE NOW</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ══ TAB 3: System Pipeline ═══════════════════════════════════════ */}
        {activeTab==='pipeline' && (
          <div>
            <div className="card" style={{marginBottom:'1rem'}}>
              <div className="title-md" style={{marginBottom:'1rem'}}>🔁 Complete Closed-Loop System Flow</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'0.82rem',lineHeight:2.2,background:'#0a0a14',borderRadius:8,padding:'1rem'}}>
                {[
                  ['#14b8a6', 'PILLAR 3', 'Syndrome calculator detects RBER spike → LDPC tier escalation → health monitor fires PRE_FAILURE'],
                  ['#6366f1', 'PILLAR 1', `SMART engine receives ECC rate update → metric #1 rises to ${snap?.ecc_rate||0}/hr`],
                  ['#6366f1', 'PILLAR 1', 'Personal Baseline: compare vs learned μ±σ → deviation flagged if >2σ'],
                  ['#a855f7', 'LSTM L1',  `Short-term ECC trend = ${lstm.l1} → capturing hour-scale fluctuations`],
                  ['#a855f7', 'LSTM L2',  `Long-term integration: wear=${lstm.wearF.toFixed(2)}, ecc=${lstm.eccF.toFixed(2)} → failProb=${(lstm.failProb*100).toFixed(1)}%`],
                  ['#f97316', 'DECISION', `${dec.level}: ${dec.action}`],
                  ['#f59e0b', 'PILLAR 2', 'Receives PRE_RETIRE command → Bitmap[N]=0 → data copied to spare → BBT updated'],
                  ['#22c55e', 'PILLAR 3', 'Receives RAISE_LDPC_CAP → max_iters updated from 8→20 for worn blocks'],
                  ['#22c55e', 'RESULT',   'Zero data loss. Block retired before UECC occurred.'],
                ].map(([col, src, msg], i) => (
                  <div key={i} style={{display:'flex',gap:12,marginBottom:2}}>
                    <span style={{color:col,minWidth:80,fontWeight:700}}>{src}</span>
                    <span style={{color:'#555'}}>→</span>
                    <span style={{color:'var(--text-dim)'}}>{msg}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>What Pillar 1 Actually Is</div>
                {[
                  ['Data Collector','Reads 12 metrics from P2 (wear, bad blocks) and P3 (ECC, RBER, latency)'],
                  ['AI Brain','2-layer LSTM over rolling time-series. Layer 1=hours, Layer 2=weeks.'],
                  ['Decision Engine','4-level decision (NOMINAL/WARNING/CRITICAL/SEVERE) → cross-pillar commands'],
                  ['Comm Layer','In-band (NVMe) when host alive. OOB (UART/BLE + caps) on crash.'],
                  ['Security Layer','AES-256-GCM encryption + Shamir 3-of-5 key split before transmit'],
                ].map(([k,v])=>(
                  <div key={k} style={{display:'flex',gap:10,marginBottom:10,padding:'8px',background:'var(--bg-card2)',borderRadius:7}}>
                    <span style={{color:'var(--accent)',fontWeight:700,minWidth:130,fontSize:'0.82rem'}}>{k}</span>
                    <span style={{color:'var(--text-dim)',fontSize:'0.8rem'}}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>Why Personal Baseline?</div>
                <div style={{color:'var(--text-dim)',fontSize:'0.84rem',lineHeight:1.7}}>
                  <div style={{marginBottom:10,padding:'0.7rem',background:'rgba(239,68,68,0.08)',borderRadius:8,border:'1px solid rgba(239,68,68,0.2)'}}>
                    <b style={{color:'#ef4444'}}>Generic threshold:</b>&nbsp;
                    ECC &gt; 400 = bad
                    <br/><span style={{color:'var(--text-muted)',fontSize:'0.78rem'}}>Problem: A fresh drive at 400 = normal. An old drive at 400 = healthy.</span>
                  </div>
                  <div style={{padding:'0.7rem',background:'rgba(34,197,94,0.08)',borderRadius:8,border:'1px solid rgba(34,197,94,0.2)'}}>
                    <b style={{color:'#22c55e'}}>Personal baseline:</b>&nbsp;
                    "This drive's ECC is normally {bl['ecc_rate']?.mean?.toFixed(0)??'~learning'}±{bl['ecc_rate']?.std?.toFixed(0)??'…'}/hr"
                    <br/><span style={{color:'var(--text-muted)',fontSize:'0.78rem'}}>A rise to {snap?Math.round(snap.ecc_rate*1.8):300}/hr = anomaly here. Not a generic cutoff.</span>
                  </div>
                  <div style={{marginTop:10,color:'var(--text-muted)',fontSize:'0.78rem'}}>
                    → Adapts to workload type<br/>
                    → Detects slow, creeping failures<br/>
                    → Avoids false alarms on high-write drives
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══ TAB 4: OOB + Security ════════════════════════════════════════ */}
        {activeTab==='oob' && (
          <div>
            <div className="card" style={{marginBottom:'1rem'}}>
              <div className="title-md" style={{marginBottom:'0.8rem'}}>📡 Out-of-Band (OOB) Recovery Architecture</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.8rem',marginBottom:'1rem'}}>
                {[
                  {label:'Channel',     val:'UART 115200 / BLE 5.0', color:'#06b6d4'},
                  {label:'Power',       val:'Internal capacitors',    color:'#10b981'},
                  {label:'Trigger',     val:'Host crash / NVMe dead', color:'#ef4444'},
                  {label:'Encryption',  val:'AES-256-GCM',           color:'#a855f7'},
                  {label:'Key Sharing', val:'Shamir 3-of-5',         color:'#6366f1'},
                  {label:'Status',      val:'ARMED',                  color:'#22c55e'},
                ].map(m=>(
                  <div key={m.label} className="metric-tile">
                    <div className="metric-label">{m.label}</div>
                    <div style={{color:m.color,fontWeight:700,fontSize:'0.9rem',marginTop:'0.3rem',fontFamily:'var(--mono)'}}>{m.val}</div>
                  </div>
                ))}
              </div>
              <button className="btn btn-danger" onClick={runOOB} disabled={oobRunning} style={{marginBottom:'1rem'}}>
                {oobRunning ? '⏳ Transmitting…' : '💥 Simulate Host Crash → OOB Recovery'}
              </button>

              {oobLog.length > 0 && (
                <div style={{background:'#050510',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',maxHeight:320,overflowY:'auto',fontFamily:'var(--mono)',fontSize:'0.76rem'}}>
                  {oobLog.map((e,i)=>(
                    <div key={i} style={{color:e.c,marginBottom:4}}>{e.msg}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>🔐 AES-256-GCM Encryption</div>
                {[
                  ['Why AES-256', 'Quantum-resistant key size. GCM mode provides both confidentiality + integrity (no tamper possible).'],
                  ['What is encrypted', '12 SMART metrics + LSTM prediction + BBT state + failure root cause analysis'],
                  ['IV/Nonce', '128-bit random nonce. Never reused. Prevents replay attacks.'],
                  ['Auth Tag', '128-bit GCM tag. Any bit flip in ciphertext invalidates it.'],
                ].map(([k,v])=>(
                  <div key={k} style={{marginBottom:8,padding:'7px 10px',background:'rgba(168,85,247,0.07)',borderRadius:7,border:'1px solid rgba(168,85,247,0.15)'}}>
                    <div style={{color:'#a855f7',fontWeight:700,fontSize:'0.8rem',marginBottom:2}}>{k}</div>
                    <div style={{color:'var(--text-dim)',fontSize:'0.78rem'}}>{v}</div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>🗝️ Shamir Secret Sharing (3-of-5)</div>
                {[
                  ['Operators','5 key shares distributed to 5 holders'],
                  ['Threshold','Any 3 holders can reconstruct the original key'],
                  ['Security','Any 2 shares reveal zero information about the key (information-theoretic)'],
                  ['Holders',['Operator A','Cloud Node','UART Port','BLE Beacon','Escrow Agent'].join(' · ')],
                ].map(([k,v])=>(
                  <div key={k} style={{marginBottom:8,padding:'7px 10px',background:'rgba(99,102,241,0.07)',borderRadius:7,border:'1px solid rgba(99,102,241,0.15)'}}>
                    <div style={{color:'#6366f1',fontWeight:700,fontSize:'0.8rem',marginBottom:2}}>{k}</div>
                    <div style={{color:'var(--text-dim)',fontSize:'0.78rem'}}>{v}</div>
                  </div>
                ))}
                <div style={{marginTop:12,padding:'0.7rem',background:'rgba(34,197,94,0.08)',borderRadius:8,border:'1px solid rgba(34,197,94,0.2)',fontSize:'0.82rem',color:'#22c55e',fontWeight:600}}>
                  ✅ Recovery possible even when host is completely dead, NVMe is silent, and drive is physically removed.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
