import { useState, useEffect } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

// ── Health helpers ────────────────────────────────────────────────────────────
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
const HEALTH_COLORS = {
  G: { text: '#22c55e', bg: '#052e16' },
  W: { text: '#f59e0b', bg: '#3d2600' },
  D: { text: '#f97316', bg: '#3d1200' },
  C: { text: '#ef4444', bg: '#3d0000' },
  X: { text: '#4a4a60', bg: '#1a1a1a' },
}
const HEALTH_TEXT_COLORS = {
  healthy:'#22c55e', worn:'#f59e0b', degraded:'#f97316', critical:'#ef4444', RETIRED:'#4a4a60'
}

function rberEst(pe) {
  return Math.min(1e-3, 1e-7 * Math.pow(1.05, pe / 100))
}

// ── NAND Block Grid ────────────────────────────────────────────────────────────
function NANDGrid({ blocks, selected, onSelect }) {
  return (
    <div>
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {Array.from({length:8}, (_,row) => (
          <div key={row} style={{ display:'flex', gap:4 }}>
            {Array.from({length:8}, (_,col) => {
              const bid = row*8+col
              const blk = blocks[bid]
              if (!blk) return null
              const key = healthKey(blk.pe_cycles, blk.health==='BAD')
              const { text, bg } = HEALTH_COLORS[key]
              const isSel = bid === selected
              return (
                <div key={bid} onClick={() => onSelect(bid)}
                  title={`Block ${bid} | PE:${blk.pe_cycles} | ${blk.health}`}
                  style={{
                    width:46, height:46, background:bg, color:text,
                    borderRadius:5, border: isSel ? '2px solid #fff' : '2px solid transparent',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontFamily:'var(--mono)', fontSize:9, fontWeight:700,
                    cursor:'pointer', transition:'all 0.2s',
                    boxShadow: isSel ? `0 0 12px ${text}88` : 'none',
                  }}>
                  B{bid}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontFamily:'var(--mono)', fontSize:11, marginTop:10 }}>
        {[['#22c55e','Healthy (0–1500)'],['#f59e0b','Worn (1500–3000)'],['#f97316','Degraded (3000–4500)'],['#ef4444','Critical (>4500)'],['#4a4a60','Retired']].map(([c,l])=>(
          <span key={l}><span style={{ color:c }}>■</span> {l}</span>
        ))}
      </div>
    </div>
  )
}

// ── BBT Bitmap (32 blocks) ────────────────────────────────────────────────────
function BBTBitmap({ blocks }) {
  const bbt = blocks.slice(0,32).map(b => b.health==='BAD')
  const retired = bbt.filter(Boolean).length
  return (
    <div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:6 }}>
        {bbt.map((bad,i) => (
          <div key={i} title={`B${i}: ${bad?'RETIRED':'OK'}`} style={{
            width:28, height:22, background: bad?'#2d0a0a':'#052e16',
            color: bad?'#ef4444':'#22c55e',
            borderRadius:3, fontSize:8, textAlign:'center', lineHeight:'22px',
            fontFamily:'var(--mono)',
          }}>B{i}</div>
        ))}
      </div>
      <div style={{ color:'#4a4a60', fontSize:11, fontFamily:'var(--mono)', marginTop:6 }}>
        RETIRED={retired} / ACTIVE={32-retired}
      </div>
    </div>
  )
}

export default function Pillar2Page() {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(7)
  const [showSignals, setShowSignals] = useState(false)

  useEffect(() => {
    axios.get(`${API}/state`).then(r => { setState(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const blocks = state?.blocks || []
  const healthy  = blocks.filter(b=>!['BAD'].includes(b.health)&&b.pe_cycles<1500).length
  const worn     = blocks.filter(b=>!['BAD'].includes(b.health)&&b.pe_cycles>=1500&&b.pe_cycles<3000).length
  const degraded = blocks.filter(b=>!['BAD'].includes(b.health)&&b.pe_cycles>=3000&&b.pe_cycles<4500).length
  const critical = blocks.filter(b=>!['BAD'].includes(b.health)&&b.pe_cycles>=4500).length
  const retired  = blocks.filter(b=>b.health==='BAD').length
  const selBlock = blocks[selected]

  return (
    <div className="page fade-in">
      <div className="page-inner">
        <div style={{ marginBottom:'1.2rem' }}>
          <div className="badge badge-cyan" style={{ marginBottom:'0.4rem' }}>Pillar 2</div>
          <h1 className="title-lg">🗃️ NAND Block Management</h1>
          <div style={{ color:'var(--text-dim)', fontSize:'0.85rem', background:'rgba(6,182,212,0.08)', border:'1px solid rgba(6,182,212,0.2)', borderRadius:8, padding:'0.7rem 1rem', marginTop:'0.7rem' }}>
            ⚡ <b>Pillar 2</b> manages every physical NAND block.
            Reports bad block events and wear counts <b>UP</b> to Pillar 1,
            and receives early retirement commands <b>DOWN</b> from Pillar 1's LSTM.
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'0.6rem', marginBottom:'1.2rem' }}>
          {[
            { label:'Healthy',  val:healthy,  color:'#22c55e' },
            { label:'Worn',     val:worn,     color:'#f59e0b' },
            { label:'Degraded', val:degraded, color:'#f97316' },
            { label:'Critical', val:critical, color:'#ef4444' },
            { label:'Retired',  val:retired,  color:'#4a4a60' },
            { label:'Active',   val:64-retired, color:'var(--accent)' },
          ].map(m => (
            <div key={m.label} className="metric-tile">
              <div className="metric-label">{m.label}</div>
              <div className="metric-value" style={{ color:m.color, fontSize:'1.6rem' }}>{m.val}</div>
            </div>
          ))}
        </div>

        <div className="grid-2">
          {/* NAND Grid + BBT Bitmap */}
          <div>
            <div className="card" style={{ marginBottom:'1rem' }}>
              <div className="title-md" style={{ marginBottom:'0.8rem' }}>📦 NAND Physical Block Array (8×8 = 64 blocks)</div>
              <div style={{ color:'var(--text-muted)', fontSize:'0.78rem', marginBottom:10 }}>
                Select any block to inspect. Colors update as blocks accumulate P/E cycles.
              </div>
              {loading ? <div style={{color:'var(--text-muted)'}}>Loading…</div> : (
                <NANDGrid blocks={blocks} selected={selected} onSelect={setSelected} />
              )}
            </div>

            {/* BBT Bitmap */}
            <div className="card">
              <div className="title-md" style={{ marginBottom:'0.5rem' }}>Pillar 2 — BBT Bitmap (32 blocks)</div>
              <BBTBitmap blocks={blocks} />
            </div>
          </div>

          {/* Block inspector + Stats */}
          <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
            {/* Block inspector */}
            {selBlock && (
              <div className="card glow-border fade-in">
                <div className="title-md" style={{ marginBottom:'0.8rem' }}>Selected Block Stats</div>
                {(() => {
                  const hlbl = healthLabel(selBlock.pe_cycles, selBlock.health==='BAD')
                  const hc = HEALTH_TEXT_COLORS[hlbl] || '#888'
                  const wear = (selBlock.pe_cycles/5000*100).toFixed(1)
                  const rber = rberEst(selBlock.pe_cycles)
                  return (
                    <div style={{ background:'var(--bg-card2)', border:`1px solid ${hc}44`, borderLeft:`4px solid ${hc}`, borderRadius:8, padding:'1rem', fontFamily:'var(--mono)' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse' }}>
                        {[
                          ['Block ID', selected],
                          ['P/E Cycles', `${selBlock.pe_cycles} / 5000`],
                          ['Wear Level', `${wear}%`],
                          ['RBER Estimate', rber.toExponential(2)],
                          ['ECC Tier', `Tier ${selBlock.ecc_tier}`],
                          ['Health Status', hlbl.toUpperCase()],
                          ['BBT Status', selBlock.health==='BAD'?'RETIRED (bit=1)':'Active (bit=0)'],
                          ['Bloom Filter', selBlock.health==='BAD'?'EXCLUDED':'INCLUDED'],
                        ].map(([k,v])=>(
                          <tr key={k}>
                            <td style={{ color:'var(--text-muted)', padding:'4px 0', fontSize:'0.82rem' }}>{k}</td>
                            <td style={{ color:hc, textAlign:'right', fontWeight:700, fontSize:'0.82rem' }}>{v}</td>
                          </tr>
                        ))}
                      </table>
                    </div>
                  )
                })()}
              </div>
            )}

            {/* Data structures */}
            <div className="card">
              <div className="title-md" style={{ marginBottom:'0.8rem' }}>BBT Data Structures</div>
              {[
                { name:'Bloom Filter', desc:'Probabilistic filter — sub-microsecond bad block pre-check (O(1))', icon:'🔵', color:'#06b6d4' },
                { name:'Bitmap',       desc:'Definitive O(1) lookup — 1=GOOD, 0=BAD per block',               icon:'⬛', color:'#6366f1' },
                { name:'Cuckoo Hash',  desc:'Rich metadata: P/E counts, failure reason, ECC history per block', icon:'🗂️', color:'#8b5cf6' },
              ].map(ds => (
                <div key={ds.name} className="tier-row" style={{ borderLeft:`4px solid ${ds.color}`, marginBottom:'0.5rem' }}>
                  <span style={{ fontSize:'1.2rem' }}>{ds.icon}</span>
                  <div>
                    <div style={{ fontWeight:600, color:ds.color, fontSize:'0.9rem' }}>{ds.name}</div>
                    <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{ds.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Signals to Pillar 1 */}
            <div className="card">
              <div className="title-md" style={{ marginBottom:'0.8rem' }}>📡 Signals Sent to Pillar 1 (live)</div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>SMART Metric Updated</th>
                    <th>Effect in Pillar 1</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Block marked bad',       '③ Bad block count +1',         'LSTM re-runs, health score drops'],
                    ['Block retired (wear)',    '④ P/E avg, ⑩ Realloc count',  'RUL recalculated'],
                    ['Write remapped',         '⑨ Retry freq +1',              'Anomaly detector checks baseline'],
                  ].map(([ev,sm,eff])=>(
                    <tr key={ev}>
                      <td style={{ color:'var(--accent)' }}>{ev}</td>
                      <td style={{ color:'var(--accent3)', fontFamily:'var(--mono)', fontSize:'0.78rem' }}>{sm}</td>
                      <td>{eff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
