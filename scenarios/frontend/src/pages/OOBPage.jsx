import { useState, useEffect, useRef } from 'react'
import { SCENARIOS, generateReport, mockAESEncrypt, mockShamirSplit, mockReconstructKey, mockAESDecrypt, hex } from './oob/OOBLogic.js'
import { Terminal, EventLogTable, ForensicReport, CryptoView, DistributedStorageView } from './oob/OOBViews.jsx'
import { OOBFlowchart, ChannelStatus } from './oob/OOBComponents.jsx'

// Tabs: Communication, Encryption, Shares, Recovery, Events
const TABS = [
  { id: 'Communication', label: '📡 Communication' },
  { id: 'Encryption',    label: '🔐 Crypto & Auth' },
  { id: 'Shares',        label: '🗝️ Shamir Shares' },
  { id: 'Recovery',      label: '🔄 Forensic Recovery' },
  { id: 'Events',        label: '🗒️ Event Log' },
]

const delay = ms => new Promise(res => setTimeout(res, ms))
const ts = () => new Date().toISOString().substring(11, 23)

export default function OOBPage() {
  const [scenario, setScenario] = useState('CRITICAL')
  const [hostStatus, setHostStatus] = useState('ACTIVE') // ACTIVE, CRASHED
  const [nvmeLink, setNvmeLink] = useState('UP') // UP, DOWN
  const [oobChannel, setOobChannel] = useState('INACTIVE') // INACTIVE, ACTIVE
  const [downtime, setDowntime] = useState(0)
  const downtimeInterval = useRef(null)

  const [events, setEvents] = useState([])
  const [report, setReport] = useState(null)
  const [aes, setAes] = useState(null)
  const [shares, setShares] = useState([])
  const [ipfsHash, setIpfsHash] = useState(null)
  const [uartLines, setUartLines] = useState([])
  const [bleLines, setBleLines] = useState([])
  
  const [recoveredReport, setRecoveredReport] = useState(null)
  const [recoveryError, setRecoveryError] = useState('')

  const [activeTab, setActiveTab] = useState('Communication')
  const [simRunning, setSimRunning] = useState(false)

  // Live dummy SMART just for UI display when ACTIVE
  const [liveSmart, setLiveSmart] = useState({ ecc: 50, lat: 40, temp: 35 })
  useEffect(() => {
    if (hostStatus !== 'ACTIVE') return
    const t = setInterval(() => {
      const sc = SCENARIOS[scenario]
      setLiveSmart({ ecc: sc.eccMin + Math.random() * 50 | 0, lat: 40 + Math.random() * 20 | 0, temp: 35 + Math.random() * 5 | 0 })
    }, 1500)
    return () => clearInterval(t)
  }, [hostStatus, scenario])

  useEffect(() => {
    if (hostStatus === 'CRASHED') {
      downtimeInterval.current = setInterval(() => setDowntime(d => +(d + 0.1).toFixed(1)), 100)
    } else {
      clearInterval(downtimeInterval.current)
      setDowntime(0)
    }
    return () => clearInterval(downtimeInterval.current)
  }, [hostStatus])

  const logEvent = (source, type, details) => {
    setEvents(prev => [{ id: Date.now() + Math.random(), time: ts(), source, type, details }, ...prev].slice(0, 50))
  }
  const addUart = (text, color = '#22c55e') => setUartLines(l => [...l.slice(-100), { text, color }])
  const addBle  = (text, color = '#8b5cf6') => setBleLines(l => [...l.slice(-100), { text, color }])

  const resetSim = () => {
    setHostStatus('ACTIVE'); setNvmeLink('UP'); setOobChannel('INACTIVE'); setDowntime(0)
    setEvents([]); setReport(null); setAes(null); setShares([]); setIpfsHash(null)
    setUartLines([]); setBleLines([]); setRecoveredReport(null); setRecoveryError('')
    logEvent('HOST', 'SYSTEM_RESET', 'System returned to normal operating state')
  }

  const runAutoPipeline = async () => {
    if (simRunning) return
    setSimRunning(true)
    resetSim()
    await delay(500)

    // 1. HOST_CRASH
    setHostStatus('CRASHED'); setNvmeLink('DOWN')
    logEvent('HOST', 'HOST_CRASH', 'Fatal kernel panic detected. NVMe link lost.')
    addUart(`[UART:115200] TRIGGER: HOST_UNRESPONSIVE`, '#ef4444')
    addUart(`[UART:115200] TIMESTAMP: ${new Date().toISOString()}`, '#ef4444')
    
    // 2. OOB_TRIGGER
    await delay(1200)
    setOobChannel('ACTIVE')
    logEvent('NVMe', 'OOB_TRIGGER', 'Watchdog timeout (500ms). Activating UART/BLE via capacitor power.')
    addUart(`[UART:115200] CAPACITOR POWER ACTIVE. SWITCHING TO OOB.`)
    addBle(`[BLE] ADV_IND: AURA-AEGIS-EMERGENCY`)

    // 3. GENERATE_REPORT
    await delay(1000)
    logEvent('PILLAR', 'GENERATE_REPORT', `Generating forensic snapshot (Scenario: ${SCENARIOS[scenario].label})`)
    const snap = generateReport(scenario)
    setReport(snap)
    addUart(`[UART:115200] HEALTH SNAPSHOT:`)
    addUart(`[UART:115200] Health Score: ${snap.health.score}`)
    addUart(`[UART:115200] RUL: ${snap.health.rul_days} days`)
    if (snap.health.anomaly_type !== 'NONE') addUart(`[UART:115200] ANOMALY: ${snap.health.anomaly_type}`, '#f59e0b')
    addBle(`[AURA][H:${snap.health.score}][RUL:${snap.health.rul_days}][${snap.health.score < 40 ? 'CRIT' : 'WARN'}]`)

    // 4. ENCRYPT_REPORT
    await delay(1500)
    logEvent('PILLAR', 'ENCRYPT_REPORT', 'Securing diagnostic payload with AES-256-GCM')
    const aesData = mockAESEncrypt(snap)
    setAes(aesData)
    addUart(`[UART:115200] SECURE ENCLAVE: Payload encrypted (AES-256-GCM, ${aesData.size} bytes)`, '#3b82f6')
    addBle(`[BLE] PKT: ENCRYPTED_PAYLOAD_READY`)

    // 5. SHAMIR_SPLIT
    await delay(1500)
    logEvent('PILLAR', 'SHAMIR_SPLIT', 'Splitting AES key via Shamir Secret Sharing (3-of-5 threshold)')
    const sShares = mockShamirSplit(aesData.key)
    setShares(sShares)
    addUart(`[UART:115200] SECURE ENCLAVE: Key split 3-of-5 completed.`, '#3b82f6')

    // 6. TRANSMIT
    await delay(1000)
    logEvent('NVMe', 'TRANSMIT', 'Streaming ciphertext over UART and broadcasting via BLE')
    addUart(`[UART:115200] TRANSMITTING CIPHERTEXT CHUNKS:`)
    for (let i = 0; i < 5; i++) {
       addUart(`[UART:115200] DATA: ${aesData.ciphertext.slice(i*40, (i+1)*40)}...`, '#8888a0')
       addBle(`[BLE] DATA_${i}: ${hex(16)}...`)
       await delay(300)
    }
    
    // 7. DISTRIBUTE (IPFS)
    await delay(1000)
    logEvent('PILLAR', 'DISTRIBUTED_PUSH', 'Pushing ciphertext chunks to distributed IPFS nodes for immutable storage')
    const ipfs = 'Qm' + hex(44)
    setIpfsHash(ipfs)
    addUart(`[UART:115200] IPFS PINNED: ${ipfs}`)
    addBle(`[BLE] IPFS:${ipfs.slice(0, 10)}...`)

    logEvent('PILLAR', 'PIPELINE_COMPLETE', 'Emergency rescue pipeline execution successful.')
    setSimRunning(false)
  }

  const handleFailScenario = async (type) => {
    if (hostStatus === 'ACTIVE') { await runAutoPipeline(); await delay(500) }
    if (type === 'uart') {
      logEvent('HOST', 'UART_FAIL', 'Physical UART cable disconnected during transmission')
      addUart(`[UART:115200] ERR: TX_FIFO_FULL / LINE_DISCONNECTED`, '#ef4444')
      addUart(`[UART:115200] TRANSMISSION HALTED.`, '#ef4444')
    } else if (type === 'ble') {
      logEvent('HOST', 'BLE_FAIL', 'RF interference detected. Packet drop > 80%')
      addBle(`[BLE] ERR: CCA_FAIL / PACKET_LOSS`, '#ef4444')
      addBle(`[BLE] Retrying... (1/3)`, '#f59e0b')
      await delay(600)
      addBle(`[BLE] BROADCAST HALTED.`, '#ef4444')
    } else if (type === 'power') {
      logEvent('PILLAR', 'POWER_FAIL', 'Internal capacitor depleted. SSD gracefully halting.')
      setOobChannel('INACTIVE')
      addUart(`[UART:115200] ERR: CAPACITOR_DEPLETED. SHUTTING DOWN.`, '#ef4444')
      addBle(`[BLE] PWR_FAIL`, '#ef4444')
    }
  }

  const handleRecovery = () => {
    setRecoveryError(''); setRecoveredReport(null)
    logEvent('HOST', 'DECRYPT_ATTEMPT', 'Technician attempting key reconstruction and decryption')
    // We assume 3 shares selected via UI implies success
    // The actual "selected shares" logic is inside CryptoView, but for this demo, we'll just reconstruct if aes exists
    if (!aes) { setRecoveryError('No encrypted report found.'); return }
    const key = mockReconstructKey([1,2,3], aes.key) // mock success
    try {
      const p = mockAESDecrypt(aes.ciphertext, key, aes.key)
      setRecoveredReport(p)
      logEvent('PILLAR', 'DECRYPT_SUCCESS', 'Forensic report successfully decrypted from IPFS snapshot')
    } catch (e) {
      setRecoveryError(e.message)
      logEvent('PILLAR', 'DECRYPT_FAIL', e.message)
    }
  }

  return (
    <div className="page fade-in">
      <div className="page-inner">

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#12121a,#1a1a2e)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.2rem', fontWeight: 700, color: '#e8e8f0' }}>📡 AURA-AEGIS: Secure OOB & Forensic Recovery</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4, fontFamily: 'var(--mono)', fontStyle: 'italic', maxWidth: 650 }}>
                “Even when the entire system fails, the SSD continues to detect, secure, and communicate critical data — ensuring nothing is lost.”
              </div>
            </div>
          </div>
          
          <div style={{ marginTop: 14, display: 'flex', gap: 16, alignItems: 'stretch' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <select className="btn" value={scenario} onChange={e => setScenario(e.target.value)} disabled={simRunning || hostStatus !== 'ACTIVE'} style={{ background: 'var(--bg-card2)', borderColor: 'var(--border)' }}>
                {Object.keys(SCENARIOS).map(k => <option key={k} value={k}>{SCENARIOS[k].label}</option>)}
              </select>
              <button className="btn btn-danger" onClick={runAutoPipeline} disabled={simRunning || hostStatus === 'CRASHED'}>
                💥 Simulate Host Crash & Auto-Pipeline
              </button>
            </div>
            
            <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {[['Host Status', hostStatus, hostStatus === 'ACTIVE' ? '#22c55e' : '#ef4444'],
                ['NVMe Link', nvmeLink, nvmeLink === 'UP' ? '#22c55e' : '#ef4444'],
                ['OOB Channel', oobChannel, oobChannel === 'ACTIVE' ? '#a855f7' : 'var(--text-muted)'],
                ['Host Downtime', `${downtime.toFixed(1)}s`, downtime > 0 ? '#f59e0b' : 'var(--text-muted)']
              ].map(([l, v, c]) => (
                <div key={l} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{l}</span>
                  <span style={{ fontSize: '0.9rem', color: c, fontWeight: 700, fontFamily: 'var(--mono)' }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.2rem' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '0.6rem 1.2rem', border: 'none', background: 'transparent',
              color: activeTab === t.id ? '#a855f7' : 'var(--text-muted)',
              borderBottom: activeTab === t.id ? '2px solid #a855f7' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.87rem', fontWeight: 600, transition: 'all 0.2s'
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ TAB PANELS ═════════════════════════════════════════════════ */}

        {/* 1. Communication */}
        {activeTab === 'Communication' && (
          <div className="fade-in">
             <OOBFlowchart systemState={hostStatus === 'ACTIVE' ? 'normal' : oobChannel === 'ACTIVE' ? 'oob' : 'failed'} />
             
             <div className="grid-2" style={{ marginBottom: '1rem' }}>
               <div>
                  <h3 className="title-md" style={{ marginBottom: '0.8rem' }}>⚡ In-Band (NVMe/SATA)</h3>
                  <div style={{ background: hostStatus === 'ACTIVE' ? '#052e16' : '#120000', border: `1px solid ${hostStatus === 'ACTIVE' ? '#22c55e' : '#ef4444'}`, borderRadius: 10, padding: '1rem', height: 120 }}>
                     {hostStatus === 'ACTIVE' ? (
                       <div className="fade-in">
                         <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 8 }}>✅ NVMe Link Active — Streaming Live Metrics</div>
                         <div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: '#86efac', display: 'flex', flexDirection: 'column', gap: 4 }}>
                           <span>ECC Rate: {liveSmart.ecc} /hr</span>
                           <span>Read Latency: {liveSmart.lat} µs</span>
                           <span>Temperature: {liveSmart.temp} °C</span>
                         </div>
                       </div>
                     ) : (
                       <div className="fade-in" style={{ color: '#ef4444', textAlign: 'center', marginTop: 15 }}>
                         <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>❌</div>
                         <div style={{ fontWeight: 700 }}>Host Unresponsive / Link Down</div>
                       </div>
                     )}
                  </div>
               </div>
               <div>
                  <h3 className="title-md" style={{ marginBottom: '0.8rem' }}>⚠️ Failure Injection</h3>
                  <div style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', height: 120, display: 'flex', flexDirection: 'column', gap: 8 }}>
                     <button className="btn btn-outline btn-sm" onClick={() => handleFailScenario('uart')} style={{ color: '#ef4444', borderColor: '#ef444444', justifyContent: 'flex-start' }}>🔌 Disconnect UART Cable</button>
                     <button className="btn btn-outline btn-sm" onClick={() => handleFailScenario('ble')} style={{ color: '#f59e0b', borderColor: '#f59e0b44', justifyContent: 'flex-start' }}>📶 Induce BLE Interference</button>
                     <button className="btn btn-outline btn-sm" onClick={() => handleFailScenario('power')} style={{ color: '#a855f7', borderColor: '#a855f744', justifyContent: 'flex-start' }}>🔋 Trigger Full Power Loss (Capacitor Depleted)</button>
                  </div>
               </div>
             </div>

             <h3 className="title-md" style={{ marginBottom: '0.8rem', color: '#06b6d4' }}>📡 OOB Channels (Terminal Dumps)</h3>
             <div className="grid-2">
               <div style={{ height: 280 }}><Terminal lines={uartLines} title="UART [115200 Baud] — Serial Emergency Dump" color="#06b6d4" /></div>
               <div style={{ height: 280 }}><Terminal lines={bleLines} title="BLE [5.0] — Wireless AURA Beacon" color="#8b5cf6" /></div>
             </div>
          </div>
        )}

        {/* 2. Encryption & 3. Shares combined in CryptoView and Distributed storage */}
        {(activeTab === 'Encryption' || activeTab === 'Shares') && (
          <div className="fade-in">
             {activeTab === 'Encryption' && (
               <>
                 <CryptoView aes={aes} shares={shares} onReconstruct={() => setActiveTab('Recovery')} />
                 <DistributedStorageView active={!!ipfsHash} hash={ipfsHash || 'Pending...'} />
               </>
             )}
             {activeTab === 'Shares' && (
               <>
                 <CryptoView aes={aes} shares={shares} onReconstruct={() => setActiveTab('Recovery')} />
                 <div className="card" style={{ marginTop: '1rem' }}>
                   <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.6 }}>
                     <b>Why 3-of-5?</b> The AES key is mathematically divided into 5 polynomial points. Without at least 3 points, the polynomial cannot be solved, granting absolute information-theoretic security even if 2 storage locations are compromised.
                   </div>
                 </div>
               </>
             )}
          </div>
        )}

        {/* 4. Forensic Recovery */}
        {activeTab === 'Recovery' && (
          <div className="fade-in">
             <div className="card" style={{ marginBottom: '1rem', border: '1px dashed #22c55e' }}>
               <h3 className="title-md" style={{ marginBottom: '0.8rem', color: '#22c55e' }}>Technician Recovery Workflow</h3>
               <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                 Simulate a technician recovering the SSD payload from IPFS using the reconstructed AES key.
               </div>
               <button className="btn btn-primary" onClick={handleRecovery} disabled={!aes}>
                 🔓 Decrypt Forensic Report
               </button>
               {recoveryError && <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: 10, fontFamily: 'var(--mono)' }}>❌ {recoveryError}</div>}
             </div>

             {recoveredReport && (
               <div className="fade-in">
                 <div className="badge badge-good" style={{ marginBottom: 12 }}>DECRYPTED SNAPSHOT (SCENARIO: {SCENARIOS[scenario].label})</div>
                 <ForensicReport report={recoveredReport} />
               </div>
             )}
             {!recoveredReport && !recoveryError && report && (
               <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
                  <div className="badge badge-warn" style={{ marginBottom: 12 }}>PLAINTEXT PREVIEW (Original State before encryption)</div>
                  <ForensicReport report={report} />
               </div>
             )}
          </div>
        )}

        {/* 5. Events */}
        {activeTab === 'Events' && (
          <div className="fade-in">
             <div className="card">
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                 <h3 className="title-md">リアルタイム Event Pipeline</h3>
                 <span className="badge badge-info">{events.length} Events Logged</span>
               </div>
               <EventLogTable events={events} />
             </div>
          </div>
        )}

      </div>
    </div>
  )
}
