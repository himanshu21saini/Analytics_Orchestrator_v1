'use client'

function fmt(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return String(v || '—')
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

export default function KPICard({ title, value, unit, comparisonValue, compLabel, index, anomalySeverity, favorableDirection }) {
  var delay = ['d1','d2','d3','d4','d5','d6','d1','d2'][index] || 'd1'

  var curr = parseFloat(value)
  var prev = parseFloat(comparisonValue)
  var changePct = null
  var direction = 'neutral'

  if (!isNaN(curr) && !isNaN(prev) && prev !== 0) {
    changePct = ((curr - prev) / Math.abs(prev)) * 100
    direction = changePct > 0 ? 'up' : changePct < 0 ? 'down' : 'neutral'
  }

  // favorable_direction: 'i' = increase good (default), 'd' = decrease good
  // When 'd': up is bad (red), down is good (green) — reverse the color mapping
  var isGoodUp = !favorableDirection || favorableDirection === 'i'
  var isGood   = direction === 'neutral' ? null
               : (isGoodUp ? direction === 'up' : direction === 'down')

  var changeColor  = isGood === null ? 'var(--text-tertiary)'
                   : isGood          ? 'var(--green-text)' : 'var(--red-text)'
  var changeBg     = isGood === null ? 'rgba(255,255,255,0.04)'
                   : isGood          ? 'var(--green-light)' : 'var(--red-light)'
  var changeBorder = isGood === null ? 'rgba(255,255,255,0.06)'
                   : isGood          ? 'rgba(16,196,138,0.25)' : 'rgba(224,85,85,0.25)'
  var barColor     = isGood === null ? 'var(--accent)'
                   : isGood          ? 'var(--green)' : 'var(--red)'
  var arrow        = direction === 'up' ? '↑' : direction === 'down' ? '↓' : ''

  return (
    <div
      className={'fade-up ' + delay}
      style={{
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '18px 20px 16px',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'default',
        transition: 'border-color var(--transition), box-shadow var(--transition)',
        backdropFilter: 'blur(8px)',
      }}
      onMouseEnter={function(e) {
        e.currentTarget.style.borderColor = 'var(--accent-border)'
        e.currentTarget.style.boxShadow = '0 0 20px rgba(0,200,240,0.06), inset 0 1px 0 rgba(0,200,240,0.06)'
      }}
      onMouseLeave={function(e) {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      {/* Top teal shimmer line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
        background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
        opacity: 0.3,
      }} />

      {/* Left status bar */}
      <div style={{
        position: 'absolute', left: 0, top: 14, bottom: 14, width: '2px',
        background: 'linear-gradient(180deg, transparent, ' + barColor + ', transparent)',
        borderRadius: '0 2px 2px 0',
        opacity: 0.8,
      }} />

      {/* Corner decoration */}
      <div style={{
        position: 'absolute', top: 8, right: 10,
        width: 16, height: 16,
        borderTop: '1px solid rgba(0,200,240,0.15)',
        borderRight: '1px solid rgba(0,200,240,0.15)',
        borderRadius: '0 4px 0 0',
      }} />

      {/* Anomaly severity badge */}
      {anomalySeverity && (
        <div style={{
          position: 'absolute', top: 8, right: 10,
          width: 8, height: 8, borderRadius: '50%',
          background: anomalySeverity === 'high' ? '#E05555' : anomalySeverity === 'medium' ? '#F0A030' : '#00C8F0',
          boxShadow: '0 0 6px ' + (anomalySeverity === 'high' ? '#E05555' : anomalySeverity === 'medium' ? '#F0A030' : '#00C8F0'),
          animation: 'glowPulse 2s ease-in-out infinite',
        }} />
      )}

      {/* Label */}
      <p style={{
        fontSize: 10, fontWeight: 500,
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        marginBottom: 10,
        fontFamily: 'var(--font-body)',
      }}>
        {title}
      </p>

      {/* Value */}
      <p style={{
        fontSize: 26, fontWeight: 600,
        letterSpacing: '-0.02em',
        lineHeight: 1,
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-display)',
        marginBottom: 12,
      }}>
        {fmt(value)}
        {unit && (
          <span style={{
            fontSize: 12, fontWeight: 400,
            color: 'var(--text-tertiary)',
            marginLeft: 5,
            fontFamily: 'var(--font-body)',
            letterSpacing: '0.04em',
          }}>
            {unit}
          </span>
        )}
      </p>

      {/* Change chip + prior */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {changePct !== null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: changeBg,
            border: '1px solid ' + changeBorder,
            borderRadius: 'var(--radius-sm)',
            padding: '2px 7px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: changeColor,
            fontWeight: 400,
            letterSpacing: '0.02em',
          }}>
            {arrow && <span>{arrow}</span>}
            <span>{Math.abs(changePct).toFixed(1)}%</span>
          </span>
        )}

        {!isNaN(prev) && (
          <span style={{
            fontSize: 11, color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-body)',
          }}>
            {fmt(prev)}{unit ? ' ' + unit : ''}
            {compLabel ? ' ' + compLabel : ''}
          </span>
        )}
      </div>
    </div>
  )
}
