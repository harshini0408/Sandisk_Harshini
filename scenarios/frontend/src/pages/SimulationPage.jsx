import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const SCENARIO_META = {
  BOOT: {
    title: 'SSD Boot Sequence',
    icon: '🔌',
    color: '#6366f1',
    desc: 'Power-ON. Rebuilds BBT from NAND, seeds SMART/LSTM baseline, initializes ECC engine, minimizes logic.',
    flow: ['PILLAR_2 → BBT_REBUILD', 'PILLAR_1 → SMART_BASELINE', 'PILLAR_3 → ECC_INIT', 'PILLAR_4 → LOGIC_OPTIMIZE'],
  },
  READ: {
    title: 'Normal Read Request',
    icon: '📖',
    color: '#06b6d4',
    desc: 'Host OS → NVMe → FTL translate → BBT gate → ECC decode → data returned to host.',
    flow: ['HOST → READ_REQUEST', 'PILLAR_1 → FTL_TRANSLATE', 'PILLAR_2 → BBT_CHECK', 'PILLAR_3 → ECC_DECODE'],
  },
  WRITE: {
    title: 'Normal Write Request',
    icon: '✏️',
    color: '#10b981',
    desc: 'Host write → FTL picks lowest-PE block via wear leveling → BBT allocate → BCH encode → NAND write.',
    flow: ['HOST → WRITE_REQUEST', 'PILLAR_1 → FTL_TRANSLATE', 'PILLAR_2 → BLOCK_ALLOC', 'PILLAR_3 → ECC_ENCODE'],
  },
  DEGRADATION: {
    title: 'Progressive Block Degradation',
    icon: '⚠️',
    color: '#f59e0b',
    desc: 'LDPC iterations breach threshold → PRE_FAILURE → Pillar 1 LSTM relocates data → Pillar 2 retires block.',
    flow: ['PILLAR_3 → ECC_DETECTED', 'PILLAR_3 → PRE_FAILURE', 'PILLAR_1 → DATA_RELOCATION', 'PILLAR_2 → BLOCK_RETIRE', 'PILLAR_4 → LOGIC_OPTIMIZE'],
  },
  HOST_CRASH: {
    title: 'Host Crash — OOB Recovery',
    icon: '💥',
    color: '#ef4444',
    desc: 'Host offline → OOB channel activates → AES-256-GCM encrypt → Shamir 3-of-5 → UART/BLE transmit.',
    flow: ['HOST → CRASH', 'PILLAR_1 → OOB_TRIGGER', 'PILLAR_1 → ENCRYPT_REPORT', 'PILLAR_1 → SHAMIR_SPLIT', 'PILLAR_1 → OOB_TRANSMIT'],
  },
  GC: {
    title: 'Garbage Collection',
    icon: '♻️',
    color: '#8b5cf6',
    desc: 'Low free blocks → worn candidate selection → re-encode pages → erase blocks → reclaim space.',
    flow: ['PILLAR_1 → GC_TRIGGER', 'PILLAR_2 → GC_CANDIDATES', 'PILLAR_3 → ECC_ENCODE', 'PILLAR_4 → LOGIC_OPTIMIZE'],
  },
}

const PAGE_LABELS = {
  home: 'Host / NVMe',
  pillar1: 'Pillar 1 · FTL + LSTM',
  pillar2: 'Pillar 2 · BBT',
  pillar3: 'Pillar 3 · ECC',
  pillar4: 'Pillar 4 · Logic',
  oob: 'OOB · Security',
  result: 'Result ✅',
}

const PAGE_NAV = {
  pillar1:'/pillar1', pillar2:'/pillar2', pillar3:'/pillar3', pillar4:'/pillar4', oob:'/pillar1'
}

const PAGE_COLORS = {
  home:'#6366f1', pillar1:'#6366f1', pillar2:'#06b6d4', pillar3:'#f59e0b', pillar4:'#10b981', oob:'#a855f7', result:'#22c55e'
}

