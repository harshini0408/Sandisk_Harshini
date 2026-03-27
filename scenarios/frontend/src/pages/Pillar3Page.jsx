import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

// ── Health helpers ─────────────────────────────────────────────────────────────
function healthLabel(pe, retired) {
  if (retired) return 'RETIRED'
  if (pe < 1500) return 'healthy'
  if (pe < 3000) return 'worn'
  if (pe < 4500) return 'degraded'
  return 'critical'
}
function healthKey(pe, retired) {
  if (retired) return 'X'
  if (pe < 1500) return 'G'
  if (pe < 3000) return 'W'
  if (pe < 4500) return 'D'
  return 'C'
}
const HC = { G:'#22c55e', W:'#f59e0b', D:'#f97316', C:'#ef4444', X:'#4a4a60' }
const HBG = { G:'#052e16', W:'#3d2600', D:'#3d1200', C:'#3d0000', X:'#1a1a1a' }
const HEALTH_TEXT = { healthy:'#22c55e', worn:'#f59e0b', degraded:'#f97316', critical:'#ef4444', RETIRED:'#4a4a60' }

function rber(pe) { return Math.min(1e-3, 1e-7 * Math.pow(1.05, pe/100)) }

function routeRead(errors, health, pe) {
  if (errors === 0) return { tier:1, mode:'Syndrome Zero', latency_us:0, iterations:0, status:'BYPASS' }
  if (errors <= 12) return { tier:2, mode:'BCH', latency_us:+(Math.random()*0.5+0.3).toFixed(2), iterations:0, status:'BCH_CORRECTED' }
  const maxIter = {healthy:8,worn:12,degraded:20,critical:20}[health]||8
  const capacity = maxIter*3
  if (errors <= capacity) {
    const iters = Math.min(Math.floor(errors/3)+1, maxIter)
    return { tier:2, mode:'Hard LDPC', latency_us:+(iters*0.15).toFixed(2), iterations:iters, status:'LDPC_CORRECTED' }
  }
  const vs = +(Math.random()*30+15).toFixed(1)
  return { tier:3, mode:'ML Soft-LDPC', voltage_shift_mv:vs, latency_us:+(Math.random()*2.6+3.2).toFixed(2), iterations:20, status:'ML_RECOVERED' }
}

