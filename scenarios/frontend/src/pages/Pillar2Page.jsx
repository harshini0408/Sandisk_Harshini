import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
const API = 'http://localhost:5000/api'

// ─── Shared helpers ────────────────────────────────────────────────────────────
const HC = { G:'#22c55e', W:'#f59e0b', D:'#f97316', C:'#ef4444', X:'#4a4a60' }
const HB = { G:'#052e16', W:'#3d2600', D:'#3d1200', C:'#3d0000', X:'#1a1a1a' }
function hKey(pe,bad){ if(bad)return'X'; if(pe<1500)return'G'; if(pe<3000)return'W'; if(pe<4500)return'D'; return'C' }

// ─── 16-block pedagogical SSD model ───────────────────────────────────────────
const INIT_BLOCKS = Array.from({length:16},(_,i)=>({
  id:i,
  erase_count:[0,120,45,310,880,0,270,2900,150,420,60,0,1100,330,0,200][i],
  bad: i===5||i===11,
  bad_reason: i===5?'factory':(i===11?'factory':null),
  retired_wear: false,
}))
const SPARE_BLOCKS = [13,14,15]
const WEAR_THRESHOLD = 3000

function simBloom(bid){ return bid===5||bid===11 }
function bloomCheck(bid){ return simBloom(bid)?'maybe_bad':'definitely_good' }

// ─── Step log entry ───────────────────────────────────────────────────────────
function LogEntry({step}){
  const colors={info:'#8888a0',pass:'#22c55e',warn:'#f59e0b',fail:'#ef4444',action:'#a855f7',remap:'#14b8a6',sys:'#3b82f6'}
  return(
    <div style={{display:'flex',gap:8,marginBottom:5,fontFamily:'var(--mono)',fontSize:'0.76rem',alignItems:'flex-start'}}>
      <span style={{color:'#333',minWidth:20}}>{step.i}.</span>
      <span style={{color:colors[step.t]||'#aaa',flex:1,whiteSpace:'pre-wrap'}}>{step.msg}</span>
    </div>
  )
}