function flattenData(data) {
  const out = {}
  function walk(obj, prefix='') {
    if (!obj || typeof obj !== 'object') return
    Object.entries(obj).forEach(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, key)
      } else if (Array.isArray(v)) {
        out[key] = v.map(x => typeof x === 'object' ? JSON.stringify(x).slice(0,40) : String(x)).join(', ')
      } else {
        out[key] = v
      }
    })
  }
  walk(data)
  return out
}

function DataGrid({ data }) {
  if (!data) return null
  const flat = flattenData(data)
  const entries = Object.entries(flat).slice(0, 12)
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.5rem', marginTop:'0.8rem' }}>
      {entries.map(([k, v]) => {
        const display = typeof v === 'boolean' ? (v ? '✓ Yes' : '✗ No') :
          typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed ? v.toFixed(2) : v) :
          String(v).length > 30 ? String(v).slice(0,30)+'…' : String(v)
        const isWarn = String(v).includes('BAD') || String(v).includes('FAIL') || String(v).includes('DOWN')
        const isGood = String(v).includes('GOOD') || String(v).includes('READY') || String(v).includes('TRANSMITTED')
        const valColor = isWarn ? '#ef4444' : isGood ? '#22c55e' : 'var(--accent)'
        return (
          <div key={k} style={{ background:'var(--bg-card2)', borderRadius:8, padding:'0.5rem 0.7rem',
            border:'1px solid var(--border)' }}>
            <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase',
              letterSpacing:0.5, marginBottom:2 }}>{k.replace(/_/g,' ').replace(/\./g,' › ')}</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:'0.82rem', color:valColor, fontWeight:700,
              wordBreak:'break-all' }}>{display}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function SimulationPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const scenario = location.state?.scenario || 'BOOT'
  const meta = SCENARIO_META[scenario] || SCENARIO_META.BOOT

  const [steps, setSteps]       = useState([])
  const [events, setEvents]     = useState([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading]   = useState(false)
  const [started, setStarted]   = useState(false)
  const [finished, setFinished] = useState(false)
  const [finalState, setFinalState] = useState(null)
  const [error, setError]       = useState(null)
  const timers = useRef([])

  const currentStep = steps[activeIdx] || null
  const pct = steps.length > 0 ? Math.round(((activeIdx + 1) / steps.length) * 100) : 0

  async function runSim() {
    setLoading(true); setStarted(true); setFinished(false)
    setActiveIdx(-1); setSteps([]); setEvents([]); setError(null)
    timers.current.forEach(clearTimeout)
    try {
      const res = await axios.post(`${API}/start-simulation`, { scenario })
      const { steps: s, state } = res.data
      if (!s || !s.length) { setError('Backend returned empty steps. Make sure Flask is running on :5000.'); setLoading(false); return }
      setSteps(s)
      setEvents(state?.event_log || [])
      setFinalState(state)
      s.forEach((_, i) => {
        const t = setTimeout(() => {
          setActiveIdx(i)
          if (i === s.length - 1) setFinished(true)
        }, i * 2200)
        timers.current.push(t)
      })
    } catch (e) {
      setError(`Cannot reach backend at ${API}. Is Flask running? (python app.py in /backend)`)
    }
    setLoading(false)
  }

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Summary blocks from final state
  const getSummaryMetrics = () => {
    if (!finalState) return []
    const sm = finalState.smart_metrics || {}
    const blocks = finalState.blocks || []
    return [
      { label:'RUL (days)', val:sm.rul_days||'—', color:'#3b82f6' },
      { label:'Bad Blocks',  val:blocks.filter(b=>b.health==='BAD').length, color:'#ef4444' },
      { label:'Good Blocks', val:blocks.filter(b=>b.health==='GOOD').length, color:'#22c55e' },
      { label:'Reallocated', val:sm.reallocated_sectors||0, color:'#f59e0b' },
      { label:'Wear Count',  val:sm.wear_leveling_count||0, color:'#a855f7' },
      { label:'Temp (°C)',   val:sm.temperature||'—', color:'#f97316' },
    ]
  }

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem',
          background:'linear-gradient(135deg,#12121a,#1a1a2e)', border:'1px solid var(--border)',
          borderRadius:14, padding:'1rem 1.5rem' }}>
          <div style={{ width:56,height:56,borderRadius:14, background:meta.color+'22',
            border:`1px solid ${meta.color}44`, display:'flex',alignItems:'center',
            justifyContent:'center', fontSize:'2rem', flexShrink:0 }}>{meta.icon}</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:'var(--mono)',fontSize:'1.1rem',fontWeight:700}}>{meta.title}</div>
            <div style={{color:'var(--text-muted)',fontSize:'0.78rem',marginTop:3}}>{meta.desc}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:6}}>
              {meta.flow.map(f=>(
                <span key={f} style={{fontFamily:'var(--mono)',fontSize:'0.65rem',color:meta.color,
                  background:meta.color+'15',border:`1px solid ${meta.color}33`,
                  padding:'1px 6px',borderRadius:4}}>{f}</span>
              ))}
            </div>
          </div>
          <div style={{display:'flex',gap:'0.6rem',flexShrink:0}}>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/')}>← Scenarios</button>
            <button className="btn btn-primary" onClick={runSim}
              disabled={loading || (started && !finished)}>
              {loading ? '⏳ Loading…' : started && !finished ? '⏳ Running…' : started ? '↺ Replay' : '▶ Run'}
            </button>
          </div>
        </div>

        {/* ── Error ──────────────────────────────────────────────────── */}
        {error && (
          <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.4)',
            borderRadius:10,padding:'1rem 1.2rem',marginBottom:'1.2rem',color:'#ef4444',fontFamily:'var(--mono)',fontSize:'0.82rem'}}>
            ❌ {error}
          </div>
        )}

        {/* ── Pre-run splash ─────────────────────────────────────────── */}
        {!started && !error && (
          <div className="card" style={{textAlign:'center',padding:'4rem 2rem'}}>
            <div style={{fontSize:'4rem',marginBottom:'1rem'}}>{meta.icon}</div>
            <div style={{fontWeight:700,fontSize:'1.4rem',marginBottom:'0.5rem'}}>{meta.title}</div>
            <div style={{color:'var(--text-muted)',maxWidth:480,margin:'0 auto 1.5rem',fontSize:'0.88rem',lineHeight:1.6}}>{meta.desc}</div>
            <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap',marginBottom:'2rem'}}>
              {meta.flow.map(f=>(
                <span key={f} style={{fontFamily:'var(--mono)',fontSize:'0.72rem',color:meta.color,
                  background:meta.color+'15',border:`1px solid ${meta.color}33`,padding:'3px 9px',borderRadius:6}}>{f}</span>
              ))}
            </div>
            <button className="btn btn-primary" style={{minWidth:160}} onClick={runSim}>▶ Run Simulation</button>
          </div>
        )}

        {/* ── Simulation running / done ──────────────────────────────── */}
        {started && steps.length > 0 && (
          <>
            {/* Progress bar */}
            <div className="card" style={{marginBottom:'1.2rem'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'0.4rem'}}>
                <span style={{fontSize:'0.82rem',color:'var(--text-muted)'}}>
                  Step {Math.max(0,activeIdx+1)} / {steps.length}
                </span>
                <span style={{fontFamily:'var(--mono)',color:meta.color,fontWeight:700}}>{pct}%</span>
              </div>
              <div className="progress-bar" style={{marginBottom:'0.8rem'}}>
                <div className="progress-fill" style={{width:`${pct}%`,
                  background:`linear-gradient(90deg,${meta.color},var(--accent2))`}}/>
              </div>
              {/* Step pips */}
              <div className="step-bar" style={{marginBottom:0}}>
                {steps.map((s, i) => (
                  <>
                    <div key={i}
                      className={`step-pip ${i < activeIdx ? 'done' : i === activeIdx ? 'active' : ''}`}
                      onClick={() => setActiveIdx(i)}
                      title={s.message.slice(0,60)}
                      style={{cursor:'pointer',fontSize:9,background:
                        i<activeIdx?'#22c55e':i===activeIdx?meta.color:'var(--bg-card2)',
                        color:i<=activeIdx?'#000':'var(--text-muted)',
                        border:`1px solid ${i<activeIdx?'#22c55e':i===activeIdx?meta.color:'var(--border)'}`
                      }}>
                      {i < activeIdx ? '✓' : i+1}
                    </div>
                    {i < steps.length-1 && (
                      <div key={`c${i}`} className={`step-connector ${i < activeIdx ? 'done' : ''}`}
                        style={{background:i<activeIdx?'#22c55e':'var(--border)'}}/>
                    )}
                  </>
                ))}
              </div>
            </div>

            <div className="grid-2" style={{alignItems:'start'}}>
              {/* Left col: current step + step list */}
              <div>
                {/* Current step card */}
                {currentStep && (
                  <div className="card glow-border fade-in" style={{marginBottom:'1rem',
                    borderColor:PAGE_COLORS[currentStep.page]||'var(--accent)'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.8rem'}}>
                      <div style={{fontFamily:'var(--mono)',fontSize:'0.7rem',color:'var(--text-muted)',textTransform:'uppercase',letterSpacing:1}}>
                        Step {activeIdx+1} of {steps.length}
                      </div>
                      <span style={{background:(PAGE_COLORS[currentStep.page]||'var(--accent)')+'22',
                        border:`1px solid ${PAGE_COLORS[currentStep.page]||'var(--accent)'}44`,
                        color:PAGE_COLORS[currentStep.page]||'var(--accent)',
                        padding:'2px 10px',borderRadius:12,fontSize:'0.72rem',fontWeight:700}}>
                        {PAGE_LABELS[currentStep.page]||currentStep.page}
                      </span>
                    </div>
                    <div style={{background:(PAGE_COLORS[currentStep.page]||meta.color)+'0d',
                      border:`1px solid ${PAGE_COLORS[currentStep.page]||meta.color}22`,
                      borderRadius:10,padding:'0.9rem',marginBottom:'0.8rem'}}>
                      <div style={{fontSize:'0.92rem',fontWeight:600,lineHeight:1.5,color:'var(--text)'}}>
                        {currentStep.message}
                      </div>
                    </div>
                    {currentStep.data && <DataGrid data={currentStep.data}/>}
                    {PAGE_NAV[currentStep.page] && (
                      <button className="btn btn-outline btn-sm" style={{marginTop:'0.8rem'}}
                        onClick={()=>navigate(PAGE_NAV[currentStep.page])}>
                        Open {PAGE_LABELS[currentStep.page]} →
                      </button>
                    )}
                  </div>
                )}

                {/* All steps list */}
                <div className="card">
                  <div className="title-md" style={{marginBottom:'0.8rem'}}>📋 All Steps</div>
                  <div style={{display:'flex',flexDirection:'column',gap:'0.3rem'}}>
                    {steps.map((s, i) => {
                      const pc = PAGE_COLORS[s.page]||'var(--accent)'
                      const isActive = i === activeIdx
                      const isDone = i < activeIdx
                      return (
                        <div key={i} onClick={()=>setActiveIdx(i)} style={{
                          padding:'0.5rem 0.8rem',borderRadius:8,cursor:'pointer',
                          background:isActive?pc+'14':'var(--bg-card2)',
                          border:`1px solid ${isActive?pc+'66':isDone?pc+'22':'transparent'}`,
                          display:'flex',gap:'0.6rem',alignItems:'flex-start',transition:'all 0.2s',
                        }}>
                          <span style={{
                            color:isDone?'#22c55e':isActive?pc:'var(--text-muted)',
                            fontWeight:700,fontSize:'0.78rem',minWidth:20,marginTop:1,flexShrink:0
                          }}>{isDone?'✓':isActive?'▶':i+1}</span>
                          <div style={{flex:1}}>
                            <div style={{fontSize:'0.72rem',color:pc,fontWeight:600,marginBottom:1,fontFamily:'var(--mono)'}}>
                              {PAGE_LABELS[s.page]||s.page}
                            </div>
                            <div style={{fontSize:'0.78rem',color:isDone||isActive?'var(--text)':'var(--text-muted)',lineHeight:1.4}}>
                              {s.message.slice(0,90)}{s.message.length>90?'…':''}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Right col: event log + done summary */}
              <div>
                <div className="card" style={{marginBottom:'1rem'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.8rem'}}>
                    <div className="title-md">📡 Event Bus</div>
                    <span style={{background:'rgba(99,102,241,0.15)',color:'var(--accent)',
                      padding:'2px 8px',borderRadius:12,fontSize:'0.7rem',fontWeight:700}}>
                      {events.length} events
                    </span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:3,maxHeight:320,overflowY:'auto',
                    fontFamily:'var(--mono)',fontSize:'0.73rem'}}>
                    {events.map((e,i) => {
                      const isNew = i >= activeIdx
                      return (
                        <div key={i} style={{
                          display:'flex',gap:8,alignItems:'baseline',
                          padding:'4px 8px',borderRadius:5,
                          background:isNew?'transparent':'rgba(34,197,94,0.06)',
                          opacity:isNew?0.35:1,
                          borderLeft:`2px solid ${e.type?.includes('FAIL')||e.type?.includes('BAD')||e.type?.includes('CRASH')?'#ef4444':e.type?.includes('OOB')||e.type?.includes('ENCRYPT')||e.type?.includes('SHAMIR')?'#a855f7':'#22c55e'}`,
                          transition:'opacity 0.5s'
                        }}>
                          <span style={{color:e.source==='HOST'?'#f97316':e.source?.includes('1')?'#6366f1':e.source?.includes('2')?'#06b6d4':e.source?.includes('3')?'#f59e0b':'#10b981',fontWeight:700,minWidth:60,flexShrink:0}}>
                            {e.source}
                          </span>
                          <span style={{color:e.type?.includes('FAIL')||e.type?.includes('BAD')?'#ef4444':e.type?.includes('OOB')?'#a855f7':'#e2e8f0'}}>
                            {e.type}
                          </span>
                          {e.block_id!=null && <span style={{color:'#4a4a60'}}>B{e.block_id}</span>}
                        </div>
                      )
                    })}
                    {events.length===0 && (
                      <div style={{color:'var(--text-muted)',padding:'1rem',textAlign:'center'}}>
                        No events yet…
                      </div>
                    )}
                  </div>
                </div>

                {/* System state snapshot (mid-run) */}
                {finalState && activeIdx >= 0 && (
                  <div className="card" style={{marginBottom:'1rem'}}>
                    <div className="title-md" style={{marginBottom:'0.8rem'}}>📊 Drive State Snapshot</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'0.4rem'}}>
                      {getSummaryMetrics().map(m=>(
                        <div key={m.label} className="metric-tile">
                          <div className="metric-label">{m.label}</div>
                          <div style={{color:m.color,fontFamily:'var(--mono)',fontWeight:700,fontSize:'1rem'}}>{m.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Completion card */}
                {finished && (
                  <div className="card glow-border fade-in" style={{borderColor:'#22c55e'}}>
                    <div style={{textAlign:'center',padding:'1rem'}}>
                      <div style={{fontSize:'2.5rem',marginBottom:'0.4rem'}}>✅</div>
                      <div style={{color:'#22c55e',fontWeight:700,fontSize:'1rem',marginBottom:'0.3rem'}}>
                        Simulation Complete
                      </div>
                      <div style={{color:'var(--text-muted)',fontSize:'0.82rem',marginBottom:'1rem'}}>
                        {steps[steps.length-1]?.message}
                      </div>
                      {steps[steps.length-1]?.data && (
                        <DataGrid data={steps[steps.length-1].data}/>
                      )}
                      <div style={{display:'flex',gap:'0.6rem',justifyContent:'center',marginTop:'1.2rem',flexWrap:'wrap'}}>
                        <button className="btn btn-outline btn-sm" onClick={()=>navigate('/')}>← Scenarios</button>
                        <button className="btn btn-primary btn-sm" onClick={runSim}>↺ Replay</button>
                        {['pillar1','pillar2','pillar3','pillar4'].map(p=>(
                          <button key={p} className="btn btn-outline btn-sm" onClick={()=>navigate(PAGE_NAV[p])}>
                            {PAGE_LABELS[p].split('·')[0]}
                          </button>
                        ))}
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
