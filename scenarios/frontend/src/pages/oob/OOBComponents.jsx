import { useState, useEffect, useRef } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────
function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a }
function hex(n) { return Array.from({ length: n }, () => rand(0, 255).toString(16).padStart(2, '0')).join('') }
function fakeHealth() { return rand(30, 85) }
function fakeRUL()    { return rand(4, 28) }

const SMART_FIELDS = ['ECC Rate', 'Bad Blocks', 'Wear Level', 'Temperature', 'Read Latency', 'RBER']
function makeSMART() {
  return { 'ECC Rate': rand(120, 800), 'Bad Blocks': rand(2, 12), 'Wear Level': rand(35, 85),
    'Temperature': rand(38, 61), 'Read Latency': rand(30, 180), 'RBER': `1e-${rand(6, 8)}` }
}

// ── Interactive OOB Flowchart ─────────────────────────────────────────────────
export function OOBFlowchart({ systemState }) {
  const isNormal   = systemState === 'normal'
  const isFailed   = systemState === 'failed' || systemState === 'oob' || systemState === 'recovering'
  const isOOB      = systemState === 'oob' || systemState === 'recovering'
  const isRecover  = systemState === 'recovering'

  const nodeStyle = (active, color, pulse) => ({
    padding: '8px 14px', borderRadius: 10, fontFamily: 'var(--mono)', fontSize: '0.75rem',
    fontWeight: 700, textAlign: 'center', minWidth: 100,
    background: active ? `${color}22` : 'var(--bg-card2)',
    border: `1.5px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
    color: active ? color : 'rgba(255,255,255,0.25)',
    boxShadow: pulse ? `0 0 16px ${color}88` : 'none',
    transition: 'all 0.5s',
  })
  const arrow = (active, color = '#fff') => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ width: 2, height: 24, background: active ? color : 'rgba(255,255,255,0.08)', transition: 'background 0.5s' }} />
      <div style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: `7px solid ${active ? color : 'rgba(255,255,255,0.08)'}`, transition: 'border-top-color 0.5s' }} />
    </div>
  )
  const hArrow = (active, color = '#fff', label = '') => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flex: 1 }}>
      {label && <div style={{ fontSize: '0.6rem', color: active ? color : 'rgba(255,255,255,0.2)', fontFamily: 'var(--mono)', transition: 'color 0.5s' }}>{label}</div>}
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <div style={{ flex: 1, height: 2, background: active ? color : 'rgba(255,255,255,0.08)', transition: 'background 0.5s' }} />
        <div style={{ width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent',
          borderLeft: `7px solid ${active ? color : 'rgba(255,255,255,0.08)'}`, transition: 'border-left-color 0.5s' }} />
      </div>
    </div>
  )

  return (
    <div style={{ background: '#080810', border: '1px solid var(--border)', borderRadius: 14, padding: '1.5rem', marginBottom: '1.2rem' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: '1rem' }}>
        🗺️ Interactive OOB Communication Flowchart — live state: <b style={{ color: isNormal ? '#22c55e' : isFailed ? '#ef4444' : '#f59e0b' }}>{systemState.toUpperCase()}</b>
      </div>

      {/* Row 1: Host System */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
        <div style={nodeStyle(true, isNormal ? '#22c55e' : '#ef4444', true)}>
          🖥️ Host System<br/>
          <span style={{ fontSize: '0.65rem', fontWeight: 400 }}>{isNormal ? 'ONLINE' : 'FAILED / CRASHED'}</span>
        </div>
      </div>

      {/* Arrow down + failure branch */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {arrow(isNormal, '#22c55e')}
          <div style={{ fontSize: '0.6rem', color: isNormal ? '#22c55e' : 'rgba(255,255,255,0.2)', fontFamily: 'var(--mono)', marginBottom: 4 }}>NVMe/SATA</div>
        </div>
      </div>

      {/* Row 2: NVMe bus + Failure detector */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 4 }}>
        <div style={nodeStyle(isNormal, '#22c55e', isNormal)}>⚡ NVMe / SATA<br/><span style={{ fontSize: '0.65rem' }}>{isNormal ? 'ACTIVE' : 'FAILED'}</span></div>
        {hArrow(false, 'transparent', '')}
        <div style={nodeStyle(isFailed, '#ef4444', isFailed)}>
          🔍 Failure Detector<br/>
          <span style={{ fontSize: '0.65rem' }}>{isFailed ? 'TRIGGERED!' : 'monitoring'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>{arrow(isNormal, '#22c55e')}</div>

      {/* Row 3: SSD Controller */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 4 }}>
        <div style={nodeStyle(isNormal, '#3b82f6', isNormal)}>⚙️ SSD Controller<br/><span style={{ fontSize: '0.65rem' }}>NAND + FTL</span></div>
      </div>

      {/* OOB branch (failure path) */}
      {isFailed && (
        <div className="fade-in" style={{ margin: '12px 0', padding: '0.8rem 1.2rem', background: 'rgba(239,68,68,0.08)', border: '1px dashed rgba(239,68,68,0.4)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{ color: '#ef4444', fontFamily: 'var(--mono)', fontSize: '0.78rem', fontWeight: 700 }}>⚠ NVMe FAILED → OOB CHANNELS ACTIVATED</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
            {/* Capacitor */}
            <div style={nodeStyle(true, '#f59e0b', true)}>🔋 Capacitor<br/><span style={{ fontSize: '0.65rem' }}>Internal Power</span></div>
            {hArrow(true, '#f59e0b', 'powers')}
            {/* OOB Mux */}
            <div style={nodeStyle(true, '#a855f7', true)}>📡 OOB MUX<br/><span style={{ fontSize: '0.65rem' }}>Channel Switch</span></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 32, marginTop: 12 }}>
            {/* UART branch */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {arrow(isOOB, '#06b6d4')}
              <div style={nodeStyle(isOOB, '#06b6d4', isOOB)}>🔌 UART<br/><span style={{ fontSize: '0.65rem' }}>115200 baud</span></div>
              {arrow(isOOB, '#06b6d4')}
              <div style={nodeStyle(isOOB, '#06b6d4', false)}>💻 Recovery<br/>Terminal</div>
            </div>
            {/* BLE branch */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              {arrow(isOOB, '#8b5cf6')}
              <div style={nodeStyle(isOOB, '#8b5cf6', isOOB)}>📶 BLE 5.0<br/><span style={{ fontSize: '0.65rem' }}>Wireless</span></div>
              {arrow(isOOB, '#8b5cf6')}
              <div style={nodeStyle(isOOB, '#8b5cf6', false)}>📱 Mobile<br/>Dashboard</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            {hArrow(true, '#22c55e', 'encrypted diagnostic data →')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={nodeStyle(true, '#22c55e', true)}>
              🔐 AES-256-GCM + Shamir 3-of-5<br/>
              <span style={{ fontSize: '0.65rem' }}>Secure diagnostic report</span>
            </div>
          </div>
        </div>
      )}

      {/* Recovery path */}
      {isRecover && (
        <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <div style={{ ...nodeStyle(true, '#22c55e', true), border: '2px solid #22c55e' }}>
            ✅ Host Restored — NVMe Resumed<br/>
            <span style={{ fontSize: '0.65rem' }}>OOB channels going idle</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: '0.68rem', fontFamily: 'var(--mono)' }}>
        {[['#22c55e', 'In-Band (NVMe/SATA)'], ['#06b6d4', 'UART OOB'], ['#8b5cf6', 'BLE OOB'], ['#ef4444', 'Failure path'], ['#f59e0b', 'Capacitor power']].map(([c, l]) => (
          <span key={l} style={{ color: c, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Channel status widget ─────────────────────────────────────────────────────
export function ChannelStatus({ systemState, uartFail, bleFail }) {
  const channels = [
    { id: 'nvme',  label: 'NVMe/SATA',  icon: '⚡',  active: systemState === 'normal' || systemState === 'recovering', color: '#22c55e', status: systemState === 'normal' ? 'ACTIVE' : systemState === 'recovering' ? 'RESUMING' : 'FAILED' },
    { id: 'cap',   label: 'Capacitor',  icon: '🔋',  active: systemState === 'oob' || systemState === 'failed', color: '#f59e0b', status: systemState === 'oob' ? 'POWERING OOB' : systemState === 'failed' ? 'STANDBY' : 'IDLE' },
    { id: 'uart',  label: 'UART',       icon: '🔌',  active: systemState === 'oob' && !uartFail, color: '#06b6d4', status: systemState === 'oob' ? (uartFail ? 'FAILED' : 'TX ACTIVE') : 'IDLE', fail: uartFail },
    { id: 'ble',   label: 'BLE 5.0',   icon: '📶',  active: systemState === 'oob' && !bleFail,  color: '#8b5cf6', status: systemState === 'oob' ? (bleFail ? 'INTERFERENCE' : 'BROADCASTING') : 'IDLE', fail: bleFail },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '0.6rem', marginBottom: '1rem' }}>
      {channels.map(ch => (
        <div key={ch.id} style={{ padding: '0.7rem 1rem', background: ch.active ? `${ch.color}12` : 'var(--bg-card2)',
          border: `1px solid ${ch.fail ? '#ef4444' : ch.active ? ch.color : 'var(--border)'}`, borderRadius: 10, transition: 'all 0.5s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '1.1rem' }}>{ch.icon}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: ch.fail ? '#ef444422' : ch.active ? `${ch.color}22` : 'transparent',
              color: ch.fail ? '#ef4444' : ch.active ? ch.color : 'var(--text-muted)',
              border: `1px solid ${ch.fail ? '#ef4444' : ch.active ? ch.color : 'var(--border)'}` }}>
              {ch.status}
            </span>
          </div>
          <div style={{ color: ch.active ? ch.color : 'var(--text-muted)', fontWeight: 700, fontSize: '0.82rem', marginTop: 4 }}>{ch.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Terminal log component ─────────────────────────────────────────────────────
export function Terminal({ lines, title, color = '#06b6d4' }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [lines])
  return (
    <div style={{ background: '#040408', border: `1px solid ${color}44`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ background: `${color}18`, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 6px ${color}` }} />
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color, fontWeight: 700 }}>{title}</span>
      </div>
      <div ref={ref} style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', padding: '0.7rem', maxHeight: 220, overflowY: 'auto', lineHeight: 1.8 }}>
        {lines.length === 0
          ? <span style={{ color: 'rgba(255,255,255,0.2)' }}>{'>'} waiting…</span>
          : lines.map((l, i) => <div key={i} style={{ color: l.color || color }}>{l.text}</div>)
        }
      </div>
    </div>
  )
}