// ── TIER BOX ──────────────────────────────────────────────────────────────────
function TierBox({ num, label, desc, state, extra }) {
  const colors = { idle:'#2a2a3a', active:'#3b82f6', pass:'#22c55e', fail:'#ef4444', recover:'#a855f7' }
  const bgs = { idle:'#12121a', active:'#0d1e2e', pass:'#051e10', fail:'#1e0505', recover:'#0d0623' }
  const accentColors = [,'#14b8a6','#f59e0b','#ff6b6b']
  const stateColor = colors[state]||colors.idle
  const stateBg = bgs[state]||bgs.idle
  const stateLabel = {idle:'IDLE',active:'ACTIVE …',pass:'PASS OK',fail:'FAIL ✗',recover:'RECOVERED'}[state]||'IDLE'
  const ac = accentColors[num]||'#888'
  return (
    <div style={{
      background:stateBg, border:`1px solid ${stateColor}`, borderLeft:`4px solid ${stateColor}`,
      borderRadius:10, padding:'12px 16px', marginBottom:8,
      boxShadow: state==='active'||state==='recover' ? `0 0 14px ${stateColor}44` : 'none',
      transition:'all 0.3s',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <span style={{ fontSize:10, color:ac, fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>Tier {num}</span>
          <span style={{ fontSize:13, color:'#e8e8f0', fontWeight:700, marginLeft:8 }}>{label}</span>
        </div>
        <span style={{ fontSize:11, color:stateColor, fontWeight:700 }}>{stateLabel}</span>
      </div>
      <div style={{ color:'#8888a0', fontSize:11, marginTop:4 }}>{desc}</div>
      {extra && <div style={{ marginTop:6, fontSize:11, color:'#e8e8f0', fontFamily:'var(--mono)' }}>{extra}</div>}
    </div>
  )
}

// ── Mini LDPC chart ───────────────────────────────────────────────────────────
function LDPCChart({ iters, blockId, alarm }) {
  if (!iters || iters.length === 0) return null
  const w = 360, h = 140
  const maxY = 22
  const pts = iters.map((v,i) => `${(i/(iters.length-1||1))*w},${h - (v/maxY)*(h-20)}`)
  const lineColor = alarm ? '#ef4444' : '#3b82f6'
  const thresholdY = h - (15/maxY)*(h-20)
  return (
    <div style={{ background:'rgba(0,0,0,0)', border:'1px solid var(--border)', borderRadius:8, padding:'0.5rem' }}>
      <div style={{ fontFamily:'var(--mono)', fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>
        LDPC Iterations — Block {blockId}
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow:'visible' }}>
        {/* Threshold line */}
        <line x1={0} y1={thresholdY} x2={w} y2={thresholdY} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1} />
        <text x={4} y={thresholdY-3} fill="#ef4444" fontSize={9}>PRE-FAILURE THRESHOLD (15)</text>
        {/* Area fill */}
        <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={lineColor} opacity={0.08} />
        {/* Line */}
        <polyline points={pts.join(' ')} fill="none" stroke={lineColor} strokeWidth={2.5} />
        {/* Dots */}
        {iters.map((v,i) => (
          <circle key={i} cx={(i/(iters.length-1||1))*w} cy={h-(v/maxY)*(h-20)} r={4} fill="#a855f7" />
        ))}
      </svg>
    </div>
  )
}

export default function Pillar3Page() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('grid')
  const [selected, setSelected] = useState(7)

  // Decoder pipeline state
  const [errors, setErrors] = useState(0)
  const [healthOvr, setHealthOvr] = useState('auto')
  const [preset, setPreset] = useState('custom')
  const [pipeState, setPipeState] = useState({ t1:'idle', t2:'idle', t3:'idle', t1e:'', t2e:'', t3e:'' })
  const [readLog, setReadLog] = useState([])
  const [tierStats, setTierStats] = useState({ t1:0, t2:0, t3:0 })
  const [firing, setFiring] = useState(false)
  const [resultMsg, setResultMsg] = useState(null)
  const [ldpcHistory, setLdpcHistory] = useState([])
  const [aging, setAging] = useState(false)
  const [agingLog, setAgingLog] = useState([])
  const ageRef = useRef(false)

  useEffect(() => {
    axios.get(`${API}/state`).then(r => { setState(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const blocks = state?.blocks || []
  const selBlock = blocks[selected]
  const hlbl = selBlock ? healthLabel(selBlock.pe_cycles, selBlock.health==='BAD') : 'healthy'
  const effective = healthOvr==='auto' ? hlbl : healthOvr

  // Preset quick fills
  const effectiveErrors = preset==='Moment 1 — Bypass (0 errors)' ? 0 : preset==='Moment 2 — ML Recovery (80 errors)' ? 80 : errors

  async function fireRead() {
    if (!selBlock) return
    setFiring(true)
    setResultMsg(null)
    const isRetired = selBlock.health==='BAD'

    setPipeState({ t1:'idle', t2:'idle', t3:'idle', t1e:'', t2e:'', t3e:'' })
    await delay(300)

    if (isRetired) {
      setPipeState({ t1:'idle', t2:'idle', t3:'idle', t1e:'BLOOM FILTER BLOCKED', t2e:'', t3e:'' })
      setResultMsg({ type:'bloom', msg:`🚫 BLOOM FILTER BLOCKED — 0.05 µs\nBlock ${selected} is in the BBT.\nZero latency rejection — UECC impossible.`, color:'#ef4444' })
      appendLog({ time:now(), bid:selected, tier:'BBT', lat:'0.05 us', outcome:'REJECTED', err:effectiveErrors })
      setFiring(false)
      return
    }

    setPipeState(p => ({...p, t1:'active', t1e:'Running syndrome check H·r ...'}))
    await delay(700)

    const res = routeRead(effectiveErrors, effective, selBlock.pe_cycles)
    const { tier, mode, latency_us, iterations, status } = res

    if (tier === 1) {
      setPipeState({ t1:'pass', t2:'idle', t3:'idle', t1e:'H·r = 0 | No errors | 0 µs', t2e:'', t3e:'' })
      setResultMsg({ type:'t1', msg:`✅ MOMENT 1 — SYNDROME ZERO BYPASS\nH·r = 0. Zero errors. Data returned instantly.\nLatency: 0 µs | Tier 1 | No CPU overhead\n[Pillar 4 QMC: 44% logic cost reduction]`, color:'#22c55e' })
      setTierStats(s => ({...s, t1:s.t1+1}))
      appendLog({ time:now(), bid:selected, tier:'T1', lat:'0 us', outcome:status, err:effectiveErrors })

    } else if (tier === 2) {
      setPipeState(p => ({...p, t1:'fail', t2:'active', t1e:'Syndrome != 0 — escalating'}))
      await delay(300)
      // animate iterations
      for (let i=1; i<=iterations; i++) {
        setPipeState(p => ({...p, t2:'active', t2e:`Hard LDPC Iter ${i} / ${iterations}`}))
        await delay(80)
      }
      const done = `${mode} | ${iterations} iters | ${latency_us} µs`
      const warn = iterations>=15 ? '\n⚠️ ITERS >= 15 — Pre-failure flag sent to Pillar 1!' : ''
      setPipeState({ t1:'fail', t2:'pass', t3:'idle', t1e:'Syndrome != 0', t2e:done, t3e:'' })
      setResultMsg({ type:'t2', msg:`${mode.toUpperCase()} CORRECTION\nBlock ${selected} | ${effectiveErrors} errors | ${iterations} iters\nLatency: ${latency_us} µs | Tier 2${warn}`, color:'#f59e0b' })
      setLdpcHistory(h => [...h.slice(-39), iterations])
      setTierStats(s => ({...s, t2:s.t2+1}))
      appendLog({ time:now(), bid:selected, tier:'T2', lat:`${latency_us} us`, outcome:status, err:effectiveErrors })

    } else {
      setPipeState({ t1:'fail', t2:'fail', t3:'active', t1e:'Syndrome != 0', t2e:'LDPC exhausted', t3e:'' })
      await delay(600)
      const vs = res.voltage_shift_mv||25
      const t3msg = `ML: PE=${selBlock.pe_cycles} → ΔV=+${vs} mV — RECOVERED`
      setPipeState({ t1:'fail', t2:'fail', t3:'recover', t1e:'Syndrome != 0', t2e:'LDPC exhausted', t3e:t3msg })
      setResultMsg({ type:'t3', msg:`✅ MOMENT 2 — ML SOFT-DECISION RECOVERY\n3.3 KB Decision Tree — optimal voltage offset predicted\nShift: +${vs} mV | Latency: ${latency_us} µs | Tier 3\n⚠ Tier 3 → Pre-failure flag → Pillar 1 FTL\n[SKLearn DecisionTree depth=4 | 3.4 KB | firmware-ready]`, color:'#a855f7' })
      setLdpcHistory(h => [...h.slice(-39), 20])
      setTierStats(s => ({...s, t3:s.t3+1}))
      appendLog({ time:now(), bid:selected, tier:'T3', lat:`${latency_us} us`, outcome:status, err:effectiveErrors })
    }
    setFiring(false)
  }

  async function ageBlock() {
    if (!selBlock || selBlock.health==='BAD') return
    setAging(true)
    ageRef.current = false
    setAgingLog([])
    const localIters = []
    let retired = false
    for (let tick=0; tick<60; tick++) {
      selBlock.pe_cycles = Math.min(5100, selBlock.pe_cycles + Math.floor(Math.random()*35+20))
      const itr = +(Math.max(1.0, 2.0+tick*0.37+((Math.random()-0.5)*0.8))).toFixed(1)
      localIters.push(itr)
      setLdpcHistory([...localIters.slice(-35)])
      await delay(200)
      if (itr >= 15 && !retired) {
        retired = true
        const dest = Math.floor(Math.random()*300+200)
        const steps = [
          `AEGIS:    Pre-failure flag emitted. threshold=15 crossed.`,
          `PAYLOAD:  {block:${selected}, trigger:LDPC>15, dest:${dest}}`,
          `PILLAR 1: FTL copying block ${selected} --> ${dest} ...`,
          `PILLAR 1: Relocation COMPLETE. Block ${dest} healthy.`,
          `PILLAR 2: BBT bit ${selected%32} flipped 0 --> 1 (RETIRED).`,
          `PILLAR 1: Encrypting diagnostic report AES-256 ...`,
          `PILLAR 1: Shamir 3-of-5 key split pushed to distributed log.`,
          `PILLAR 4: Firmware decision tree pruned for next GC cycle.`,
          `STATUS:   UECC PREVENTED. Block ${selected} RETIRED. NAND lifespan +1.5x.`,
        ]
        for (const s of steps) {
          setAgingLog(prev => [...prev, s])
          await delay(400)
        }
        // update block state locally
        if (state) state.blocks[selected].health = 'BAD'
        break
      }
    }
    if (!retired) setAgingLog(['Simulation ended. Block still operational.'])
    setAging(false)
  }

  function delay(ms) { return new Promise(r=>setTimeout(r,ms)) }
  function now() { return new Date().toLocaleTimeString('en-US',{hour12:false}) }
  function appendLog(e) { setReadLog(prev=>[...prev.slice(-19), e]) }

  const total = tierStats.t1+tierStats.t2+tierStats.t3
  const bbt = Array.from({length:32}, (_,i) => blocks[i]?.health==='BAD' ? 1 : 0)
  const bbtRetired = bbt.filter(Boolean).length
  const alarm = ldpcHistory.some(x=>x>=15)

  const LOG_COLORS = { T1:'#14b8a6', T2:'#f59e0b', T3:'#ff6b6b', BBT:'#ef4444' }

  const TABS = [
    { id:'grid', label:'📦 NAND Block Grid' },
    { id:'decoder', label:'⚡ Live Decoder Pipeline' },
    { id:'telemetry', label:'📊 Telemetry & Aging' },
  ]

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:'1.2rem' }}>
          <span style={{ fontSize:'1.8rem' }}>🛡️</span>
          <div>
            <div style={{ fontFamily:'var(--mono)', fontSize:'1.15rem', fontWeight:700 }}>AEGIS — Adaptive ECC & Grade-Intelligent Supervision</div>
            <div style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>
              Pillar 3 &nbsp;·&nbsp;
              <span style={{color:'#22c55e'}}>■</span> Healthy &nbsp;
              <span style={{color:'#f59e0b'}}>■</span> Worn &nbsp;
              <span style={{color:'#f97316'}}>■</span> Degraded &nbsp;
              <span style={{color:'#ef4444'}}>■</span> Critical &nbsp;
              <span style={{color:'#4a4a60'}}>■</span> Retired
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:'1.2rem' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              padding:'0.6rem 1.2rem', border:'none', background:'transparent',
              color:activeTab===t.id?'#3b82f6':'var(--text-muted)',
              borderBottom:activeTab===t.id?'2px solid #3b82f6':'2px solid transparent',
              cursor:'pointer', fontFamily:'var(--font)', fontSize:'0.88rem', fontWeight:600, transition:'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {loading && <div style={{color:'var(--text-muted)'}}>Loading…</div>}

        {/* ── TAB 1: NAND Grid ─────────────────────────────── */}
        {!loading && activeTab==='grid' && (
          <div>
            <div className="title-md" style={{ marginBottom:'0.8rem' }}>📦 NAND Physical Block Array (8×8 = 64 blocks)</div>
            <div style={{ color:'var(--text-muted)', fontSize:'0.78rem', marginBottom:12 }}>Select any block to target it for reads and aging. Colors update as blocks accumulate P/E cycles.</div>
            <div className="grid-2">
              {/* Grid */}
              <div className="card">
                <div style={{ display:'flex', flexDirection:'column', gap:4, marginBottom:12 }}>
                  {Array.from({length:8},(_,row)=>(
                    <div key={row} style={{display:'flex',gap:4}}>
                      {Array.from({length:8},(_,col)=>{
                        const bid=row*8+col, blk=blocks[bid]
                        if (!blk) return null
                        const key=healthKey(blk.pe_cycles,blk.health==='BAD')
                        const isSel=bid===selected
                        return (
                          <div key={bid} onClick={()=>setSelected(bid)}
                            style={{width:46,height:46,background:HBG[key],color:HC[key],borderRadius:5,
                            border:isSel?'2px solid #fff':'2px solid transparent',display:'flex',alignItems:'center',
                            justifyContent:'center',fontFamily:'var(--mono)',fontSize:9,fontWeight:700,cursor:'pointer',
                            transition:'all 0.2s',boxShadow:isSel?`0 0 12px ${HC[key]}88`:'none'}}>
                            B{bid}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',fontFamily:'var(--mono)',fontSize:11}}>
                  {[['#22c55e','Healthy (0–1500)'],['#f59e0b','Worn (1500–3000)'],['#f97316','Degraded (3000–4500)'],['#ef4444','Critical (>4500)'],['#4a4a60','Retired']].map(([c,l])=>(
                    <span key={l}><span style={{color:c}}>■</span> {l}</span>
                  ))}
                </div>
                {/* Block selector */}
                <div style={{ marginTop:12, display:'flex', gap:'0.5rem', alignItems:'center' }}>
                  <span style={{color:'var(--text-muted)',fontSize:'0.82rem'}}>Select Block:</span>
                  <input type="number" min={0} max={63} value={selected}
                    onChange={e=>setSelected(+e.target.value)}
                    style={{width:60,background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'0.25rem 0.5rem',fontFamily:'var(--mono)'}} />
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                {/* Selected block stats */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom:'0.8rem' }}>Selected Block Stats</div>
                  {selBlock && (() => {
                    const hlbl2 = healthLabel(selBlock.pe_cycles, selBlock.health==='BAD')
                    const hc = HEALTH_TEXT[hlbl2]||'#888'
                    const wear = (selBlock.pe_cycles/5000*100).toFixed(1)
                    const avgI = ldpcHistory.length ? (ldpcHistory.reduce((a,b)=>a+b,0)/ldpcHistory.length).toFixed(1) : selBlock.ecc_tier===1?'1.0':'8.0'
                    return (
                      <div style={{background:'var(--bg-card2)',border:`1px solid ${hc}44`,borderLeft:`4px solid ${hc}`,borderRadius:8,padding:'1rem',fontFamily:'var(--mono)'}}>
                        <table style={{width:'100%',borderCollapse:'collapse'}}>
                          {[['Block ID',selected],['P/E Cycles',`${selBlock.pe_cycles} / 5000`],['Wear Level',`${wear}%`],['Avg LDPC Iters',avgI],['RBER Estimate',rber(selBlock.pe_cycles).toExponential(2)],['Tier 3 Hits',readLog.filter(e=>e.tier==='T3'&&e.bid===selected).length],['Health Status',hlbl2.toUpperCase()]].map(([k,v])=>(
                            <tr key={k}><td style={{color:'var(--text-muted)',padding:'4px 0',fontSize:'0.82rem'}}>{k}</td><td style={{color:hc,textAlign:'right',fontWeight:700,fontSize:'0.82rem'}}>{v}</td></tr>
                          ))}
                        </table>
                      </div>
                    )
                  })()}
                </div>
                {/* Summary */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom:'0.8rem' }}>All Blocks Summary</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                    {[
                      { label:'Healthy',  val:blocks.filter(b=>b.pe_cycles<1500&&b.health!=='BAD').length,  color:'#22c55e' },
                      { label:'Worn',     val:blocks.filter(b=>b.pe_cycles>=1500&&b.pe_cycles<3000&&b.health!=='BAD').length, color:'#f59e0b' },
                      { label:'Degraded', val:blocks.filter(b=>b.pe_cycles>=3000&&b.pe_cycles<4500&&b.health!=='BAD').length, color:'#f97316' },
                      { label:'Critical', val:blocks.filter(b=>b.pe_cycles>=4500&&b.health!=='BAD').length,  color:'#ef4444' },
                      { label:'Retired',  val:blocks.filter(b=>b.health==='BAD').length,                   color:'#4a4a60' },
                      { label:'Active',   val:64-blocks.filter(b=>b.health==='BAD').length,                color:'var(--accent)' },
                    ].map(m=>(
                      <div key={m.label} className="metric-tile">
                        <div className="metric-label">{m.label}</div>
                        <div style={{ color:m.color, fontFamily:'var(--mono)', fontWeight:700, fontSize:'1.3rem' }}>{m.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: Live Decoder Pipeline ──────────────────── */}
        {!loading && activeTab==='decoder' && (
          <div>
            <div className="title-md" style={{ marginBottom:'0.8rem' }}>⚡ Live Decoder Pipeline</div>
            <div style={{ color:'var(--text-muted)', fontSize:'0.78rem', marginBottom:14 }}>Fire a read request on the selected block. Watch the packet travel through the three-tier ECC system.</div>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1.5fr 1fr', gap:'1rem' }}>
              {/* Pipeline */}
              <div>
                <div className="title-md" style={{ marginBottom:'0.8rem' }}>Decoder Pipeline</div>
                <TierBox num={1} label="Syndrome Zero Bypass"   desc="Parity check H·r = 0 · 0 µs bypass path"       state={pipeState.t1} extra={pipeState.t1e} />
                <div style={{textAlign:'center',color:'#2a2a3a',fontSize:18,margin:'-4px 0'}}>↓</div>
                <TierBox num={2} label="BCH + Hard-Decision LDPC" desc="Normalized Min-Sum · up to 20 iterations"       state={pipeState.t2} extra={pipeState.t2e} />
                <div style={{textAlign:'center',color:'#2a2a3a',fontSize:18,margin:'-4px 0'}}>↓</div>
                <TierBox num={3} label="ML Soft-Decision LDPC"  desc="3.3 KB Decision Tree · voltage shift prediction" state={pipeState.t3} extra={pipeState.t3e} />

                {resultMsg && (
                  <div className="fade-in" style={{
                    background:resultMsg.color+'11', border:`1px solid ${resultMsg.color}44`,
                    borderRadius:8, padding:'0.8rem', marginTop:8,
                    fontFamily:'var(--mono)', fontSize:'0.8rem', color:resultMsg.color,
                    whiteSpace:'pre-line',
                  }}>{resultMsg.msg}</div>
                )}
              </div>

              {/* Config */}
              <div>
                <div className="title-md" style={{ marginBottom:'0.8rem' }}>Request Configuration</div>
                {selBlock && (() => {
                  const hc = HEALTH_TEXT[hlbl]||'#888'
                  return (
                    <div style={{background:'var(--bg-card2)',border:`1px solid ${hc}44`,borderLeft:`4px solid ${hc}`,borderRadius:8,padding:'10px 14px',marginBottom:12,fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
                      Target: <b>Block {selected}</b> · P/E: <b>{selBlock.pe_cycles}</b> · Health: <span style={{color:hc,fontWeight:700}}>{hlbl.toUpperCase()}</span>
                      {selBlock.health==='BAD' && <span style={{color:'#ef4444',fontWeight:700}}> ⚠ RETIRED</span>}
                    </div>
                  )
                })()}

                <div style={{ marginBottom:'0.8rem' }}>
                  <div className="metric-label" style={{marginBottom:4}}>Injected Bit Errors: {errors}</div>
                  <input type="range" min={0} max={150} value={errors} onChange={e=>setErrors(+e.target.value)} style={{width:'100%',accentColor:'var(--accent)'}} />
                </div>
                <div style={{ marginBottom:'0.8rem' }}>
                  <div className="metric-label" style={{marginBottom:4}}>Quick Demo Preset</div>
                  <select value={preset} onChange={e=>setPreset(e.target.value)}
                    style={{width:'100%',background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'0.4rem',fontFamily:'var(--font)'}}>
                    {['custom','Moment 1 — Bypass (0 errors)','Moment 2 — ML Recovery (80 errors)','Moment 3 — Read Retired Block'].map(p=>(
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary" style={{width:'100%',marginBottom:'1rem'}} onClick={fireRead} disabled={firing}>
                  {firing ? '⏳ Processing…' : '▶ Fire Read Request'}
                </button>
                <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.75rem'}}>
                  <div style={{color:'#60a5fa',fontWeight:700,marginBottom:8,fontSize:'0.65rem',textTransform:'uppercase'}}>Routing Logic</div>
                  errors = 0 &nbsp;→&nbsp; <span style={{color:'#14b8a6'}}>Tier 1 Bypass</span><br/>
                  errors 1-12 &nbsp;→&nbsp; <span style={{color:'#f59e0b'}}>BCH correction</span><br/>
                  errors 13-60 &nbsp;→&nbsp; <span style={{color:'#f59e0b'}}>Hard LDPC</span><br/>
                  errors &gt; 60 &nbsp;→&nbsp; <span style={{color:'#ff6b6b'}}>ML Soft-LDPC</span><br/>
                  <span style={{color:'#ef4444'}}>RETIRED</span> &nbsp;→&nbsp; <span style={{color:'#ef4444'}}>Bloom Filter kill 0µs</span>
                </div>
              </div>

              {/* Session stats */}
              <div>
                <div className="title-md" style={{ marginBottom:'0.8rem' }}>Session Stats</div>
                {[
                  { label:'T1 Bypass', val:`${total?((tierStats.t1/total)*100).toFixed(1):0}%` },
                  { label:'T3 Triggers', val:tierStats.t3 },
                  { label:'Avg T2 Iters', val:ldpcHistory.length?(ldpcHistory.reduce((a,b)=>a+b,0)/ldpcHistory.length).toFixed(1):'0.0' },
                  { label:'RBER', val:selBlock?rber(selBlock.pe_cycles).toExponential(1):'—' },
                ].map(m=>(
                  <div key={m.label} className="metric-tile" style={{marginBottom:'0.5rem'}}>
                    <div className="metric-label">{m.label}</div>
                    <div style={{color:'#a855f7',fontFamily:'var(--mono)',fontWeight:700,fontSize:'1.2rem'}}>{m.val}</div>
                  </div>
                ))}
                {/* Tier donut (CSS-based) */}
                {total > 0 && (
                  <div style={{marginTop:'0.8rem'}}>
                    {[{tier:'T1',count:tierStats.t1,color:'#14b8a6'},{tier:'T2',count:tierStats.t2,color:'#f59e0b'},{tier:'T3',count:tierStats.t3,color:'#ff6b6b'}].map(t=>(
                      <div key={t.tier} style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.3rem'}}>
                        <span style={{color:t.color,fontFamily:'var(--mono)',fontSize:'0.75rem',minWidth:24}}>{t.tier}</span>
                        <div style={{flex:1,background:'var(--bg-card2)',borderRadius:3,height:8,overflow:'hidden'}}>
                          <div style={{width:`${(t.count/total)*100}%`,height:'100%',background:t.color,borderRadius:3}} />
                        </div>
                        <span style={{color:t.color,fontSize:'0.72rem',minWidth:24}}>{t.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Read log */}
            <div style={{borderTop:'1px solid var(--border)',marginTop:16,paddingTop:12}}>
              <div className="title-md" style={{ marginBottom:'0.8rem' }}>📋 Live Read Log — last 10 reads</div>
              {readLog.length > 0 ? (
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {readLog.slice(-10).reverse().map((e,i) => {
                    const tc = LOG_COLORS[e.tier]||'#888'
                    return (
                      <div key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 12px',borderRadius:6,background:'#1a1a26',fontFamily:'var(--mono)',fontSize:'0.78rem'}}>
                        <span style={{color:'#4a4a60',minWidth:60}}>{e.time}</span>
                        <span style={{color:'#8888a0',minWidth:40}}>B{e.bid}</span>
                        <span style={{color:tc,fontWeight:700,minWidth:36}}>{e.tier}</span>
                        <span style={{color:'#e8e8f0',minWidth:60}}>{e.lat}</span>
                        <span style={{color:tc,minWidth:120}}>{e.outcome}</span>
                        <span style={{color:'#4a4a60'}}>{e.err} err</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{color:'#4a4a60',fontFamily:'var(--mono)',fontSize:'0.78rem'}}>No reads yet — fire a request above.</div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 3: Telemetry & Aging ──────────────────────── */}
        {!loading && activeTab==='telemetry' && (
          <div>
            <div className="title-md" style={{ marginBottom:'0.8rem' }}>📊 Telemetry Dashboard & Block Aging</div>
            <div className="grid-2">
              <div>
                {/* Metrics row */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.5rem', marginBottom:'1rem' }}>
                  {[
                    { label:`T1 Bypass`, val:`${total?((tierStats.t1/total)*100).toFixed(1):0}%` },
                    { label:`Avg T2 Iters`, val:ldpcHistory.length?(ldpcHistory.reduce((a,b)=>a+b,0)/ldpcHistory.length).toFixed(1):'0.0' },
                    { label:`T3 ML Triggers`, val:tierStats.t3 },
                    { label:`RBER B${selected}`, val:selBlock?rber(selBlock.pe_cycles).toExponential(1):'—' },
                  ].map(m=>(
                    <div key={m.label} className="metric-tile">
                      <div className="metric-label">{m.label}</div>
                      <div style={{color:'#a855f7',fontFamily:'var(--mono)',fontWeight:700,fontSize:'1.1rem'}}>{m.val}</div>
                    </div>
                  ))}
                </div>

                {/* LDPC chart */}
                <div className="card" style={{ marginBottom:'1rem' }}>
                  {ldpcHistory.length > 0 ? (
                    <LDPCChart iters={ldpcHistory} blockId={selected} alarm={alarm} />
                  ) : (
                    <div style={{color:'var(--text-muted)',textAlign:'center',padding:'1rem',fontSize:'0.85rem'}}>Fire read requests to populate LDPC iteration chart</div>
                  )}
                </div>

                {/* BBT Bitmap P2 */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom:'0.5rem' }}>Pillar 2 — BBT Bitmap (32 blocks)</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:6}}>
                    {bbt.map((bad,i)=>(
                      <div key={i} title={`B${i}: ${bad?'RETIRED':'OK'}`} style={{width:28,height:22,background:bad?'#2d0a0a':'#052e16',color:bad?'#ef4444':'#22c55e',borderRadius:3,fontSize:8,textAlign:'center',lineHeight:'22px',fontFamily:'var(--mono)'}}>B{i}</div>
                    ))}
                  </div>
                  <div style={{color:'#4a4a60',fontSize:11,fontFamily:'var(--mono)',marginTop:6}}>
                    RETIRED={bbtRetired} / ACTIVE={32-bbtRetired}
                  </div>
                </div>
              </div>

              {/* Aging simulation */}
              <div className="card">
                <div className="title-md" style={{ marginBottom:'0.8rem' }}>🔥 Moment 3 — Block Aging Simulation</div>
                {selBlock && (() => {
                  const hlbl3 = healthLabel(selBlock.pe_cycles, selBlock.health==='BAD')
                  const hc3 = HEALTH_TEXT[hlbl3]||'#888'
                  return (
                    <>
                      <div style={{background:'var(--bg-card2)',border:`1px solid ${hc3}44`,borderLeft:`4px solid ${hc3}`,borderRadius:8,padding:'10px 12px',fontFamily:'var(--mono)',fontSize:'0.8rem',marginBottom:12}}>
                        Block <b>{selected}</b> · P/E: <b>{selBlock.pe_cycles}</b><br/>
                        Status: <span style={{color:hc3,fontWeight:700}}>{hlbl3.toUpperCase()}</span>
                      </div>
                      {selBlock.health==='BAD' ? (
                        <div>
                          <div style={{background:'#1e0505',border:'1px solid #ef444444',borderRadius:8,padding:'0.8rem',marginBottom:'0.8rem'}}>
                            <b style={{color:'#ef4444'}}>Block {selected} already RETIRED.</b><br/>
                            Go to NAND Grid and select another block.
                          </div>
                          <div style={{background:'#051e10',border:'1px solid #22c55e44',borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.78rem'}}>
                            <b style={{color:'#22c55e'}}>Bloom Filter Active</b><br/>
                            Any read to Block {selected} returns 0.05 µs rejection.<br/>
                            Data was relocated to a healthy block by Pillar 1 FTL.
                          </div>
                        </div>
                      ) : (
                        <>
                          <button className="btn btn-primary" style={{width:'100%',marginBottom:'0.8rem'}} onClick={ageBlock} disabled={aging}>
                            {aging ? '⏳ Aging…' : `▶ Age Block ${selected} Until Retirement`}
                          </button>
                          <div style={{color:'var(--text-muted)',fontSize:'0.78rem',fontFamily:'var(--mono)',marginBottom:'0.8rem'}}>
                            Simulates progressive wear. At LDPC iter 15 the retirement cascade fires automatically and runs to completion — unstoppable.
                          </div>
                          {agingLog.length > 0 && (
                            <div style={{background:'#0a0a0f',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.75rem',maxHeight:220,overflowY:'auto'}}>
                              {agingLog.map((line,i)=>{
                                const color = line.includes('STATUS')||line.includes('COMPLETE')?'#22c55e':line.includes('PILLAR')||line.includes('AEGIS')?'#14b8a6':line.includes('PAYLOAD')?'#a855f7':'#e8e8f0'
                                return <div key={i} style={{color,marginBottom:3}}>{line}</div>
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
