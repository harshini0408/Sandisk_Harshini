// ── Simulation Engine for Pillar 1 ───────────────────────────────────────────
export const MAX_PE = 3000
export const WORKLOAD_MULT = { sequential: 0.7, random: 1.4, mixed: 1.0 }

// Scenario configs drive the physics
export const SCENARIOS = {
  healthy: {
    label: '🟢 Healthy Drive', short: 'Healthy', color: '#22c55e',
    pe_avg: 150, bad_blocks: 1, workload: 'sequential', stress: false,
    pe_rate: 2, bad_rate: 0.005, ecc_mult: 0.3, spike_chance: 0,
    health_range: [85, 100], rul_range: [200, 730], fail_prob_max: 0.15,
    desc: 'Stable metrics, low ECC errors, no bad block growth.',
    anomaly: 'NOMINAL',
  },
  prefailure: {
    label: '🟡 Pre-Failure Drive', short: 'Pre-Failure', color: '#f59e0b',
    pe_avg: 1400, bad_blocks: 5, workload: 'mixed', stress: false,
    pe_rate: 6, bad_rate: 0.04, ecc_mult: 1.0, spike_chance: 0.05,
    health_range: [40, 70], rul_range: [10, 30], fail_prob_max: 0.65,
    desc: 'Gradual ECC rise with acceleration. SLOW_BURN pattern emerging.',
    anomaly: 'SLOW_BURN',
  },
  critical: {
    label: '🔴 Critical Failing Drive', short: 'Critical', color: '#ef4444',
    pe_avg: 2700, bad_blocks: 13, workload: 'random', stress: true,
    pe_rate: 14, bad_rate: 0.18, ecc_mult: 3.5, spike_chance: 0.25,
    health_range: [5, 28], rul_range: [1, 9], fail_prob_max: 0.97,
    desc: 'UECC events, rapid bad block growth, high latency, system in CRITICAL state.',
    anomaly: 'CRITICAL',
  },
}

export function computeMetrics(drive, scenario) {
  const cfg = SCENARIOS[scenario]
  const pef = drive.pe_avg / MAX_PE
  const wm = WORKLOAD_MULT[drive.workload] || 1
  const tb = drive.stress ? 18 : 0
  const spike = drive.spiking ? 3.5 : 1
  const temp = +(40 + (Math.random() - 0.5) * 5 + tb + pef * 12).toFixed(1)
  const em = cfg.ecc_mult * spike

  const ecc_rate     = Math.round(5 * Math.exp(pef * 4.2) * wm * em * (0.88 + Math.random() * 0.24))
  const uecc_count   = (pef > 0.88 && Math.random() > 0.55) || drive.spiking ? 1 : 0
  const bad_block_count = drive.bad_blocks
  const pe_avg       = Math.round(drive.pe_avg)
  const wear_level   = +(pef * 100).toFixed(1)
  const rber         = +(1e-8 * Math.exp(pe_avg / 750) * em).toFixed(14)
  const temperature  = Math.min(95, temp)
  const read_latency = +(28 + pef * 130 + (drive.stress ? 45 : 0) + (drive.spiking ? 60 : 0)).toFixed(1)
  const retry_freq   = Math.round(pef > 0.75 ? (pef - 0.75) * 520 * wm * em : 0)
  const reallocated  = bad_block_count * 4
  const program_fail = pef > 0.88 ? (Math.random() > 0.8 ? 1 : 0) : 0
  const erase_fail   = pef > 0.82 ? (Math.random() > 0.85 ? 1 : 0) : 0

  return { ecc_rate, uecc_count, bad_block_count, pe_avg, wear_level, rber,
           temperature, read_latency, retry_freq, reallocated, program_fail, erase_fail }
}

export const DEFS = [
  { id:1,  f:'ecc_rate',        name:'ECC Correction Rate', unit:'/hr',  warn:500,   crit:2000,  color:'#22c55e', src:'P3', why:'Bit errors fixed/hr. Grows exponentially with wear.' },
  { id:2,  f:'uecc_count',      name:'UECC Count',          unit:'',     warn:1,     crit:5,     color:'#ef4444', src:'P3', why:'Uncorrectable errors = data corruption. Any non-zero is critical.' },
  { id:3,  f:'bad_block_count', name:'Bad Block Count',     unit:'',     warn:5,     crit:15,    color:'#f59e0b', src:'P2', why:'Active BBT entries. Factory + runtime failures combined.' },
  { id:4,  f:'pe_avg',          name:'P/E Avg',             unit:'',     warn:1500,  crit:2700,  color:'#3b82f6', src:'P2', why:'Primary wear indicator. Max 3000 for TLC NAND.' },
  { id:5,  f:'wear_level',      name:'Wear Level',          unit:'%',    warn:60,    crit:85,    color:'#a855f7', src:'P2', why:'(pe_avg/3000)×100. 100% = end of rated endurance.' },
  { id:6,  f:'rber',            name:'RBER',                unit:'',     warn:1e-6,  crit:1e-5,  color:'#14b8a6', src:'P3', why:'Raw bit error rate. 1e-8 fresh → 1e-4 = distress.' },
  { id:7,  f:'temperature',     name:'Temperature',         unit:'°C',   warn:45,    crit:70,    color:'#f97316', src:'HW', why:'Every +10°C doubles wear rate. >85°C critical.' },
  { id:8,  f:'read_latency',    name:'Read Latency',        unit:'µs',   warn:100,   crit:300,   color:'#84cc16', src:'P3', why:'Avg read time. Climbs as more reads need Tier 2/3 ECC.' },
  { id:9,  f:'retry_freq',      name:'Retry Frequency',     unit:'/hr',  warn:50,    crit:200,   color:'#06b6d4', src:'P3', why:'HW-level retries. Tier 3 soft-decode count × 10.' },
  { id:10, f:'reallocated',     name:'Reallocated Sectors', unit:'',     warn:3,     crit:10,    color:'#ec4899', src:'P2', why:'Sectors remapped from bad region. Never decreases.' },
  { id:11, f:'program_fail',    name:'Program Fail',        unit:'',     warn:2,     crit:8,     color:'#8b5cf6', src:'NND',why:'Write ops failed at hardware level.' },
  { id:12, f:'erase_fail',      name:'Erase Fail',          unit:'',     warn:2,     crit:8,     color:'#10b981', src:'NND',why:'Erase ops failed → block cannot be reused → retire.' },
]

