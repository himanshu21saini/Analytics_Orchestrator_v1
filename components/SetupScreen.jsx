'use client'

import { useState, useEffect, useRef } from 'react'
import { APP_NAME, APP_TAGLINE } from '../lib/app-config'

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

var COMPARISON_OPTIONS = {
  YTD: [{ value: 'YoY', label: 'YoY' }],
  QTD: [{ value: 'YoY', label: 'YoY' }, { value: 'QoQ', label: 'QoQ' }],
  MTD: [{ value: 'YoY', label: 'YoY' }, { value: 'MoM', label: 'MoM' }],
}

function detectPeriodPairs(ymRows) {
  var yearFields  = ymRows.filter(function(r) {
    return /year/i.test(r.field_name) && !/month|qtr|quarter/i.test(r.field_name) && !/^current_/i.test(r.field_name)
  })
  var monthFields = ymRows.filter(function(r) {
    return /month/i.test(r.field_name) && !/year/i.test(r.field_name) && !/^current_/i.test(r.field_name)
  })
  var pairs = []
  yearFields.forEach(function(yRow) {
    var prefix = yRow.field_name.replace(/_?year/i, '').replace(/^_|_$/, '')
    var mRow   = monthFields.find(function(m) {
      var mPrefix = m.field_name.replace(/_?month/i, '').replace(/^_|_$/, '')
      return mPrefix.toLowerCase() === prefix.toLowerCase()
    })
    if (mRow) {
      pairs.push({
        label: (prefix || 'Default') + ' period',
        yearField: yRow.field_name, monthField: mRow.field_name,
        yearDisplay: yRow.display_name || yRow.field_name,
        monthDisplay: mRow.display_name || mRow.field_name,
      })
    }
  })
  if (!pairs.length && yearFields.length && monthFields.length) {
    pairs.push({ label: 'Default period', yearField: yearFields[0].field_name, monthField: monthFields[0].field_name, yearDisplay: yearFields[0].display_name || yearFields[0].field_name, monthDisplay: monthFields[0].display_name || monthFields[0].field_name })
  }
  if (!pairs.length) {
    pairs.push({ label: 'Default period', yearField: 'year', monthField: 'month', yearDisplay: 'year', monthDisplay: 'month' })
  }
  return pairs
}

var TODAY = new Date()
var SLIDER_MONTHS = []
for (var si = 23; si >= 0; si--) {
  var sd = new Date(TODAY.getFullYear(), TODAY.getMonth() - si, 1)
  SLIDER_MONTHS.push({ year: sd.getFullYear(), month: sd.getMonth() + 1 })
}
var SLIDER_DEFAULT = SLIDER_MONTHS.length - 1

// ── Sub-components ────────────────────────────────────────────────────────────

function ProdChip({ active, onClick, children, amber }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 500,
      cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.06em',
      border: '1px solid ' + (active ? (amber ? 'rgba(240,160,48,0.5)' : 'var(--accent-border)') : 'var(--border)'),
      background: active ? (amber ? 'rgba(240,160,48,0.12)' : 'var(--accent-dim)') : 'transparent',
      color: active ? (amber ? '#F0A030' : 'var(--text-accent)') : 'var(--text-secondary)',
      transition: 'all var(--transition)',
    }}>
      {children}
    </button>
  )
}

function SectionCard({ n, title, children,style }) {
  return (
<div style={{
  background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
  border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: '20px 22px', position: 'relative', overflow: 'hidden', marginBottom: 12,
  ...style,
}}>
      <div style={{ position: 'absolute', top: 8, left: 8, width: 12, height: 12, borderTop: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', borderRadius: '2px 0 0 0', opacity: 0.6 }} />
      <div style={{ position: 'absolute', top: 8, right: 8, width: 12, height: 12, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', borderRadius: '0 2px 0 0', opacity: 0.6 }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.2 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-dim)' }}>
          <span style={{ fontSize: 10, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{n}</span>
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>{title}</p>
      </div>
      {children}
    </div>
  )
}

function AutoGenButton({ state, onGenerate, disabled, compact }) {
  var isLoading = state === 'loading'; var isDone = state === 'done'
  return (
    <button onClick={onGenerate} disabled={disabled || isLoading}
      title={disabled ? 'Select a dataset first' : isDone ? 'Re-generate metadata' : 'Auto-generate metadata from your dataset'}
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? 0 : 6,
        padding: compact ? '3px 8px' : '4px 10px', borderRadius: 'var(--radius-sm)',
        fontSize: 10, fontWeight: 500, cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-body)', letterSpacing: '0.04em',
        border: '1px solid ' + (disabled ? 'var(--border)' : isDone ? 'rgba(16,196,138,0.4)' : 'var(--accent-border)'),
        background: disabled ? 'transparent' : isDone ? 'rgba(16,196,138,0.08)' : 'var(--accent-dim)',
        color: disabled ? 'var(--text-tertiary)' : isDone ? '#10C48A' : 'var(--text-accent)',
        transition: 'all var(--transition)', whiteSpace: 'nowrap',
      }}>
      {isLoading
        ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, flexShrink: 0 }} />
        : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5 1v2M5 7v2M1 5h2M7 5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
      }
      {!compact && <span style={{ marginLeft: 4 }}>{isLoading ? 'Generating...' : isDone ? 'Re-generate' : 'Auto-generate'}</span>}
    </button>
  )
}

function AutoGenResult({ result }) {
  return (
    <div className="fade-in" style={{
      marginTop: 10, padding: '10px 14px', borderRadius: 'var(--radius-sm)',
      background: result.flaggedCount > 0 ? 'rgba(240,160,48,0.06)' : 'rgba(16,196,138,0.06)',
      border: '1px solid ' + (result.flaggedCount > 0 ? 'rgba(240,160,48,0.25)' : 'rgba(16,196,138,0.25)'),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 13, flexShrink: 0 }}>{result.flaggedCount > 0 ? '⚠' : '✓'}</span>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: result.flaggedCount > 0 ? 'var(--amber-text)' : 'var(--green-text)', fontFamily: 'var(--font-body)', marginBottom: 4 }}>
            {result.fieldCount} fields generated · {result.filename} downloaded
          </p>
          {result.flaggedCount > 0
            ? <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--amber-text)' }}>{result.flaggedCount} {result.flaggedCount === 1 ? 'field needs' : 'fields need'} review</strong> — check the Review Summary tab, fix flagged rows, then re-upload.
              </p>
            : <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                All fields classified. Delete the <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>confidence</code> and <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>review_notes</code> columns before re-uploading.
              </p>
          }
        </div>
      </div>
    </div>
  )
}

// ── StepBar ───────────────────────────────────────────────────────────────────