// ─── Bitmap 16-block display ──────────────────────────────────────────────────
function Bitmap16({blocks,highlight}){
  return(
    <div>
      <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',marginBottom:4}}>Bitmap (0=BAD, 1=GOOD):</div>
      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
        {blocks.map((b,i)=>{
          const bad=b.bad||b.retired_wear
          return(
            <div key={i} style={{
              width:40,height:36,background:bad?'#2d0a0a':'#052e16',
              color:bad?'#ef4444':'#22c55e',
              border:highlight===i?'2px solid #fff':'2px solid transparent',
              borderRadius:5,display:'flex',flexDirection:'column',alignItems:'center',
              justifyContent:'center',fontFamily:'var(--mono)',fontSize:9,fontWeight:700,
              boxShadow:highlight===i?'0 0 10px #fff8':''
            }}>
              <div style={{fontSize:8,color:'#555'}}>B{i}</div>
              <div style={{fontSize:12}}>{bad?'0':'1'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Metadata table display ───────────────────────────────────────────────────
function MetaTable({blocks}){
  const bad=blocks.filter(b=>b.bad||b.retired_wear)
  if(!bad.length) return <div style={{color:'var(--text-muted)',fontSize:12}}>No bad blocks recorded.</div>
  return(
    <table className="data-table" style={{fontSize:12}}>
      <thead><tr><th>Block</th><th>Reason</th><th>Erase Count</th><th>Status</th></tr></thead>
      <tbody>
        {bad.map(b=>(
          <tr key={b.id}>
            <td style={{fontFamily:'var(--mono)',color:'#ef4444'}}>B{b.id}</td>
            <td style={{color:'#f59e0b'}}>{b.retired_wear?'wear_threshold':b.bad_reason||'runtime_failure'}</td>
            <td style={{fontFamily:'var(--mono)'}}>{b.erase_count}</td>
            <td><span style={{background:'#2d0a0a',color:'#ef4444',padding:'2px 8px',borderRadius:10,fontSize:11}}>RETIRED</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Bloom filter display ──────────────────────────────────────────────────────
function BloomDisplay({blocks}){
  const bad=blocks.filter(b=>b.bad||b.retired_wear).map(b=>b.id)
  const bits=Array(16).fill(0)
  bad.forEach(id=>{ bits[id%13]=1; bits[(id*3+7)%16]=1; bits[(id*7+2)%16]=1 })
  return(
    <div>
      <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',marginBottom:4}}>Bloom Filter bits (3 hash functions on bad block IDs):</div>
      <div style={{display:'flex',gap:3}}>
        {bits.map((b,i)=>(
          <div key={i} style={{width:24,height:24,background:b?'rgba(99,102,241,0.5)':'var(--bg-card2)',
            border:'1px solid var(--border)',borderRadius:3,display:'flex',alignItems:'center',justifyContent:'center',
            fontFamily:'var(--mono)',fontSize:9,color:b?'#a5b4fc':'#333',fontWeight:700}}>
            {b?'1':'0'}
          </div>
        ))}
      </div>
      <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--text-muted)',marginTop:4}}>
        Bad blocks in filter: {bad.map(id=>`B${id}`).join(', ')||'none'}
      </div>
    </div>
  )
}

// ─── Cuckoo Hash visualization ────────────────────────────────────────────────
function CuckooHashViz({blocks}){
  const BAD_BLOCKS = blocks.filter(b=>b.bad||b.retired_wear)
  const T1=Array(8).fill(null), T2=Array(8).fill(null)
  BAD_BLOCKS.forEach(b=>{
    const h1=b.id%8, h2=(b.id*3+5)%8
    if(!T1[h1]) T1[h1]=b
    else if(!T2[h2]) T2[h2]=b
    else T2[h2]=b // evict (simplified)
  })
  return(
    <div>
      <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text-muted)',marginBottom:8}}>
        Cuckoo Hash — 2 tables × 8 buckets. Hash1(id)=id%8 &nbsp;|&nbsp; Hash2(id)=(id×3+5)%8
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
        {[['Table 1 (h1)',T1],['Table 2 (h2)',T2]].map(([label,tbl])=>(
          <div key={label}>
            <div style={{fontFamily:'var(--mono)',fontSize:11,color:'#a855f7',marginBottom:4}}>{label}</div>
            {tbl.map((cell,i)=>(
              <div key={i} style={{
                display:'flex',gap:6,alignItems:'center',marginBottom:3,padding:'3px 8px',
                background:cell?'#1a0a2e':'var(--bg-card2)',borderRadius:5,
                border:`1px solid ${cell?'#a855f744':'var(--border)'}`,
              }}>
                <span style={{color:'#555',fontFamily:'var(--mono)',fontSize:10,minWidth:18}}>[{i}]</span>
                {cell?(
                  <span style={{color:'#a855f7',fontFamily:'var(--mono)',fontSize:11,fontWeight:700}}>
                    B{cell.id} — {cell.retired_wear?'wear':cell.bad_reason}
                  </span>
                ):<span style={{color:'#333',fontSize:11}}>empty</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{marginTop:8,fontSize:12,color:'var(--text-dim)',background:'rgba(168,85,247,0.08)',
        border:'1px solid rgba(168,85,247,0.2)',borderRadius:8,padding:'0.6rem'}}>
        <b>Why Cuckoo?</b> O(1) worst-case lookup. If slot taken, "kicks" existing entry to its alternate table — guaranteed placement.
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 1 — Boot Phase
// ════════════════════════════════════════════════════════════════════════════════
function BootPhase({simBlocks,setSimBlocks}){
  const [log,setLog]=useState([])
  const [running,setRunning]=useState(false)
  const [done,setDone]=useState(false)

  function delay(ms){return new Promise(r=>setTimeout(r,ms))}

  async function runBoot(){
    setRunning(true); setLog([]); setDone(false)
    const add=(msg,t='info')=>setLog(l=>[...l,{i:l.length+1,msg,t}])

    add('📀 Reading BBT from NAND Flash (Block 0, reserved region)…','sys')
    await delay(600)
    add('✅ CRC-32 check PASSED — BBT is valid and unmodified.','pass')
    await delay(500)
    add('🗺️  Parsing BBT entries…','sys')
    await delay(400)
    add('   → Factory bad block detected: Block 5','warn')
    await delay(300)
    add('   → Factory bad block detected: Block 11','warn')
    await delay(500)
    add('📋 Building Bitmap: 1=GOOD, 0=BAD for all 16 blocks','sys')
    await delay(400)
    add('   Bitmap[5]  ← 0  (factory bad)','fail')
    add('   Bitmap[11] ← 0  (factory bad)','fail')
    add('   Bitmap[0..4, 6..10, 12..15] ← 1  (good)','pass')
    await delay(500)
    add('🗂️  Initializing Metadata Table (Cuckoo Hash)…','sys')
    await delay(400)
    add('   Insert B5  → Table1[5%8=5]  {"reason":"factory","erase_count":0}','action')
    await delay(200)
    add('   Insert B11 → Table2[(11×3+5)%8=6]  {"reason":"factory","erase_count":0}','action')
    await delay(500)
    add('🔵 Building Bloom Filter (3 hash functions)…','sys')
    await delay(400)
    add('   h1(5)=5, h2(5×3+7%16)=6, h3(5×7+2%16)=5 → bits set','action')
    await delay(200)
    add('   h1(11)=11, h2((11×3+7)%16)=10, h3((11×7+2)%16)=13 → bits set','action')
    await delay(400)
    add('✅ Boot complete. All 3 BBT structures ready in < 2ms.','pass')
    await delay(200)
    add('   Bloom Filter: O(1) pre-check     — 16-bit array, 3 hash fns','info')
    add('   Bitmap:       O(1) definitive    — 16 bits, one per block','info')
    add('   Cuckoo Hash:  O(1) rich metadata — failure reason, erase count','info')
    setDone(true); setRunning(false)
  }
  return(
    <div>
      <div style={{color:'var(--text-dim)',fontSize:'0.84rem',marginBottom:'0.8rem'}}>
        Simulates SSD power-on: reading the BBT from NAND, CRC validation, and building all 3 in-memory structures.
      </div>
      <button className="btn btn-primary" onClick={runBoot} disabled={running} style={{marginBottom:'1rem'}}>
        {running?'⏳ Booting…':'▶ Run Boot Phase'}
      </button>
      {log.length>0&&(
        <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',marginBottom:'1rem',maxHeight:240,overflowY:'auto'}}>
          {log.map((s,i)=><LogEntry key={i} step={s}/>)}
        </div>
      )}
      {done&&(
        <div className="fade-in" style={{display:'flex',flexDirection:'column',gap:'0.8rem'}}>
          <div className="card"><Bitmap16 blocks={simBlocks}/></div>
          <div className="card"><MetaTable blocks={simBlocks}/></div>
          <div className="card"><BloomDisplay blocks={simBlocks}/></div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 2 — Write Operation Simulation
// ════════════════════════════════════════════════════════════════════════════════
const WRITE_CASES=[
  {bid:3,label:'Write → Block 3 (known good)',  expect:'good'},
  {bid:5,label:'Write → Block 5 (factory bad)', expect:'bad'},
  {bid:9,label:'Write → Block 9 (good, runtime)',expect:'good'},
]

function WriteOps({simBlocks,setSimBlocks}){
  const [caseIdx,setCaseIdx]=useState(0)
  const [log,setLog]=useState([])
  const [running,setRunning]=useState(false)
  const [highlight,setHighlight]=useState(null)

  function delay(ms){return new Promise(r=>setTimeout(r,ms))}

  async function runCase(idx){
    const c=WRITE_CASES[idx]; if(!c)return
    setRunning(true); setLog([]); setHighlight(null)
    const add=(msg,t='info')=>setLog(l=>[...l,{i:l.length+1,msg,t}])
    const blk=simBlocks[c.bid]
    const isBad=blk.bad||blk.retired_wear

    add(`📝 Write Request → Block ${c.bid}`,'sys')
    await delay(400)
    add(`━━ TIER 1: Bloom Filter check ━━`,'info')
    const bloom=bloomCheck(c.bid)
    await delay(500)
    if(bloom==='definitely_good'){
      add(`   h1,h2,h3 all return 0 → DEFINITELY GOOD (fast path) ✅`,'pass')
      await delay(400)
      add(`   ⚡ Fast path! No need for Tier 2 or Tier 3 lookup.`,'pass')
      add(`🟢 FTL Decision: USE Block ${c.bid} directly. Write proceeds.`,'pass')
      setHighlight(c.bid); setRunning(false); return
    }
    add(`   Bloom bit hit → MAYBE BAD (could be false positive)`,'warn')
    await delay(500)
    add(`━━ TIER 2: Bitmap check ━━`,'info')
    await delay(400)
    add(`   Bitmap[${c.bid}] = ${isBad?'0 (BAD)':'1 (GOOD)'}`, isBad?'fail':'pass')
    await delay(400)
    if(!isBad){
      add(`   → Bloom false positive confirmed! Block is actually GOOD.`,'pass')
      add(`🟢 FTL Decision: USE Block ${c.bid}. (Bloom was wrong, Bitmap is truth)`,'pass')
      setHighlight(c.bid); setRunning(false); return
    }
    add(`   Bitmap confirms BAD.`,'fail')
    await delay(500)
    add(`━━ TIER 3: Metadata lookup ━━`,'info')
    await delay(400)
    add(`   CuckooHash.get(${c.bid}) → {"reason":"${blk.bad_reason||'runtime'}","erase_count":${blk.erase_count}}`,'action')
    await delay(400)
    const spare=SPARE_BLOCKS.find(s=>!simBlocks[s].bad&&!simBlocks[s].retired_wear)
    add(`🔴 FTL Decision: REMAP → Block ${spare} (next free spare)`,'remap')
    await delay(300)
    add(`   Updating FTL mapping table: LBA → PBA${spare}`,'action')
    add(`   Block ${c.bid} is ${isBad?'factory-bad':'bad'} and will not be used.`,'warn')
    setHighlight(c.bid); setRunning(false)
  }

  return(
    <div>
      <div style={{color:'var(--text-dim)',fontSize:'0.84rem',marginBottom:'0.8rem'}}>
        Step-by-step 3-tier lookup for each write request. Watch the fast path vs slow path.
      </div>
      <div style={{display:'flex',gap:8,marginBottom:'1rem',flexWrap:'wrap'}}>
        {WRITE_CASES.map((c,i)=>(
          <button key={i} className={`btn ${caseIdx===i?'btn-primary':'btn-outline'}`}
            onClick={()=>{setCaseIdx(i);setLog([]);setHighlight(null)}}>
            Case {i+1}: B{c.bid}
          </button>
        ))}
      </div>
      <div style={{background:'rgba(59,130,246,0.08)',border:'1px solid rgba(59,130,246,0.2)',borderRadius:8,padding:'0.6rem 1rem',marginBottom:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
        {WRITE_CASES[caseIdx]?.label}
      </div>
      <button className="btn btn-primary" onClick={()=>runCase(caseIdx)} disabled={running} style={{marginBottom:'1rem'}}>
        {running?'⏳ Running…':'▶ Run This Case'}
      </button>
      {log.length>0&&(
        <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',marginBottom:'1rem',maxHeight:260,overflowY:'auto'}}>
          {log.map((s,i)=><LogEntry key={i} step={s}/>)}
        </div>
      )}
      {simBlocks.length>0&&<div className="card" style={{marginTop:8}}><Bitmap16 blocks={simBlocks} highlight={highlight}/></div>}
      <div style={{marginTop:'1rem',padding:'0.8rem',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:8,fontSize:'0.82rem'}}>
        <b style={{color:'#22c55e'}}>⚡ Fast path</b><span style={{color:'var(--text-dim)'}}> (good block): Bloom=0 → done in 1 lookup. No bitmap/metadata needed.</span><br/>
        <b style={{color:'#ef4444'}}>🐌 Slow path</b><span style={{color:'var(--text-dim)'}}> (bad block): Bloom=1 → Bitmap=0 → Metadata → FTL remap.</span>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 3 — Runtime Failure
// ════════════════════════════════════════════════════════════════════════════════
function RuntimeFailure({simBlocks,setSimBlocks}){
  const [log,setLog]=useState([])
  const [running,setRunning]=useState(false)
  const [failBid,setFailBid]=useState(9)
  const [done,setDone]=useState(false)

  function delay(ms){return new Promise(r=>setTimeout(r,ms))}

  async function runFailure(){
    setRunning(true); setLog([]); setDone(false)
    const add=(msg,t='info')=>setLog(l=>[...l,{i:l.length+1,msg,t}])
    const blk=simBlocks[failBid]

    add(`⚡ Write operation issued to Block ${failBid}…`,'sys')
    await delay(500)
    add(`❌ ERASE FAIL DETECTED on Block ${failBid}! Hardware returned error code 0x4F.`,'fail')
    await delay(500)
    add(`━━ Phase A: Detection ━━`,'info')
    add(`   Controller timeout after 2ms. Expected erase to all-1s, got partial.`,'warn')
    await delay(400)
    add(`━━ Phase B: Update all BBT structures ━━`,'info')
    await delay(300)
    add(`   1. Bitmap[${failBid}] ← 0  (mark as BAD)`,'action')
    await delay(300)
    add(`   2. Metadata.insert(${failBid}, {reason:"runtime_erase_fail", erase_count:${blk.erase_count}})`,'action')
    await delay(300)
    add(`   3. BloomFilter.set(h1(${failBid}), h2(${failBid}), h3(${failBid})) ← 1`,'action')
    await delay(400)
    add(`━━ Phase C: NAND Persistence ━━`,'info')
    await delay(300)
    add(`   Serializing BBT to NAND reserved region at Block 0…`,'sys')
    await delay(400)
    add(`   CRC-32 computed and appended.`,'sys')
    add(`   ✅ BBT written to NAND. Survives power loss.`,'pass')
    await delay(400)
    add(`━━ Phase D: Data Recovery ━━`,'info')
    const spare=SPARE_BLOCKS.find(s=>!simBlocks[s].bad&&!simBlocks[s].retired_wear&&s!==failBid)
    add(`   FTL remaps LBA → spare Block ${spare}. Data re-programmed.`,'remap')
    add(`   ✅ ZERO DATA LOSS. Block ${failBid} retired permanently.`,'pass')

    setSimBlocks(prev=>{
      const next=[...prev.map(b=>({...b}))]
      next[failBid].bad=true
      next[failBid].bad_reason='runtime_erase_fail'
      return next
    })
    setDone(true); setRunning(false)
  }

  return(
    <div>
      <div style={{color:'var(--text-dim)',fontSize:'0.84rem',marginBottom:'0.8rem'}}>
        Simulates a block failing at runtime during an erase. Demonstrates how the firmware detects, logs, and recovers with zero data loss.
      </div>
      <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:'1rem'}}>
        <span style={{color:'var(--text-muted)',fontSize:'0.85rem'}}>Fail block:</span>
        <select value={failBid} onChange={e=>setFailBid(+e.target.value)}
          style={{background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:6,padding:'4px 8px',fontFamily:'var(--mono)'}}>
          {simBlocks.filter(b=>!b.bad&&!b.retired_wear&&b.id!==0).map(b=>(
            <option key={b.id} value={b.id}>Block {b.id} (erase_count={b.erase_count})</option>
          ))}
        </select>
        <button className="btn btn-danger" onClick={runFailure} disabled={running}>
          {running?'⏳ Failing…':'💥 Inject Failure'}
        </button>
      </div>
      {log.length>0&&(
        <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',marginBottom:'1rem',maxHeight:260,overflowY:'auto'}}>
          {log.map((s,i)=><LogEntry key={i} step={s}/>)}
        </div>
      )}
      {done&&(
        <div className="fade-in" style={{display:'flex',flexDirection:'column',gap:'0.8rem'}}>
          <div className="card"><Bitmap16 blocks={simBlocks} highlight={failBid}/></div>
          <div className="card"><MetaTable blocks={simBlocks}/></div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 4 — Wear Monitoring
// ════════════════════════════════════════════════════════════════════════════════
function WearMonitor({simBlocks,setSimBlocks}){
  const [log,setLog]=useState([])
  const [running,setRunning]=useState(false)
  const [done,setDone]=useState(false)
  const wornBlk=simBlocks.find(b=>b.erase_count>=2500&&!b.bad&&!b.retired_wear)

  function delay(ms){return new Promise(r=>setTimeout(r,ms))}

  async function runWear(){
    if(!wornBlk){return}
    setRunning(true); setLog([]); setDone(false)
    const add=(msg,t='info')=>setLog(l=>[...l,{i:l.length+1,msg,t}])
    const bid=wornBlk.id

    add(`📊 Wear Monitor tick — checking all block erase counts…`,'sys')
    await delay(500)
    add(`   Block ${bid}: erase_count = ${wornBlk.erase_count}  (threshold = ${WEAR_THRESHOLD})`,'warn')
    await delay(400)
    add(`⚠️  Block ${bid} is at ${((wornBlk.erase_count/WEAR_THRESHOLD)*100).toFixed(0)}% of rated endurance!`,'warn')
    await delay(400)
    add(`━━ Proactive Retirement Decision ━━`,'info')
    await delay(300)
    add(`   Pillar 1 LSTM: RUL estimated < 50 writes. Retirement triggered.`,'action')
    await delay(400)
    add(`━━ Data Migration ━━`,'info')
    const spare=SPARE_BLOCKS.find(s=>!simBlocks[s].bad&&!simBlocks[s].retired_wear&&s!==bid)
    add(`   Copying all valid data from Block ${bid} → Spare Block ${spare}…`,'remap')
    await delay(500)
    add(`   FTL remapping complete. LBA range now points to Block ${spare}.`,'remap')
    await delay(400)
    add(`━━ Retiring Block ${bid} ━━`,'info')
    await delay(300)
    add(`   Bitmap[${bid}] ← 0`,'action')
    add(`   Metadata.insert(${bid}, {reason:"wear_threshold", erase_count:${wornBlk.erase_count}})`,'action')
    add(`   Bloom filter bits set for Block ${bid}`,'action')
    await delay(400)
    add(`   BBT persisted to NAND with updated CRC.`,'sys')
    await delay(300)
    add(`✅ Proactive retirement complete. ZERO data loss. No UECC occurred.`,'pass')
    add(`   → This is WHY Pillar 1 sends commands DOWN to Pillar 2 before failure.`,'pass')

    setSimBlocks(prev=>{
      const next=[...prev.map(b=>({...b}))]
      next[bid].retired_wear=true
      return next
    })
    setDone(true); setRunning(false)
  }

  return(
    <div>
      <div style={{color:'var(--text-dim)',fontSize:'0.84rem',marginBottom:'0.8rem'}}>
        Pillar 1 LSTM detects a block approaching its rated endurance. Proactive retirement with data migration before any data loss occurs.
      </div>
      {wornBlk?(
        <div style={{background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.3)',borderRadius:8,padding:'0.7rem 1rem',marginBottom:'0.8rem',fontFamily:'var(--mono)',fontSize:'0.82rem'}}>
          ⚠️ Block <b style={{color:'#f59e0b'}}>{wornBlk.id}</b> — erase_count: <b style={{color:'#f59e0b'}}>{wornBlk.erase_count}</b> / {WEAR_THRESHOLD} ({((wornBlk.erase_count/WEAR_THRESHOLD)*100).toFixed(0)}%)
        </div>
      ):(
        <div style={{background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:8,padding:'0.7rem 1rem',marginBottom:'0.8rem',fontSize:'0.82rem',color:'#22c55e'}}>
          ✅ No blocks near wear threshold right now. Run Runtime Failure first to retire blocks and see this scenario.
        </div>
      )}
      <button className="btn btn-primary" onClick={runWear} disabled={running||!wornBlk} style={{marginBottom:'1rem'}}>
        {running?'⏳ Running…':'▶ Trigger Wear Retirement'}
      </button>
      {log.length>0&&(
        <div style={{background:'#0a0a14',border:'1px solid var(--border)',borderRadius:8,padding:'0.8rem',marginBottom:'1rem',maxHeight:260,overflowY:'auto'}}>
          {log.map((s,i)=><LogEntry key={i} step={s}/>)}
        </div>
      )}
      {done&&(
        <div className="fade-in" style={{display:'flex',flexDirection:'column',gap:'0.8rem'}}>
          <div className="card"><Bitmap16 blocks={simBlocks}/></div>
          <div className="card"><CuckooHashViz blocks={simBlocks}/></div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════════
export default function Pillar2Page(){
  const [selected16,setSelected16]=useState(7)
  const [activeTab,setActiveTab]=useState('overview')
  const [simTab,setSimTab]=useState('boot')
  const [queryBid,setQueryBid]=useState('')
  const [queryResult,setQueryResult]=useState(null)
  const [queryRunning,setQueryRunning]=useState(false)

  // 16-block sim state — fully self-contained, no backend needed
  const [simBlocks,setSimBlocks]=useState(()=>INIT_BLOCKS.map(b=>({...b})))

  // Stats from simBlocks
  const healthy  = simBlocks.filter(b=>!b.bad&&!b.retired_wear&&b.erase_count<1000).length
  const worn     = simBlocks.filter(b=>!b.bad&&!b.retired_wear&&b.erase_count>=1000&&b.erase_count<2500).length
  const worn2    = simBlocks.filter(b=>!b.bad&&!b.retired_wear&&b.erase_count>=2500).length
  const retired  = simBlocks.filter(b=>b.bad||b.retired_wear).length

  const TABS=[
    {id:'overview', label:'📦 Live NAND Grid'},
    {id:'sim',      label:'🧪 BBT Simulator'},
    {id:'cuckoo',   label:'🗂️ Cuckoo Hash'},
    {id:'summary',  label:'📋 System Summary'},
  ]
  const SIM_TABS=[
    {id:'boot',    label:'1️⃣ Boot Phase'},
    {id:'write',   label:'2️⃣ Write Ops'},
    {id:'runtime', label:'3️⃣ Runtime Failure'},
    {id:'wear',    label:'4️⃣ Wear Monitor'},
  ]

  return(
    <div className="page fade-in">
      <div className="page-inner">
        {/* Header */}
        <div style={{marginBottom:'1rem'}}>
          <div className="badge badge-cyan" style={{marginBottom:'0.4rem'}}>Pillar 2</div>
          <h1 className="title-lg">🗃️ NAND Block Management — BBT Simulation</h1>
          <div style={{color:'var(--text-dim)',fontSize:'0.84rem',background:'rgba(6,182,212,0.08)',border:'1px solid rgba(6,182,212,0.2)',borderRadius:8,padding:'0.7rem 1rem',marginTop:'0.6rem'}}>
            <b>3-tier BBT Architecture</b>: Bloom Filter (fast pre-check) → Bitmap (O(1) status) → Cuckoo Hash (rich metadata).
            &nbsp;Reports bad block events <b>UP</b> to Pillar 1 · Receives early-retirement commands <b>DOWN</b> from Pillar 1.
          </div>
        </div>

        {/* Stats row */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'0.6rem',marginBottom:'1.2rem'}}>
          {[{label:'Good',val:healthy+worn,c:'#22c55e'},{label:'Worn',val:worn,c:'#f59e0b'},{label:'Near-Limit',val:worn2,c:'#f97316'},{label:'Retired',val:retired,c:'#4a4a60'},{label:'Active',val:16-retired,c:'var(--accent)'}].map(m=>(
            <div key={m.label} className="metric-tile">
              <div className="metric-label">{m.label}</div>
              <div className="metric-value" style={{color:m.c,fontSize:'1.6rem'}}>{m.val}</div>
            </div>
          ))}
        </div>

        {/* Main tabs */}
        <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.2rem'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
              padding:'0.6rem 1.1rem',border:'none',background:'transparent',
              color:activeTab===t.id?'#06b6d4':'var(--text-muted)',
              borderBottom:activeTab===t.id?'2px solid #06b6d4':'2px solid transparent',
              cursor:'pointer',fontFamily:'var(--font)',fontSize:'0.86rem',fontWeight:600,transition:'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── TAB: Block Grid + 3-Tier Query ───────────────────────────── */}
        {activeTab==='overview'&&(()=>{
          // Helpers for query
          function runQuery(){
            const bid=parseInt(queryBid)
            if(isNaN(bid)||bid<0||bid>15){setQueryResult({error:`Block ${bid} out of range. Use 0–15.`});return}
            const blk=simBlocks[bid]
            const bad=blk.bad||blk.retired_wear
            const bloom=bad?'MAYBE_BAD (bit set)':'DEFINITELY_GOOD (bit clear)'
            const bitmap=bad?'0 — BAD':'1 — GOOD'
            let meta=null
            if(bad){
              const h1=bid%8, h2=(bid*3+5)%8
              meta={table:blk.bad&&!blk.retired_wear?'Table1':'Table2',slot:blk.bad?h1:h2,reason:blk.retired_wear?'wear_threshold':blk.bad_reason||'runtime_failure',erase_count:blk.erase_count}
            }
            const decision=bad?`🔴 REMAP to spare block ${[13,14,15].find(s=>!(simBlocks[s].bad||simBlocks[s].retired_wear)&&s!==bid)||'none'}`:`🟢 USE Block ${bid} directly`
            setQueryResult({bid,bad,bloom,bitmap,meta,decision,fast:!bad})
          }

          // Color per erase count (pedagogical, no backend PE)
          function blockColor(b){
            if(b.bad||b.retired_wear) return {bg:'#2d0a0a',fg:'#ef4444'}
            if(b.erase_count>=2500)   return {bg:'#3d1200',fg:'#f97316'}
            if(b.erase_count>=1000)   return {bg:'#3d2600',fg:'#f59e0b'}
            return {bg:'#052e16',fg:'#22c55e'}
          }

          return(
            <div>
              {/* 16-block color grid */}
              <div className="card" style={{marginBottom:'1rem'}}>
                <div className="title-md" style={{marginBottom:'0.8rem'}}>📦 16-Block NAND Array — Color-Coded by Health</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:6,marginBottom:14}}>
                  {simBlocks.map(b=>{
                    const {bg,fg}=blockColor(b)
                    const isSel=b.id===selected16
                    return(
                      <div key={b.id} onClick={()=>{setSelected16(b.id);setQueryBid(String(b.id));setQueryResult(null)}}
                        title={`Block ${b.id} | Erase: ${b.erase_count} | ${b.bad?'FACTORY BAD':b.retired_wear?'WEAR RETIRED':'GOOD'}`}
                        style={{
                          height:56,background:bg,color:fg,borderRadius:8,cursor:'pointer',
                          border:isSel?'2px solid #fff':'2px solid transparent',
                          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                          fontFamily:'var(--mono)',fontSize:10,fontWeight:700,
                          boxShadow:isSel?`0 0 14px ${fg}99`:'',transition:'all 0.2s',
                        }}>
                        <div style={{fontSize:12}}>B{b.id}</div>
                        <div style={{fontSize:9,opacity:0.75}}>{b.bad?'BAD':b.retired_wear?'WORN':b.erase_count}</div>
                      </div>
                    )
                  })}
                </div>
                {/* Legend */}
                <div style={{display:'flex',gap:16,flexWrap:'wrap',fontFamily:'var(--mono)',fontSize:11}}>
                  {[['#22c55e','Good (0–999)'],['#f59e0b','Worn (1000–2499)'],['#f97316','Near-limit (2500+)'],['#ef4444','BAD / Retired']].map(([c,l])=>(
                    <span key={l}><span style={{color:c,fontSize:14}}>■</span> {l}</span>
                  ))}
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1rem'}}>
                {/* Block query tool */}
                <div className="card">
                  <div className="title-md" style={{marginBottom:'0.8rem'}}>🔍 Block Query — 3-Tier Lookup Demo</div>
                  <div style={{display:'flex',gap:8,marginBottom:'0.8rem',alignItems:'center'}}>
                    <input
                      type="number" min={0} max={15} value={queryBid}
                      onChange={e=>setQueryBid(e.target.value)}
                      placeholder="Enter block 0–15"
                      style={{flex:1,background:'var(--bg-card2)',border:'1px solid var(--border)',color:'var(--text)',borderRadius:8,padding:'0.5rem 0.8rem',fontFamily:'var(--mono)',fontSize:'0.9rem'}}
                      onKeyDown={e=>e.key==='Enter'&&runQuery()}
                    />
                    <button className="btn btn-primary" onClick={runQuery}>Check →</button>
                  </div>
                  <div style={{fontSize:'0.78rem',color:'var(--text-muted)',marginBottom:'0.8rem'}}>Type any block number. See exactly which tier answers and why.</div>

                  {queryResult&&(
                    <div className="fade-in">
                      {queryResult.error?(
                        <div style={{color:'#ef4444',fontFamily:'var(--mono)',fontSize:'0.82rem'}}>{queryResult.error}</div>
                      ):(
                        <div>
                          {/* Tier 1 */}
                          <div style={{background:queryResult.fast?'#051e10':'#1e0505',border:`1px solid ${queryResult.fast?'#22c55e44':'#ef444444'}`,borderLeft:`4px solid ${queryResult.fast?'#22c55e':'#ef4444'}`,borderRadius:8,padding:'0.6rem 0.8rem',marginBottom:6}}>
                            <div style={{fontFamily:'var(--mono)',fontSize:'0.72rem',fontWeight:700,color:'#14b8a6',marginBottom:2}}>TIER 1 — Bloom Filter</div>
                            <div style={{fontFamily:'var(--mono)',fontSize:'0.78rem',color:'var(--text)'}}>{queryResult.bloom}</div>
                            {queryResult.fast&&<div style={{marginTop:4,color:'#22c55e',fontSize:'0.72rem',fontWeight:700}}>⚡ Fast path — lookup COMPLETE. No Tier 2 or 3 needed.</div>}
                          </div>
                          {/* Tier 2 */}
                          <div style={{background:queryResult.bad?'#1e0505':'#051e10',border:`1px solid ${queryResult.bad?'#ef444444':'#22c55e44'}`,borderLeft:`4px solid ${queryResult.bad?'#ef4444':'#22c55e'}`,borderRadius:8,padding:'0.6rem 0.8rem',marginBottom:6,opacity:queryResult.fast?0.35:1,transition:'opacity 0.3s'}}>
                            <div style={{fontFamily:'var(--mono)',fontSize:'0.72rem',fontWeight:700,color:'#6366f1',marginBottom:2}}>TIER 2 — Bitmap</div>
                            <div style={{fontFamily:'var(--mono)',fontSize:'0.78rem',color:'var(--text)'}}>Bitmap[{queryResult.bid}] = {queryResult.bitmap}</div>
                          </div>
                          {/* Tier 3 */}
                          <div style={{background:queryResult.meta?'#1a0a2e':'#0a0a14',border:`1px solid ${queryResult.meta?'#a855f744':'var(--border)'}`,borderLeft:`4px solid ${queryResult.meta?'#a855f7':'#2a2a3a'}`,borderRadius:8,padding:'0.6rem 0.8rem',marginBottom:8,opacity:queryResult.meta?1:0.3,transition:'opacity 0.3s'}}>
                            <div style={{fontFamily:'var(--mono)',fontSize:'0.72rem',fontWeight:700,color:'#a855f7',marginBottom:2}}>TIER 3 — Cuckoo Hash (Metadata)</div>
                            {queryResult.meta?(
                              <div style={{fontFamily:'var(--mono)',fontSize:'0.78rem'}}>
                                <div style={{color:'#f59e0b'}}>reason: <b>{queryResult.meta.reason}</b></div>
                                <div style={{color:'var(--text-dim)'}}>erase_count: {queryResult.meta.erase_count}</div>
                                <div style={{color:'var(--text-dim)'}}>slot: {queryResult.meta.table}[{queryResult.meta.slot}]</div>
                              </div>
                            ):<div style={{color:'#333',fontSize:'0.75rem'}}>Not queried — block is good</div>}
                          </div>
                          {/* Decision */}
                          <div style={{background:'rgba(99,102,241,0.1)',border:'1px solid rgba(99,102,241,0.3)',borderRadius:8,padding:'0.6rem 0.8rem',fontFamily:'var(--mono)',fontSize:'0.82rem',fontWeight:700,color:queryResult.fast?'#22c55e':'#14b8a6'}}>
                            FTL Decision: {queryResult.decision}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Selected block detail + signals */}
                <div style={{display:'flex',flexDirection:'column',gap:'0.8rem'}}>
                  {(()=>{
                    const b=simBlocks[selected16]
                    const {bg,fg}=blockColor(b)
                    const bad=b.bad||b.retired_wear
                    return(
                      <div className="card glow-border fade-in">
                        <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:'0.8rem'}}>
                          <div style={{width:48,height:48,background:bg,color:fg,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--mono)',fontWeight:700,fontSize:13,border:`2px solid ${fg}66`}}>B{b.id}</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:'0.95rem'}}>Block {b.id}</div>
                            <div style={{color:fg,fontFamily:'var(--mono)',fontSize:'0.78rem',marginTop:2}}>{bad?'RETIRED':'ACTIVE'} | erase_count={b.erase_count}</div>
                          </div>
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
                          {[['Erase Count',b.erase_count],['Status',bad?'BAD':'GOOD'],['Bloom Filter',bad?'IN FILTER':'Not in filter'],['Bitmap bit',bad?'0 (BAD)':'1 (GOOD)'],['Reason',bad?b.retired_wear?'wear_threshold':(b.bad_reason||'n/a'):'—'],['Spare Pool',b.id>=13?'YES — spare':'No']].map(([k,v])=>(
                            <tr key={k}><td style={{color:'var(--text-muted)',padding:'3px 0'}}>{k}</td><td style={{color:fg,textAlign:'right',fontWeight:700}}>{v}</td></tr>
                          ))}
                        </table>
                      </div>
                    )
                  })()}
                  <div className="card">
                    <div className="title-md" style={{marginBottom:'0.8rem'}}>📡 Signals → Pillar 1</div>
                    <table className="data-table">
                      <thead><tr><th>Event</th><th>SMART</th><th>P1 Action</th></tr></thead>
                      <tbody>
                        {[['Block bad','③ +1','LSTM re-runs'],['Wear retire','④⑩','RUL recalc'],['Remap','⑨+1','Baseline check']].map(([ev,sm,eff])=>(
                          <tr key={ev}><td style={{color:'var(--accent)'}}>{ev}</td><td style={{color:'var(--accent3)',fontFamily:'var(--mono)',fontSize:'0.74rem'}}>{sm}</td><td style={{fontSize:'0.8rem'}}>{eff}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ── TAB: BBT Simulator ────────────────────────────────────────── */}
        {activeTab==='sim'&&(
          <div>
            <div style={{background:'rgba(168,85,247,0.08)',border:'1px solid rgba(168,85,247,0.2)',borderRadius:8,padding:'0.7rem 1rem',marginBottom:'1rem',fontSize:'0.83rem',color:'var(--text-dim)'}}>
              <b>16-block pedagogical model</b> | Factory bad: B5, B11 | Spare pool: B13, B14, B15 | Wear threshold: 3000 erase cycles<br/>
              State persists across scenarios — run Boot → Write → Runtime Failure → Wear Monitor to see structures evolve.
            </div>
            <div style={{display:'flex',borderBottom:'1px solid var(--border)',marginBottom:'1.2rem'}}>
              {SIM_TABS.map(t=>(
                <button key={t.id} onClick={()=>setSimTab(t.id)} style={{
                  padding:'0.5rem 1rem',border:'none',background:'transparent',
                  color:simTab===t.id?'#a855f7':'var(--text-muted)',
                  borderBottom:simTab===t.id?'2px solid #a855f7':'2px solid transparent',
                  cursor:'pointer',fontFamily:'var(--font)',fontSize:'0.84rem',fontWeight:600,transition:'all 0.2s',
                }}>{t.label}</button>
              ))}
            </div>
            {simTab==='boot'    &&<BootPhase      simBlocks={simBlocks} setSimBlocks={setSimBlocks}/>}
            {simTab==='write'   &&<WriteOps       simBlocks={simBlocks} setSimBlocks={setSimBlocks}/>}
            {simTab==='runtime' &&<RuntimeFailure simBlocks={simBlocks} setSimBlocks={setSimBlocks}/>}
            {simTab==='wear'    &&<WearMonitor    simBlocks={simBlocks} setSimBlocks={setSimBlocks}/>}
          </div>
        )}

        {/* ── TAB: Cuckoo Hash ─────────────────────────────────────────── */}
        {activeTab==='cuckoo'&&(
          <div>
            <div style={{marginBottom:'1rem',color:'var(--text-dim)',fontSize:'0.84rem',background:'rgba(168,85,247,0.08)',border:'1px solid rgba(168,85,247,0.2)',borderRadius:8,padding:'0.7rem 1rem'}}>
              <b>Cuckoo Hashing</b> replaces the Bitmap for rich metadata storage. O(1) worst-case lookup — much better than chaining.
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>🗂️ Live Cuckoo Hash State (16-block sim)</div>
                <CuckooHashViz blocks={simBlocks}/>
              </div>
              <div className="card">
                <div className="title-md" style={{marginBottom:'0.8rem'}}>How Cuckoo Hashing Works</div>
                {[
                  ['Hash 1','h1(id) = id % 8 → primary slot'],
                  ['Hash 2','h2(id) = (id×3+5) % 8 → alternate slot'],
                  ['Insert','Try Table 1 slot. If taken, try Table 2. If taken, KICK existing entry back to its alternate.'],
                  ['Lookup','Check Table1[h1(id)] OR Table2[h2(id)]. Always ≤ 2 probes.'],
                  ['Why?','Max 2 probes regardless of load — perfect for firmware where worst-case matters more than average.'],
                ].map(([k,v])=>(
                  <div key={k} style={{marginBottom:10,paddingBottom:10,borderBottom:'1px solid var(--border)'}}>
                    <div style={{color:'#a855f7',fontWeight:700,fontFamily:'var(--mono)',fontSize:13,marginBottom:2}}>{k}</div>
                    <div style={{color:'var(--text-dim)',fontSize:13}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{marginTop:'1rem'}}>
              <div className="title-md" style={{marginBottom:'0.8rem'}}>Current 16-block Metadata (Cuckoo Hash contents)</div>
              <MetaTable blocks={simBlocks}/>
            </div>
          </div>
        )}

        {/* ── TAB: Summary ─────────────────────────────────────────────── */}
        {activeTab==='summary'&&(
          <div>
            <div className="card" style={{marginBottom:'1rem',background:'linear-gradient(135deg,rgba(6,182,212,0.08),rgba(99,102,241,0.06))'}}>
              <div className="title-md" style={{marginBottom:'0.8rem'}}>Why 3 Tiers? Speed + Memory + Reliability</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'1rem'}}>
                {[
                  {icon:'🔵',name:'Bloom Filter',color:'#06b6d4',props:[['Speed','O(1) — sub-microsecond'],['Memory','~16 bits total'],['Accuracy','No false negatives, rare false positives'],['Purpose','Block 95%+ of reads instantly before touching bitmap']]},
                  {icon:'⬛',name:'Bitmap',color:'#6366f1',props:[['Speed','O(1) — 1 memory read'],['Memory','1 bit per block'],['Accuracy','100% definitive'],['Purpose','Confirm or deny Bloom result with certainty']]},
                  {icon:'🗂️',name:'Cuckoo Hash',color:'#8b5cf6',props:[['Speed','O(1) worst-case — max 2 probes'],['Memory','~64 bytes per entry'],['Accuracy','Full metadata record'],['Purpose','Rich context: reason, erase count, timestamp']]},
                ].map(ds=>(
                  <div key={ds.name} style={{background:'var(--bg-card2)',border:`1px solid ${ds.color}33`,borderLeft:`4px solid ${ds.color}`,borderRadius:10,padding:'1rem'}}>
                    <div style={{fontSize:'1.4rem',marginBottom:6}}>{ds.icon}</div>
                    <div style={{color:ds.color,fontWeight:700,marginBottom:8}}>{ds.name}</div>
                    {ds.props.map(([k,v])=>(
                      <div key={k} style={{marginBottom:5}}>
                        <div style={{color:'var(--text-muted)',fontSize:11}}>{k}</div>
                        <div style={{color:'var(--text)',fontSize:12,fontFamily:'var(--mono)'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <div className="title-md" style={{marginBottom:'0.8rem'}}>Closed-Loop: Pillar 2 ↔ Pillar 1</div>
              <div style={{fontFamily:'var(--mono)',fontSize:'0.8rem',lineHeight:2,color:'var(--text-dim)',background:'#0a0a14',borderRadius:8,padding:'1rem'}}>
                <span style={{color:'#06b6d4'}}>Pillar 3</span> detects RBER spike on Block N<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;↓<br/>
                <span style={{color:'#6366f1'}}>Pillar 1</span> SMART engine receives ECC rate event → LSTM predicts RUL &lt; 50 writes<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;↓<br/>
                <span style={{color:'#6366f1'}}>Pillar 1</span> Decision Engine: CRITICAL → issue PRE_RETIREMENT command<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;↓<br/>
                <span style={{color:'#8b5cf6'}}>Pillar 2</span> copies data to spare, sets Bitmap[N]=0, inserts metadata, updates Bloom<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;↓<br/>
                <span style={{color:'#6366f1'}}>Pillar 1</span> SMART metric ③ (bad block +1) updated → loop continues<br/>
                &nbsp;&nbsp;&nbsp;&nbsp;↓<br/>
                <span style={{color:'#22c55e'}}>Result: Zero data loss. Block retired before it could cause UECC.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
