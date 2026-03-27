import { useState, useEffect, useRef, useCallback } from 'react'
import { OOBFlowchart, ChannelStatus, Terminal } from './oob/OOBComponents.jsx'

function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a }
function hex(n) { return Array.from({ length: n }, () => rand(0, 255).toString(16).padStart(2, '0')).join('') }

const SMART_FIELDS = [
  { k: 'ECC Rate', unit: '/hr' }, { k: 'Bad Blocks', unit: '' }, { k: 'Wear Level', unit: '%' },
  { k: 'Temperature', unit: '°C' }, { k: 'Read Latency', unit: 'µs' }, { k: 'RBER', unit: '' }
]
function makeSMART() {
  return { 'ECC Rate': rand(120, 800), 'Bad Blocks': rand(2, 12), 'Wear Level': rand(35, 85),
    'Temperature': rand(38, 61), 'Read Latency': rand(30, 180), 'RBER': `1e-${rand(6, 8)}` }
}

// systemState: 'normal' | 'failed' | 'oob' | 'recovering'
const FAILURE_CASES = [
  { id: 'cable', label: '🔌 UART Cable Disconnected', color: '#ef4444', affects: 'uart' },
  { id: 'ble',   label: '📶 BLE Interference',        color: '#f97316', affects: 'ble'  },
  { id: 'power', label: '⚡ Power Loss (OOB fails)',   color: '#6366f1', affects: 'both' },
]