function StepBar({ current }) {
  var steps = ['Configure', 'Choose Mode', 'Settings']
  var items = []
  steps.forEach(function(label, i) {
    var n = i + 1; var done = n < current; var active = n === current
    items.push(
      <div key={'s' + n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '1px solid ' + (done || active ? 'var(--accent-border)' : 'var(--border)'),
          background: active ? 'var(--accent-dim)' : done ? 'rgba(0,200,240,0.07)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all var(--transition)',
        }}>
          {done
            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <polyline points="1.5,5 3.8,7.5 8.5,2.5" stroke="var(--text-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            : <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: active ? 'var(--text-accent)' : 'var(--text-tertiary)' }}>{n}</span>
          }
        </div>
        <span style={{ fontSize: 9, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', color: active ? 'var(--text-accent)' : done ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
          {label}
        </span>
      </div>
    )
    if (i < steps.length - 1) {
      items.push(
        <div key={'l' + n} style={{ flex: 1, height: 1, background: done ? 'rgba(0,200,240,0.3)' : 'var(--border)', marginBottom: 18, minWidth: 24, transition: 'background var(--transition)' }} />
      )
    }
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 36, width: '100%', maxWidth: 400 }}>
      {items}
    </div>
  )
}

// ── VapiHelpWidget ────────────────────────────────────────────────────────────
var VAPI_PUBLIC_KEY   = process.env.NEXT_PUBLIC_VAPI_KEY
var VAPI_ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID

function VapiHelpWidget() {
  var [expanded,   setExpanded]   = useState(false)
  var [callState,  setCallState]  = useState('idle')
  var [isMuted,    setIsMuted]    = useState(false)
  var [transcript, setTranscript] = useState([])
  var [vapiInst,   setVapiInst]   = useState(null)
  var [volume,     setVolume]     = useState(0)
  var [errorMsg,   setErrorMsg]   = useState('')

  async function getVapi() {
    if (vapiInst) return vapiInst
    try {
      var mod = await import('@vapi-ai/web'); var Vapi = mod.default || mod.Vapi; var inst = new Vapi(VAPI_PUBLIC_KEY)
      inst.on('call-start',   function()  { setCallState('active'); setErrorMsg('') })
      inst.on('call-end',     function()  { setCallState('ended');  setVolume(0) })
      inst.on('volume-level', function(v) { setVolume(v) })
      inst.on('error',        function(e) { console.error('VAPI error:', e); setErrorMsg('Connection error — please try again.'); setCallState('idle') })
      inst.on('message', function(msg) {
        if (msg && msg.type === 'transcript' && msg.transcriptType === 'final') {
          setTranscript(function(prev) { return prev.concat({ role: msg.role, text: msg.transcript }).slice(-6) })
        }
      })
      setVapiInst(inst); return inst
    } catch (err) { setErrorMsg('Could not load voice SDK.'); setCallState('idle'); return null }
  }

  async function handleStartCall() {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) { setErrorMsg('VAPI keys not configured.'); return }
    setCallState('connecting'); setTranscript([]); setErrorMsg('')
    var inst = await getVapi(); if (!inst) return
    try { await inst.start(VAPI_ASSISTANT_ID) } catch (err) { setErrorMsg('Could not start call: ' + (err.message || 'Unknown error')); setCallState('idle') }
  }

  function handleEndCall()    { if (vapiInst) vapiInst.stop(); setCallState('idle'); setVolume(0); setIsMuted(false); setTranscript([]) }
  function handleToggleMute() { if (!vapiInst) return; var next = !isMuted; vapiInst.setMuted(next); setIsMuted(next) }
  function handleDismiss()    { handleEndCall(); setExpanded(false); setErrorMsg('') }

  function VolumeBar() {
    var segs = 5; var lit = Math.round(volume * segs)
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
        {Array.from({ length: segs }).map(function(_, i) {
          return <div key={i} style={{ width: 3, height: 6 + i * 3, borderRadius: 2, background: i < lit ? 'var(--accent)' : 'var(--surface-3)', transition: 'background 80ms' }} />
        })}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      {!expanded ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <button onClick={function() { setExpanded(true) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="4" y="0.5" width="4" height="6.5" rx="2" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2"/>
              <path d="M2 6a4 4 0 0 0 8 0" stroke="var(--text-tertiary)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              <line x1="6" y1="10" x2="6" y2="11.5" stroke="var(--text-tertiary)" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Not sure where to start?</span>
          </button>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>
      ) : (
        <div className="fade-in" style={{
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
          border: '1px solid ' + (callState === 'active' ? 'var(--accent-border)' : 'var(--border)'),
          borderRadius: 'var(--radius-lg)', padding: '18px 20px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: callState === 'active' ? 0.5 : 0.2 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: callState === 'active' ? 'rgba(0,200,240,0.15)' : 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {callState === 'connecting'
                  ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                  : <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="4.5" y="0.5" width="5" height="8" rx="2.5" fill={callState === 'active' ? 'rgba(0,200,240,0.25)' : 'rgba(0,200,240,0.15)'} stroke="var(--accent)" strokeWidth="1.2"/>
                      <path d="M2 7a5 5 0 0 0 10 0" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                      <line x1="7" y1="12" x2="7" y2="13.5" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                }
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                  {callState === 'idle' ? 'Need help getting started?' : callState === 'connecting' ? 'Connecting...' : callState === 'active' ? 'Call in progress' : 'Call ended'}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginTop: 1 }}>
                  {callState === 'idle' ? 'Talk to our voice assistant · Available 24/7' : callState === 'connecting' ? 'Please wait...' : callState === 'active' ? 'Speak clearly · Browser mic is active' : 'Thanks for calling'}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {callState === 'active' && <VolumeBar />}
              <button onClick={handleDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, padding: '2px 4px' }}>×</button>
            </div>
          </div>
          {callState === 'idle' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['How to format metadata','Choosing the right time period','Understanding KPI types','Reading the dashboard'].map(function(t) {
                return <span key={t} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{t}</span>
              })}
            </div>
          )}
          {callState === 'active' && transcript.length > 0 && (
            <div style={{ marginBottom: 14, padding: '10px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {transcript.map(function(line, i) {
                var isUser = line.role === 'user'
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0, marginTop: 1, color: isUser ? 'var(--text-accent)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', width: 28 }}>{isUser ? 'You' : 'AI'}</span>
                    <span style={{ fontSize: 11, color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>{line.text}</span>
                  </div>
                )
              })}
            </div>
          )}
          {errorMsg && <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)', marginBottom: 12, fontFamily: 'var(--font-body)' }}>{errorMsg}</p>}
          {(callState === 'idle' || callState === 'ended') && (
            <button onClick={handleStartCall} style={{ width: '100%', padding: '11px 16px', background: 'linear-gradient(135deg, rgba(0,200,240,0.14) 0%, rgba(43,127,227,0.1) 100%)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: 'all var(--transition)' }}
              onMouseEnter={function(e) { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,200,240,0.22) 0%, rgba(43,127,227,0.16) 100%)' }}
              onMouseLeave={function(e) { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,200,240,0.14) 0%, rgba(43,127,227,0.1) 100%)' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-accent)', fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>{callState === 'ended' ? 'Call Again' : 'Start Voice Call'}</span>
            </button>
          )}
          {callState === 'active' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleToggleMute} style={{ flex: 1, padding: '9px 12px', background: isMuted ? 'rgba(224,85,85,0.1)' : 'var(--surface-3)', border: '1px solid ' + (isMuted ? 'rgba(224,85,85,0.3)' : 'var(--border)'), borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: isMuted ? 'var(--red-text)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>{isMuted ? 'Unmute' : 'Mute'}</span>
              </button>
              <button onClick={handleEndCall} style={{ flex: 1, padding: '9px 12px', background: 'rgba(224,85,85,0.1)', border: '1px solid rgba(224,85,85,0.3)', borderRadius: 'var(--radius-md)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--red-text)', fontFamily: 'var(--font-body)' }}>End Call</span>
              </button>
            </div>
          )}
          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 10, fontFamily: 'var(--font-body)' }}>Browser mic required · Powered by VAPI</p>
        </div>
      )}
    </div>
  )
}

