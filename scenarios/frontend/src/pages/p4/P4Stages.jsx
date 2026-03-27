import { useState } from 'react'
import { termToBinary, termToStr, tryFactor, computeMetrics } from './P4Engine.js'

// ── Collapsible stage wrapper ─────────────────────────────────────────────────
export function Stage({ num, title, defaultOpen = true, color = '#a855f7', children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card" style={{ marginBottom: '0.8rem', borderLeft: `3px solid ${color}` }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'none', border: 'none', color: 'var(--text)', textAlign: 'left',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        cursor: 'pointer', fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.88rem', padding: 0,
      }}>
        <span style={{ color }}>{num}</span>&nbsp;<span>{title}</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{open ? '▼' : '▶'}</span>
      </button>
      {open && <div style={{ marginTop: '0.8rem' }}>{children}</div>}
    </div>
  )
}

// ── Truth table ───────────────────────────────────────────────────────────────
export function TruthTableView({ rows, vars, dontCares = [] }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
      <table className="data-table">
        <thead><tr>
          <th>#</th>
          {vars.map(v => <th key={v}>{v}</th>)}
          <th>Output</th>
        </tr></thead>
        <tbody>
          {rows.map((row, i) => {
            const isDC = dontCares.includes(i)
            const out = isDC ? 'X' : row.Output
            const bg = out === 1 ? '#052e16' : out === 0 ? '#120000' : '#1c1400'
            const col = out === 1 ? '#22c55e' : out === 0 ? '#4a4a60' : '#f59e0b'
            return (
              <tr key={i}>
                <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>m{i}</td>
                {vars.map(v => <td key={v} style={{ textAlign: 'center', fontFamily: 'var(--mono)' }}>{row[v]}</td>)}
                <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, color: col, background: bg }}>{out}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── K-Map grid ────────────────────────────────────────────────────────────────
export function KMapView({ n, onSet, dontCares }) {
  const gray2 = [0, 1, 3, 2], gray4 = [0, 1, 3, 2, 4, 5, 7, 6, 12, 13, 15, 14, 8, 9, 11, 10]
  const rowCount = Math.max(1, Math.floor(n / 2)), colCount = n - rowCount
  const rowOrder = rowCount === 2 ? gray2 : [0, 1]
  const colOrder = colCount === 2 ? gray2 : colCount === 1 ? [0, 1] : [0, 1, 3, 2]
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: '0.82rem' }}>
        <tbody>
          {rowOrder.slice(0, 1 << rowCount).map((rowIdx, ri) => (
            <tr key={ri}>
              {colOrder.slice(0, 1 << colCount).map((colIdx, ci) => {
                const m = (rowIdx << colCount) | colIdx
                const isOn = onSet.includes(m), isDC = dontCares.includes(m)
                const bg = isOn ? '#052e16' : isDC ? '#1c1400' : '#0a0014'
                const col = isOn ? '#22c55e' : isDC ? '#f59e0b' : '#2a2a4a'
                return (
                  <td key={ci} style={{ border: '1px solid var(--border)', width: 56, height: 44, textAlign: 'center', background: bg, color: col, fontWeight: 700, position: 'relative' }}>
                    {isDC ? 'X' : isOn ? '1' : '0'}
                    <div style={{ fontSize: 9, color: '#4a4a60', position: 'absolute', bottom: 2, right: 4 }}>m{m}</div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: '0.75rem', display: 'flex', gap: 12 }}>
        <span style={{ color: '#22c55e' }}>■ 1 (on-set)</span>
        <span style={{ color: '#f59e0b' }}>■ X (don't care)</span>
        <span style={{ color: '#4a4a60' }}>■ 0 (off-set)</span>
      </div>
    </div>
  )
}

// ── QMC iteration table ───────────────────────────────────────────────────────
export function QMCView({ steps, pis, n }) {
  return (
    <div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '0.8rem' }}>
        <b>{steps.length}</b> iterations · <b>{pis.length}</b> prime implicants found
      </div>
      {steps.map((step, si) => (
        <div key={si} style={{ marginBottom: '1rem' }}>
          <div style={{ color: '#a855f7', fontFamily: 'var(--mono)', fontSize: '0.78rem', marginBottom: 4 }}>
            Iteration {step.iteration} — {step.merges.length} merge(s), {step.primes_found.length} prime(s) identified
          </div>
          {step.merges.length > 0 && (
            <table className="data-table" style={{ marginBottom: 4 }}>
              <thead><tr><th>Term 1</th><th>Term 2</th><th>→ Merged</th><th>XOR diff</th></tr></thead>
              <tbody>
                {step.merges.map((m, mi) => {
                  const diff = m[0][0] ^ m[1][0]
                  return (
                    <tr key={mi}>
                      <td style={{ fontFamily: 'var(--mono)' }}>{termToBinary(m[0][0], m[0][1], n)}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{termToBinary(m[1][0], m[1][1], n)}</td>
                      <td style={{ fontFamily: 'var(--mono)', color: '#22c55e', fontWeight: 700 }}>{termToBinary(m[2][0], m[2][1], n)}</td>
                      <td style={{ fontFamily: 'var(--mono)', color: '#06b6d4' }}>{diff.toString(2).padStart(n, '0')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {step.primes_found.length > 0 && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: '#a855f7' }}>
              Prime(s) locked: {step.primes_found.map(p => termToBinary(p[0], p[1], n)).join(', ')}
            </div>
          )}
        </div>
      ))}
      {pis.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: '0.85rem' }}>All prime implicants:</div>
          <table className="data-table">
            <thead><tr><th>Binary</th><th>SOP Term</th><th>Covers</th></tr></thead>
            <tbody>
              {pis.map((pi, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'var(--mono)' }}>{termToBinary(pi[0], pi[1], n)}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: '#a855f7' }}>{termToStr(pi, Array.from({ length: n }, (_, k) => String.fromCharCode(65 + k)))}</td>
                  <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>PI-{i}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Cost comparison view ──────────────────────────────────────────────────────
export function CostView({ expr, optimizedExpr, factoredExpr, mB, mA, mF }) {
  const pct = mB.cost > 0 ? ((mB.cost - mA.cost) / mB.cost * 100).toFixed(1) : 0
  const saved = mB.cost > mA.cost
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: factoredExpr !== optimizedExpr ? 'repeat(3,1fr)' : '1fr 1fr', gap: '0.8rem', marginBottom: '1rem' }}>
        {[
          { label: '❌ BEFORE (original)', color: '#ef4444', bg: '#120000', border: '#ef444440', ex: expr, m: mB },
          { label: '✅ AFTER (QMC)', color: '#22c55e', bg: '#052e16', border: '#22c55e40', ex: optimizedExpr, m: mA },
          ...(factoredExpr !== optimizedExpr ? [{ label: '🔵 FACTORED', color: '#3b82f6', bg: '#001230', border: '#3b82f640', ex: factoredExpr, m: mF }] : []),
        ].map(({ label, color, bg, border, ex, m }) => (
          <div key={label} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ color, fontSize: '0.75rem', marginBottom: 6, fontFamily: 'var(--mono)' }}>{label}</div>
            <code style={{ display: 'block', background: 'var(--bg-card2)', padding: '0.4rem', borderRadius: 4, marginBottom: 8, color: 'var(--text)', fontSize: '0.78rem', wordBreak: 'break-all' }}>{ex}</code>
            <table style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', width: '100%' }}>
              {[['AND', m.and, color], ['OR', m.or, color], ['NOT', m.not, color], ['Cost', m.cost, color], ['Complexity', m.complexity, color]].map(([k, v, c]) => (
                <tr key={k}><td style={{ color: 'var(--text-muted)' }}>{k}</td><td style={{ color: c, textAlign: 'right', fontWeight: 700 }}>{v}</td></tr>
              ))}
            </table>
          </div>
        ))}
      </div>
      {saved && (
        <div>
          <div style={{ color: '#22c55e', fontWeight: 700, marginBottom: 4 }}>⚡ Gate cost reduced by <b>{pct}%</b> — {mB.cost} → {mA.cost} units</div>
          <div style={{ background: 'var(--bg-card2)', borderRadius: 4, height: 12, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(pct, 100)}%`, height: '100%', background: 'linear-gradient(90deg,#a855f7,#22c55e)', borderRadius: 4, transition: 'width 0.8s' }} />
          </div>
        </div>
      )}
      {!saved && <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Expression is already minimal — no further reduction possible.</div>}
    </div>
  )
}

// ── Firmware C code view ──────────────────────────────────────────────────────
export function FirmwareView({ cBefore, cAfter, onDownload }) {
  const [tab, setTab] = useState('after')
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {[['before', '❌ Original C'], ['after', '✅ Optimized C']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '4px 14px', borderRadius: 6, border: `1px solid ${tab === id ? '#a855f7' : 'var(--border)'}`,
            background: tab === id ? 'rgba(168,85,247,0.15)' : 'transparent',
            color: tab === id ? '#a855f7' : 'var(--text-muted)', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.82rem', fontWeight: 600
          }}>{label}</button>
        ))}
      </div>
      <pre style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '1rem', overflow: 'auto', fontSize: '0.8rem', color: tab === 'after' ? '#86efac' : '#fca5a5', fontFamily: 'var(--mono)', lineHeight: 1.6, maxHeight: 280 }}>
        {tab === 'after' ? cAfter : cBefore}
      </pre>
      <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={onDownload}>⬇ Download Optimized C</button>
    </div>
  )
}