export default function OOBPage() {
  const [systemState, setSystemState]     = useState('normal')  // normal|failed|oob|recovering
  const [smart, setSmart]                 = useState(makeSMART())
  const [health, setHealth]               = useState(rand(62, 91))
  const [rul, setRul]                     = useState(rand(14, 60))
  const [uartLines, setUartLines]         = useState([])
  const [bleLines, setBleLines]           = useState([])
  const [sysLines, setSysLines]           = useState([])
  const [uartFail, setUartFail]           = useState(false)
  const [bleFail, setBleFail]             = useState(false)
  const [activeFailCase, setActiveFailCase] = useState(null)
  const [retrying, setRetrying]           = useState(false)
  const [shamirShares, setShamirShares]   = useState([])
  const [aesKey, setAesKey]               = useState('')
  const [activeTab, setActiveTab]         = useState('sim')
  const smartTimer = useRef(null)

  // Live SMART updates in normal mode
  useEffect(() => {
    if (systemState !== 'normal') { clearInterval(smartTimer.current); return }
    smartTimer.current = setInterval(() => {
      setSmart(makeSMART())
      setHealth(h => Math.max(10, Math.min(99, h + rand(-3, 3))))
      setRul(r => Math.max(1, Math.min(90, r + rand(-1, 1))))
    }, 2000)
    return () => clearInterval(smartTimer.current)
  }, [systemState])

  const addSys  = (text, color = '#8888a0') => setSysLines(l => [...l.slice(-60), { text, color }])
  const addUart = (text, color = '#06b6d4') => setUartLines(l => [...l.slice(-60), { text, color }])
  const addBLE  = (text, color = '#8b5cf6') => setBleLines(l => [...l.slice(-60), { text, color }])

  const delay = ms => new Promise(r => setTimeout(r, ms))

  async function simulateHostFailure() {
    setSystemState('failed'); setUartFail(false); setBleFail(false)
    setUartLines([]); setBleLines([]); setSysLines([])
    setShamirShares([]); setAesKey('')
    addSys('💥 HOST CRASH DETECTED — NVMe/SATA bus silent failure', '#ef4444')
    await delay(600)
    addSys('🔍 Watchdog: no ACK from host controller for 500ms', '#ef4444')
    await delay(500)
    addSys('🔋 Internal capacitor bank activated — OOB power mode', '#f59e0b')
    await delay(400)
    setSystemState('oob')
    addSys('📡 OOB MUX: activating UART + BLE channels simultaneously', '#a855f7')
    await delay(300)

    // UART stream
    addUart('[UART] Host failure detected at t=0ms', '#ef4444')
    await delay(200)
    addUart('[UART] Switching to emergency diagnostic mode...')
    await delay(300)
    addUart(`[UART] Assembling SMART log → health=${health}, RUL=${rul}d`)
    await delay(200)
    addUart(`[UART] ECC Rate: ${smart['ECC Rate']}/hr | Bad Blocks: ${smart['Bad Blocks']}`)
    await delay(200)
    addUart(`[UART] Temp: ${smart['Temperature']}°C | Wear: ${smart['Wear Level']}%`)

    // BLE stream
    await delay(100)
    addBLE('[BLE] Advertising emergency beacon...')
    await delay(300)
    addBLE(`[AURA][H:${health}][RUL:${rul}d][${health < 40 ? 'CRIT' : health < 70 ? 'WARN' : 'OK'}]`)
    await delay(200)
    addBLE(`[BLE] Packet #1 → ECC=${smart['ECC Rate']} BAD=${smart['Bad Blocks']}`)
    await delay(200)

    // AES + Shamir
    const key = hex(32)
    setAesKey(key)
    addSys(`🔐 AES-256-GCM encrypting report | IV: ${hex(16).slice(0, 16)}...`, '#a855f7')
    await delay(500)
    const shares = Array.from({ length: 5 }, (_, i) => `S${i + 1}:${hex(8)}`)
    setShamirShares(shares)
    addSys('🗝️ Shamir 3-of-5 key split → distributing shares', '#6366f1')
    shares.forEach((s, i) => {
      setTimeout(() => addSys(`   → Share ${i + 1}: ${s}`, '#6366f1'), i * 100)
    })
    await delay(700)

    // Final BLE packet
    addBLE(`[BLE] Encrypted payload: ${hex(16)}...`)
    addUart('[UART] Encrypted report sealed — transmission complete ✓', '#22c55e')
    addSys('✅ OOB transmission complete — diagnostics secured', '#22c55e')
  }

  async function simulateFailureCase(fc) {
    if (systemState !== 'oob') { await simulateHostFailure(); await delay(2000) }
    setActiveFailCase(fc.id)
    if (fc.affects === 'uart' || fc.affects === 'both') {
      setUartFail(true)
      addUart('[UART] ⚠ Cable disconnected — transmission interrupted!', '#ef4444')
      await delay(400)
      if (fc.affects === 'both') {
        setBleFail(true)
        addBLE('[BLE] ⚠ Power loss — OOB unavailable!', '#ef4444')
        addSys('💀 ALL OOB CHANNELS FAILED — No fallback available', '#ef4444')
        await delay(1000)
        addSys('💀 Critical failure: no diagnostics can be transmitted', '#ef4444')
      } else {
        addSys('⚠ UART failed — trying BLE fallback...', '#f59e0b')
        await delay(300)
        setRetrying(true)
        addBLE('[BLE] Taking over from UART...')
        await delay(400)
        addBLE(`[BLE] Fallback: [AURA][H:${health}][RUL:${rul}d][UART_FAIL→BLE]`, '#22c55e')
        addSys('✅ BLE fallback successful — data preserved', '#22c55e')
        setRetrying(false)
      }
    } else {
      setBleFail(true)
      addBLE('[BLE] ⚠ Heavy interference detected — packet loss!', '#ef4444')
      await delay(300)
      addBLE('[BLE] Retrying... (attempt 1/3)', '#f59e0b'); await delay(400)
      addBLE('[BLE] Retrying... (attempt 2/3)', '#f59e0b'); await delay(400)
      addBLE('[BLE] Retrying... (attempt 3/3)', '#f59e0b'); await delay(400)
      setRetrying(true)
      addSys('⚠ BLE unstable — switching to UART fallback', '#f59e0b')
      await delay(300)
      addUart('[UART] Picking up fallback from BLE...')
      await delay(300)
      addUart(`[UART] Recovery: H=${health} RUL=${rul}d → transmitted`, '#22c55e')
      addSys('✅ UART fallback successful', '#22c55e')
      setRetrying(false)
    }
  }

  async function restoreHost() {
    setSystemState('recovering')
    addSys('🔄 Host system rebooting...', '#3b82f6')
    await delay(800)
    addSys('✅ NVMe/SATA bus restored — host handshake confirmed', '#22c55e')
    await delay(400)
    addUart('[UART] Host recovered — returning to standby mode')
    addBLE('[BLE] Host recovered — beacon stopped')
    await delay(600)
    setSystemState('normal'); setUartFail(false); setBleFail(false); setActiveFailCase(null)
    addSys('🟢 System nominal — in-band communication resumed', '#22c55e')
  }

  function resetAll() {
    setSystemState('normal'); setUartFail(false); setBleFail(false)
    setUartLines([]); setBleLines([]); setSysLines([])
    setShamirShares([]); setAesKey(''); setActiveFailCase(null); setRetrying(false)
  }

  const isNormal   = systemState === 'normal'
  const isOOB      = systemState === 'oob'
  const isFailed   = systemState === 'failed' || isOOB
  const healthColor = health > 70 ? '#22c55e' : health > 40 ? '#f59e0b' : '#ef4444'
  const TABS = [{ id: 'sim', label: '📡 Simulation' }, { id: 'how', label: '📖 How OOB Works' }]

  return (
    <div className="page fade-in">
      <div className="page-inner">

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#12121a,#1a1a2e)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700 }}>📡 OOB — Out-of-Band Communication Simulation</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 3, fontFamily: 'var(--mono)' }}>
                "Even when the system dies, the SSD keeps communicating."
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-danger btn-sm" onClick={simulateHostFailure} disabled={isFailed}>
                💥 Host Failure
              </button>
              {FAILURE_CASES.map(fc => (
                <button key={fc.id} className="btn btn-outline btn-sm" onClick={() => simulateFailureCase(fc)}
                  style={{ color: fc.color, borderColor: fc.color + '66' }} disabled={!isFailed}>
                  {fc.label.split(' ').slice(0, 2).join(' ')}
                </button>
              ))}
              <button className="btn btn-outline btn-sm" onClick={restoreHost} disabled={isNormal} style={{ color: '#22c55e' }}>🔄 Restore Host</button>
              <button className="btn btn-outline btn-sm" onClick={resetAll}>↺ Reset</button>
            </div>
          </div>
          {/* Status bar */}
          <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', padding: '3px 12px', borderRadius: 12,
              background: isNormal ? '#22c55e22' : isFailed ? '#ef444422' : '#f59e0b22',
              border: `1px solid ${isNormal ? '#22c55e' : isFailed ? '#ef4444' : '#f59e0b'}`,
              color: isNormal ? '#22c55e' : isFailed ? '#ef4444' : '#f59e0b' }}>
              {isNormal ? '🟢 IN-BAND NORMAL' : isFailed ? '🔴 HOST FAILED — OOB ACTIVE' : '🟡 RECOVERING'}
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: healthColor }}>Health: {health}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#3b82f6' }}>RUL: {rul}d</span>
            {retrying && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#f59e0b' }}>⟳ Retrying fallback…</span>}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.2rem' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '0.55rem 1.1rem', border: 'none', background: 'transparent',
              color: activeTab === t.id ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.87rem', fontWeight: 600, transition: 'all 0.2s'
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ TAB: Simulation ════════════════════════════════════════════ */}
        {activeTab === 'sim' && (
          <div className="fade-in">
            {/* Interactive Flowchart */}
            <OOBFlowchart systemState={systemState} />

            {/* Channel status + SMART side by side */}
            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <div>
                <div className="title-md" style={{ marginBottom: '0.6rem' }}>📶 Channel Status</div>
                <ChannelStatus systemState={systemState} uartFail={uartFail} bleFail={bleFail} />

                {/* Failure case buttons */}
                {isFailed && (
                  <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '0.8rem', marginTop: 4 }}>
                    <div style={{ color: '#ef4444', fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700, marginBottom: 8 }}>⚠ Simulate OOB Failure Cases:</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {FAILURE_CASES.map(fc => (
                        <button key={fc.id} onClick={() => simulateFailureCase(fc)}
                          className="btn btn-outline btn-sm"
                          style={{ color: fc.color, borderColor: fc.color + '55', justifyContent: 'flex-start', textAlign: 'left' }}>
                          {fc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SMART metrics panel */}
              <div>
                <div className="title-md" style={{ marginBottom: '0.6rem' }}>
                  📊 {isNormal ? 'Live SMART Feed (In-Band)' : 'Last SMART Snapshot (OOB)'}
                </div>
                <div style={{ background: isNormal ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${isNormal ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`, borderRadius: 10, padding: '0.8rem' }}>
                  {SMART_FIELDS.map(({ k, unit }) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', color: isNormal ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                        {smart[k]}{unit}
                      </span>
                    </div>
                  ))}
                  {!isNormal && (
                    <div style={{ marginTop: 6, color: '#ef4444', fontSize: '0.72rem', fontFamily: 'var(--mono)' }}>
                      ⚠ In-band update STOPPED — snapshot frozen at failure moment
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* UART + BLE terminals */}
            <div className="grid-2" style={{ marginBottom: '1rem' }}>
              <Terminal lines={uartLines} title="UART Terminal (115200 baud)" color={uartFail ? '#ef4444' : '#06b6d4'} />
              <Terminal lines={bleLines}  title="BLE 5.0 Channel (AURA beacon)" color={bleFail ? '#ef4444' : '#8b5cf6'} />
            </div>

            {/* System event log */}
            <div style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '0.5rem' }}>🗒️ System Event Log</div>
              <Terminal lines={sysLines} title="FW EVENT LOG — OOB Controller" color="#a855f7" />
            </div>

            {/* AES + Shamir if active */}
            {(aesKey || shamirShares.length > 0) && (
              <div className="grid-2 fade-in">
                <div className="card">
                  <div className="title-md" style={{ marginBottom: '0.7rem' }}>🔐 AES-256-GCM Encryption</div>
                  {[['Mode', 'GCM (authenticated encryption)'], ['Key', aesKey.slice(0, 24) + '…'], ['IV', hex(16).slice(0, 16) + '…'], ['Auth Tag', '128-bit integrity guarantee']].map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{k}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#a855f7' }}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <div className="title-md" style={{ marginBottom: '0.7rem' }}>🗝️ Shamir Secret Sharing (3-of-5)</div>
                  {shamirShares.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(99,102,241,0.2)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                        {i + 1}
                      </div>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--accent3)', wordBreak: 'break-all' }}>{s}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#22c55e', background: 'rgba(34,197,94,0.08)', padding: '6px 10px', borderRadius: 8 }}>
                    ✅ Any 3 shares reconstruct key — information-theoretic security
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB: How OOB Works ═════════════════════════════════════════ */}
        {activeTab === 'how' && (
          <div className="fade-in">
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '0.8rem' }}>🎯 Why Out-of-Band Communication?</div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', lineHeight: 1.8 }}>
                Normal SSD diagnostics flow through the <b style={{ color: '#22c55e' }}>NVMe/SATA bus</b> to the host OS. But during a host crash, kernel panic, or power failure, this channel goes silent. <b style={{ color: '#f59e0b' }}>OOB channels</b> bypass the host entirely — using the SSD's internal capacitor bank as power, and UART/BLE as the transmission medium.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem', marginBottom: '1rem' }}>
              {[
                { icon: '⚡', title: 'In-Band (Normal)', items: ['NVMe/SATA bus carries SMART data', 'Host OS reads diagnostics', 'Real-time metrics updated', 'Fast and high-bandwidth'], color: '#22c55e' },
                { icon: '💥', title: 'When Host Fails', items: ['NVMe bus goes silent', 'Host cannot receive data', 'Watchdog detects timeout', 'Capacitor bank kicks in'], color: '#ef4444' },
                { icon: '📡', title: 'OOB Activated', items: ['UART: wired terminal output', 'BLE: wireless beacon broadcast', 'AES-256-GCM encryption', 'Shamir 3-of-5 key sharing'], color: '#a855f7' },
              ].map(s => (
                <div key={s.title} style={{ background: `${s.color}0d`, border: `1px solid ${s.color}33`, borderRadius: 10, padding: '0.8rem' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{s.icon}</div>
                  <div style={{ color: s.color, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                  {s.items.map((item, i) => <div key={i} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 3 }}>• {item}</div>)}
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="title-md" style={{ marginBottom: '0.8rem' }}>⚠️ Failure Cases & Fallback Logic</div>
              <table className="data-table">
                <thead><tr><th>Failure</th><th>What Happens</th><th>Fallback</th><th>Outcome</th></tr></thead>
                <tbody>
                  {[
                    ['UART cable cut', 'UART TX fails immediately', 'Switch to BLE', '✅ Data preserved via BLE'],
                    ['BLE interference', 'Packet loss, 3 retries', 'Switch to UART', '✅ UART delivers data'],
                    ['Power loss', 'Capacitor depleted', 'No fallback', '❌ OOB unavailable'],
                    ['Both fail', 'All channels down', 'None', '❌ Diagnostic lost'],
                  ].map(([f, w, fb, o]) => (
                    <tr key={f}>
                      <td style={{ color: '#ef4444', fontFamily: 'var(--mono)' }}>{f}</td>
                      <td style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>{w}</td>
                      <td style={{ color: '#f59e0b', fontFamily: 'var(--mono)', fontSize: '0.82rem' }}>{fb}</td>
                      <td style={{ color: o.startsWith('✅') ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{o}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="title-md" style={{ marginBottom: '0.8rem' }}>🔐 Security Layer</div>
              <div className="grid-2">
                {[
                  { title: 'AES-256-GCM', items: ['Quantum-resistant 256-bit key', 'GCM = confidentiality + integrity', '128-bit random IV (nonce)', 'Any tampering invalidates auth tag'] },
                  { title: 'Shamir Secret Sharing', items: ['Key split into 5 shares', 'Any 3 holders reconstruct key', '< 3 shares = zero information revealed', 'Information-theoretic security (unconditional)'] },
                ].map(s => (
                  <div key={s.title} style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: '0.8rem' }}>
                    <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                    {s.items.map((item, i) => <div key={i} style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 3 }}>• {item}</div>)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