// ── Main SetupScreen ──────────────────────────────────────────────────────────

export default function SetupScreen({ onReady }) {
  var [step,      setStep]      = useState(0)
  var [splashOut, setSplashOut] = useState(false)

  var [datasets,     setDatasets]     = useState([])
  var [metaSets,     setMetaSets]     = useState([])
  var [loadingLists, setLoadingLists] = useState(true)
  var [dataMode,     setDataMode]     = useState('existing')
  var [metaMode,     setMetaMode]     = useState('existing')
  var [selDataset,   setSelDataset]   = useState('')
  var [selMeta,      setSelMeta]      = useState('')
  var [dataFile,     setDataFile]     = useState(null)
  var [metaFile,     setMetaFile]     = useState(null)
  var [dataName,     setDataName]     = useState('')
  var [metaName,     setMetaName]     = useState('')
  var [viewType,     setViewType]     = useState('YTD')
  var [sliderIdx,    setSliderIdx]    = useState(SLIDER_DEFAULT)
  var [compType,     setCompType]     = useState('YoY')
  var [periodPairs,  setPeriodPairs]  = useState([])
  var [selPairIdx,   setSelPairIdx]   = useState(0)
  var [prefs,        setPrefs]        = useState({ decisions: true, summary: true, forecast: true, queryInspector: true, coveragePanel: true })
  var [working,      setWorking]      = useState(false)
  var [progress,     setProgress]     = useState('')
  var [error,        setError]        = useState('')
  var [extracting,   setExtracting]   = useState(false)
  var [extracted,    setExtracted]    = useState(null)
  var [showConfirm,  setShowConfirm]  = useState(false)
  var contextRef = useRef()
  var dataRef    = useRef()
  var metaRef    = useRef()
  var [autoGenState,  setAutoGenState]  = useState('idle')
  var [autoGenResult, setAutoGenResult] = useState(null)
  var [savingMeta,    setSavingMeta]    = useState(false)

  // ── Mandatory filters ────────────────────────────────────────────────────
  var [mandatoryFilterFields, setMandatoryFilterFields] = useState([])
  var [mandatoryFilterValues, setMandatoryFilterValues] = useState({})

  var selYearMonth = SLIDER_MONTHS[sliderIdx] || SLIDER_MONTHS[SLIDER_DEFAULT]
  var selYear  = selYearMonth.year
  var selMonth = selYearMonth.month
  var allowedComp = COMPARISON_OPTIONS[viewType] || []
  var activePair  = periodPairs[selPairIdx] || periodPairs[0]

  // ── Splash ───────────────────────────────────────────────────────────────
  useEffect(function() {
    if (step !== 0) return
    var t = setTimeout(function() { setSplashOut(true); setTimeout(function() { setStep(1) }, 350) }, 2000)
    return function() { clearTimeout(t) }
  }, [step])

  useEffect(function() { loadLists() }, [])

  useEffect(function() {
    var allowed = COMPARISON_OPTIONS[viewType] || []
    var valid = allowed.some(function(o) { return o.value === compType })
    if (!valid && allowed.length > 0) setCompType(allowed[0].value)
  }, [viewType])

  // ── Load period pairs + mandatory filters whenever selMeta changes ────────
  useEffect(function() {
    var metaId = metaMode === 'existing' ? selMeta : null
    if (!metaId) { setPeriodPairs([]); setSelPairIdx(0); setMandatoryFilterFields([]); setMandatoryFilterValues({}); return }
    fetch('/api/metadata-fields?metadataSetId=' + metaId)
      .then(function(r) { return r.json() })
      .then(function(j) {
        var fields = j.fields || []
        setPeriodPairs(detectPeriodPairs(fields.filter(function(f) { return f.type === 'year_month' })))
        setSelPairIdx(0)
        var mFields = fields.filter(function(f) { return f.mandatory_filter_value && String(f.mandatory_filter_value).trim() })
        setMandatoryFilterFields(mFields)
        var defaults = {}
        mFields.forEach(function(f) { defaults[f.field_name] = String(f.mandatory_filter_value).trim() })
        setMandatoryFilterValues(defaults)
      })
      .catch(function() { setPeriodPairs([]); setSelPairIdx(0); setMandatoryFilterFields([]); setMandatoryFilterValues({}) })
  }, [selMeta, metaMode])

  function handleMandatoryFilterChange(fieldName, value) {
    setMandatoryFilterValues(function(prev) { var next = Object.assign({}, prev); next[fieldName] = value; return next })
  }

  async function loadLists() {
    setLoadingLists(true)
    try {
      var r1 = await fetch('/api/datasets'); var r2 = await fetch('/api/metadata-sets')
      var d1 = await r1.json(); var d2 = await r2.json()
      var ds = d1.datasets || []; var ms = d2.metadataSets || []
      setDatasets(ds); setMetaSets(ms)
      if (ds.length === 0) setDataMode('upload'); else setSelDataset(String(ds[0].id))
      if (ms.length === 0) setMetaMode('upload'); else setSelMeta(String(ms[0].id))
    } catch(e) { setError('Could not connect to database.') }
    setLoadingLists(false)
  }

  async function handleSaveMetadata() {
    if (!metaFile) return
    setSavingMeta(true); setError('')
    try {
      var mf2 = new FormData()
      mf2.append('file', metaFile)
      mf2.append('name', metaName || metaFile.name)
      var mr = await fetch('/api/save-metadata', { method: 'POST', body: mf2 })
      var mj = await mr.json()
      if (!mr.ok) throw new Error(mj.error || 'Metadata save failed.')
      var savedMetaId = String(mj.metadataSet.id)
      await loadLists()
      setSelMeta(savedMetaId)
      setMetaMode('existing')
      setMetaFile(null)
    } catch(err) { setError('Metadata save failed: ' + err.message) }
    setSavingMeta(false)
  }

  async function uploadDatasetChunked(file, name) {
    var XLSX = (await import('xlsx')).default || (await import('xlsx'))
    var arrayBuffer = await new Promise(function(resolve, reject) {
      var reader = new FileReader()
      reader.onload  = function(e) { resolve(e.target.result) }
      reader.onerror = function()  { reject(new Error('Failed to read file')) }
      reader.readAsArrayBuffer(file)
    })
    var buffer = new Uint8Array(arrayBuffer)
    var wb = file.name.toLowerCase().endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
      : XLSX.read(buffer, { type: 'array' })
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false, dateNF: 'yyyy-mm-dd' })
    if (!rows.length) throw new Error('File is empty.')

    setProgress('Preparing dataset (' + rows.length.toLocaleString() + ' rows)...')
    var initRes = await fetch('/api/upload-dataset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'init', name: name, rowCount: rows.length, sampleRows: rows.slice(0, 20) }),
    })
    var initJson = await initRes.json()
    if (!initRes.ok) throw new Error(initJson.error || 'Dataset init failed.')
    var datasetId = initJson.datasetId

    var CHUNK = 1000; var total = rows.length; var chunks = Math.ceil(total / CHUNK)
    for (var c = 0; c < chunks; c++) {
      setProgress('Uploading ' + Math.min((c + 1) * CHUNK, total).toLocaleString() + ' / ' + total.toLocaleString() + ' rows...')
      var chunkRes  = await fetch('/api/upload-dataset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chunk', datasetId: datasetId, rows: rows.slice(c * CHUNK, (c + 1) * CHUNK) }),
      })
      var chunkJson = await chunkRes.json()
      if (!chunkRes.ok) throw new Error(chunkJson.error || 'Chunk upload failed at batch ' + (c + 1))
    }

    setProgress('Finalising...')
    var finalRes  = await fetch('/api/upload-dataset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'finalise', datasetId: datasetId, name: name, rowCount: total }),
    })
    var finalJson = await finalRes.json()
    if (!finalRes.ok) throw new Error(finalJson.error || 'Finalise failed.')
    return finalJson.dataset
  }

  async function handleAutoGenMeta() {
    var dsId = dataMode === 'existing' ? selDataset : null
    if (!dsId) { setError('Select a dataset first.'); return }
    setAutoGenState('loading'); setAutoGenResult(null)
    try {
      var res  = await fetch('/api/generate-metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: dsId }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Generation failed.')
      var bytes = Uint8Array.from(atob(json.base64), function(c) { return c.charCodeAt(0) })
      var blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      var url   = URL.createObjectURL(blob)
      var link  = document.createElement('a')
      link.href = url; link.download = json.filename
      document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url)
      setAutoGenResult({ fieldCount: json.fieldCount, flaggedCount: json.flaggedCount, filename: json.filename })
      setAutoGenState('done')
    } catch(err) { setError('Auto-generate failed: ' + err.message); setAutoGenState('error') }
  }

  async function handleAskOnly() {
    setError('')
    if (metaMode === 'upload') { setError('Please save your metadata file first using the Save Metadata button.'); return }
    if (!selDataset || !selMeta) { setError('Please select a dataset and metadata first.'); return }
    setWorking(true); setProgress('Preparing Ask session...')
    try {
      var activePairs = periodPairs
      if (!activePairs.length) {
        try {
          var pRes  = await fetch('/api/metadata-fields?metadataSetId=' + selMeta)
          var pJson = await pRes.json()
          activePairs = detectPeriodPairs((pJson.fields || []).filter(function(f) { return f.type === 'year_month' }))
        } catch(e) { activePairs = [] }
      }
      if (!activePairs.length) activePairs = [{ yearField: 'year', monthField: 'month' }]
      var chosenPair = activePairs[selPairIdx] || activePairs[0]
      var metaRes  = await fetch('/api/metadata-fields?metadataSetId=' + selMeta)
      var metaJson = await metaRes.json()
      var metadata = metaJson.fields || []
      var mandatoryFilters = mandatoryFilterFields.map(function(f) {
        return { field: f.field_name, value: mandatoryFilterValues[f.field_name] || String(f.mandatory_filter_value).trim(), display_name: f.display_name || f.field_name }
      })
      var timePeriod = { viewType, year: selYear, month: selMonth, comparisonType: compType, yearField: chosenPair.yearField, monthField: chosenPair.monthField }
      var mo = selMonth; var yr = selYear
      var mMin = viewType === 'MTD' ? mo : viewType === 'YTD' ? 1 : Math.floor((mo - 1) / 3) * 3 + 1
      var periodInfo = {
        viewLabel: viewType + ' · ' + yr + '-' + (mo < 10 ? '0' + mo : mo),
        cmpLabel:  compType,
        yf:        chosenPair.yearField,
        mf:        chosenPair.monthField,
        curYear:   yr,
        curCond:   chosenPair.yearField + ' = ' + yr + ' AND ' + chosenPair.monthField + ' >= ' + mMin + ' AND ' + chosenPair.monthField + ' <= ' + mo,
      }
      onReady({ mode: 'ask-only', datasetId: selDataset, metadataSetId: selMeta, metadata, timePeriod, periodInfo, userContext: null, mandatoryFilters, preferences: prefs, queries: [], queryResults: [] })
    } catch(err) { setError(err.message); setWorking(false); setProgress('') }
  }

  async function handleBuild() {
    setError('')
    var contextText = (contextRef.current && contextRef.current.value) || ''
    if (contextText.trim() && !showConfirm) {
      setExtracting(true)
      try {
        var metaId = metaMode === 'existing' ? selMeta : null; var metaForCtx = []
        if (metaId) { var mfr = await fetch('/api/metadata-fields?metadataSetId=' + metaId); var mfj = await mfr.json(); metaForCtx = mfj.fields || [] }
        var res = await fetch('/api/extract-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextText: contextText.trim(), metadata: metaForCtx }) })
        var j = await res.json(); if (j.error) throw new Error(j.error)
        setExtracted(j); setShowConfirm(true)
      } catch(err) { setError('Context extraction failed: ' + err.message) }
      setExtracting(false); return
    }
    await doBuild(showConfirm ? extracted : null)
  }

  async function doBuild(userContext) {
    setShowConfirm(false); setError(''); setWorking(true)
    var finalDatasetId = selDataset; var finalMetaId = selMeta
    try {
      if (dataMode === 'upload') {
        if (!dataFile) { setError('Please select a data file.'); setWorking(false); return }
        var dataset = await uploadDatasetChunked(dataFile, dataName || dataFile.name)
        finalDatasetId = String(dataset.id); await loadLists()
      }
      if (metaMode === 'upload') {
        setError('Please save your metadata file first using the "Save Metadata" button before generating.')
        setWorking(false); return
      }
      var activePairs = periodPairs
      if (!activePairs.length) {
        try {
          var pairRes  = await fetch('/api/metadata-fields?metadataSetId=' + finalMetaId)
          var pairJson = await pairRes.json()
          var allFields = pairJson.fields || []
          activePairs = detectPeriodPairs(allFields.filter(function(f) { return f.type === 'year_month' }))
          if (!mandatoryFilterFields.length) {
            var mFields = allFields.filter(function(f) { return f.mandatory_filter_value && String(f.mandatory_filter_value).trim() })
            setMandatoryFilterFields(mFields)
            var defaults = {}; mFields.forEach(function(f) { defaults[f.field_name] = String(f.mandatory_filter_value).trim() })
            setMandatoryFilterValues(defaults)
          }
        } catch(e) { activePairs = [] }
      }
      if (!activePairs.length) activePairs = [{ yearField: 'year', monthField: 'month' }]
      var chosenPair = activePairs[selPairIdx] || activePairs[0]
      var mandatoryFilters = mandatoryFilterFields.map(function(f) {
        return { field: f.field_name, value: mandatoryFilterValues[f.field_name] || String(f.mandatory_filter_value).trim(), display_name: f.display_name || f.field_name }
      })
      setProgress('Composing intelligence queries...')
      var timePeriod = { viewType, year: selYear, month: selMonth, comparisonType: compType, yearField: chosenPair.yearField, monthField: chosenPair.monthField }
      var gqRes = await fetch('/api/generate-queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: finalDatasetId, metadataSetId: finalMetaId, timePeriod, userContext: userContext || null, mandatoryFilters }),
      })
      var gqJson = await gqRes.json()
      if (!gqRes.ok) throw new Error(gqJson.error || 'Failed to generate queries.')
      setProgress('Executing ' + (gqJson.queries ? gqJson.queries.length : '') + ' queries...')
      var rqRes = await fetch('/api/run-queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: gqJson.queries }),
      })
      var rqJson = await rqRes.json()
      if (!rqRes.ok) throw new Error(rqJson.error || 'Failed to run queries.')
      onReady({
        datasetId: finalDatasetId, metadataSetId: finalMetaId,
        queries: gqJson.queries, queryResults: rqJson.results,
        metadata: gqJson.metadata, timePeriod,
        periodInfo: gqJson.periodInfo,
        initialUsage: gqJson.usage || null,
        userContext: userContext || null,
        coverageData: gqJson.coverageData || null,
        preferences: prefs,
        mandatoryFilters,
      })
    } catch(err) { setError(err.message); setWorking(false); setProgress('') }
  }

  // ── Shared styles (used across steps 1 & 3) ───────────────────────────────
  var selectStyle = { width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, background: 'var(--surface-2)', color: 'var(--text-primary)', cursor: 'pointer', outline: 'none', fontFamily: 'var(--font-body)' }
  var inputStyle  = { ...selectStyle, cursor: 'text', marginBottom: 8 }

  // ── Page wrapper + header shared across all steps ─────────────────────────
  var pageStyle = { minHeight: 'calc(100vh - 54px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '36px 24px 60px' }
  var headingStyle = { fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--text-primary)', marginBottom: 10 }
  var subStyle = { color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-body)' }

  // ── Step 0: Splash ────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div style={{ minHeight: 'calc(100vh - 54px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{
          width: '100%', maxWidth: 900, height: 'calc(65vh)', minHeight: 420,
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          backdropFilter: 'blur(12px)', position: 'relative', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
          opacity: splashOut ? 0 : 1, transform: splashOut ? 'scale(0.97)' : 'scale(1)',
        }}>
          <div style={{ position: 'absolute', top: 16, left: 16, width: 20, height: 20, borderTop: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', top: 16, right: 16, width: 20, height: 20, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: 16, left: 16, width: 20, height: 20, borderBottom: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: 16, right: 16, width: 20, height: 20, borderBottom: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)' }} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, marginBottom: 32 }}>
            {[22, 14, 30, 14, 22].map(function(h, i) {
              return <div key={i} style={{ width: 5, height: h, background: i === 2 ? 'var(--accent)' : 'rgba(0,200,240,0.35)', borderRadius: 3 }} />
            })}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 12, textAlign: 'center' }}>{APP_NAME}</h1>
          <p style={{ fontSize: 12, color: 'var(--text-accent)', letterSpacing: '0.22em', textTransform: 'uppercase', fontFamily: 'var(--font-body)', marginBottom: 48 }}>{APP_TAGLINE}</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="spinner" style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>Initialising</span>
          </div>
        </div>
      </div>
    )
  }

  // ── Step 1: Configure Dataset ─────────────────────────────────────────────
  if (step === 1) {
    var canNext = !loadingLists && (
      (dataMode === 'existing' && !!selDataset) || (dataMode === 'upload' && !!dataFile)
    ) && (
      (metaMode === 'existing' && !!selMeta) || (metaMode === 'upload' && !!metaFile)
    )

    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 580, marginBottom: 28 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 14, fontFamily: 'var(--font-body)', fontWeight: 500 }}>{APP_NAME}</p>
          <h1 style={headingStyle}>Configure your dataset</h1>
          <p style={subStyle}>Select your data source, set the time horizon and apply any required filters.</p>
        </div>

        <StepBar current={1} />

        <div style={{ width: '100%', maxWidth: 960 }}>

