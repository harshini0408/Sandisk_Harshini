import { useRef, useEffect, useState } from 'react'

export function Terminal({ lines, title, color = '#06b6d4', height = 250 }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [lines])
  return (
    <div style={{ background: '#040408', border: `1px solid ${color}44`, borderRadius: 8, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: `${color}18`, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}` }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color, fontWeight: 700 }}>{title}</span>
      </div>
      <div ref={ref} style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', padding: '0.8rem', overflowY: 'auto', flex: 1, lineHeight: 1.6 }}>
        {lines.length === 0 ? <span style={{ color: 'rgba(255,255,255,0.2)' }}>{'> waiting...'}</span> : lines.map((l, i) => (
          <div key={i} style={{ color: l.color || color, wordBreak: 'break-all' }}>{l.text}</div>
        ))}
      </div>
    </div>
  )
}

export function EventLogTable({ events }) {
  return (
    <div style={{ maxHeight: 350, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
      <table className="data-table" style={{ margin: 0 }}>
        <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1 }}>
          <tr><th>Time</th><th>Source</th><th>Event Type</th><th>Details</th></tr>
        </thead>
        <tbody>
          {events.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No events yet.</td></tr> : events.map(e => (
            <tr key={e.id}>
              <td style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--text-dim)' }}>{e.time}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: e.source==='HOST'?'#ef4444':e.source==='NVMe'?'#22c55e':'#a855f7' }}>{e.source}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', fontWeight: 700, color: e.type.includes('FAIL')?'#ef4444':'#3b82f6' }}>{e.type}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text)' }}>{e.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ForensicReport({ report }) {
  if (!report) return <div style={{ color: 'var(--text-muted)' }}>No report generated yet.</div>
  
  const Section = ({ title, obj, color }) => (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 8, background: `${color}08`, marginBottom: '1rem', overflow: 'hidden' }}>
      <div style={{ background: `${color}22`, color: color, padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, fontFamily: 'var(--mono)' }}>{title}</div>
      <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px dotted rgba(255,255,255,0.1)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{k.replace(/_/g, ' ')}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text)', fontWeight: 600 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
  
  return (
    <div className="grid-2 fade-in">
      <div>
        <Section title="🧠 HEALTH" obj={report.health} color="#3b82f6" />
        <Section title="📈 SMART METRICS" obj={report.smart_metrics} color="#22c55e" />
      </div>
      <div>
        <Section title="🧱 BLOCK / BBT INFO" obj={report.bbt_info} color="#f59e0b" />
        <Section title="💾 USAGE STATS" obj={report.usage_stats} color="#06b6d4" />
        <Section title="🛡️ ECC / LDPC CONTEXT" obj={report.ecc_ldpc_context} color="#a855f7" />
      </div>
    </div>
  )
}

export function CryptoView({ aes, shares, onReconstruct }) {
  const [selected, setSelected] = useState([])
  
  const toggle = (idx) => {
    if (selected.includes(idx)) setSelected(selected.filter(i => i !== idx))
    else if (selected.length < 3) setSelected([...selected, idx])
  }

  return (
    <div className="fade-in">
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 className="title-md" style={{ marginBottom: '0.8rem', color: '#8b5cf6' }}>🔐 AES-256-GCM Encryption</h3>
        {!aes ? <div style={{ color: 'var(--text-muted)' }}>Report not yet encrypted.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <div className="metric-tile"><div className="metric-label">Key ID</div><div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: '#8b5cf6' }}>{aes.key.slice(0, 16)}...</div></div>
            <div className="metric-tile"><div className="metric-label">IV (Nonce)</div><div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: '#8b5cf6' }}>{aes.iv}</div></div>
            <div className="metric-tile"><div className="metric-label">Size</div><div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: '#8b5cf6' }}>{aes.size} bytes</div></div>
            <div className="metric-tile" style={{ gridColumn: 'span 1' }}><div className="metric-label">Ciphertext (Preview)</div><div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{aes.ciphertext.slice(0, 30)}...</div></div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="title-md" style={{ marginBottom: '0.8rem', color: '#f59e0b' }}>🗝️ Shamir Secret Sharing (3-of-5)</h3>
        {!shares.length ? <div style={{ color: 'var(--text-muted)' }}>Key not split yet.</div> : (
          <div className="grid-2">
            <div>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '0.8rem' }}>Check 3 shares to simulate gathering keys for recovery:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {shares.map(s => (
                  <label key={s.index} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '8px 12px', border: `1px solid ${selected.includes(s.index) ? '#f59e0b' : 'var(--border)'}`,
                    borderRadius: 8, background: selected.includes(s.index) ? '#f59e0b11' : 'var(--bg-card2)',
                    cursor: selected.length >= 3 && !selected.includes(s.index) ? 'not-allowed' : 'pointer'
                  }}>
                    <input type="checkbox" checked={selected.includes(s.index)} onChange={() => toggle(s.index)} disabled={selected.length >= 3 && !selected.includes(s.index)} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: selected.includes(s.index) ? '#f59e0b' : 'var(--text)' }}>#{s.index} - {s.dest}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--text-dim)' }}>{s.shareData}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-card2)', borderRadius: 10, border: '1px dashed var(--border)', padding: '2rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: 10 }}>{selected.length === 3 ? '🔓' : '🔒'}</div>
              <div style={{ fontWeight: 700, color: selected.length === 3 ? '#22c55e' : '#f59e0b', marginBottom: 14 }}>{selected.length} of 3 Shares Collected</div>
              <button className="btn" style={{ background: selected.length === 3 ? '#22c55e' : 'var(--bg-card)', color: selected.length === 3 ? '#fff' : 'var(--text-muted)' }}
                disabled={selected.length < 3}
                onClick={onReconstruct}
              >
                Reconstruct AES Key →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function DistributedStorageView({ active, hash }) {
  const nodes = ['IPFS Node [US-East]', 'IPFS Node [EU-West]', 'AURA Immutable Ledger (Substrate)', 'Arweave Permanent Sync']
  return (
    <div className="card" style={{ marginTop: '1rem', border: `1px solid ${active ? '#3b82f655' : 'var(--border)'}` }}>
      <h3 className="title-md" style={{ marginBottom: '0.8rem', color: '#3b82f6' }}>🌐 Distributed Storage (IPFS)</h3>
      {!active ? <div style={{ color: 'var(--text-muted)' }}>Not pushed to network yet.</div> : (
        <div className="fade-in">
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <span className="badge badge-info">REDUNDANCY: 3x COPIES/NODE</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: '#3b82f6' }}>Hash: {hash}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nodes.map((n, i) => (
              <div key={i} style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.1)', borderRadius: 6, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
                <span style={{ color: '#93c5fd' }}>{n}</span>
                <span style={{ color: '#22c55e' }}>✅ PUSHED</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
