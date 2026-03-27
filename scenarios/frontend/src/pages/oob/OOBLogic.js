// ── OOB Logistics & Data Engine ─────────────────────────────────────────────

export const SCENARIOS = {
  HEALTHY: { label: '🟢 Healthy', health: [85, 100], prob: 0.01, rul: [90, 120], type: 'NONE', eccMin: 50, eccMax: 150, badMin: 0, badMax: 5, wearMax: 10 },
  AGING: { label: '🟡 Aging', health: [60, 84], prob: 0.25, rul: [30, 89], type: 'WEAR_DEGRADATION', eccMin: 300, eccMax: 600, badMin: 10, badMax: 30, wearMax: 60 },
  END_OF_LIFE: { label: '🟠 End-of-Life', health: [20, 59], prob: 0.75, rul: [5, 29], type: 'BLOCK_EXHAUSTION', eccMin: 800, eccMax: 1500, badMin: 50, badMax: 150, wearMax: 90 },
  CRITICAL: { label: '🔴 Critical', health: [0, 19], prob: 0.99, rul: [0, 4], type: 'IMMINENT_FAILURE', eccMin: 3000, eccMax: 8000, badMin: 300, badMax: 800, wearMax: 99 }
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
export function hex(len) { return Array.from({ length: len }, () => rand(0, 255).toString(16).padStart(2, '0')).join('') }

export function generateReport(scenarioID) {
  const sc = SCENARIOS[scenarioID] || SCENARIOS.HEALTHY
  const h = rand(sc.health[0], sc.health[1])
  
  return {
    health: {
      score: h,
      rul_days: rand(sc.rul[0], sc.rul[1]),
      fail_prob: (sc.prob + (Math.random() * 0.05)).toFixed(3),
      anomaly_type: sc.type
    },
    smart_metrics: {
      ecc_rate_per_hr: rand(sc.eccMin, sc.eccMax),
      uecc_count: sc.health[1] < 60 ? rand(1, 15) : 0,
      bad_blocks: rand(sc.badMin, sc.badMax),
      wear_level_pct: rand(Math.max(0, sc.wearMax - 20), sc.wearMax),
      temperature_c: rand(35, 65) + (sc.health[1] < 60 ? 15 : 0),
      latency_us: rand(40, 90) + (sc.health[1] < 84 ? rand(20, 100) : 0),
      retry_frequency: (Math.random() * (sc.health[1] < 60 ? 5 : 0.5)).toFixed(2),
      program_erase_fail: sc.health[1] < 60 ? rand(2, 20) : 0,
      rber: `1e-${rand(sc.health[1] < 60 ? 3 : 6, sc.health[1] < 60 ? 5 : 8)}`
    },
    bbt_info: {
      bbt_crc: hex(4).toUpperCase(),
      factory_defects: rand(10, 40),
      runtime_failures: rand(sc.badMin, sc.badMax),
      retired_blocks_total: rand(sc.badMin + 10, sc.badMax + 40)
    },
    usage_stats: {
      total_reads_tb: (rand(100, 5000) / 10).toFixed(1),
      total_writes_tb: (rand(50, 2000) / 10).toFixed(1)
    },
    ecc_ldpc_context: {
      tier1_hard_decisions: rand(1000, 100000),
      tier2_soft_dsps: sc.health[1] < 84 ? rand(10, 5000) : 0,
      tier3_raid_recoveries: sc.health[1] < 60 ? rand(1, 50) : 0,
      escalation_count: sc.health[1] < 60 ? rand(10, 200) : 0
    }
  }
}

// Mock Crypto Functions
export function mockAESEncrypt(plaintextObj) {
  const plaintextStr = JSON.stringify(plaintextObj)
  const key = hex(32) // 256-bit key
  const iv = hex(12)  // 96-bit nonce
  const ciphertext = btoa(unescape(encodeURIComponent(plaintextStr))).split('').reverse().join('') + hex(16) // mock garble + auth tag
  return { key, iv, ciphertext, size: ciphertext.length }
}

export function mockAESDecrypt(ciphertext, keyInput, correctKey) {
  if (keyInput !== correctKey) throw new Error("Decryption Failed: Invalid AES Key or Auth Tag mismatch")
  const raw = ciphertext.slice(0, -16).split('').reverse().join('') // remove mock tag and unreverse
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))))
  } catch (e) {
    throw new Error("Decryption Failed: Corrupt payload")
  }
}

const SHAMIR_DESTINATIONS = ['Operator Key Vault', 'Cloud Backup Node', 'Local Admin Escrow', 'Forensic Immutable Ledger', 'Remote Hardware Token']

export function mockShamirSplit(keyHex) {
  // creates 5 shares, needing 3 to restore
  return Array.from({ length: 5 }, (_, i) => ({
    index: i + 1,
    dest: SHAMIR_DESTINATIONS[i],
    shareData: `share-${i + 1}-` + hex(16) + `-${keyHex.slice(i * 4, i * 4 + 8)}...`
  }))
}

export function mockReconstructKey(selectedShares, originalKey) {
  if (selectedShares.length < 3) return null // fails
  // In a real system, math is used. Here we mock success if >=3 shares.
  return originalKey 
}
