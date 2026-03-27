// ── Pillar 4 Engine — Boolean Logic Optimization ─────────────────────────────

export function extractVars(expr) {
  return [...new Set(expr.match(/[A-E]/g) || [])].sort()
}

export function safeEval(expr, assignment) {
  let e = expr
    .replace(/\b([A-E])\b/g, (_, v) => assignment[v] !== undefined ? assignment[v] : 0)
    .replace(/\bAND\b/gi, '&&').replace(/\bOR\b/gi, '||').replace(/\bNOT\b/gi, '!')
    .replace(/\b0\b/g, 'false').replace(/\b1\b/g, 'true')
    .replace(/\s*&\s*/g, '&&').replace(/\s*\+\s*/g, '||')
    .replace(/!!!/g, '!')
  e = e.replace(/!(\d)/g, (_, n) => `!${n}`)
  try { return new Function(`'use strict'; return !!(${e})`)() ? 1 : 0 } catch { return 0 }
}

export function autoCorrect(raw) {
  let expr = raw.trim(), original = expr, changes = []
  const before = expr
  expr = expr.replace(/([A-E)])(\s*)([A-E(])/g, (m, a, sp, b) => `${a} & ${b}`)
  if (expr !== before) changes.push(`Implicit AND: ${before} → ${expr}`)
  expr = expr.replace(/\band\b/gi, '&').replace(/\bor\b/gi, '+').replace(/\bnot\b/gi, '!')
  let valid = true, error = ''
  try { const assign = Object.fromEntries(extractVars(expr).map(v => [v, 0])); safeEval(expr, assign) }
  catch (e_) { valid = false; error = e_.message }
  return { original, corrected: expr, changes, valid, error }
}

export function generateTruthTable(expr, vars) {
  const n = vars.length, rows = [], onSet = [], offSet = []
  for (let i = 0; i < (1 << n); i++) {
    const assignment = {}
    vars.forEach((v, j) => { assignment[v] = (i >> (n - 1 - j)) & 1 })
    const out = safeEval(expr, assignment)
    rows.push({ ...Object.fromEntries(vars.map((v, j) => [v, (i >> (n - 1 - j)) & 1])), Output: out })
    out === 1 ? onSet.push(i) : offSet.push(i)
  }
  return { rows, onSet, offSet }
}

export function termToBinary(minterm, mask, n) {
  let s = ''
  for (let i = n - 1; i >= 0; i--) s += (mask >> i) & 1 ? '-' : (minterm >> i) & 1
  return s
}

export function termToStr(pi, vars) {
  const [minterm, mask] = pi, n = vars.length, parts = []
  for (let i = 0; i < n; i++) {
    if ((mask >> (n - 1 - i)) & 1) continue
    parts.push(((minterm >> (n - 1 - i)) & 1) ? vars[i] : `!${vars[i]}`)
  }
  return parts.join(' & ') || '1'
}

export function quine_mccluskey(onSet, dontCares, n) {
  const all = [...onSet, ...dontCares].map(m => [m, 0])
  if (!all.length) return { pis: [], steps: [] }
  const steps = [], primes = new Set()
  let groups = all, iter = 0
  while (groups.length > 0 && iter < 8) {
    iter++
    const merges = [], usedSet = new Set(), newGroups = [], primesFound = []
    const bitCount = x => { let c = 0, v = x; while (v) { c += v & 1; v >>= 1 } return c }
    const sorted = [...groups].sort((a, b) => bitCount(a[0]) - bitCount(b[0]))
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const [m1, mask1] = sorted[i], [m2, mask2] = sorted[j]
        if (mask1 !== mask2) continue
        const diff = m1 ^ m2
        if (diff && (diff & (diff - 1)) === 0) {
          const nm = m1 & m2, nmask = mask1 | diff
          if (!newGroups.some(g => g[0] === nm && g[1] === nmask)) newGroups.push([nm, nmask])
          usedSet.add(`${m1}_${mask1}`); usedSet.add(`${m2}_${mask2}`)
          merges.push([sorted[i], sorted[j], [nm, nmask]])
        }
      }
    }
    for (const g of sorted) {
      if (!usedSet.has(`${g[0]}_${g[1]}`)) { primes.add(`${g[0]}_${g[1]}`); primesFound.push(g) }
    }
    steps.push({ iteration: iter, merges, primes_found: primesFound })
    groups = newGroups
  }
  for (const g of groups) primes.add(`${g[0]}_${g[1]}`)
  const pis = [...primes].map(r => { const [a, b] = r.split('_'); return [+a, +b] })
  return { pis, steps }
}

export function petricks(pis, onSet) {
  const coverage = {}, selected = []
  for (const m of onSet) {
    coverage[m] = pis.reduce((acc, [mt, mask], i) => {
      if ((mt & ~mask) === (m & ~mask)) acc.push(i)
      return acc
    }, [])
  }
  const essIdx = new Set()
  for (const [, piList] of Object.entries(coverage)) {
    if (piList.length === 1) essIdx.add(piList[0])
  }
  const essentialPis = [...essIdx].map(i => pis[i])
  const covered = new Set()
  essentialPis.forEach(pi => {
    onSet.forEach(m => { if ((pi[0] & ~pi[1]) === (m & ~pi[1])) covered.add(m) })
  })
  selected.push(...essentialPis)
  for (const m of onSet) {
    if (!covered.has(m)) {
      const piIdxList = coverage[m] || []
      if (piIdxList.length > 0) {
        const pi = pis[piIdxList[0]]
        if (!selected.some(s => s[0] === pi[0] && s[1] === pi[1])) {
          selected.push(pi)
          onSet.forEach(mm => { if ((pi[0] & ~pi[1]) === (mm & ~pi[1])) covered.add(mm) })
        }
      }
    }
  }
  return { selected, coverage, essential: [...essIdx] }
}

