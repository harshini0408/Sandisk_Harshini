import { useState } from 'react'
import {
  extractVars, autoCorrect, generateTruthTable, quine_mccluskey, petricks,
  buildExpr, tryFactor, computeMetrics, generateC, genSuggestions,
  termToBinary, termToStr, BUILTIN_TESTS, SIGNAL_OPTIONS
} from './p4/P4Engine.js'
import { Stage, TruthTableView, KMapView, QMCView, CostView, FirmwareView } from './p4/P4Stages.jsx'

const TABS = [
  { id: 'pipeline', label: '🔬 Pipeline' },
  { id: 'analysis', label: '📊 Analysis' },
  { id: 'tests',    label: '🧪 Test Cases' },
]
const C = { purple: '#a855f7', green: '#22c55e', red: '#ef4444', amber: '#f59e0b', blue: '#3b82f6' }

function runPipeline(rawExpr, dcStr, method, varMap) {
  const cr = autoCorrect(rawExpr)
  if (!cr.valid) throw new Error(`Invalid expression: ${cr.error}`)
  const expr = cr.corrected
  const vars = extractVars(expr), n = vars.length
  if (n > 6) throw new Error('Too many variables (max 6)')
  if (n === 0) throw new Error('No variables found (use A–E)')
  const dontCares = dcStr.trim() ? dcStr.split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x)) : []
  const { rows, onSet, offSet } = generateTruthTable(expr, vars)
  if (!onSet.length) throw new Error('Expression is identically 0 — nothing to minimize.')
  const useKmap = (n <= 4) && method !== 'qmc'
  const { pis, steps } = quine_mccluskey(onSet, dontCares, n)
  const { selected: selPis, coverage, essential } = petricks(pis, onSet)
  const optimizedExpr = buildExpr(selPis, vars)
  const factoredExpr  = tryFactor(optimizedExpr)
  const mB = computeMetrics(expr), mA = computeMetrics(optimizedExpr), mF = computeMetrics(factoredExpr)
  // BDD verify
  let verified = true; const mismatches = []
  for (let i = 0; i < (1 << n); i++) {
    if (dontCares.includes(i)) continue
    const assign = {}; vars.forEach((v, j) => { assign[v] = (i >> (n - 1 - j)) & 1 })
    const a = safeEvalLocal(expr, assign), b = safeEvalLocal(optimizedExpr, assign)
    if (a !== b) { verified = false; mismatches.push({ minterm: `m${i}`, original: a, optimized: b }) }
  }
  const suggestions = genSuggestions(expr, optimizedExpr, mB, mA)
  const cBefore = generateC(expr, varMap, 'Original')
  const cAfter  = generateC(factoredExpr, varMap, 'Optimized')
  return { cr, expr, vars, n, dontCares, rows, onSet, offSet, useKmap, steps, pis, selPis,
           coverage, essential, optimizedExpr, factoredExpr, mB, mA, mF, verified, mismatches,
           suggestions, cBefore, cAfter }
}

function safeEvalLocal(expr, assignment) {
  let e = expr
    .replace(/\b([A-E])\b/g, (_, v) => assignment[v] !== undefined ? assignment[v] : 0)
    .replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!')
    .replace(/\b0\b/g, 'false').replace(/\b1\b/g, 'true')
    .replace(/\s*&\s*/g, '&&').replace(/\s*\+\s*/g, '||')
  try { return new Function(`'use strict'; return !!(${e})`)() ? 1 : 0 } catch { return 0 }
}

function runTestCase(tc) {
  try {
    const cr = autoCorrect(tc.expr); if (!cr.valid) return null
    const expr = cr.corrected, vars = extractVars(expr), n = vars.length
    const { rows, onSet } = generateTruthTable(expr, vars)
    if (!onSet.length) return null
    const { pis } = quine_mccluskey(onSet, tc.dont_cares, n)
    const { selected } = petricks(pis, onSet)
    const opt = buildExpr(selected, vars), fac = tryFactor(opt)
    const mB = computeMetrics(expr), mA = computeMetrics(fac)
    let bdd = true
    for (let i = 0; i < (1 << n); i++) {
      if (tc.dont_cares.includes(i)) continue
      const a = {}; vars.forEach((v, j) => { a[v] = (i >> (n - 1 - j)) & 1 })
      if (safeEvalLocal(expr, a) !== safeEvalLocal(fac, a)) { bdd = false; break }
    }
    const pct = mB.cost > 0 && mB.cost > mA.cost ? ((mB.cost - mA.cost) / mB.cost * 100).toFixed(1) : null
    return { opt, fac, mB, mA, pct, bdd }
  } catch { return null }
}

