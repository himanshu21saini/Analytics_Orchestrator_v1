'use client'
import { useState } from 'react'
import {
  BarChart, Bar, AreaChart, Area, LineChart, Line,
  PieChart, Pie, Cell, ScatterChart, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList,
} from 'recharts'


import SetupScreen from '../components/SetupScreen'
import Dashboard from '../components/Dashboard'
import AskOnlyView from '../components/AskOnlyView'
import { APP_NAME, APP_TAGLINE } from '../lib/app-config'


export default function Home() {
  var [appState, setAppState] = useState('setup')
  var [session,  setSession]  = useState(null)

  function handleReady(s) { setSession(s); setAppState(s.mode === 'ask-only' ? 'ask' : 'dashboard') }
  function handleReset()  { setSession(null); setAppState('setup') }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--bg)', position: 'relative', zIndex: 1 }}>

      <header style={{
        borderBottom: '1px solid var(--border)',
        background: 'rgba(7,13,26,0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1320, margin: '0 auto', padding: '0 28px',
          height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3 }}>
              {[14, 10, 18, 10, 14].map(function(h, i) {
                return <div key={i} style={{ width: 3, height: h, background: i === 2 ? 'var(--accent)' : 'rgba(0,200,240,0.4)', borderRadius: 2, transition: 'height var(--transition)' }} />
              })}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.06em' }}>
              {APP_NAME.toUpperCase()}
            </span>
            <div style={{ width: 1, height: 18, background: 'var(--border-strong)' }} />
            <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-accent)', fontFamily: 'var(--font-body)' }}>
              {APP_TAGLINE}
            </span>
          </div>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>

            {/* Period badge — dashboard and ask modes */}
            {(appState === 'dashboard' || appState === 'ask') && session && session.periodInfo && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)', display: 'inline-block', animation: 'glowPulse 2s ease-in-out infinite' }} />
                <span style={{ fontSize: 11, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                  {session.periodInfo.viewLabel}
                </span>
              </div>
            )}

            {/* Mode badge for ask-only */}
            {appState === 'ask' && (
              <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 3, background: 'rgba(155,127,227,0.12)', color: '#B8A0F0', border: '1px solid rgba(155,127,227,0.25)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Ask Only
              </span>
            )}

            {/* Switch to dashboard button — shown in ask mode if dashboard data exists */}
            {appState === 'ask' && session && session.queries && session.queries.length > 0 && (
              <button
                onClick={function() { setAppState('dashboard') }}
                style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-accent)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-sm)', padding: '5px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all var(--transition)' }}
              >
                View Dashboard
              </button>
            )}

            {/* New Session */}
            {(appState === 'dashboard' || appState === 'ask') && (
              <button
                onClick={handleReset}
                style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '5px 14px', cursor: 'pointer', fontFamily: 'var(--font-body)', transition: 'all var(--transition)' }}
                onMouseEnter={function(e) { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={function(e) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                New Session
              </button>
            )}

            <a href="/api/setup-db" target="_blank" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', textDecoration: 'none', fontFamily: 'var(--font-body)', transition: 'color var(--transition)' }}
              onMouseEnter={function(e) { e.currentTarget.style.color = 'var(--text-accent)' }}
              onMouseLeave={function(e) { e.currentTarget.style.color = 'var(--text-tertiary)' }}
            >
              Setup DB
            </a>
          </div>
        </div>
      </header>

      {appState === 'setup'     && <SetupScreen onReady={handleReady} />}
      {appState === 'dashboard' && <Dashboard session={session} onReset={handleReset} />}
      {appState === 'ask'       && <AskOnlyView session={session} />}
    </main>
  )
}