export function buildExpr(pis, vars) {
  if (!pis.length) return '0'
  return pis.map(p => termToStr(p, vars)).join(' + ')
}

// Try to factor: find common prefix in SOP terms
export function tryFactor(expr) {
  if (!expr || expr === '0') return expr
  const terms = expr.split(' + ').map(t => t.trim())
  if (terms.length < 2) return expr
  // Group by common literals
  const groupMap = {}
  for (const term of terms) {
    const lits = term.split(' & ').map(l => l.trim()).sort()
    for (const lit of lits) {
      if (!groupMap[lit]) groupMap[lit] = []
      groupMap[lit].push(lits.filter(l => l !== lit).join(' & ') || '1')
    }
  }
  let bestFactor = null, bestGroup = [], bestCount = 1
  for (const [lit, group] of Object.entries(groupMap)) {
    if (group.length > bestCount) { bestFactor = lit; bestGroup = group; bestCount = group.length }
  }
  if (!bestFactor) return expr
  const factored = `${bestFactor} & (${bestGroup.join(' + ')})`
  const remaining = terms.filter(t => !t.split(' & ').map(l => l.trim()).includes(bestFactor))
  return remaining.length ? `${factored} + ${remaining.join(' + ')}` : factored
}

export function computeMetrics(expr) {
  const and = (expr.match(/&/g) || []).length
  const or  = (expr.match(/\+/g) || []).length
  const not = (expr.match(/!/g) || []).length
  const terms = expr.split('+').length
  // Estimate depth: nested parens
  let depth = 0, maxDepth = 0, d = 0
  for (const c of expr) { if (c === '(') { d++; maxDepth = Math.max(maxDepth, d) } else if (c === ')') d-- }
  depth = Math.max(1, maxDepth)
  const cost = and * 2 + or * 2 + not * 1
  const complexity = 2 * and + 2 * or + 1 * not + 3 * depth + 2 * terms
  return { and, or, not, terms, depth, cost, complexity }
}

export function generateC(expr, varMap, label) {
  const vars = extractVars(expr)
  const params = vars.map(v => `int ${varMap[v] || v.toLowerCase()}`).join(', ')
  let body = expr
  for (const v of vars) body = body.replace(new RegExp(`\\b${v}\\b`, 'g'), varMap[v] || v.toLowerCase())
  body = body.replace(/&/g, '&&').replace(/\+/g, '||')
  return `/* ${label} ECC Decision Logic — AURA Firmware */\n/* Pillar 4 QMC-optimized: firmware-ready */\n\nstatic inline int ssd_decision(${params}) {\n    return (${body});\n}`
}

// Suggestions engine
export function genSuggestions(original, optimized, mB, mA) {
  const tips = []
  if (mB.and > mA.and) tips.push({ type: 'win', msg: `AND gates reduced ${mB.and}→${mA.and} (${mB.and - mA.and} gates saved)` })
  if (mB.or > mA.or)  tips.push({ type: 'win', msg: `OR gates reduced ${mB.or}→${mA.or}` })
  if (mB.not > mA.not) tips.push({ type: 'win', msg: `NOT gates reduced ${mB.not}→${mA.not}` })
  if (mB.terms > mA.terms) tips.push({ type: 'win', msg: `Terms reduced ${mB.terms}→${mA.terms} (redundancy eliminated)` })
  if (mB.cost === mA.cost) tips.push({ type: 'info', msg: 'Expression is already minimal — QMC found no redundancies' })
  if (mA.not > 2) tips.push({ type: 'tip', msg: 'High NOT count: consider De Morgan transform (!A & !B → !(A|B))' })
  if (mA.depth > 2) tips.push({ type: 'tip', msg: 'Deep nesting detected: refactoring may reduce critical path depth' })
  const factored = tryFactor(optimized)
  if (factored !== optimized) tips.push({ type: 'tip', msg: `Factored form available: ${factored}` })
  return tips
}

export const BUILTIN_TESTS = [
  { label: 'Redundancy Elimination',   expr: '(A & B & C) + (A & B & D)', dont_cares: [], desc: 'Reduces (A·B·C)+(A·B·D) → A·B, eliminating C/D dependency entirely.' },
  { label: 'ECC Tier Selector',        expr: '(A & B) + (A & C) + (B & C)', dont_cares: [], desc: 'Three-input majority: fires when 2+/3 of A/B/C set — typical LDPC escalation.' },
  { label: 'NAND Block Retirement',    expr: '(A & !B) + (A & B & C)',      dont_cares: [], desc: 'A·!B + A·B·C simplifies to A·(!B+C).' },
  { label: "De Morgan's Law Demo",     expr: '!(A & B)',                    dont_cares: [], desc: '¬(A∧B) → ¬A∨¬B: NOT-AND → NOT-OR gate reduction.' },
  { label: 'Wear + ECC Compound',      expr: '(A & B & !C) + (A & !B & C) + (!A & B & C)', dont_cares: [7], desc: '3-var majority with m7 don\'t-care: compound wear/ECC threshold.' },
  { label: 'Write Pipeline Guard',     expr: '(A & B & !D) + (A & C & D) + (B & C)', dont_cares: [], desc: 'Guards write pipeline: fires on any 2-of-3 condition with direction bias.' },
]

export const SIGNAL_OPTIONS = ['ecc_error','bad_block','wear_limit','write_request','read_fail','temp_crit','retry_flag','ldpc_fail','uecc_flag','program_fail','erase_fail','reallocated']
