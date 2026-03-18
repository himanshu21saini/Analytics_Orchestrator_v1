'use client'

import { useEffect, useState } from 'react'

export default function SummaryPanel({ narrative, state, error }) {
  var [displayed, setDisplayed] = useState(null)

  useEffect(function() {
    if (state !== 'done' || !narrative) return
    setDisplayed(null)
    var t = setTimeout(function() { setDisplayed(narrative) }, 80)
    return function() { clearTimeout(t) }
  }, [narrative, state])

  var sections = [
    { key: 'overall_performance', label: 'Executive Summary' },
    { key: 'key_highlights',      label: 'Key Highlights' },
    { key: 'areas_of_attention',  label: 'Areas of Attention' },
    { key: 'closing_insight',     label: 'Outlook' },
  ]

  return (
    <div className="fade-in" style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      overflow: 'hidden',
      marginTop: 4,
      backdropFilter: 'blur(8px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(90deg, rgba(0,200,240,0.06) 0%, transparent 60%)',
        position: 'relative',
      }}>
        {/* Top accent */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, var(--accent), rgba(0,200,240,0.1))', opacity: 0.4 }} />

        <div style={{
          width: 34, height: 34,
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent-border)',
          borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 0 12px rgba(0,200,240,0.1)',
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L9.2 6.8H14L10.4 9.6L11.8 14.4L8 11.6L4.2 14.4L5.6 9.6L2 6.8H6.8L8 2Z"
              fill="var(--accent)" opacity="0.9"/>
          </svg>
        </div>

        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.02em', fontFamily: 'var(--font-display)' }}>
            AI Intelligence Report
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1, fontFamily: 'var(--font-body)' }}>
            {state === 'loading' ? 'Composing executive narrative...' : 'Generated from live query results'}
          </p>
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        {state === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[80, 60, 95, 70, 85, 55].map(function(w, i) {
              return <div key={i} className="skeleton" style={{ height: 11, width: w + '%', borderRadius: 2 }} />
            })}
          </div>
        )}

        {state === 'error' && (
          <p style={{ fontSize: 13, color: 'var(--red-text)', background: 'var(--red-light)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)' }}>
            {error || 'Failed to generate narrative.'}
          </p>
        )}

        {state === 'done' && displayed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {sections.map(function(s, si) {
              var val = displayed[s.key]
              if (!val) return null
              var isFirst = si === 0
              return (
                <div key={s.key} style={{
                  paddingLeft: 16,
                  borderLeft: '2px solid ' + (isFirst ? 'var(--accent)' : 'var(--border-strong)'),
                }}>
                  <p style={{
                    fontSize: 9, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.14em',
                    color: isFirst ? 'var(--text-accent)' : 'var(--text-tertiary)',
                    marginBottom: 8, fontFamily: 'var(--font-body)',
                  }}>
                    {s.label}
                  </p>
                  {Array.isArray(val) ? (
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {val.map(function(item, i) {
                        return (
                          <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', opacity: 0.7, flexShrink: 0, marginTop: 7 }} />
                            <span style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>{item}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p style={{
                      fontSize: isFirst ? 15 : 13, lineHeight: 1.75,
                      color: isFirst ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)', fontWeight: isFirst ? 400 : 400,
                    }}>
                      {val}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