export const STATUS_COLOR = { OK:'#22c55e', WARN:'#f59e0b', CRIT:'#ef4444' }
export function metricStatus(val, def) {
  if (val >= def.crit) return 'CRIT'
  if (val >= def.warn) return 'WARN'
  return 'OK'
}

// 2-layer LSTM simulation
export function lstmInfer(snapHistory, drive, scenario) {
  const cfg = SCENARIOS[scenario]
  if (!snapHistory.ecc_rate || snapHistory.ecc_rate.length < 3) {
    const base = cfg.fail_prob_max * 0.3
    return { failProb: base, rul: Math.round((1 - base) * 730), l1: 0, l2: base * 0.6, wearF: 0, eccF: 0, badF: 0, tempF: 0 }
  }
  const rec = snapHistory.ecc_rate.slice(-8)
  const l1 = rec.length > 1 ? (rec[rec.length-1] - rec[0]) / (rec.length * Math.max(rec[0], 1)) : 0
  const wearF = Math.min(1, drive.pe_avg / MAX_PE)
  const eccF  = Math.min(1, (rec[rec.length-1] || 0) / 3000)
  const badF  = Math.min(1, drive.bad_blocks / 14)
  const tempF = Math.max(0, (drive.stress ? 58 : 40) - 40) / 55
  const l2    = wearF * 0.4 + eccF * 0.3 + badF * 0.2 + tempF * 0.1
  // Clamp to scenario range
  const raw   = Math.min(cfg.fail_prob_max, l2 + Math.max(0, l1) * 0.06)
  const failProb = Math.max(cfg.fail_prob_max * 0.15, raw)
  const rul   = Math.max(0, Math.round((1 - failProb) * 365))
  return { failProb, rul, l1: +l1.toFixed(4), l2: +l2.toFixed(3), wearF, eccF, badF, tempF }
}

export function anomalyLabel(scenario, failProb) {
  if (scenario === 'healthy') return 'NOMINAL'
  if (scenario === 'critical') return failProb > 0.85 ? 'CRITICAL' : 'ACCELERATING'
  if (failProb > 0.55) return 'ACCELERATING'
  return 'SLOW_BURN'
}

export function decisionEngine(lstm) {
  const p = lstm.failProb
  if (p > 0.75) return {
    level:'SEVERE', color:'#ef4444',
    action:'Emergency data migration. Block retirement imminent.',
    cmds:['→ Pillar 2: FORCE_RETIRE_WORN_BLOCKS','→ Pillar 3: MAX_ECC (iters=20)','→ OOB: TRANSMIT_CRITICAL_REPORT'],
  }
  if (p > 0.50) return {
    level:'CRITICAL', color:'#f97316',
    action:'Move data from highest-worn blocks. Alert operator.',
    cmds:['→ Pillar 2: PRE_RETIRE (bitmap update)','→ Pillar 3: RAISE_LDPC_CAP (8→20)'],
  }
  if (p > 0.25) return {
    level:'WARNING', color:'#f59e0b',
    action:'Monitor closely. Tighten baseline sigma threshold.',
    cmds:['→ Pillar 1: TIGHTEN_BASELINE (2σ→1.5σ)','→ Pillar 2: INCREASE_WEAR_CHECK_FREQ'],
  }
  return {
    level:'NOMINAL', color:'#22c55e',
    action:'Normal operation. Continue monitoring.',
    cmds:['→ No action required'],
  }
}

export function ldpcTier(ecc_rate) {
  if (ecc_rate >= 2000) return { tier: 3, iters: 20, label: 'Tier 3 — Soft-decision LDPC', color: '#ef4444' }
  if (ecc_rate >= 500)  return { tier: 2, iters: 12, label: 'Tier 2 — Medium LDPC',        color: '#f59e0b' }
  return                       { tier: 1, iters: 8,  label: 'Tier 1 — Fast BCH / LDPC',    color: '#22c55e' }
}
