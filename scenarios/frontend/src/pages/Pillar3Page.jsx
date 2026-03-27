import { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

// ── Health metadata ────────────────────────────────────────────────────────────
const HC_COLORS  = { 0:'#22c55e', 1:'#f59e0b', 2:'#f97316', 3:'#ef4444' }
const HC_BG      = { 0:'#052e16', 1:'#3d2600', 2:'#3d1200', 3:'#3d0000' }
const HC_LABELS  = { 0:'HEALTHY', 1:'MOD_WORN', 2:'DEGRADED', 3:'CRITICAL' }
const HC_ITERS   = { 0:8, 1:12, 2:20, 3:20 }
const TIER_COLORS = { 1:'#14b8a6', 2:'#f59e0b', 3:'#a855f7' }

// Deterministic synthetic block data (shown when backend unavailable)
const SYNTH_BLOCKS = Array.from({length:64},(_,i)=>{
  const seed=[120,890,45,2100,310,3100,880,2900,150,420,60,3500,1100,330,0,200,
              1800,450,2700,100,1500,3000,600,1200,80,2300,350,1700,950,2600,400,3200,
              200,1400,750,2800,500,1900,650,2400,300,1600,850,2500,700,2000,550,2100,
              400,1300,900,2200,250,1700,800,2400,350,1900,600,2300,450,1500,1000,2700][i]??500
  const bad=i===5||i===11||i===31||i===51
  return{ pe_cycles:seed, health:bad?'BAD':'GOOD', error_rate:1e-8*Math.exp(seed/800),
          ecc_tier:seed<1000?1:seed<2500?2:3, pre_failure:seed>2600&&!bad }
})

function healthKey(pe, retired) {
  if (retired) return 'X'
  if (pe < 1500) return 'G'
  if (pe < 3000) return 'W'
  if (pe < 4500) return 'D'
  return 'C'
}
const HCx = { G:'#22c55e', W:'#f59e0b', D:'#f97316', C:'#ef4444', X:'#4a4a60' }
const HBGx = { G:'#052e16', W:'#3d2600', D:'#3d1200', C:'#3d0000', X:'#1a1a1a' }

function rberEst(pe) { return Math.min(1e-3, 1e-7 * Math.exp(pe / 500)) }

// ── Tier box ──────────────────────────────────────────────────────────────────
function TierBox({ num, label, desc, state, extra }) {
  const colors = { idle:'#2a2a3a', active:'#3b82f6', pass:'#22c55e', fail:'#ef4444', recover:'#a855f7' }
  const bgs    = { idle:'#12121a', active:'#0d1e2e', pass:'#051e10', fail:'#1e0505', recover:'#0d0623' }
  const ac     = [,'#14b8a6','#f59e0b','#ff6b6b'][num]||'#888'
  const sc     = colors[state]||colors.idle
  const sb     = bgs[state]||bgs.idle
  const slbl   = { idle:'IDLE', active:'ACTIVE…', pass:'PASS ✓', fail:'FAIL ✗', recover:'RECOVERED' }[state]||'IDLE'
  return (
    <div style={{
      background:sb, border:`1px solid ${sc}`, borderLeft:`4px solid ${sc}`,
      borderRadius:10, padding:'12px 16px', marginBottom:8,
      boxShadow: ['active','recover'].includes(state)?`0 0 14px ${sc}44`:'none',
      transition:'all 0.3s',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <span style={{ fontSize:10,color:ac,fontWeight:700,textTransform:'uppercase',letterSpacing:1 }}>Tier {num}</span>
          <span style={{ fontSize:13,color:'#e8e8f0',fontWeight:700,marginLeft:8 }}>{label}</span>
        </div>
        <span style={{ fontSize:11,color:sc,fontWeight:700 }}>{slbl}</span>
      </div>
      <div style={{ color:'#8888a0',fontSize:11,marginTop:4 }}>{desc}</div>
      {extra && <div style={{ marginTop:6,fontSize:11,color:'#e8e8f0',fontFamily:'var(--mono)',whiteSpace:'pre-wrap' }}>{extra}</div>}
    </div>
  )
}

// ── LDPC SVG chart ────────────────────────────────────────────────────────────
function LDPCChart({ iters, blockId, alarm }) {
  if (!iters || iters.length === 0) return (
    <div style={{ color:'var(--text-muted)',textAlign:'center',padding:'1rem',fontFamily:'var(--mono)',fontSize:'0.78rem' }}>
      Fire read requests to populate LDPC chart
    </div>
  )
  const w=360, h=140, maxY=22
  const pts = iters.map((v,i)=>`${(i/(iters.length-1||1))*w},${h-(v/maxY)*(h-20)}`)
  const lc = alarm?'#ef4444':'#3b82f6'
  const thY = h-(15/maxY)*(h-20)
  return (
    <div style={{ border:'1px solid var(--border)',borderRadius:8,padding:'0.5rem',background:'rgba(0,0,0,0.2)' }}>
      <div style={{ fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',marginBottom:4 }}>
        LDPC Iterations — Block {blockId} {alarm&&'⚠ PRE-FAILURE ZONE'}
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ overflow:'visible' }}>
        <line x1={0} y1={thY} x2={w} y2={thY} stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1}/>
        <text x={4} y={thY-3} fill="#ef4444" fontSize={9}>PRE-FAILURE THRESHOLD (15)</text>
        <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={lc} opacity={0.08}/>
        <polyline points={pts.join(' ')} fill="none" stroke={lc} strokeWidth={2.5}/>
        {iters.map((v,i)=>(
          <circle key={i} cx={(i/(iters.length-1||1))*w} cy={h-(v/maxY)*(h-20)} r={4} fill="#a855f7"/>
        ))}
      </svg>
    </div>
  )
}

// ── Parity matrix display ─────────────────────────────────────────────────────
function ParityMatrix({ H, syndrome_bits }) {
  if (!H || !H.length) return null
  return (
    <div style={{ overflowX:'auto', marginTop:8 }}>
      <div style={{ fontFamily:'var(--mono)',fontSize:10,color:'var(--text-muted)',marginBottom:4 }}>
        Parity-Check Matrix H ({H.length}×{H[0]?.length}) — GF(2)
      </div>
      <table style={{ borderCollapse:'collapse',fontSize:11 }}>
        <tbody>
          {H.map((row,ri)=>(
            <tr key={ri}>
              {row.map((v,ci)=>(
                <td key={ci} style={{
                  width:22,height:22,textAlign:'center',fontFamily:'var(--mono)',
                  fontWeight:700,border:'1px solid var(--border)',
                  background:v?'#1a1a3a':'#0a0a14',
                  color:v?'#6366f1':'#2a2a3a',
                }}>{v}</td>
              ))}
              {syndrome_bits && (
                <td style={{
                  paddingLeft:8,fontFamily:'var(--mono)',fontWeight:700,fontSize:12,
                  color:syndrome_bits[ri]===0?'#22c55e':'#ef4444',
                }}>{syndrome_bits[ri]===0?'0':'1'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {syndrome_bits && (
        <div style={{ marginTop:4,fontFamily:'var(--mono)',fontSize:11,
          color:syndrome_bits.every(s=>s===0)?'#22c55e':'#f59e0b' }}>
          Syndrome: [{syndrome_bits.join(',')}]&nbsp;
          {syndrome_bits.every(s=>s===0)?'→ H·r = 0 ZERO':'→ Errors detected'}
        </div>
      )}
    </div>
  )
}

// ── ECC Allocation table ─────────────────────────────────────────────────────
function ECCAllocationTable({ blocks, classData }) {
  if (!blocks || !classData) return null
  const sample = classData.slice(0, 12)
  return (
    <div style={{ overflowX:'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Block</th><th>P/E</th><th>Health Class</th>
            <th>ECC Strategy</th><th>Max Iters</th><th>Pre-Fail</th>
          </tr>
        </thead>
        <tbody>
          {sample.map(b => {
            const hc = b.health_class
            const c  = HC_COLORS[hc]||'#888'
            return (
              <tr key={b.block_id}>
                <td style={{ fontFamily:'var(--mono)' }}>B{b.block_id}</td>
                <td style={{ fontFamily:'var(--mono)' }}>{Math.round(b.pe_cycles)}</td>
                <td>
                  <span style={{ background:HC_BG[hc]||'#111',color:c,padding:'2px 8px',borderRadius:12,fontSize:11,fontWeight:700 }}>
                    {HC_LABELS[hc]||'?'}
                  </span>
                </td>
                <td style={{ fontSize:12,color:'var(--text-dim)' }}>
                  {['BCH only','BCH + Hard LDPC','BCH + Hard LDPC (strong)','Double-enveloped'][hc||0]}
                </td>
                <td style={{ fontFamily:'var(--mono)',color:c,fontWeight:700 }}>{HC_ITERS[hc]||8}</td>
                <td>{b.pre_failure?'⚠ YES':'-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Pillar3Page() {
  const [state,       setState]      = useState(null)
  const [classData,   setClassData]  = useState([])
  const [loading,     setLoading]    = useState(true)
  const [activeTab,   setActiveTab]  = useState('grid')
  const [selected,    setSelected]   = useState(7)

  // Decoder state
  const [errors,      setErrors]     = useState(0)
  const [preset,      setPreset]     = useState('custom')
  const [retentionDays, setRetention] = useState(30)
  const [pipeState,   setPipeState]  = useState({ t1:'idle',t2:'idle',t3:'idle',t1e:'',t2e:'',t3e:'' })
  const [decResult,   setDecResult]  = useState(null)
  const [readLog,     setReadLog]    = useState([])
  const [tierStats,   setTierStats]  = useState({ t1:0,t2:0,t3:0 })
  const [ldpcHistory, setLdpcHistory] = useState([])
  const [firing,      setFiring]     = useState(false)

  // Telemetry state
  const [blockHealth, setBlockHealth] = useState(null)
  const [aging,       setAging]      = useState(false)
  const [agingLog,    setAgingLog]   = useState([])

  // Classify result
  const [classifyResult, setClassifyResult] = useState(null)

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/state`),
      axios.get(`${API}/ecc/classify-all`),
    ]).then(([sr, cr]) => {
      setState(sr.data)
      setClassData(cr.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const blocks    = (state?.blocks?.length ? state.blocks : SYNTH_BLOCKS)
  const selBlock  = blocks[selected]
  const selClass  = classData.find(c=>c.block_id===selected)

  // Quick presets
  function getPresetErrors() {
    if (preset === 'bypass')   return 0
    if (preset === 'ml')       return 80
    return errors
  }

  async function fireRead() {
    if (!selBlock) return
    setFiring(true)
    setDecResult(null)
    setPipeState({ t1:'idle',t2:'idle',t3:'idle',t1e:'',t2e:'',t3e:'' })

    const numErrors = preset==='retired' ? 0 : getPresetErrors()
    const pe     = selBlock.pe_cycles
    const wl     = pe / 3000
    const temp   = 45

    // Show T1 active
    setPipeState(p=>({...p,t1:'active',t1e:'Computing H·r over GF(2)…'}))

    try {
      const res = await axios.post(`${API}/ecc/decode`, {
        block_id:       selected,
        pe_cycles:      pe,
        temperature:    temp,
        retention_days: retentionDays,
        wear_level:     wl,
        num_errors:     numErrors,
        codeword:       Array.from({length:16},()=>Math.round(Math.random())),
      })
      const d = res.data

      // Animate based on tier_used
      if (d.tier_used === 1) {
        setPipeState({ t1:'pass',t2:'idle',t3:'idle',
          t1e:`H·r = ${d.syndrome} → Syndrome Zero | 0 µs`,t2e:'',t3e:'' })
      } else if (d.tier_used === 2 && d.mode==='BCH') {
        setPipeState({ t1:'fail',t2:'pass',t3:'idle',
          t1e:`H·r = ${d.syndrome} → Errors detected`,
          t2e:`BCH corrected ${d.errors_corrected} bits | ${d.latency_us} µs`,t3e:'' })
      } else if (d.tier_used === 2) {
        // Animate LDPC iteration
        const ilog = d.iteration_log || []
        setPipeState(p=>({...p,t1:'fail',t1e:`H·r = ${d.syndrome} → Errors detected`}))
        for (let i=0;i<ilog.length;i++) {
          await delay(80)
          setPipeState(p=>({...p,t2:'active',t2e:`Hard LDPC Iter ${ilog[i].iter}/${d.max_iters_allowed} — violations: ${ilog[i].violations}`}))
        }
        setPipeState({ t1:'fail',t2:'pass',t3:'idle',
          t1e:`H·r = ${d.syndrome}`,
          t2e:`Hard LDPC — ${d.iterations}/${d.max_iters_allowed} iters | ${d.latency_us} µs`,
          t3e:'' })
        setLdpcHistory(h=>[...h.slice(-39),d.iterations])
      } else if (d.tier_used === 3) {
        // Animate all 3 tiers
        setPipeState(p=>({...p,t1:'fail',t1e:`H·r = ${d.syndrome}`,t2:'fail',t2e:'LDPC exhausted after '+d.max_iters_allowed+' iters'}))
        await delay(400)
        setPipeState(p=>({...p,t3:'active',t3e:'ML Decision Tree — predicting voltage offset…'}))
        await delay(600)
        setPipeState(p=>({...p,t3:'recover',t3e:`ΔV = +${d.voltage_shift_mv} mV → Soft-Decode RECOVERED | ${d.latency_us} µs`}))
        setLdpcHistory(h=>[...h.slice(-39),d.max_iters_allowed])
      }

      setDecResult(d)
      setTierStats(s=>({
        t1: s.t1+(d.tier_used===1?1:0),
        t2: s.t2+(d.tier_used===2?1:0),
        t3: s.t3+(d.tier_used===3?1:0),
      }))
      setReadLog(l=>[...l.slice(-19),{
        time: new Date().toLocaleTimeString('en-US',{hour12:false}),
        bid:selected, tier:'T'+d.tier_used,
        lat:`${d.latency_us} µs`,
        outcome:d.mode, err:numErrors,
        prefail:d.pre_failure_flag,
      }])
    } catch(e) {
      setDecResult({ error: String(e), description:'Backend error — is Flask running?' })
      setPipeState({ t1:'fail',t2:'idle',t3:'idle',t1e:'API error',t2e:'',t3e:'' })
    }
    setFiring(false)
  }

  async function fetchBlockHealth(bid) {
    try {
      const r = await axios.get(`${API}/ecc/block-health/${bid}`)
      setBlockHealth(r.data)
    } catch {}
  }

  async function classifyBlock(bid) {
    if (!selBlock) return
    const pe = selBlock.pe_cycles
    const rber = rberEst(pe)
    try {
      const r = await axios.post(`${API}/ecc/classify-block`, {
        block_id: bid,
        pe_cycles: pe,
        rber,
        ecc_correction_rate: rber*1e6,
        ldpc_avg_iterations: 1.5+(pe/3000)*18,
        temperature: 45,
        is_metadata: 0,
      })
      setClassifyResult(r.data)
      // Update class data locally
      setClassData(prev=>prev.map(x=>x.block_id===bid?{...x,health_class:r.data.health_class}:x))
    } catch {}
  }

  async function runAging() {
    if (!selBlock || selBlock.health==='BAD') return
    setAging(true); setAgingLog([])
    const pe0 = selBlock.pe_cycles
    let localIters = [...ldpcHistory], retired=false
    const steps=60
    for (let tick=0;tick<steps;tick++) {
      selBlock.pe_cycles = Math.min(5100, selBlock.pe_cycles+Math.floor(Math.random()*35+20))
      const itr = +(Math.max(1.0,2.0+tick*0.37+((Math.random()-0.5)*0.8))).toFixed(1)
      localIters=[...localIters.slice(-35),itr]
      setLdpcHistory([...localIters])
      await delay(200)
      if (itr>=15&&!retired) {
        retired=true
        const lines=[
          `AEGIS:    Pre-failure flag emitted. threshold=15 crossed at iter ${itr}.`,
          `PAYLOAD:  {block:${selected}, trigger:LDPC_THRESHOLD, event:PRE_FAILURE}`,
          `PILLAR 1: FTL copying block ${selected} → spare block ...`,
          `PILLAR 1: Relocation COMPLETE. Data safely migrated.`,
          `PILLAR 2: BBT bit ${selected%32} flipped 0 → 1 (RETIRED).`,
          `PILLAR 1: Encrypting diagnostic with AES-256-GCM ...`,
          `PILLAR 1: Shamir 3-of-5 key shares distributed.`,
          `PILLAR 4: Decision tree updated for next GC cycle.`,
          `STATUS:   UECC PREVENTED. Block ${selected} RETIRED. ✅`,
        ]
        for (const s of lines) { setAgingLog(p=>[...p,s]); await delay(400) }
        state.blocks[selected].health='BAD'
        break
      }
    }
    if (!retired) setAgingLog(['Aging simulation ended — block still operational.'])
    setAging(false)
  }

  function delay(ms) { return new Promise(r=>setTimeout(r,ms)) }

  const total = tierStats.t1+tierStats.t2+tierStats.t3
  const bbt = Array.from({length:32},(_,i)=>blocks[i]?.health==='BAD'?1:0)
  const alarm = ldpcHistory.some(x=>x>=15)

  const TABS = [
    { id:'grid',    label:'📦 NAND Block Grid' },
    { id:'decoder', label:'⚡ Live Decoder Pipeline' },
    { id:'alloc',   label:'🎯 ECC Allocation' },
    { id:'telem',   label:'📊 Telemetry & Aging' },
  ]

  return (
    <div className="page fade-in">
      <div className="page-inner">
        {/* Header */}
        <div style={{ marginBottom:'1.2rem' }}>
          <div style={{ display:'flex',alignItems:'center',gap:12,marginBottom:4 }}>
            <span style={{ fontSize:'1.8rem' }}>🛡️</span>
            <div>
              <div style={{ fontFamily:'var(--mono)',fontSize:'1.15rem',fontWeight:700 }}>
                AEGIS — Adaptive ECC & Grade-Intelligent Supervision
              </div>
              <div style={{ color:'var(--text-muted)',fontSize:'0.78rem' }}>
                Pillar 3 &nbsp;·&nbsp; 5-Step Decode Pipeline &nbsp;·&nbsp; 2 ML Models &nbsp;·&nbsp; 4 Algorithmic Engines
              </div>
            </div>
          </div>
          <div style={{ color:'var(--text-dim)',fontSize:'0.84rem',background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:8,padding:'0.7rem 1rem' }}>
            <b>Pipeline:</b> Health Classifier → <span style={{color:'#14b8a6'}}>max_iters</span> → LDPC uses it → if fail → Voltage Model predicts shift → Soft-decode → Health Monitor → PRE_FAILURE to Pillar 1
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.2rem' }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              padding:'0.6rem 1.2rem',border:'none',background:'transparent',
              color:activeTab===t.id?'#3b82f6':'var(--text-muted)',
              borderBottom:activeTab===t.id?'2px solid #3b82f6':'2px solid transparent',
              cursor:'pointer',fontFamily:'var(--font)',fontSize:'0.88rem',fontWeight:600,transition:'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {loading&&<div style={{color:'var(--text-muted)'}}>Loading state…</div>}

        {/* ── TAB 1: NAND Grid ────────────────────────────────────────────── */}
        {activeTab==='grid'&&(
          <div>
            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>📦 Physical Block Array (8×8 = 64 blocks)</div>
                <div style={{ display:'flex',flexDirection:'column',gap:4,marginBottom:12 }}>
                  {Array.from({length:8},(_,row)=>(
                    <div key={row} style={{display:'flex',gap:4}}>
                      {Array.from({length:8},(_,col)=>{
                        const bid=row*8+col,blk=blocks[bid]
                        if(!blk)return null
                        const k=healthKey(blk.pe_cycles,blk.health==='BAD')
                        const cd=classData.find(c=>c.block_id===bid)
                        const isSel=bid===selected
                        const pflag=cd?.pre_failure
                        return (
                          <div key={bid} onClick={()=>{setSelected(bid);fetchBlockHealth(bid)}}
                            style={{
                              width:46,height:46,background:HBGx[k],color:HCx[k],
                              borderRadius:5,
                              border:isSel?'2px solid #fff':pflag?'2px solid #ef4444':'2px solid transparent',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              fontFamily:'var(--mono)',fontSize:9,fontWeight:700,cursor:'pointer',
                              transition:'all 0.2s',
                              boxShadow:isSel?`0 0 12px ${HCx[k]}88`:pflag?'0 0 8px #ef444488':'none',
                            }}
                            title={`B${bid} | PE:${blk.pe_cycles} | Class:${cd?.health_label||'?'}`}
                          >
                            B{bid}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:12,flexWrap:'wrap',fontFamily:'var(--mono)',fontSize:11,marginTop:4}}>
                  {[['#22c55e','Healthy'],['#f59e0b','Worn'],['#f97316','Degraded'],['#ef4444','Critical'],['#4a4a60','Retired']].map(([c,l])=>(
                    <span key={l}><span style={{color:c}}>■</span> {l}</span>
                  ))}
                  <span style={{color:'#ef4444'}}>⚠ = pre-failure</span>
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
                {selBlock&&(
                  <div className="card glow-border fade-in">
                    <div className="title-md" style={{marginBottom:'0.8rem'}}>Block {selected} — AEGIS Profile</div>
                    {(()=>{
                      const k=healthKey(selBlock.pe_cycles,selBlock.health==='BAD')
                      const hc=selBlock.health==='BAD'?'var(--text-muted)':HCx[k]
                      const cd=classData.find(c=>c.block_id===selected)
                      return (
                        <>
                          <div style={{background:'var(--bg-card2)',border:`1px solid ${hc}44`,borderLeft:`4px solid ${hc}`,borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',marginBottom:'0.8rem'}}>
                            <table style={{width:'100%',borderCollapse:'collapse'}}>
                              {[
                                ['P/E Cycles',selBlock.pe_cycles],
                                ['Wear Level',`${(selBlock.pe_cycles/3000*100).toFixed(1)}%`],
                                ['RBER',rberEst(selBlock.pe_cycles).toExponential(2)],
                                ['Health Class',cd?`${cd.health_class} — ${cd.health_label}`:'—'],
                                ['Max LDPC Iters',cd?HC_ITERS[cd.health_class]:'—'],
                                ['Pre-Failure',cd?.pre_failure?'⚠ YES':'No'],
                                ['BBT Status',selBlock.health==='BAD'?'RETIRED (bit=1)':'Active (bit=0)'],
                              ].map(([k,v])=>(
                                <tr key={k}>
                                  <td style={{color:'var(--text-muted)',padding:'3px 0',fontSize:'0.8rem'}}>{k}</td>
                                  <td style={{color:hc,textAlign:'right',fontWeight:700,fontSize:'0.8rem'}}>{String(v)}</td>
                                </tr>
                              ))}
                            </table>
                          </div>
                          <button className="btn btn-outline btn-sm" onClick={()=>classifyBlock(selected)} style={{width:'100%'}}>
                            🤖 Run Health Classifier (Model 2)
                          </button>
                        </>
                      )
                    })()}
                  </div>
                )}
                {classifyResult&&(
                  <div className="card fade-in" style={{border:`1px solid ${HC_COLORS[classifyResult.health_class]||'#888'}44`}}>
                    <div className="title-md" style={{marginBottom:'0.6rem'}}>Model 2 — Classification Result</div>
                    {[
                      ['Health Class',classifyResult.health_label],
                      ['ECC Strategy',classifyResult.ecc_strategy],
                      ['Max LDPC Iters',classifyResult.max_iterations],
                      ['Protection',classifyResult.protection_level],
                      ['Confidence',`${(classifyResult.confidence*100).toFixed(1)}%`],
                      ['Model',classifyResult.model_used],
                      ['Recommendation',classifyResult.recommendation],
                    ].map(([k,v])=>(
                      <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:'1px solid var(--border)'}}>
                        <span style={{color:'var(--text-muted)',fontSize:'0.78rem'}}>{k}</span>
                        <span style={{color:HC_COLORS[classifyResult.health_class]||'#888',fontFamily:'var(--mono)',fontSize:'0.78rem',fontWeight:600}}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: Live Decoder Pipeline ────────────────────────────────── */}
        {!loading&&activeTab==='decoder'&&(
          <div>
            <div className="title-md" style={{marginBottom:'0.8rem'}}>⚡ Live Decoder Pipeline — Real Backend API</div>
            <div style={{ display:'grid',gridTemplateColumns:'1.5fr 1.5fr 1fr',gap:'1rem' }}>
              {/* Tiers */}
              <div>
                <div className="title-md" style={{marginBottom:'0.8rem'}}>ECC Pipeline</div>
                <TierBox num={1} label="Syndrome Zero Bypass"     desc="GF(2) parity check H·r. 0 µs if zero." state={pipeState.t1} extra={pipeState.t1e}/>
                <div style={{textAlign:'center',color:'#2a2a3a',fontSize:18,margin:'-4px 0'}}>↓</div>
                <TierBox num={2} label="BCH + Hard-Decision LDPC" desc="Normalized Min-Sum. max_iters from ML classifier." state={pipeState.t2} extra={pipeState.t2e}/>
                <div style={{textAlign:'center',color:'#2a2a3a',fontSize:18,margin:'-4px 0'}}>↓</div>
                <TierBox num={3} label="ML Soft-Decision LDPC"    desc="3.3 KB DecisionTree. Voltage-shift prediction." state={pipeState.t3} extra={pipeState.t3e}/>

                {/* Result box */}
                {decResult&&!decResult.error&&(
                  <div className="fade-in" style={{
                    background:TIER_COLORS[decResult.tier_used]+'11',
                    border:`1px solid ${TIER_COLORS[decResult.tier_used]}44`,
                    borderRadius:8,padding:'0.8rem',marginTop:8,
                    fontFamily:'var(--mono)',fontSize:'0.78rem',
                    color:TIER_COLORS[decResult.tier_used],whiteSpace:'pre-line',
                  }}>
                    <div style={{fontWeight:700,marginBottom:4}}>TIER {decResult.tier_used} — {decResult.mode}</div>
                    {decResult.description}
                    {decResult.pre_failure_flag&&(
                      <div style={{marginTop:6,color:'#ef4444',fontWeight:700}}>
                        ⚠ PRE-FAILURE FLAG → Pillar 1 FTL notified
                      </div>
                    )}
                  </div>
                )}
                {decResult?.error&&(
                  <div style={{color:'#ef4444',fontFamily:'var(--mono)',fontSize:'0.78rem',marginTop:8}}>
                    ❌ {decResult.description}
                  </div>
                )}

                {/* Syndrome matrix */}
                {decResult?.parity_matrix&&(
                  <div style={{marginTop:12}}>
                    <ParityMatrix H={decResult.parity_matrix} syndrome_bits={decResult.syndrome_bits}/>
                  </div>
                )}
              </div>

              {/* Config */}
              <div>
                <div className="title-md" style={{marginBottom:'0.8rem'}}>Request Configuration</div>
                {selBlock&&(()=>{
                  const k=healthKey(selBlock.pe_cycles,selBlock.health==='BAD')
                  const hc=HCx[k]
                  const cd=classData.find(c=>c.block_id===selected)
                  return (
                    <div style={{background:'var(--bg-card2)',border:`1px solid ${hc}44`,borderLeft:`4px solid ${hc}`,borderRadius:8,padding:'10px 14px',marginBottom:12,fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
                      <b>Block {selected}</b> · P/E: {selBlock.pe_cycles} · {cd?`Class ${cd.health_class} (${HC_ITERS[cd.health_class]} iters max)`:'—'}
                      {selBlock.health==='BAD'&&<span style={{color:'#ef4444',fontWeight:700}}> ⚠ RETIRED</span>}
                    </div>
                  )
                })()}

                <div style={{marginBottom:'0.8rem'}}>
                  <div className="metric-label" style={{marginBottom:4}}>Injected Bit Errors: {getPresetErrors()}</div>
                  <input type="range" min={0} max={150} value={errors} onChange={e=>setErrors(+e.target.value)}
                    style={{width:'100%',accentColor:'var(--accent)'}}/>
                </div>
                <div style={{marginBottom:'0.8rem'}}>
                  <div className="metric-label" style={{marginBottom:4}}>Retention Days: {retentionDays}</div>
                  <input type="range" min={0} max={365} value={retentionDays} onChange={e=>setRetention(+e.target.value)}
                    style={{width:'100%',accentColor:'#f59e0b'}}/>
                </div>
                <div style={{marginBottom:'0.8rem'}}>
                  <div className="metric-label" style={{marginBottom:4}}>Quick Preset</div>
                  <select value={preset} onChange={e=>setPreset(e.target.value)}
                    style={{width:'100%',background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'0.4rem',fontFamily:'var(--font)'}}>
                    <option value="custom">Custom (use slider)</option>
                    <option value="bypass">Moment 1 — Tier 1 Bypass (0 errors)</option>
                    <option value="ml">Moment 2 — ML Recovery (80 errors)</option>
                  </select>
                </div>

                <div style={{marginBottom:'0.8rem'}}>
                  <div className="metric-label" style={{marginBottom:4}}>Select Block</div>
                  <input type="number" min={0} max={63} value={selected}
                    onChange={e=>{setSelected(+e.target.value);fetchBlockHealth(+e.target.value)}}
                    style={{width:'100%',background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'0.4rem',fontFamily:'var(--mono)'}}/>
                </div>

                <button className="btn btn-primary" style={{width:'100%',marginBottom:'1rem'}} onClick={fireRead} disabled={firing}>
                  {firing?'⏳ Processing…':'▶ Fire Read Request → /api/ecc/decode'}
                </button>

                <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.75rem'}}>
                  <div style={{color:'#60a5fa',fontWeight:700,marginBottom:8,fontSize:'0.65rem',textTransform:'uppercase'}}>Backend Pipeline</div>
                  classify → max_iters &nbsp;→&nbsp; <span style={{color:'#14b8a6'}}>Syndrome Check</span><br/>
                  → <span style={{color:'#f59e0b'}}>BCH (≤4 errors)</span><br/>
                  → <span style={{color:'#f59e0b'}}>Hard LDPC (adaptive iters)</span><br/>
                  → <span style={{color:'#a855f7'}}>ML Voltage Shift (Tier 3)</span><br/>
                  → <span style={{color:'#ef4444'}}>Health Monitor → Pillar 1</span>
                </div>
              </div>

              {/* Session stats */}
              <div>
                <div className="title-md" style={{marginBottom:'0.8rem'}}>Session Stats</div>
                {[
                  {label:'T1 Bypass',val:total?`${((tierStats.t1/total)*100).toFixed(0)}%`:'0%'},
                  {label:'T3 Triggers',val:tierStats.t3},
                  {label:'Avg Iters',val:ldpcHistory.length?(ldpcHistory.reduce((a,b)=>a+b,0)/ldpcHistory.length).toFixed(1):'0'},
                  {label:'Pre-Fail Flags',val:readLog.filter(r=>r.prefail).length},
                ].map(m=>(
                  <div key={m.label} className="metric-tile" style={{marginBottom:'0.5rem'}}>
                    <div className="metric-label">{m.label}</div>
                    <div style={{color:'#a855f7',fontFamily:'var(--mono)',fontWeight:700,fontSize:'1.2rem'}}>{m.val}</div>
                  </div>
                ))}
                {total>0&&(
                  <div style={{marginTop:'0.8rem'}}>
                    {[{t:'T1',c:tierStats.t1,color:'#14b8a6'},{t:'T2',c:tierStats.t2,color:'#f59e0b'},{t:'T3',c:tierStats.t3,color:'#a855f7'}].map(x=>(
                      <div key={x.t} style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.3rem'}}>
                        <span style={{color:x.color,fontFamily:'var(--mono)',fontSize:'0.75rem',minWidth:24}}>{x.t}</span>
                        <div style={{flex:1,background:'var(--bg-card2)',borderRadius:3,height:8,overflow:'hidden'}}>
                          <div style={{width:`${(x.c/total)*100}%`,height:'100%',background:x.color,borderRadius:3}}/>
                        </div>
                        <span style={{color:x.color,fontSize:'0.72rem',minWidth:24}}>{x.c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Read Log */}
            {readLog.length>0&&(
              <div style={{marginTop:16,borderTop:'1px solid var(--border)',paddingTop:12}}>
                <div className="title-md" style={{marginBottom:'0.8rem'}}>📋 Live Read Log</div>
                {readLog.slice(-8).reverse().map((e,i)=>{
                  const tc=TIER_COLORS[+e.tier.slice(1)]||'#888'
                  return (
                    <div key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'5px 12px',borderRadius:6,background:'#1a1a26',fontFamily:'var(--mono)',fontSize:'0.75rem',marginBottom:3}}>
                      <span style={{color:'#4a4a60',minWidth:60}}>{e.time}</span>
                      <span style={{color:'#8888a0',minWidth:40}}>B{e.bid}</span>
                      <span style={{color:tc,fontWeight:700,minWidth:36}}>{e.tier}</span>
                      <span style={{color:'#e8e8f0',minWidth:70}}>{e.lat}</span>
                      <span style={{color:tc,minWidth:120}}>{e.outcome}</span>
                      <span style={{color:'#4a4a60'}}>{e.err} err</span>
                      {e.prefail&&<span style={{color:'#ef4444',fontWeight:700}}>⚠ PRE-FAIL</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: ECC Allocation ────────────────────────────────────────── */}
        {!loading&&activeTab==='alloc'&&(
          <div>
            <div className="title-md" style={{marginBottom:'0.5rem'}}>🎯 Context-Aware ECC Allocation — Model 2 (RandomForest)</div>
            <div style={{color:'var(--text-dim)',fontSize:'0.84rem',background:'rgba(168,85,247,0.08)',border:'1px solid rgba(168,85,247,0.2)',borderRadius:8,padding:'0.7rem 1rem',marginBottom:'1.2rem'}}>
              <b>Model 2</b> classifies each block into one of 4 health classes → determines LDPC max_iters.
              Without this model, every block wastes resources getting the same ECC strength.
            </div>
            <div className="grid-2" style={{marginBottom:'1.2rem'}}>
              {[
                {cls:0,label:'HEALTHY',strategy:'BCH only',iters:8,color:'#22c55e',desc:'Fresh blocks. Single-error BCH is sufficient.'},
                {cls:1,label:'MODERATELY_WORN',strategy:'BCH + Hard LDPC',iters:12,color:'#f59e0b',desc:'800–2000 P/E. More parity constraints needed.'},
                {cls:2,label:'HIGHLY_DEGRADED',strategy:'BCH + Hard LDPC (strong)',iters:20,color:'#f97316',desc:'PE>2000 or RBER>1e-4. Full soft-decision budget.'},
                {cls:3,label:'CRITICAL_METADATA',strategy:'Double-enveloped',iters:'20+verify',color:'#ef4444',desc:'FTL structures. BCH + LDPC + BCH verify always.'},
              ].map(c=>(
                <div key={c.cls} className="card" style={{borderLeft:`4px solid ${c.color}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
                    <span style={{background:HC_BG[c.cls],color:c.color,padding:'3px 10px',borderRadius:12,fontSize:12,fontWeight:700}}>{c.label}</span>
                    <span style={{fontFamily:'var(--mono)',fontSize:13,color:c.color,fontWeight:700}}>max={c.iters}</span>
                  </div>
                  <div style={{fontFamily:'var(--mono)',fontSize:12,color:'#a855f7',marginBottom:4}}>{c.strategy}</div>
                  <div style={{fontSize:12,color:'var(--text-dim)'}}>{c.desc}</div>
                  <div style={{marginTop:6,fontSize:11,color:'var(--text-muted)'}}>
                    Count: <b style={{color:c.color}}>{classData.filter(x=>x.health_class===c.cls).length}</b> blocks
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="title-md" style={{marginBottom:'0.8rem'}}>Block Allocation Table <span style={{color:'var(--text-muted)',fontSize:12,fontWeight:400}}>(first 12 blocks)</span></div>
              <ECCAllocationTable blocks={blocks} classData={classData}/>
            </div>
          </div>
        )}

        {/* ── TAB 4: Telemetry & Aging ─────────────────────────────────────── */}
        {!loading&&activeTab==='telem'&&(
          <div>
            <div className="title-md" style={{marginBottom:'0.8rem'}}>📊 Telemetry & Block Aging Simulation</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.5rem',marginBottom:'1rem'}}>
              {[
                {label:'T1 Bypass',val:total?`${((tierStats.t1/total)*100).toFixed(1)}%`:'0%'},
                {label:'Avg Iters',val:ldpcHistory.length?(ldpcHistory.reduce((a,b)=>a+b,0)/ldpcHistory.length).toFixed(1):'0'},
                {label:'T3 Triggers',val:tierStats.t3},
                {label:`RBER B${selected}`,val:selBlock?rberEst(selBlock.pe_cycles).toExponential(1):'—'},
              ].map(m=>(
                <div key={m.label} className="metric-tile">
                  <div className="metric-label">{m.label}</div>
                  <div style={{color:'#a855f7',fontFamily:'var(--mono)',fontWeight:700,fontSize:'1.1rem'}}>{m.val}</div>
                </div>
              ))}
            </div>
            <div className="grid-2">
              <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
                <div className="card">
                  <LDPCChart iters={ldpcHistory} blockId={selected} alarm={alarm}/>
                </div>
                {/* BBT Bitmap */}
                <div className="card">
                  <div className="title-md" style={{marginBottom:'0.5rem'}}>Pillar 2 — BBT Bitmap (32 blocks)</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:3,marginTop:6}}>
                    {bbt.map((bad,i)=>(
                      <div key={i} title={`B${i}: ${bad?'RETIRED':'OK'}`} style={{width:28,height:22,background:bad?'#2d0a0a':'#052e16',color:bad?'#ef4444':'#22c55e',borderRadius:3,fontSize:8,textAlign:'center',lineHeight:'22px',fontFamily:'var(--mono)'}}>B{i}</div>
                    ))}
                  </div>
                  <div style={{color:'#4a4a60',fontSize:11,fontFamily:'var(--mono)',marginTop:6}}>
                    RETIRED={bbt.filter(Boolean).length} / ACTIVE={32-bbt.filter(Boolean).length}
                  </div>
                </div>
                {/* API block health */}
                {blockHealth&&(
                  <div className="card fade-in">
                    <div className="title-md" style={{marginBottom:'0.8rem'}}>
                      🔬 Block {blockHealth.block_id} — API Health Report
                    </div>
                    {[
                      ['Health Class',`${blockHealth.health_class} — ${blockHealth.health_label}`],
                      ['ECC Strategy',blockHealth.ecc_strategy],
                      ['Avg LDPC Iters',blockHealth.avg_iterations],
                      ['Tier 3 Hits',blockHealth.tier3_hit_count],
                      ['ECC Corrections',blockHealth.ecc_correction_count],
                      ['Pre-Failure',blockHealth.pre_failure_flag?'⚠ YES':'No'],
                      ['FTL Notified',blockHealth.ftl_notified?'✅ YES':'No'],
                      ['Action',blockHealth.action_taken],
                    ].map(([k,v])=>(
                      <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',borderBottom:'1px solid var(--border)'}}>
                        <span style={{color:'var(--text-muted)',fontSize:'0.78rem'}}>{k}</span>
                        <span style={{color:HC_COLORS[blockHealth.health_class]||'#888',fontFamily:'var(--mono)',fontSize:'0.78rem',fontWeight:600}}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Aging simulation */}
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>🔥 Moment 3 — Block Aging Simulation</div>
                {selBlock&&(()=>{
                  const k=healthKey(selBlock.pe_cycles,selBlock.health==='BAD')
                  const hc=HCx[k]
                  return (
                    <>
                      <div style={{background:'var(--bg-card2)',border:`1px solid ${hc}44`,borderLeft:`4px solid ${hc}`,borderRadius:8,padding:'10px 12px',fontFamily:'var(--mono)',fontSize:'0.8rem',marginBottom:12}}>
                        Block <b>{selected}</b> · P/E: {selBlock.pe_cycles}<br/>
                        Health: <span style={{color:hc,fontWeight:700}}>{k==='X'?'RETIRED':k==='G'?'HEALTHY':k==='W'?'WORN':k==='D'?'DEGRADED':'CRITICAL'}</span>
                      </div>
                      {selBlock.health==='BAD'?(
                        <div style={{background:'#1e0505',border:'1px solid #ef444444',borderRadius:8,padding:'0.8rem'}}>
                          <b style={{color:'#ef4444'}}>Block {selected} already RETIRED.</b><br/>
                          Select another block from the NAND Grid tab.
                        </div>
                      ):(
                        <>
                          <button className="btn btn-primary" style={{width:'100%',marginBottom:'0.8rem'}} onClick={runAging} disabled={aging}>
                            {aging?'⏳ Aging…':`▶ Age Block ${selected} Until Retirement`}
                          </button>
                          <div style={{color:'var(--text-muted)',fontSize:'0.78rem',fontFamily:'var(--mono)',marginBottom:'0.8rem'}}>
                            Simulates progressive wear. At LDPC iter 15 the AEGIS cascade fires — data relocated, block retired, Pillar 1 notified via AES-encrypted event.
                          </div>
                          {agingLog.length>0&&(
                            <div style={{background:'#0a0a0f',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.75rem',maxHeight:260,overflowY:'auto'}}>
                              {agingLog.map((line,i)=>{
                                const color=line.includes('STATUS')||line.includes('COMPLETE')?'#22c55e':line.includes('PILLAR')||line.includes('AEGIS')?'#14b8a6':line.includes('PAYLOAD')?'#a855f7':'#e8e8f0'
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