<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch', marginBottom: 12 }}>

  {/* ── Left column: Section 1 ── */}
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <SectionCard n="1" title="Data" style={{ flex: 1, marginBottom: 0 }}>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 12 }}>Main data file — .xlsx, .xls or .csv</p>
            <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Dataset</p>
            {!loadingLists && datasets.length > 0 && (
              <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                {['existing','upload'].map(function(m) {
                  return <button key={m} onClick={function(){setDataMode(m)}} style={{ padding: '3px 9px', fontSize: 10, cursor: 'pointer', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (dataMode===m?'var(--accent-border)':'var(--border)'), background: dataMode===m?'var(--accent-dim)':'transparent', color: dataMode===m?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{m==='existing'?'Existing':'Upload new'}</button>
                })}
              </div>
            )}
            {dataMode === 'existing'
              ? <select value={selDataset} onChange={function(e){setSelDataset(e.target.value)}} style={{ ...selectStyle, marginBottom: 14 }}>
                  {datasets.map(function(d){return <option key={d.id} value={d.id}>{d.name}</option>})}
                </select>
              : <div style={{ marginBottom: 14 }}>
                  <input type="text" placeholder="Dataset name (optional)" value={dataName} onChange={function(e){setDataName(e.target.value)}} style={inputStyle} />
                  <div onClick={function(){dataRef.current&&dataRef.current.click()}} style={{ border: '1px dashed '+(dataFile?'var(--accent-border)':'var(--border)'), borderRadius: 'var(--radius-md)', padding: '10px 14px', cursor: 'pointer', background: dataFile?'var(--accent-dim)':'transparent' }}>
                    <input ref={dataRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={function(e){setDataFile(e.target.files[0]||null)}} />
                    <p style={{ fontSize: 11, color: dataFile?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{dataFile?dataFile.name:'Select dataset file (.xlsx or .csv)'}</p>
                  </div>
                </div>
            }
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.09em', fontFamily: 'var(--font-body)' }}>Metadata</p>
              <AutoGenButton state={autoGenState} onGenerate={handleAutoGenMeta} disabled={dataMode === 'existing' ? !selDataset : !dataFile} compact={true} />
            </div>
            {!loadingLists && metaSets.length > 0 && (
              <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                {['existing','upload'].map(function(m) {
                  return <button key={m} onClick={function(){setMetaMode(m)}} style={{ padding: '3px 9px', fontSize: 10, cursor: 'pointer', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (metaMode===m?'var(--accent-border)':'var(--border)'), background: metaMode===m?'var(--accent-dim)':'transparent', color: metaMode===m?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{m==='existing'?'Existing':'Upload new'}</button>
                })}
              </div>
            )}
            {metaMode === 'existing'
              ? <select value={selMeta} onChange={function(e){setSelMeta(e.target.value)}} style={selectStyle}>
                  {metaSets.map(function(m){return <option key={m.id} value={m.id}>{m.name}</option>})}
                </select>
              : <div>
                  <input type="text" placeholder="Metadata name (optional)" value={metaName} onChange={function(e){setMetaName(e.target.value)}} style={inputStyle} />
                  <div onClick={function(){metaRef.current&&metaRef.current.click()}} style={{ border: '1px dashed '+(metaFile?'var(--accent-border)':'var(--border)'), borderRadius: 'var(--radius-md)', padding: '10px 14px', cursor: 'pointer', background: metaFile?'var(--accent-dim)':'transparent' }}>
                    <input ref={metaRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={function(e){setMetaFile(e.target.files[0]||null)}} />
                    <p style={{ fontSize: 11, color: metaFile?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{metaFile?metaFile.name:'Select metadata file (.xlsx or .csv)'}</p>
                  </div>
                  {metaFile && (
                    <button onClick={handleSaveMetadata} disabled={savingMeta} style={{ marginTop: 8, width: '100%', padding: '8px 12px', borderRadius: 'var(--radius-md)', background: savingMeta?'transparent':'var(--accent-dim)', border: '1px solid '+(savingMeta?'var(--border)':'var(--accent-border)'), color: savingMeta?'var(--text-tertiary)':'var(--text-accent)', fontSize: 11, fontWeight: 600, cursor: savingMeta?'not-allowed':'pointer', fontFamily: 'var(--font-display)', letterSpacing: '0.08em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {savingMeta ? <><span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> Saving...</> : '↑ Save Metadata'}
                    </button>
                  )}
                </div>
            }
            {autoGenState === 'done' && autoGenResult && <AutoGenResult result={autoGenResult} />}
    </SectionCard>
  </div>

  {/* ── Right column: Sections 2 & 3 ── */}
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <SectionCard n="2" title="Time period">
           <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 12 }}>Set the as-of date and comparison type for all queries</p>
            <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
              <div>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>View</p>
                <div style={{ display: 'flex', gap: 5 }}>
                  {['MTD','YTD','QTD'].map(function(v) { return <ProdChip key={v} active={viewType===v} onClick={function(){setViewType(v)}}>{v}</ProdChip> })}
                </div>
              </div>
              <div>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Compare</p>
                <div style={{ display: 'flex', gap: 5 }}>
                  {allowedComp.map(function(opt) { return <ProdChip key={opt.value} active={compType===opt.value} onClick={function(){setCompType(opt.value)}}>{opt.value}</ProdChip> })}
                </div>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--font-body)' }}>As-of date</p>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{MONTH_NAMES[selMonth-1]} {selYear}</span>
              </div>
              <input type="range" min={0} max={SLIDER_MONTHS.length-1} value={sliderIdx} onChange={function(e){setSliderIdx(parseInt(e.target.value))}} style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{MONTH_NAMES[SLIDER_MONTHS[0].month-1].slice(0,3)} {SLIDER_MONTHS[0].year}</span>
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>{MONTH_NAMES[SLIDER_MONTHS[SLIDER_MONTHS.length-1].month-1].slice(0,3)} {SLIDER_MONTHS[SLIDER_MONTHS.length-1].year}</span>
              </div>
            </div>
            {periodPairs.length > 1 && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Period calendar</p>
                <div style={{ display: 'flex', gap: 5 }}>
                  {periodPairs.map(function(pair, idx) { return <ProdChip key={idx} active={selPairIdx===idx} onClick={function(){setSelPairIdx(idx)}}>{pair.label}</ProdChip> })}
                </div>
              </div>
            )}
            <div style={{ padding: '8px 12px', background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
              <p style={{ fontSize: 11, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                {viewType} · {MONTH_NAMES[selMonth-1]} {selYear} · vs {compType}{activePair ? ' · ' + activePair.yearField : ''}
              </p>
            </div>

    </SectionCard>
    {mandatoryFilterFields.length > 0 && (
      <SectionCard n="3" title="Data Filters">
           <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 14, lineHeight: 1.5 }}>
                Required filters to prevent double-counting. Defaults are from your metadata — adjust if needed.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {mandatoryFilterFields.map(function(f) {
                  var options    = f.sample_values ? String(f.sample_values).split(',').map(function(v) { return v.trim() }).filter(Boolean) : []
                  var defaultVal = String(f.mandatory_filter_value || '').trim()
                  if (defaultVal && options.indexOf(defaultVal) === -1) options.unshift(defaultVal)
                  var selected   = mandatoryFilterValues[f.field_name] || defaultVal
                  return (
                    <div key={f.field_name}>
                      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, fontFamily: 'var(--font-body)' }}>{f.display_name || f.field_name}</p>
                      {options.length > 0 ? (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {options.map(function(opt) {
                            return <ProdChip key={opt} active={selected === opt} amber={true} onClick={function() { handleMandatoryFilterChange(f.field_name, opt) }}>{opt}</ProdChip>
                          })}
                        </div>
                      ) : (
                        <input type="text" value={selected}
                          onChange={function(e) { handleMandatoryFilterChange(f.field_name, e.target.value) }}
                          style={{ width: '100%', padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', outline: 'none' }}
                          onFocus={function(e) { e.target.style.borderColor = 'rgba(240,160,48,0.4)' }}
                          onBlur={function(e)  { e.target.style.borderColor = 'var(--border)' }}
                        />
                      )}
                      <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 5, fontFamily: 'var(--font-body)' }}>
                        Default: <span style={{ color: '#F0A030' }}>{defaultVal}</span>
                        {selected !== defaultVal && <span style={{ color: 'var(--text-accent)', marginLeft: 8 }}>· Changed to: {selected}</span>}
                      </p>
                    </div>
                  )
                })}
              </div>
      </SectionCard>
    )}
  </div>

</div>
          {error && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(224,85,85,0.2)' }}>
              {error}
            </p>
          )}

          {/* Next button */}
          <button
            onClick={function() { setError(''); setStep(2) }}
            disabled={!canNext}
            style={{
              width: '100%', padding: '14px 24px',
              background: !canNext ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
              border: '1px solid ' + (!canNext ? 'var(--border)' : 'var(--accent-border)'),
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: !canNext ? 'var(--text-tertiary)' : 'var(--text-accent)',
              cursor: !canNext ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
              boxShadow: !canNext ? 'none' : '0 0 20px rgba(0,200,240,0.06)',
            }}
          >
            Next
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: Choose Mode ───────────────────────────────────────────────────
  if (step === 2) {
    return (
      <div style={pageStyle}>
        <div style={{ textAlign: 'center', maxWidth: 580, marginBottom: 28 }}>
          <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 14, fontFamily: 'var(--font-body)', fontWeight: 500 }}>{APP_NAME}</p>
          <h1 style={headingStyle}>How would you like to proceed?</h1>
          <p style={subStyle}>Choose a mode to continue. You can always start a new session later.</p>
        </div>

        <StepBar current={2} />

        <div style={{ width: '100%', maxWidth: 860, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>

          {/* ── Ask Questions card ── */}
          <div
            onClick={!working ? handleAskOnly : undefined}
            style={{
              background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
              border: '1px solid rgba(155,127,227,0.3)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px 28px',
              cursor: working ? 'not-allowed' : 'pointer',
              position: 'relative', overflow: 'hidden',
              transition: 'all var(--transition)',
              display: 'flex', flexDirection: 'column', gap: 18,
              opacity: working ? 0.75 : 1,
            }}
            onMouseEnter={function(e) {
              if (!working) {
                e.currentTarget.style.borderColor = 'rgba(155,127,227,0.6)'
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(155,127,227,0.05) 0%, var(--surface-2) 100%)'
                e.currentTarget.style.boxShadow = '0 0 28px rgba(155,127,227,0.08)'
              }
            }}
            onMouseLeave={function(e) {
              e.currentTarget.style.borderColor = 'rgba(155,127,227,0.3)'
              e.currentTarget.style.background = 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(155,127,227,0.5), transparent)' }} />
            {/* Icon */}
            <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-md)', background: 'rgba(155,127,227,0.1)', border: '1px solid rgba(155,127,227,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {working
                ? <span className="spinner" style={{ borderColor: 'rgba(155,127,227,0.3)', borderTopColor: '#B8A0F0', width: 18, height: 18 }} />
                : <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M4 6h16M4 10.5h10M4 15h7" stroke="#B8A0F0" strokeWidth="1.6" strokeLinecap="round"/>
                    <circle cx="18" cy="16.5" r="4.5" fill="none" stroke="#B8A0F0" strokeWidth="1.6"/>
                    <path d="M21.5 20l2 2" stroke="#B8A0F0" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
              }
            </div>
            {/* Title + badge */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: '#B8A0F0', fontFamily: 'var(--font-display)', letterSpacing: '0.01em' }}>Ask Questions</h2>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'rgba(155,127,227,0.12)', border: '1px solid rgba(155,127,227,0.25)', color: '#B8A0F0', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}></span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.65 }}>
                Start with a blank slate. Ask anything about your data — get instant SQL-powered answers, driver analysis and trend breakdowns. No queries generated upfront.
              </p>
            </div>
            {/* Feature list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {['Instant natural-language queries', 'Driver analysis & waterfall charts', 'No upfront token cost'].map(function(feat) {
                return (
                  <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'rgba(155,127,227,0.1)', border: '1px solid rgba(155,127,227,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><polyline points="1,3.5 2.8,5.5 6,1.5" stroke="#B8A0F0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{feat}</span>
                  </div>
                )
              })}
            </div>
            {/* Footer CTA */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 4, borderTop: '1px solid rgba(155,127,227,0.12)' }}>
              <span style={{ fontSize: 11, color: '#B8A0F0', fontFamily: 'var(--font-body)', fontWeight: 500 }}>{working ? 'Preparing session…' : 'Select this mode'}</span>
              {!working && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="#B8A0F0" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </div>
          </div>

          {/* ── Generate Intelligence card ── */}
          <div
            onClick={function() { setError(''); setStep(3) }}
            style={{
              background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
              border: '1px solid var(--accent-border)',
              borderRadius: 'var(--radius-lg)',
              padding: '32px 28px',
              cursor: 'pointer',
              position: 'relative', overflow: 'hidden',
              transition: 'all var(--transition)',
              display: 'flex', flexDirection: 'column', gap: 18,
            }}
            onMouseEnter={function(e) {
              e.currentTarget.style.borderColor = 'rgba(0,200,240,0.6)'
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,200,240,0.05) 0%, var(--surface-2) 100%)'
              e.currentTarget.style.boxShadow = '0 0 28px rgba(0,200,240,0.08)'
            }}
            onMouseLeave={function(e) {
              e.currentTarget.style.borderColor = 'var(--accent-border)'
              e.currentTarget.style.background = 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.4 }} />
            {/* Icon */}
            <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-md)', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="15" width="4" height="7" rx="1" fill="rgba(0,200,240,0.18)" stroke="var(--accent)" strokeWidth="1.4"/>
                <rect x="10" y="10" width="4" height="12" rx="1" fill="rgba(0,200,240,0.18)" stroke="var(--accent)" strokeWidth="1.4"/>
                <rect x="18" y="4" width="4" height="18" rx="1" fill="rgba(0,200,240,0.18)" stroke="var(--accent)" strokeWidth="1.4"/>
                <path d="M3.5 12l5-4 5-3 5-4" stroke="var(--accent)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 2" opacity="0.5"/>
              </svg>
            </div>
            {/* Title + badge */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-accent)', fontFamily: 'var(--font-display)', letterSpacing: '0.01em' }}>Generate Intelligence</h2>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Full dashboard</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.65 }}>
                Let PRISM build a full dashboard — KPI cards, charts, trend explorer and AI-ranked decisions. Configure your panels and context before building.
              </p>
            </div>
            {/* Feature list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {['KPI cards, charts & trend explorer', 'AI-ranked decisions & summary', 'Context-aware query generation'].map(function(feat) {
                return (
                  <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 15, height: 15, borderRadius: '50%', background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="7" height="7" viewBox="0 0 7 7" fill="none"><polyline points="1,3.5 2.8,5.5 6,1.5" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{feat}</span>
                  </div>
                )
              })}
            </div>
            {/* Footer CTA */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto', paddingTop: 4, borderTop: '1px solid rgba(0,200,240,0.12)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-accent)', fontFamily: 'var(--font-body)', fontWeight: 500 }}>Select this mode</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M7 3l3 3-3 3" stroke="var(--accent)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
          </div>
        </div>

        {error && (
          <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 16, border: '1px solid rgba(224,85,85,0.2)', maxWidth: 860, width: '100%', fontFamily: 'var(--font-body)' }}>
            {error}
          </p>
        )}

        {/* Back to Configure */}
        <button
          onClick={function() { setError(''); setStep(1) }}
          disabled={working}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 16px', cursor: working ? 'not-allowed' : 'pointer', color: 'var(--text-tertiary)', fontSize: 11, fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 6, transition: 'all var(--transition)' }}
          onMouseEnter={function(e) { if (!working) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'var(--border-strong)' } }}
          onMouseLeave={function(e) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 6H1M4 3L1 6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Back to Configure
        </button>
      </div>
    )
  }

  // ── Step 3: Dashboard Settings (Generate Intelligence path) ───────────────
  return (
    <div style={pageStyle}>
      <div style={{ textAlign: 'center', maxWidth: 580, marginBottom: 28 }}>
        <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 14, fontFamily: 'var(--font-body)', fontWeight: 500 }}>{APP_NAME}</p>
        <h1 style={headingStyle}>Configure your dashboard</h1>
        <p style={subStyle}>Add context to focus the analysis and choose which panels to include.</p>
      </div>

      <StepBar current={3} />

      <div style={{ width: '100%', maxWidth: 640 }}>

        {/* ── Context (Section 4 or 3) ── */}
        <SectionCard n={mandatoryFilterFields.length > 0 ? '4' : '3'} title={<>Your context <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginLeft: 6, verticalAlign: 'middle' }}>optional</span></>}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 10 }}>
            Describe your role or focus — the LLM will extract <span style={{ color: 'var(--text-accent)' }}>dimension filters</span> and <span style={{ color: 'var(--text-accent)' }}>KPI focus</span>. You'll confirm before building.
          </p>
          <textarea ref={contextRef} defaultValue=""
            placeholder={'e.g. "I am head of West Region and my focus is Revenue"'}
            style={{ width: '100%', minHeight: 72, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
            onFocus={function(e){e.target.style.borderColor='var(--accent-border)'}}
            onBlur={function(e){e.target.style.borderColor='var(--border)'}}
          />
          {showConfirm && extracted && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', marginTop: 10 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, fontFamily: 'var(--font-body)' }}>Confirm context</p>
              {extracted.filters && extracted.filters.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-body)' }}>Filters</p>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {extracted.filters.map(function(f,i){ return <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>{f.display||(f.field+' '+f.operator+' '+f.value)}</span> })}
                  </div>
                </div>
              )}
              {extracted.kpi_focus && extracted.kpi_focus.length > 0 && (
                <div style={{ marginBottom: 6 }}>
                  <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-body)' }}>KPI focus</p>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {extracted.kpi_focus.map(function(k,i){ return <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(16,196,138,0.1)', border: '1px solid rgba(16,196,138,0.3)', color: '#10C48A', fontFamily: 'var(--font-mono)' }}>{k}</span> })}
                  </div>
                </div>
              )}
              {extracted.explanation && <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>{extracted.explanation}</p>}
            </div>
          )}
        </SectionCard>

        {/* ── Dashboard Panels (Section 5 or 4) ── */}
        <SectionCard n={mandatoryFilterFields.length > 0 ? '5' : '4'} title="Dashboard panels">
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 10 }}>Choose which panels appear on your dashboard</p>
          {[
            { key: 'decisions',      label: 'Generate Decisions',  desc: 'AI-ranked actions and health scores' },
            { key: 'summary',        label: 'Generate Summary',    desc: 'Executive narrative report' },
            { key: 'forecast',       label: 'Trend Explorer',      desc: 'Interactive KPI trends and forecasts' },
            { key: 'queryInspector', label: 'Query Inspector',     desc: 'View and copy all generated SQL' },
            { key: 'coveragePanel',  label: 'Coverage Report',     desc: 'Explain why KPIs or charts were skipped' },
          ].map(function(item) {
            var on = prefs[item.key] !== false
            return (
              <div key={item.key}
                onClick={function(){setPrefs(function(p){var n=Object.assign({},p);n[item.key]=!on;return n})}}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 'var(--radius-md)', border: '1px solid '+(on?'var(--accent-border)':'var(--border)'), background: on?'var(--accent-dim)':'transparent', cursor: 'pointer', transition: 'all var(--transition)', marginBottom: 6 }}>
                <div style={{ width: 30, height: 16, borderRadius: 8, background: on?'var(--accent)':'var(--border)', position: 'relative', flexShrink: 0, transition: 'background var(--transition)' }}>
                  <div style={{ position: 'absolute', top: 2, left: on?15:2, width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left var(--transition)' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: on?'var(--text-accent)':'var(--text-secondary)', fontFamily: 'var(--font-body)', marginBottom: 1 }}>{item.label}</p>
                  <p style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{item.desc}</p>
                </div>
              </div>
            )
          })}
        </SectionCard>

        {error && (
          <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(224,85,85,0.2)', fontFamily: 'var(--font-body)' }}>
            {error}
          </p>
        )}

        {/* Back + Generate buttons */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <button
            onClick={function() { setError(''); setShowConfirm(false); setStep(2) }}
            disabled={working || extracting}
            style={{ flexShrink: 0, padding: '14px 20px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: working||extracting?'var(--text-tertiary)':'var(--text-secondary)', cursor: working||extracting?'not-allowed':'pointer', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-display)', transition: 'all var(--transition)' }}
            onMouseEnter={function(e){ if(!working&&!extracting){ e.currentTarget.style.borderColor='var(--border-strong)'; e.currentTarget.style.color='var(--text-primary)' } }}
            onMouseLeave={function(e){ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.color=working||extracting?'var(--text-tertiary)':'var(--text-secondary)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M9 6H1M4 3L1 6l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>

          <button onClick={handleBuild} disabled={working || extracting}
            style={{
              flex: 1, padding: '14px 24px',
              background: working||extracting ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
              border: '1px solid ' + (working||extracting ? 'var(--border)' : 'var(--accent-border)'),
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: working||extracting ? 'var(--text-tertiary)' : 'var(--text-accent)',
              cursor: working||extracting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
              boxShadow: working||extracting ? 'none' : '0 0 20px rgba(0,200,240,0.06)',
            }}>
            {extracting ? <><span className="spinner" /><span style={{ fontSize: 12 }}>Analysing context…</span></>
              : working   ? <><span className="spinner" /><span style={{ fontSize: 12 }}>{progress || 'Processing…'}</span></>
              : showConfirm ? 'Build with this context'
              : 'Generate Intelligence'}
          </button>
        </div>

        <VapiHelpWidget />
      </div>
    </div>
  )
}