// ── Input row helper ──────────────────────────────────────────────────────────
function InputGroup({ label, children }) {
  return (
    <div style={{ marginBottom: '0.7rem' }}>
      <div className="metric-label" style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}
const inputStyle = { width: '100%', background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '0.45rem 0.8rem', fontFamily: 'var(--mono)', fontSize: '0.88rem', boxSizing: 'border-box' }

// ═══════════════════════════════════════════════════════════════════════════════
export default function Pillar4Page() {
  const [rawExpr, setRawExpr] = useState('(A & B & C) + (A & B & D)')
  const [dcStr,   setDcStr]   = useState('')
  const [method,  setMethod]  = useState('auto')
  const [varMap,  setVarMap]  = useState({ A: 'ecc_error', B: 'bad_block', C: 'wear_limit', D: 'write_request', E: 'read_fail' })
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')
  const [activeTab, setActiveTab] = useState('pipeline')

  function run() {
    setError(''); setResult(null)
    try { setResult(runPipeline(rawExpr, dcStr, method, varMap)) }
    catch (e) { setError(e.message) }
  }

  function loadTest(tc) {
    setRawExpr(tc.expr); setDcStr(tc.dont_cares.join(','))
    setResult(null); setError(''); setActiveTab('pipeline')
  }

  return (
    <div className="page fade-in">
      <div className="page-inner">

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#12121a,#1a1a2e)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.5rem', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '1.1rem', fontWeight: 700 }}>⚙️ PILLAR 4 — Firmware Logic Optimization Engine</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: 3 }}>Parse → Truth Table → K-Map / QMC → Petrick's → Factor → BDD Verify → C Code</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '0.6rem', marginTop: '0.8rem' }}>
            {[{ l: 'Mode', v: 'BUILD-TIME' }, { l: 'Reduction', v: '30–40%' }, { l: 'Method', v: 'QMC+Petrick' }, { l: 'Output', v: 'C Firmware' }].map(m => (
              <div key={m.l} className="metric-tile" style={{ padding: '0.5rem 0.8rem' }}>
                <div className="metric-label">{m.l}</div>
                <div style={{ color: C.purple, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '0.9rem' }}>{m.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Config panel */}
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="title-md" style={{ marginBottom: '0.8rem' }}>⚙ Configuration</div>
          <div className="grid-2">
            <div>
              <InputGroup label="Boolean Expression (use A–E, &, +, !)">
                <input value={rawExpr} onChange={e => setRawExpr(e.target.value)} style={inputStyle} />
              </InputGroup>
              <InputGroup label="Don't-Care minterms (comma-separated, optional)">
                <input value={dcStr} onChange={e => setDcStr(e.target.value)} placeholder="e.g. 5,7" style={inputStyle} />
              </InputGroup>
              <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', marginTop: 6 }}>
                {[['auto', 'Auto (K-Map ≤4 vars, QMC otherwise)'], ['qmc', 'Force QMC']].map(([v, l]) => (
                  <label key={v} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="radio" name="method" checked={method === v} onChange={() => setMethod(v)} /> {l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="metric-label" style={{ marginBottom: 6 }}>Variable → SSD Signal Mapping</div>
              {['A', 'B', 'C', 'D', 'E'].map(v => (
                <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                  <span style={{ fontFamily: 'var(--mono)', color: C.purple, minWidth: 18, fontWeight: 700 }}>{v}</span>
                  <select value={varMap[v]} onChange={e => setVarMap(m => ({ ...m, [v]: e.target.value }))}
                    style={{ flex: 1, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 6, padding: '0.3rem 0.5rem', fontSize: '0.82rem' }}>
                    {SIGNAL_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: '0.8rem', minWidth: 240 }} onClick={run}>▶ Run Optimization Pipeline</button>
          {error && <div style={{ marginTop: 8, color: C.red, fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>❌ {error}</div>}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.2rem' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              padding: '0.55rem 1.1rem', border: 'none', background: 'transparent',
              color: activeTab === t.id ? C.purple : 'var(--text-muted)',
              borderBottom: activeTab === t.id ? `2px solid ${C.purple}` : '2px solid transparent',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: '0.87rem', fontWeight: 600, transition: 'all 0.2s'
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ TAB: Pipeline ══════════════════════════════════════════════════ */}
        {activeTab === 'pipeline' && (
          <div className="fade-in">
            {!result && !error && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                Enter a Boolean expression and click <b style={{ color: C.purple }}>▶ Run Optimization Pipeline</b> to begin.
              </div>
            )}
            {result && (
              <div>
                {/* Stage 0: Auto-correct */}
                <Stage num="📋" title="Stage 0 — Auto-Correction" color={C.purple}>
                  {result.cr.changes.length > 0 ? (
                    <div>
                      <div style={{ color: C.amber, marginBottom: 6, fontSize: '0.85rem' }}>Expression was auto-corrected:</div>
                      {result.cr.changes.map((c, i) => <div key={i} style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>• {c}</div>)}
                    </div>
                  ) : (
                    <div style={{ color: C.green, fontSize: '0.85rem' }}>✓ Expression is well-formed — no corrections needed.</div>
                  )}
                  <div style={{ marginTop: 10, fontFamily: 'var(--mono)', fontSize: '0.82rem', display: 'flex', gap: 16 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Variables: <b style={{ color: C.purple }}>{result.vars.join(', ')}</b></span>
                    <span style={{ color: 'var(--text-muted)' }}>n = <b style={{ color: C.blue }}>{result.n}</b></span>
                    <span style={{ color: 'var(--text-muted)' }}>On-set minterms: <b style={{ color: C.green }}>{result.onSet.length}</b></span>
                  </div>
                </Stage>

                {/* Stage 1: Truth Table */}
                <Stage num="📊" title="Stage 1 — Truth Table" color={C.green}>
                  <TruthTableView rows={result.rows} vars={result.vars} dontCares={result.dontCares} />
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    On-set: {JSON.stringify(result.onSet)} | Don't-cares: {JSON.stringify(result.dontCares)} | Off-set: {result.offSet.length}
                  </div>
                </Stage>

                {/* Stage 2: K-Map or QMC decision */}
                <Stage num="🗂️" title={result.useKmap ? 'Stage 2 — K-Map Visualization' : 'Stage 2 — Algorithm Decision: QMC'} color={C.blue}>
                  {result.useKmap ? (
                    <div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 8 }}>
                        Rows = {result.vars.slice(0, Math.floor(result.n / 2)).join('')} | Cols = {result.vars.slice(Math.floor(result.n / 2)).join('')}
                      </div>
                      <KMapView n={result.n} onSet={result.onSet} dontCares={result.dontCares} />
                    </div>
                  ) : (
                    <div style={{ padding: '0.8rem', background: 'rgba(59,130,246,0.08)', borderRadius: 8, border: '1px solid rgba(59,130,246,0.2)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
                      <span style={{ color: C.blue }}>→ Using Quine-McCluskey</span> (n={result.n} — K-map not practical for ≥5 variables)
                      <br /><span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>QMC works by iteratively merging minterms differing by 1 bit, extracting prime implicants.</span>
                    </div>
                  )}
                </Stage>

                {/* Stage 3: QMC */}
                <Stage num="🔢" title="Stage 3 — Quine-McCluskey Reduction" color={C.purple}>
                  <QMCView steps={result.steps} pis={result.pis} n={result.n} />
                </Stage>

                {/* Stage 4: Petrick's Method */}
                <Stage num="🎯" title="Stage 4 — Petrick's Method (Minimal Cover)" color={C.amber}>
                  {result.essential.length > 0 && (
                    <div style={{ color: C.green, fontFamily: 'var(--mono)', fontSize: '0.82rem', marginBottom: 6 }}>
                      Essential PIs (cover unique minterms): indices {JSON.stringify(result.essential)}
                    </div>
                  )}
                  <table className="data-table" style={{ marginBottom: 10 }}>
                    <thead><tr><th>Minterm</th><th>Covered by PIs</th><th>Essential</th></tr></thead>
                    <tbody>
                      {Object.entries(result.coverage).map(([m, piList]) => (
                        <tr key={m}>
                          <td style={{ fontFamily: 'var(--mono)' }}>m{m}</td>
                          <td style={{ fontFamily: 'var(--mono)' }}>{JSON.stringify(piList)}</td>
                          <td style={{ textAlign: 'center' }}>{piList.length === 1 ? '✅' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
                    <b>Minimized SOP:</b> <code style={{ background: 'var(--bg-card2)', padding: '2px 8px', borderRadius: 4, color: C.purple }}>{result.optimizedExpr}</code>
                  </div>
                  {result.factoredExpr !== result.optimizedExpr && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', marginTop: 6 }}>
                      <b>Factored (cheaper):</b> <code style={{ background: 'var(--bg-card2)', padding: '2px 8px', borderRadius: 4, color: C.blue }}>{result.factoredExpr}</code>
                    </div>
                  )}
                </Stage>

                {/* Stage 5: Cost Analysis */}
                <Stage num="📈" title="Stage 5 — Cost & Complexity Analysis" color={C.green}>
                  <CostView expr={result.expr} optimizedExpr={result.optimizedExpr}
                    factoredExpr={result.factoredExpr} mB={result.mB} mA={result.mA} mF={result.mF} />
                </Stage>

                {/* Stage 6: Refactoring */}
                <Stage num="🔧" title="Stage 6 — Refactoring & Depth Reduction" color={C.amber} defaultOpen={false}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 8 }}>
                    Structural comparison: depth, term count, and operation count before vs after full optimization.
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Metric</th><th style={{ color: C.red }}>Before</th><th style={{ color: C.green }}>QMC After</th><th style={{ color: C.blue }}>Factored</th><th>Δ</th></tr></thead>
                    <tbody>
                      {[
                        ['AND gates', result.mB.and, result.mA.and, result.mF.and],
                        ['OR gates',  result.mB.or,  result.mA.or,  result.mF.or],
                        ['NOT gates', result.mB.not, result.mA.not, result.mF.not],
                        ['Terms',     result.mB.terms, result.mA.terms, result.mF.terms],
                        ['Depth',     result.mB.depth, result.mA.depth, result.mF.depth],
                        ['Gate cost', result.mB.cost, result.mA.cost, result.mF.cost],
                        ['Complexity score', result.mB.complexity, result.mA.complexity, result.mF.complexity],
                      ].map(([k, b, a, f]) => (
                        <tr key={k}>
                          <td style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{k}</td>
                          <td style={{ textAlign: 'center', color: C.red, fontFamily: 'var(--mono)' }}>{b}</td>
                          <td style={{ textAlign: 'center', color: C.green, fontFamily: 'var(--mono)' }}>{a}</td>
                          <td style={{ textAlign: 'center', color: C.blue, fontFamily: 'var(--mono)' }}>{f}</td>
                          <td style={{ textAlign: 'center', color: b > a ? C.green : 'var(--text-muted)', fontFamily: 'var(--mono)', fontWeight: 700 }}>
                            {b > a ? `−${b - a}` : b === a ? '—' : `+${a - b}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, padding: '0.6rem', background: 'rgba(168,85,247,0.07)', borderRadius: 8, border: '1px solid rgba(168,85,247,0.2)', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    <b style={{ color: C.purple }}>Complexity Score</b> = 2×AND + 2×OR + 1×NOT + 3×depth + 2×terms. Lower = better firmware efficiency.
                  </div>
                </Stage>

                {/* Stage 7: BDD Verification */}
                <Stage num="✅" title="Stage 7 — BDD Verification (Exhaustive)" color={result.verified ? C.green : C.red}>
                  {result.verified ? (
                    <div>
                      <div style={{ color: C.green, fontWeight: 700, marginBottom: 4 }}>
                        ✅ BDD Verification PASSED — Logically identical across all {1 << result.n} input combinations.
                      </div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: C.green }}>
                        Tested {(1 << result.n) - result.dontCares.length} combinations · 0 mismatches · Mathematical proof complete.
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: C.red, fontWeight: 700 }}>⚠️ Verification FAILED — {result.mismatches.length} mismatch(es)!</div>
                      <table className="data-table" style={{ marginTop: 8 }}>
                        <thead><tr><th>Minterm</th><th>Original</th><th>Optimized</th></tr></thead>
                        <tbody>{result.mismatches.map((m, i) => <tr key={i}><td>{m.minterm}</td><td>{m.original}</td><td>{m.optimized}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </Stage>

                {/* Stage 8: Firmware C Code */}
                <Stage num="💾" title="Stage 8 — Firmware C Code Generator" color={C.blue}>
                  <FirmwareView cBefore={result.cBefore} cAfter={result.cAfter}
                    onDownload={() => {
                      const a = document.createElement('a')
                      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(result.cAfter)
                      a.download = 'ssd_optimized_logic.c'; a.click()
                    }} />
                </Stage>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB: Analysis Dashboard ════════════════════════════════════ */}
        {activeTab === 'analysis' && (
          <div className="fade-in">
            {!result ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                Run the pipeline first to see the analysis dashboard.
              </div>
            ) : (
              <div>
                {/* Feature 1+2: Expression metrics */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>📐 Expression Analysis</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '0.8rem', marginBottom: '1rem' }}>
                    {[
                      ['Variables', result.vars.join(', '), C.purple],
                      ['On-set minterms', result.onSet.length, C.green],
                      ['Don\'t-cares', result.dontCares.length, C.amber],
                      ['AND gates', `${result.mB.and} → ${result.mA.and}`, C.blue],
                      ['OR gates',  `${result.mB.or} → ${result.mA.or}`,   C.blue],
                      ['NOT gates', `${result.mB.not} → ${result.mA.not}`, C.blue],
                    ].map(([k, v, c]) => (
                      <div key={k} className="metric-tile">
                        <div className="metric-label">{k}</div>
                        <div style={{ color: c, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: '1rem' }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Feature 6: Complexity Meter */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>🎯 Complexity Meter</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: 10 }}>
                    Score = 2×AND + 2×OR + 1×NOT + 3×depth + 2×terms. Lower = simpler firmware.
                  </div>
                  {[
                    { label: 'Before', val: result.mB.complexity, color: C.red },
                    { label: 'After QMC', val: result.mA.complexity, color: C.green },
                    { label: 'Factored', val: result.mF.complexity, color: C.blue },
                  ].map(row => {
                    const max = Math.max(result.mB.complexity, 1)
                    return (
                      <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--mono)', fontSize: '0.78rem', minWidth: 80 }}>{row.label}</span>
                        <div style={{ flex: 1, background: 'var(--bg-card2)', borderRadius: 4, height: 12, overflow: 'hidden' }}>
                          <div style={{ width: `${(row.val / max) * 100}%`, height: '100%', background: row.color, borderRadius: 4, transition: 'width 0.6s' }} />
                        </div>
                        <span style={{ color: row.color, fontFamily: 'var(--mono)', minWidth: 28, fontWeight: 700, fontSize: '0.85rem' }}>{row.val}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Feature 7: Suggestions Engine */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>💡 Suggestions Engine</div>
                  {result.suggestions.map((s, i) => {
                    const col = s.type === 'win' ? C.green : s.type === 'info' ? C.blue : C.amber
                    const icon = s.type === 'win' ? '✅' : s.type === 'info' ? 'ℹ️' : '💡'
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', background: col + '10', border: `1px solid ${col}30`, borderRadius: 8, marginBottom: 6 }}>
                        <span>{icon}</span>
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.83rem', fontFamily: 'var(--mono)' }}>{s.msg}</span>
                      </div>
                    )
                  })}
                </div>

                {/* Feature 8: Firmware Efficiency */}
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>⚡ Firmware Efficiency Report</div>
                  <table className="data-table">
                    <thead><tr><th>Metric</th><th>Original</th><th>Optimized</th><th>Factored</th><th>Best</th></tr></thead>
                    <tbody>
                      {[
                        ['Gate cost', result.mB.cost, result.mA.cost, result.mF.cost],
                        ['Complexity', result.mB.complexity, result.mA.complexity, result.mF.complexity],
                        ['Depth', result.mB.depth, result.mA.depth, result.mF.depth],
                        ['Operations', result.mB.and + result.mB.or + result.mB.not, result.mA.and + result.mA.or + result.mA.not, result.mF.and + result.mF.or + result.mF.not],
                      ].map(([k, b, a, f]) => {
                        const best = Math.min(b, a, f)
                        return (
                          <tr key={k}>
                            <td style={{ fontFamily: 'var(--mono)' }}>{k}</td>
                            <td style={{ textAlign: 'center', color: C.red, fontFamily: 'var(--mono)' }}>{b}</td>
                            <td style={{ textAlign: 'center', color: a <= b ? C.green : C.amber, fontFamily: 'var(--mono)' }}>{a}</td>
                            <td style={{ textAlign: 'center', color: f <= a ? C.blue : 'var(--text-dim)', fontFamily: 'var(--mono)' }}>{f}</td>
                            <td style={{ textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700, color: C.green }}>{best}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div style={{ marginTop: 10, padding: '0.7rem', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
                    <b style={{ color: C.green }}>BDD Verification:</b> <span style={{ color: result.verified ? C.green : C.red }}>{result.verified ? '✅ PASSED' : '❌ FAILED'}</span>
                    &nbsp;·&nbsp;
                    <b style={{ color: C.purple }}>Reduction:</b> <span style={{ color: C.purple }}>
                      {result.mB.cost > result.mA.cost ? `-${((result.mB.cost - result.mA.cost) / result.mB.cost * 100).toFixed(1)}%` : 'Already minimal'}
                    </span>
                  </div>
                </div>

                {/* Feature 9: C code in analysis tab */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom: '0.8rem' }}>💾 Firmware Code Output</div>
                  <FirmwareView cBefore={result.cBefore} cAfter={result.cAfter}
                    onDownload={() => {
                      const a = document.createElement('a')
                      a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(result.cAfter)
                      a.download = 'ssd_optimized_logic.c'; a.click()
                    }} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ TAB: Tests ═════════════════════════════════════════════════ */}
        {activeTab === 'tests' && (
          <div className="fade-in">
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: '0.7rem 1rem', marginBottom: '1rem' }}>
              {BUILTIN_TESTS.length} built-in firmware logic cases. Each runs the full QMC pipeline automatically. Click <b>Load →</b> to open in the pipeline tab.
            </div>
            {BUILTIN_TESTS.map((tc, idx) => {
              const r = runTestCase(tc)
              return (
                <Stage key={idx} num={`Test ${idx + 1}:`} title={tc.label} defaultOpen={idx === 0} color={C.purple}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 10 }}>{tc.desc}</div>
                  {r ? (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '0.6rem', alignItems: 'stretch' }}>
                        <div style={{ background: '#120000', border: '1px solid #ef444440', borderRadius: 6, padding: 10, fontFamily: 'var(--mono)' }}>
                          <div style={{ color: '#fca5a5', fontSize: '0.7rem' }}>ORIGINAL</div>
                          <div style={{ color: C.red, fontSize: '0.85rem', margin: '4px 0', wordBreak: 'break-all' }}>{tc.expr}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Cost: {r.mB.cost} | Complexity: {r.mB.complexity}</div>
                        </div>
                        <div style={{ background: '#052e16', border: '1px solid #22c55e40', borderRadius: 6, padding: 10, fontFamily: 'var(--mono)' }}>
                          <div style={{ color: '#86efac', fontSize: '0.7rem' }}>OPTIMIZED (QMC)</div>
                          <div style={{ color: C.green, fontSize: '0.85rem', margin: '4px 0', wordBreak: 'break-all' }}>{r.opt}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Cost: {r.mA.cost} | Complexity: {r.mA.complexity}</div>
                        </div>
                        <div style={{ background: '#001230', border: '1px solid #3b82f640', borderRadius: 6, padding: 10, fontFamily: 'var(--mono)' }}>
                          <div style={{ color: '#93c5fd', fontSize: '0.7rem' }}>FACTORED</div>
                          <div style={{ color: C.blue, fontSize: '0.85rem', margin: '4px 0', wordBreak: 'break-all' }}>{r.fac}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>BDD: {r.bdd ? '✅' : '❌'}</div>
                        </div>
                        <div style={{ background: '#120020', border: '1px solid #a855f740', borderRadius: 6, padding: 10, fontFamily: 'var(--mono)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <div style={{ color: '#d8b4fe', fontSize: '0.7rem' }}>RESULT</div>
                          <div style={{ color: C.purple, fontSize: '1.3rem', fontWeight: 700 }}>{r.pct ? `-${r.pct}%` : '—'}</div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{r.pct ? 'gate reduction' : 'already minimal'}</div>
                        </div>
                      </div>
                      <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }} onClick={() => loadTest(tc)}>
                        Load in Pipeline →
                      </button>
                    </div>
                  ) : <div style={{ color: 'var(--text-muted)' }}>Error running test case</div>}
                </Stage>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
