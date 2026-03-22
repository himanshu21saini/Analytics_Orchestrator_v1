'use client'

import { useState, useEffect, useRef } from 'react'
import { SETUP_MODE, APP_NAME, APP_TAGLINE } from '../lib/app-config'

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

var COMPARISON_OPTIONS = {
  YTD: [{ value: 'YoY', label: 'YoY' }],
  QTD: [{ value: 'YoY', label: 'YoY' }, { value: 'QoQ', label: 'QoQ' }],
  MTD: [{ value: 'YoY', label: 'YoY' }, { value: 'MoM', label: 'MoM' }],
}

// Given year_month rows from metadata, detect available year+month field pairs.
// Pairs are matched by naming convention: Report_Year↔Report_Month, Fiscal_Year↔Fiscal_Month etc.
// Falls back to any single year_month field used for both if no pair is found.
function detectPeriodPairs(ymRows) {
  // Exclude Current_Fiscal_Year / Current_Fiscal_Month — these are 0/1 flag fields not actual period values
  var yearFields  = ymRows.filter(function(r) {
    return /year/i.test(r.field_name)
      && !/month|qtr|quarter/i.test(r.field_name)
      && !/^current_/i.test(r.field_name)
  })
  var monthFields = ymRows.filter(function(r) {
    return /month/i.test(r.field_name)
      && !/year/i.test(r.field_name)
      && !/^current_/i.test(r.field_name)
  })

  var pairs = []

  yearFields.forEach(function(yRow) {
    // Extract prefix: Report_Year → Report, Fiscal_Year → Fiscal
    var prefix = yRow.field_name.replace(/_?year/i, '').replace(/^_|_$/,'')
    // Find matching month field with same prefix
    var mRow = monthFields.find(function(m) {
      var mPrefix = m.field_name.replace(/_?month/i, '').replace(/^_|_$/,'')
      return mPrefix.toLowerCase() === prefix.toLowerCase()
    })
    if (mRow) {
      pairs.push({
        label:      (prefix || 'Default') + ' period',
        yearField:  yRow.field_name,
        monthField: mRow.field_name,
        yearDisplay:  yRow.display_name || yRow.field_name,
        monthDisplay: mRow.display_name || mRow.field_name,
      })
    }
  })

  // Fallback: if no pairs matched but we have year/month fields, use first available
  if (!pairs.length && yearFields.length && monthFields.length) {
    pairs.push({
      label:      'Default period',
      yearField:  yearFields[0].field_name,
      monthField: monthFields[0].field_name,
      yearDisplay:  yearFields[0].display_name || yearFields[0].field_name,
      monthDisplay: monthFields[0].display_name || monthFields[0].field_name,
    })
  }

  // Final fallback: legacy datasets without year_month type — use 'year'/'month'
  if (!pairs.length) {
    pairs.push({ label: 'Default period', yearField: 'year', monthField: 'month', yearDisplay: 'year', monthDisplay: 'month' })
  }

  return pairs
}

// Build list of months for the slider: 2 years back to current month
var TODAY      = new Date()
var SLIDER_MONTHS = []
for (var si = 23; si >= 0; si--) {
  var sd = new Date(TODAY.getFullYear(), TODAY.getMonth() - si, 1)
  SLIDER_MONTHS.push({ year: sd.getFullYear(), month: sd.getMonth() + 1 })
}
var SLIDER_DEFAULT = SLIDER_MONTHS.length - 1  // latest month

export function SetupScreenDev({ onReady }) {
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
  var [working,      setWorking]      = useState(false)
  var [progress,     setProgress]     = useState('')
  var [error,        setError]        = useState('')
  var [periodPairs,  setPeriodPairs]  = useState([])
  var [selPairIdx,   setSelPairIdx]   = useState(0)
  // Panel preferences — all on by default
  var [prefs, setPrefs] = useState({ decisions: true, summary: true, forecast: true, queryInspector: true, coveragePanel: true })
  // User context — uncontrolled textarea (ref) to avoid re-render on every keystroke
  var contextRef = useRef()
  var [extracting,   setExtracting]   = useState(false)
  var [extracted,    setExtracted]    = useState(null)   // { filters, kpi_focus, explanation }
  var [showConfirm,  setShowConfirm]  = useState(false)
  var dataRef = useRef(); var metaRef = useRef()
  // Auto-generate metadata state
  var [autoGenState,  setAutoGenState]  = useState('idle')   // idle | loading | done | error
  var [autoGenResult, setAutoGenResult] = useState(null)      // { fieldCount, flaggedCount, filename }

  // Derive selYear and selMonth from slider index
  var selYearMonth = SLIDER_MONTHS[sliderIdx] || SLIDER_MONTHS[SLIDER_DEFAULT]
  var selYear  = selYearMonth.year
  var selMonth = selYearMonth.month

  useEffect(function() { loadLists() }, [])
  useEffect(function() {
    var allowed = COMPARISON_OPTIONS[viewType] || []
    var valid = allowed.some(function(o) { return o.value === compType })
    if (!valid && allowed.length > 0) setCompType(allowed[0].value)
  }, [viewType])

  // When metadata selection changes, fetch year_month fields to build period pairs
  useEffect(function() {
    var metaId = metaMode === 'existing' ? selMeta : null
    if (!metaId) { setPeriodPairs([]); setSelPairIdx(0); return }
    fetch('/api/metadata-fields?metadataSetId=' + metaId + '&type=year_month')
      .then(function(r) { return r.json() })
      .then(function(j) {
        var pairs = detectPeriodPairs(j.fields || [])
        setPeriodPairs(pairs)
        setSelPairIdx(0)
      })
      .catch(function() { setPeriodPairs([]); setSelPairIdx(0) })
  }, [selMeta, metaMode])

  async function loadLists() {
    setLoadingLists(true)
    try {
      var r1 = await fetch('/api/datasets'); var r2 = await fetch('/api/metadata-sets')
      var d1 = await r1.json(); var d2 = await r2.json()
      var ds = d1.datasets || []; var ms = d2.metadataSets || []
      setDatasets(ds); setMetaSets(ms)
      if (ds.length === 0) setDataMode('upload'); else setSelDataset(String(ds[0].id))
      if (ms.length === 0) setMetaMode('upload'); else setSelMeta(String(ms[0].id))
    } catch (e) { setError('Could not connect to database.') }
    setLoadingLists(false)
  }

  async function handleAutoGenMeta() {
    // Determine which dataset to sample from
    var dsId = dataMode === 'existing' ? selDataset : null
    if (!dsId && !dataFile) {
      setError('Select or upload a dataset first — the auto-generator needs data to analyse.')
      return
    }
    // If dataset was just uploaded we need its ID — require existing selection for now
    if (!dsId) {
      setError('Upload your dataset first, then use auto-generate after it is saved.')
      return
    }
    setAutoGenState('loading')
    setAutoGenResult(null)
    try {
      var res  = await fetch('/api/generate-metadata', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ datasetId: dsId }),
      })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Generation failed.')

      // Trigger download automatically
      var bytes  = Uint8Array.from(atob(json.base64), function(c) { return c.charCodeAt(0) })
      var blob   = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      var url    = URL.createObjectURL(blob)
      var link   = document.createElement('a')
      link.href  = url
      link.download = json.filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setAutoGenResult({ fieldCount: json.fieldCount, flaggedCount: json.flaggedCount, filename: json.filename })
      setAutoGenState('done')
    } catch(err) {
      setError('Auto-generate failed: ' + err.message)
      setAutoGenState('error')
    }
  }

  async function handleBuild() {
    setError('')
    var contextText = (contextRef.current && contextRef.current.value) || ''
    // If context entered and confirmation not yet shown — extract first
    if (contextText.trim() && !showConfirm) {
      setExtracting(true)
      try {
        var metaId = metaMode === 'existing' ? selMeta : null
        var metaForCtx = []
        if (metaId) {
          var mfr = await fetch('/api/metadata-fields?metadataSetId=' + metaId)
          var mfj = await mfr.json()
          metaForCtx = mfj.fields || []
        }
        var res = await fetch('/api/extract-context', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contextText: contextText.trim(), metadata: metaForCtx }),
        })
        var j = await res.json()
        if (j.error) throw new Error(j.error)
        setExtracted(j)
        setShowConfirm(true)
      } catch(err) { setError('Context extraction failed: ' + err.message) }
      setExtracting(false)
      return
    }
    await doBuild(showConfirm ? extracted : null)
  }

  async function doBuild(userContext) {
    setShowConfirm(false)
    setError(''); var finalDatasetId = selDataset; var finalMetaId = selMeta; setWorking(true)
    try {
      if (dataMode === 'upload') {
        if (!dataFile) { setError('Please select a data file.'); setWorking(false); return }
        setProgress('Uploading dataset...')
        var fd = new FormData(); fd.append('file', dataFile); fd.append('name', dataName || dataFile.name)
        var dr = await fetch('/api/upload-dataset', { method: 'POST', body: fd }); var dj = await dr.json()
        if (!dr.ok) throw new Error(dj.error || 'Dataset upload failed.')
        finalDatasetId = String(dj.dataset.id); await loadLists()
      }
      if (metaMode === 'upload') {
        if (!metaFile) { setError('Please select a metadata file.'); setWorking(false); return }
        setProgress('Saving metadata...')
        var mf2 = new FormData(); mf2.append('file', metaFile); mf2.append('name', metaName || metaFile.name)
        var mr = await fetch('/api/save-metadata', { method: 'POST', body: mf2 }); var mj = await mr.json()
        if (!mr.ok) throw new Error(mj.error || 'Metadata save failed.')
        finalMetaId = String(mj.metadataSet.id)
        var mfRes = await fetch('/api/metadata-fields?metadataSetId=' + finalMetaId + '&type=year_month')
        var mfJson = await mfRes.json()
        var newPairs = detectPeriodPairs(mfJson.fields || [])
        setPeriodPairs(newPairs); setSelPairIdx(0)
        await loadLists()
      }
      var activePairs = periodPairs.length ? periodPairs : [{ yearField: 'year', monthField: 'month' }]
      var chosenPair  = activePairs[selPairIdx] || activePairs[0]
      setProgress('Composing intelligence queries...')
      var timePeriod = {
        viewType, year: selYear, month: selMonth, comparisonType: compType,
        yearField: chosenPair.yearField, monthField: chosenPair.monthField,
      }
      var gqRes = await fetch('/api/generate-queries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasetId: finalDatasetId, metadataSetId: finalMetaId, timePeriod, userContext: userContext || null }),
      })
      var gqJson = await gqRes.json()
      if (!gqRes.ok) throw new Error(gqJson.error || 'Failed to generate queries.')
      setProgress('Executing ' + (gqJson.queries ? gqJson.queries.length : '') + ' queries...')
      var rqRes = await fetch('/api/run-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: gqJson.queries }) })
      var rqJson = await rqRes.json()
      if (!rqRes.ok) throw new Error(rqJson.error || 'Failed to run queries.')
      onReady({
        datasetId: finalDatasetId, metadataSetId: finalMetaId,
        queries: gqJson.queries, queryResults: rqJson.results,
        metadata: gqJson.metadata, timePeriod, periodInfo: gqJson.periodInfo,
        initialUsage: gqJson.usage || null,
        userContext: userContext || null,
        coverageData: gqJson.coverageData || null,
        preferences: prefs,
      })
    } catch (err) { setError(err.message); setWorking(false); setProgress('') }
  }

  var canBuild = !working && (dataMode === 'existing' ? !!selDataset : !!dataFile) && (metaMode === 'existing' ? !!selMeta : !!metaFile)
  var allowedComp = COMPARISON_OPTIONS[viewType] || []
  var activePair = (periodPairs[selPairIdx] || periodPairs[0])
  var previewLabel = viewType + ' · ' + MONTH_NAMES[selMonth-1] + ' ' + selYear + ' · vs ' + compType + (activePair ? ' · ' + activePair.yearField : '')

  var selectStyle = {
    width: '100%', padding: '10px 14px', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', fontSize: 13, background: 'var(--surface-2)',
    color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
    fontFamily: 'var(--font-body)', appearance: 'none', WebkitAppearance: 'none',
  }
  var inputStyle = { ...selectStyle, cursor: 'text', appearance: 'auto', WebkitAppearance: 'auto', marginBottom: 10 }

  function Chip({ value, active, onClick, children }) {
    return (
      <button onClick={onClick} style={{
        padding: '6px 16px', borderRadius: 'var(--radius-sm)',
        fontSize: 12, fontWeight: 500, cursor: 'pointer',
        fontFamily: 'var(--font-body)', letterSpacing: '0.06em',
        border: '1px solid ' + (active ? 'var(--accent-border)' : 'var(--border)'),
        background: active ? 'var(--accent-dim)' : 'transparent',
        color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
        transition: 'all var(--transition)',
        boxShadow: active ? '0 0 10px rgba(0,200,240,0.08)' : 'none',
      }}>
        {children}
      </button>
    )
  }

  function FileZone({ file, onFile, refEl, placeholder }) {
    return (
      <div onClick={function() { refEl.current && refEl.current.click() }} style={{
        border: '1px dashed ' + (file ? 'var(--accent-border)' : 'var(--border)'),
        borderRadius: 'var(--radius-md)', padding: '14px 16px', cursor: 'pointer',
        background: file ? 'var(--accent-dim)' : 'transparent', transition: 'all var(--transition)',
      }}>
        <input ref={refEl} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={function(e) { onFile(e.target.files[0] || null) }} />
        <p style={{ fontSize: 12, color: file ? 'var(--text-accent)' : 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
          {file ? file.name : placeholder}
        </p>
      </div>
    )
  }

  function SectionCard({ n, title, children }) {
    return (
      <div className={'fade-up d' + n} style={{
        background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: '22px 24px', backdropFilter: 'blur(8px)',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Corner bracket decorations */}
        <div style={{ position: 'absolute', top: 8, left: 8, width: 12, height: 12, borderTop: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', borderRadius: '2px 0 0 0', opacity: 0.6 }} />
        <div style={{ position: 'absolute', top: 8, right: 8, width: 12, height: 12, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', borderRadius: '0 2px 0 0', opacity: 0.6 }} />
        {/* Top line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.2 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-dim)',
          }}>
            <span style={{ fontSize: 10, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', fontWeight: 400 }}>{n}</span>
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}>{title}</p>
        </div>
        {children}
      </div>
    )
  }

  function ModeToggle({ mode, setMode, hasExisting }) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {hasExisting && (
          <button onClick={function() { setMode('existing') }} style={{
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-body)', letterSpacing: '0.04em',
            border: '1px solid ' + (mode === 'existing' ? 'var(--accent-border)' : 'var(--border)'),
            background: mode === 'existing' ? 'var(--accent-dim)' : 'transparent',
            color: mode === 'existing' ? 'var(--text-accent)' : 'var(--text-tertiary)',
          }}>Existing</button>
        )}
        <button onClick={function() { setMode('upload') }} style={{
          padding: '4px 10px', fontSize: 11, cursor: 'pointer', borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-body)', letterSpacing: '0.04em',
          border: '1px solid ' + (mode === 'upload' ? 'var(--accent-border)' : 'var(--border)'),
          background: mode === 'upload' ? 'var(--accent-dim)' : 'transparent',
          color: mode === 'upload' ? 'var(--text-accent)' : 'var(--text-tertiary)',
        }}>Upload new</button>
      </div>
    )
  }

  if (loadingLists) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 'calc(100vh - 54px)' }}>
        <div style={{ textAlign: 'center' }}>
          <span className="spinner" />
          <p style={{ marginTop: 16, color: 'var(--text-tertiary)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-body)' }}>Connecting</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: 'calc(100vh - 54px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>

      {/* Hero */}
      <div className="fade-up" style={{ textAlign: 'center', maxWidth: 500, marginBottom: 44 }}>
        <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 16, fontFamily: 'var(--font-body)', fontWeight: 500 }}>
          {APP_NAME} · Developer Mode
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--text-primary)', marginBottom: 14 }}>
          Configure Intelligence
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
          Select your data sources, time horizon and context. The AI agent composes your intelligence.
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Dataset */}
        <SectionCard n="1" title="Dataset">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Main data file — .xlsx, .xls or .csv</p>
            <ModeToggle mode={dataMode} setMode={setDataMode} hasExisting={datasets.length > 0} />
          </div>
          {dataMode === 'existing' && datasets.length > 0 && (
            <select value={selDataset} onChange={function(e) { setSelDataset(e.target.value) }} style={selectStyle}>
              {datasets.map(function(d) { return <option key={d.id} value={String(d.id)}>{d.name} — {d.row_count} rows</option> })}
            </select>
          )}
          {dataMode === 'upload' && (
            <>
              <input type="text" placeholder="Dataset name (optional)" value={dataName} onChange={function(e) { setDataName(e.target.value) }} style={inputStyle} />
              <FileZone file={dataFile} onFile={setDataFile} refEl={dataRef} placeholder="Select .xlsx or .csv file" />
            </>
          )}
        </SectionCard>

        {/* Metadata */}
        <SectionCard n="2" title="Metadata">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Field definitions — required: field_name, type, display_name</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <ModeToggle mode={metaMode} setMode={setMetaMode} hasExisting={metaSets.length > 0} />
              <AutoGenButton
                state={autoGenState}
                result={autoGenResult}
                onGenerate={handleAutoGenMeta}
                disabled={dataMode === 'existing' ? !selDataset : !dataFile}
              />
            </div>
          </div>
          {metaMode === 'existing' && metaSets.length > 0 && (
            <select value={selMeta} onChange={function(e) { setSelMeta(e.target.value) }} style={selectStyle}>
              {metaSets.map(function(m) { return <option key={m.id} value={String(m.id)}>{m.name}</option> })}
            </select>
          )}
          {metaMode === 'upload' && (
            <>
              <input type="text" placeholder="Metadata name (optional)" value={metaName} onChange={function(e) { setMetaName(e.target.value) }} style={inputStyle} />
              <FileZone file={metaFile} onFile={setMetaFile} refEl={metaRef} placeholder="Select metadata .xlsx or .csv file" />
            </>
          )}
          {autoGenState === 'done' && autoGenResult && (
            <AutoGenResult result={autoGenResult} onGenerate={handleAutoGenMeta} />
          )}
        </SectionCard>

        {/* Time Period */}
        <SectionCard n="3" title="Time Period">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 18 }}>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-body)' }}>View</p>
              <div style={{ display: 'flex', gap: 6 }}>
                {['MTD','YTD','QTD'].map(function(v) { return <Chip key={v} active={viewType===v} onClick={function() { setViewType(v) }}>{v}</Chip> })}
              </div>
            </div>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-body)' }}>Compare</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {allowedComp.map(function(opt) { return <Chip key={opt.value} active={compType===opt.value} onClick={function() { setCompType(opt.value) }}>{opt.value}</Chip> })}
              </div>
            </div>
          </div>

          {/* As-of date slider */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-body)' }}>As-of date</p>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                {MONTH_NAMES[selMonth - 1]} {selYear}
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                type="range"
                min={0}
                max={SLIDER_MONTHS.length - 1}
                value={sliderIdx}
                onChange={function(e) { setSliderIdx(parseInt(e.target.value)) }}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {MONTH_NAMES[SLIDER_MONTHS[0].month - 1].slice(0,3)} {SLIDER_MONTHS[0].year}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {MONTH_NAMES[SLIDER_MONTHS[SLIDER_MONTHS.length - 1].month - 1].slice(0,3)} {SLIDER_MONTHS[SLIDER_MONTHS.length - 1].year}
                </span>
              </div>
            </div>
          </div>

          {/* Period field selector — only shown when multiple pairs exist */}
          {periodPairs.length > 1 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-body)' }}>
                Period calendar to use
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {periodPairs.map(function(pair, idx) {
                  return (
                    <Chip key={idx} active={selPairIdx === idx} onClick={function() { setSelPairIdx(idx) }}>
                      {pair.label}
                    </Chip>
                  )
                })}
              </div>
              {activePair && (
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'var(--font-mono)' }}>
                  Using: {activePair.yearField} + {activePair.monthField}
                </p>
              )}
            </div>
          )}

          <div style={{ padding: '10px 14px', background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)', flexShrink: 0 }} />
            <p style={{ fontSize: 12, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              {previewLabel}
            </p>
          </div>
        </SectionCard>

        {/* Section 3: User Context */}
        <SectionCard n="3" title={<>Your context <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginLeft: 6, verticalAlign: 'middle' }}>optional</span></>}>
          <textarea
            ref={contextRef}
            defaultValue=""
            placeholder={'e.g. "I am head of West Region and my focus is on Revenue"\n     "Show me only Corporate segment performance"'}
            style={{
              width: '100%', minHeight: 72, padding: '10px 12px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', color: 'var(--text-primary)',
              fontSize: 12, fontFamily: 'var(--font-body)', resize: 'vertical',
              outline: 'none', lineHeight: 1.6,
            }}
            onFocus={function(e) { e.target.style.borderColor = 'var(--accent-border)' }}
            onBlur={function(e) { e.target.style.borderColor = 'var(--border)' }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>
            The LLM will extract <span style={{ color: 'var(--text-accent)' }}>dimension filters</span> (e.g. Region = West) and <span style={{ color: 'var(--text-accent)' }}>KPI focus</span> from your description. You'll confirm before building.
          </p>
        </SectionCard>

        {/* Confirmation modal — shown after context extraction */}
        {showConfirm && extracted && (
          <div className="fade-in" style={{
            background: 'var(--surface)', border: '1px solid var(--accent-border)',
            borderRadius: 'var(--radius-lg)', padding: '20px 22px', marginBottom: 0,
            backdropFilter: 'blur(8px)',
          }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14, fontFamily: 'var(--font-display)' }}>
              Confirm dashboard context
            </p>

            {extracted.filters && extracted.filters.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>Filters applied</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {extracted.filters.map(function(f, i) {
                    return (
                      <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: 'var(--accent-dim)', border: '1px solid var(--accent-border)', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)' }}>
                        {f.display || (f.field + ' ' + f.operator + ' ' + f.value)}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {extracted.kpi_focus && extracted.kpi_focus.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>KPI focus (prioritised)</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {extracted.kpi_focus.map(function(k, i) {
                    return (
                      <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: 'rgba(16,196,138,0.1)', border: '1px solid rgba(16,196,138,0.3)', color: '#10C48A', fontFamily: 'var(--font-mono)' }}>
                        {k}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {extracted.explanation && (
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                {extracted.explanation}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={function() { doBuild(extracted) }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
                  border: '1px solid var(--accent-border)', color: 'var(--text-accent)',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-display)',
                  letterSpacing: '0.06em',
                }}
              >Build with this context</button>
              <button
                onClick={function() { setShowConfirm(false); setExtracted(null); if (contextRef.current) contextRef.current.value = ''; doBuild(null) }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 'var(--radius-md)',
                  background: 'transparent', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--font-display)', letterSpacing: '0.06em',
                }}
              >Reset &amp; build without</button>
            </div>
          </div>
        )}

        {/* Section 4: Dashboard Panels */}
        <SectionCard n="4" title="Dashboard panels">
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 14, fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
            Choose which panels appear on your dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { key: 'decisions',     label: 'Generate Decisions',  desc: 'AI-ranked actions and health scores' },
              { key: 'summary',       label: 'Generate Summary',    desc: 'Executive narrative report' },
              { key: 'forecast',      label: 'Trend Explorer',      desc: 'Interactive KPI trends and forecasts' },
              { key: 'queryInspector',label: 'Query Inspector',     desc: 'View and copy all generated SQL' },
              { key: 'coveragePanel', label: 'Coverage Report',     desc: 'Why certain KPIs or charts were skipped' },
            ].map(function(item) {
              var on = prefs[item.key] !== false
              return (
                <div
                  key={item.key}
                  onClick={function() { setPrefs(function(p) { var n = Object.assign({}, p); n[item.key] = !on; return n }) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid ' + (on ? 'var(--accent-border)' : 'var(--border)'), background: on ? 'var(--accent-dim)' : 'transparent', cursor: 'pointer', transition: 'all var(--transition)' }}
                >
                  {/* Toggle pill */}
                  <div style={{ width: 32, height: 18, borderRadius: 9, background: on ? 'var(--accent)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background var(--transition)' }}>
                    <div style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left var(--transition)' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: on ? 'var(--text-accent)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)', marginBottom: 1 }}>{item.label}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{item.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>

        {/* Build */}
        <div className="fade-up d4">
          <button
            onClick={handleBuild}
            disabled={!canBuild || extracting}
            style={{
              width: '100%', padding: '14px 24px',
              background: canBuild
                ? 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)'
                : 'transparent',
              border: '1px solid ' + (canBuild ? 'var(--accent-border)' : 'var(--border)'),
              borderRadius: 'var(--radius-md)',
              fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
              color: canBuild ? 'var(--text-accent)' : 'var(--text-tertiary)',
              cursor: canBuild ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
              boxShadow: canBuild ? '0 0 20px rgba(0,200,240,0.06)' : 'none',
            }}
          >
            {extracting
              ? <><span className="spinner" /><span style={{ fontSize: 12 }}>Analysing context...</span></>
              : working
                ? <><span className="spinner" /><span style={{ fontSize: 12 }}>{progress || 'Processing...'}</span></>
                : showConfirm ? 'Confirm above to proceed' : 'Generate Intelligence'
            }
          </button>

          {error && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)' }}>
              {error}
            </p>
          )}

          <VapiHelpWidget />
        </div>
      </div>
    </div>
  )
}

// ── Production wizard ─────────────────────────────────────────────────────────

function WizardCard({ children, style }) {
  return (
    <div style={Object.assign({
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '36px 40px',
      width: '100%',
      maxWidth: 520,
      backdropFilter: 'blur(8px)',
      position: 'relative',
      overflow: 'hidden',
    }, style)}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.3 }} />
      {children}
    </div>
  )
}

function ToggleRow({ item, on, onToggle }) {
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid ' + (on ? 'var(--accent-border)' : 'var(--border)'), background: on ? 'var(--accent-dim)' : 'transparent', cursor: 'pointer', transition: 'all var(--transition)', marginBottom: 8 }}
    >
      <div style={{ width: 32, height: 18, borderRadius: 9, background: on ? 'var(--accent)' : 'var(--border)', position: 'relative', flexShrink: 0, transition: 'background var(--transition)' }}>
        <div style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left var(--transition)' }} />
      </div>
      <div>
        <p style={{ fontSize: 12, fontWeight: 500, color: on ? 'var(--text-accent)' : 'var(--text-secondary)', fontFamily: 'var(--font-body)', marginBottom: 1 }}>{item.label}</p>
        <p style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{item.desc}</p>
      </div>
    </div>
  )
}


// ── Shared section card — same style as dev mode ──────────────────────────────
function ProdSectionCard({ n, title, children }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 22px', position: 'relative', overflow: 'hidden', marginBottom: 12,
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

function ProdChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '5px 14px', borderRadius: 'var(--radius-sm)', fontSize: 11, fontWeight: 500,
      cursor: 'pointer', fontFamily: 'var(--font-body)', letterSpacing: '0.06em',
      border: '1px solid ' + (active ? 'var(--accent-border)' : 'var(--border)'),
      background: active ? 'var(--accent-dim)' : 'transparent',
      color: active ? 'var(--text-accent)' : 'var(--text-secondary)',
      transition: 'all var(--transition)',
    }}>{children}</button>
  )
}

export function SetupScreenProd({ onReady }) {
  var [step, setStep] = useState(0) // 0=splash, 1=main
  var [splashOut, setSplashOut] = useState(false)

  // All the same state as dev mode
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
  var dataRef = useRef(); var metaRef = useRef()
  var [autoGenState,  setAutoGenState]  = useState('idle')
  var [autoGenResult, setAutoGenResult] = useState(null)

  var selYearMonth = SLIDER_MONTHS[sliderIdx] || SLIDER_MONTHS[SLIDER_DEFAULT]
  var selYear  = selYearMonth.year
  var selMonth = selYearMonth.month
  var allowedComp = COMPARISON_OPTIONS[viewType] || []
  var activePair  = periodPairs[selPairIdx] || periodPairs[0]

  useEffect(function() { loadLists() }, [])

  // Auto-advance splash after 2s
  useEffect(function() {
    if (step !== 0) return
    var t = setTimeout(function() {
      setSplashOut(true)
      setTimeout(function() { setStep(1) }, 350)
    }, 2000)
    return function() { clearTimeout(t) }
  }, [step])

  useEffect(function() {
    var allowed = COMPARISON_OPTIONS[viewType] || []
    var valid = allowed.some(function(o) { return o.value === compType })
    if (!valid && allowed.length > 0) setCompType(allowed[0].value)
  }, [viewType])

  useEffect(function() {
    var metaId = metaMode === 'existing' ? selMeta : null
    if (!metaId) { setPeriodPairs([]); setSelPairIdx(0); return }
    fetch('/api/metadata-fields?metadataSetId=' + metaId)
      .then(function(r) { return r.json() })
      .then(function(j) { var pairs = detectPeriodPairs(j.fields || []); setPeriodPairs(pairs); setSelPairIdx(0) })
      .catch(function() { setPeriodPairs([]); setSelPairIdx(0) })
  }, [selMeta, metaMode])

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

  async function handleAutoGenMeta() {
    var dsId = dataMode === 'existing' ? selDataset : null
    if (!dsId) { setError('Select or upload a dataset first.'); return }
    setAutoGenState('loading'); setAutoGenResult(null)
    try {
      var res  = await fetch('/api/generate-metadata', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: dsId }) })
      var json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Generation failed.')
      var bytes = Uint8Array.from(atob(json.base64), function(c) { return c.charCodeAt(0) })
      var blob  = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      var url   = URL.createObjectURL(blob); var link = document.createElement('a')
      link.href = url; link.download = json.filename
      document.body.appendChild(link); link.click()
      document.body.removeChild(link); URL.revokeObjectURL(url)
      setAutoGenResult({ fieldCount: json.fieldCount, flaggedCount: json.flaggedCount, filename: json.filename })
      setAutoGenState('done')
    } catch(err) { setError('Auto-generate failed: ' + err.message); setAutoGenState('error') }
  }

  async function handleBuild() {
    setError('')
    var contextText = (contextRef.current && contextRef.current.value) || ''
    if (contextText.trim() && !showConfirm) {
      setExtracting(true)
      try {
        var metaId = metaMode === 'existing' ? selMeta : null
        var metaForCtx = []
        if (metaId) { var mfr = await fetch('/api/metadata-fields?metadataSetId=' + metaId); var mfj = await mfr.json(); metaForCtx = mfj.fields || [] }
        var res = await fetch('/api/extract-context', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contextText: contextText.trim(), metadata: metaForCtx }) })
        var j = await res.json()
        if (j.error) throw new Error(j.error)
        setExtracted(j); setShowConfirm(true)
      } catch(err) { setError('Context extraction failed: ' + err.message) }
      setExtracting(false)
      return
    }
    await doBuild(showConfirm ? extracted : null)
  }

  async function doBuild(userContext) {
    setShowConfirm(false); setError(''); setWorking(true)
    var finalDatasetId = selDataset; var finalMetaId = selMeta
    try {
      if (dataMode === 'upload') {
        if (!dataFile) { setError('Please select a data file.'); setWorking(false); return }
        setProgress('Uploading dataset...')
        var fd = new FormData(); fd.append('file', dataFile); fd.append('name', dataName || dataFile.name)
        var dr = await fetch('/api/upload-dataset', { method: 'POST', body: fd }); var dj = await dr.json()
        if (!dr.ok) throw new Error(dj.error || 'Dataset upload failed.')
        finalDatasetId = String(dj.dataset.id); await loadLists()
      }
      if (metaMode === 'upload') {
        if (!metaFile) { setError('Please select a metadata file.'); setWorking(false); return }
        setProgress('Saving metadata...')
        var mf2 = new FormData(); mf2.append('file', metaFile); mf2.append('name', metaName || metaFile.name)
        var mr = await fetch('/api/save-metadata', { method: 'POST', body: mf2 }); var mj = await mr.json()
        if (!mr.ok) throw new Error(mj.error || 'Metadata save failed.')
        finalMetaId = String(mj.metadataSet.id)
        var mfRes = await fetch('/api/metadata-fields?metadataSetId=' + finalMetaId + '&type=year_month')
        var mfJson = await mfRes.json()
        var newPairs = detectPeriodPairs(mfJson.fields || [])
        setPeriodPairs(newPairs); setSelPairIdx(0)
        await loadLists()
      }
      var activePairs = periodPairs.length ? periodPairs : [{ yearField: 'year', monthField: 'month' }]
      var chosenPair  = activePairs[selPairIdx] || activePairs[0]
      setProgress('Composing intelligence queries...')
      var timePeriod = { viewType, year: selYear, month: selMonth, comparisonType: compType, yearField: chosenPair.yearField, monthField: chosenPair.monthField }
      var gqRes = await fetch('/api/generate-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: finalDatasetId, metadataSetId: finalMetaId, timePeriod, userContext: userContext || null }) })
      var gqJson = await gqRes.json()
      if (!gqRes.ok) throw new Error(gqJson.error || 'Failed to generate queries.')
      setProgress('Executing ' + (gqJson.queries ? gqJson.queries.length : '') + ' queries...')
      var rqRes = await fetch('/api/run-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: gqJson.queries }) })
      var rqJson = await rqRes.json()
      if (!rqRes.ok) throw new Error(rqJson.error || 'Failed to run queries.')
      onReady({ datasetId: finalDatasetId, metadataSetId: finalMetaId, queries: gqJson.queries, queryResults: rqJson.results, metadata: gqJson.metadata, timePeriod, periodInfo: gqJson.periodInfo, initialUsage: gqJson.usage || null, userContext: userContext || null, coverageData: gqJson.coverageData || null, preferences: prefs })
    } catch(err) { setError(err.message); setWorking(false); setProgress('') }
  }

  // ── SPLASH ─────────────────────────────────────────────────────────────────
  if (step === 0) {
    return (
      <div style={{ minHeight: 'calc(100vh - 54px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{
          width: '100%', maxWidth: 900,
          height: 'calc(65vh)',
          minHeight: 420,
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          backdropFilter: 'blur(12px)', position: 'relative', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
          opacity: splashOut ? 0 : 1,
          transform: splashOut ? 'scale(0.97)' : 'scale(1)',
        }}>
          {/* Decorative corners */}
          <div style={{ position: 'absolute', top: 16, left: 16, width: 20, height: 20, borderTop: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', top: 16, right: 16, width: 20, height: 20, borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: 16, left: 16, width: 20, height: 20, borderBottom: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', opacity: 0.7 }} />
          <div style={{ position: 'absolute', bottom: 16, right: 16, width: 20, height: 20, borderBottom: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', opacity: 0.7 }} />
          {/* Top accent line */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)' }} />

          {/* Logomark */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, marginBottom: 32 }}>
            {[22, 14, 30, 14, 22].map(function(h, i) {
              return <div key={i} style={{ width: 5, height: h, background: i === 2 ? 'var(--accent)' : 'rgba(0,200,240,0.35)', borderRadius: 3 }} />
            })}
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', marginBottom: 12, textAlign: 'center' }}>
            {APP_NAME}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-accent)', letterSpacing: '0.22em', textTransform: 'uppercase', fontFamily: 'var(--font-body)', marginBottom: 48 }}>
            {APP_TAGLINE}
          </p>

          {/* Loading indicator */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="spinner" style={{ opacity: 0.5 }} />
            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>Initialising</span>
          </div>
        </div>
      </div>
    )
  }

  // ── MAIN SCREEN — two cards side by side ──────────────────────────────────
  var selectStyle = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', fontSize: 12, background: 'var(--surface-2)',
    color: 'var(--text-primary)', cursor: 'pointer', outline: 'none',
    fontFamily: 'var(--font-body)',
  }
  var inputStyle = { ...selectStyle, cursor: 'text', marginBottom: 8 }

  return (
    <div style={{ minHeight: 'calc(100vh - 54px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '36px 24px 60px' }}>

      {/* Hero — matches dev mode style */}
      <div style={{ textAlign: 'center', maxWidth: 580, marginBottom: 36 }}>
        <p style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--text-accent)', marginBottom: 14, fontFamily: 'var(--font-body)', fontWeight: 500 }}>
          {APP_NAME}
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--text-primary)', marginBottom: 12 }}>
          Configure Intelligence
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
          Select your data sources, time horizon and context. The AI agent composes your intelligence.
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 1200, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'stretch' }}>

        {/* ── LEFT CARD: sections 1 + 2 ─────────────────────────────── */}
        <div style={{ background: 'linear-gradient(160deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '28px 28px', backdropFilter: 'blur(8px)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />

          {/* Section 1: Data */}
          <ProdSectionCard n="1" title="Data">
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
              ? <select value={selDataset} onChange={function(e){setSelDataset(e.target.value)}} style={{ ...selectStyle, marginBottom: 14 }}>{datasets.map(function(d){return <option key={d.id} value={d.id}>{d.name}</option>})}</select>
              : <div style={{ marginBottom: 14 }}><input type="text" placeholder="Dataset name (optional)" value={dataName} onChange={function(e){setDataName(e.target.value)}} style={inputStyle} /><div onClick={function(){dataRef.current&&dataRef.current.click()}} style={{ border: '1px dashed '+(dataFile?'var(--accent-border)':'var(--border)'), borderRadius: 'var(--radius-md)', padding: '10px 14px', cursor: 'pointer', background: dataFile?'var(--accent-dim)':'transparent' }}><input ref={dataRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={function(e){setDataFile(e.target.files[0]||null)}} /><p style={{ fontSize: 11, color: dataFile?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{dataFile?dataFile.name:'Select dataset file (.xlsx or .csv)'}</p></div></div>
            }

            {/* Metadata */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.09em', fontFamily: 'var(--font-body)' }}>Metadata</p>
              <AutoGenButton state={autoGenState} result={autoGenResult} onGenerate={handleAutoGenMeta} disabled={dataMode === 'existing' ? !selDataset : !dataFile} compact={true} />
            </div>
            {!loadingLists && metaSets.length > 0 && (
              <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
                {['existing','upload'].map(function(m) {
                  return <button key={m} onClick={function(){setMetaMode(m)}} style={{ padding: '3px 9px', fontSize: 10, cursor: 'pointer', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (metaMode===m?'var(--accent-border)':'var(--border)'), background: metaMode===m?'var(--accent-dim)':'transparent', color: metaMode===m?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{m==='existing'?'Existing':'Upload new'}</button>
                })}
              </div>
            )}
            {metaMode === 'existing'
              ? <select value={selMeta} onChange={function(e){setSelMeta(e.target.value)}} style={selectStyle}>{metaSets.map(function(m){return <option key={m.id} value={m.id}>{m.name}</option>})}</select>
              : <div><input type="text" placeholder="Metadata name (optional)" value={metaName} onChange={function(e){setMetaName(e.target.value)}} style={inputStyle} /><div onClick={function(){metaRef.current&&metaRef.current.click()}} style={{ border: '1px dashed '+(metaFile?'var(--accent-border)':'var(--border)'), borderRadius: 'var(--radius-md)', padding: '10px 14px', cursor: 'pointer', background: metaFile?'var(--accent-dim)':'transparent' }}><input ref={metaRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={function(e){setMetaFile(e.target.files[0]||null)}} /><p style={{ fontSize: 11, color: metaFile?'var(--text-accent)':'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{metaFile?metaFile.name:'Select metadata file (.xlsx or .csv)'}</p></div></div>
            }
            {autoGenState === 'done' && autoGenResult && (
              <AutoGenResult result={autoGenResult} onGenerate={handleAutoGenMeta} />
            )}
          </ProdSectionCard>

          {/* Section 2: Time Period */}
          <ProdSectionCard n="2" title="Time period">
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
              <div>
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
          </ProdSectionCard>
        </div>

        {/* ── RIGHT CARD: sections 3 + 4 + build ───────────────────── */}
        <div style={{ background: 'linear-gradient(160deg, var(--surface) 0%, var(--surface-2) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '28px 28px', backdropFilter: 'blur(8px)', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', opacity: 0.25 }} />

          {/* Section 3: Context */}
          <ProdSectionCard n="3" title={<>Your context <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginLeft: 6, verticalAlign: 'middle' }}>optional</span></>}>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 10 }}>Describe your role or focus — the LLM will extract <span style={{ color: 'var(--text-accent)' }}>dimension filters</span> and <span style={{ color: 'var(--text-accent)' }}>KPI focus</span>. You'll confirm before building.</p>
            <textarea
              ref={contextRef}
              defaultValue=""
              placeholder={'e.g. "I am head of West Region and my focus is Revenue"'}
              style={{ width: '100%', minHeight: 72, padding: '9px 11px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 12, fontFamily: 'var(--font-body)', resize: 'vertical', outline: 'none', lineHeight: 1.5 }}
              onFocus={function(e){e.target.style.borderColor='var(--accent-border)'}}
              onBlur={function(e){e.target.style.borderColor='var(--border)'}}
            />
            {/* Confirmation block */}
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
          </ProdSectionCard>

          {/* Section 4: Dashboard panels */}
          <ProdSectionCard n="4" title="Dashboard panels">
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 10 }}>Choose which panels appear on your dashboard</p>
            {[
              { key: 'decisions',     label: 'Generate Decisions',  desc: 'AI-ranked actions and health scores' },
              { key: 'summary',       label: 'Generate Summary',    desc: 'Executive narrative report' },
              { key: 'forecast',      label: 'Trend Explorer',      desc: 'Interactive KPI trends and forecasts' },
              { key: 'queryInspector',label: 'Query Inspector',     desc: 'View and copy all generated SQL' },
              { key: 'coveragePanel', label: 'Coverage Report',     desc: 'Explain why KPIs or charts were skipped' },
            ].map(function(item) {
              var on = prefs[item.key] !== false
              return (
                <div key={item.key} onClick={function(){setPrefs(function(p){var n=Object.assign({},p);n[item.key]=!on;return n})}}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 9px', borderRadius: 'var(--radius-md)', border: '1px solid '+(on?'var(--accent-border)':'var(--border)'), background: on?'var(--accent-dim)':'transparent', cursor: 'pointer', transition: 'all var(--transition)', marginBottom: 6 }}
                >
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
          </ProdSectionCard>

          {/* Error */}
          {error && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: 12, border: '1px solid rgba(224,85,85,0.2)' }}>{error}</p>
          )}

          {/* Spacer pushes button to bottom */}
          <div style={{ flex: 1 }} />

          {/* Generate button */}
          <button
            onClick={handleBuild}
            disabled={working || extracting}
            style={{
              width: '100%', padding: '14px 24px',
              background: working||extracting ? 'transparent' : 'linear-gradient(135deg, rgba(0,200,240,0.15) 0%, rgba(43,127,227,0.1) 100%)',
              border: '1px solid ' + (working||extracting ? 'var(--border)' : 'var(--accent-border)'),
              borderRadius: 'var(--radius-md)', fontSize: 13, fontWeight: 600,
              letterSpacing: '0.1em', textTransform: 'uppercase',
              color: working||extracting ? 'var(--text-tertiary)' : 'var(--text-accent)',
              cursor: working||extracting ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              fontFamily: 'var(--font-display)', transition: 'all var(--transition)',
              boxShadow: working||extracting ? 'none' : '0 0 20px rgba(0,200,240,0.06)',
            }}
          >
            {extracting ? <><span className="spinner" /><span style={{ fontSize: 12 }}>Analysing context…</span></>
            : working   ? <><span className="spinner" /><span style={{ fontSize: 12 }}>{progress || 'Processing…'}</span></>
            : showConfirm ? 'Build with this context'
            : 'Generate Intelligence'}
          </button>

          <VapiHelpWidget />
        </div>

      </div>
    </div>
  )
}


// ── AutoGenButton ─────────────────────────────────────────────────────────────
function AutoGenButton({ state, result, onGenerate, disabled, compact }) {
  var isLoading = state === 'loading'
  var isDone    = state === 'done'
  return (
    <button
      onClick={onGenerate}
      disabled={disabled || isLoading}
      title={disabled ? 'Select a dataset first' : isDone ? 'Re-generate metadata' : 'Auto-generate metadata from your dataset'}
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? 0 : 6,
        padding: compact ? '3px 8px' : '4px 10px',
        borderRadius: 'var(--radius-sm)',
        fontSize: 10, fontWeight: 500, cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-body)', letterSpacing: '0.04em',
        border: '1px solid ' + (disabled ? 'var(--border)' : isDone ? 'rgba(16,196,138,0.4)' : 'var(--accent-border)'),
        background: disabled ? 'transparent' : isDone ? 'rgba(16,196,138,0.08)' : 'var(--accent-dim)',
        color: disabled ? 'var(--text-tertiary)' : isDone ? '#10C48A' : 'var(--text-accent)',
        transition: 'all var(--transition)', whiteSpace: 'nowrap',
      }}
    >
      {isLoading
        ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, flexShrink: 0 }} />
        : <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0 }}>
            <path d="M5 1v2M5 7v2M1 5h2M7 5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <circle cx="5" cy="5" r="2" stroke="currentColor" strokeWidth="1.3"/>
          </svg>
      }
      {!compact && (
        <span style={{ marginLeft: 4 }}>
          {isLoading ? 'Generating...' : isDone ? 'Re-generate' : 'Auto-generate'}
        </span>
      )}
    </button>
  )
}

// ── AutoGenResult ──────────────────────────────────────────────────────────────
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
                <strong style={{ color: 'var(--amber-text)' }}>{result.flaggedCount} {result.flaggedCount === 1 ? 'field needs' : 'fields need'} review</strong> — check the <em>Review Summary</em> tab in Excel, fix the flagged rows, delete the <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>confidence</code> and <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>review_notes</code> columns, then re-upload.
              </p>
            : <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                All fields classified with high confidence. Delete the <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>confidence</code> and <code style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>review_notes</code> columns before re-uploading.
              </p>
          }
        </div>
      </div>
    </div>
  )
}

// ── VapiHelpWidget ────────────────────────────────────────────────────────────
// Browser-based voice call using the VAPI Web SDK.
// No phone number needed — user clicks, mic activates, browser handles the call.
//
// Required environment variables (add to Vercel):
//   NEXT_PUBLIC_VAPI_KEY          — your VAPI public key
//   NEXT_PUBLIC_VAPI_ASSISTANT_ID — your VAPI assistant ID
//
// Install the SDK once in your project:
//   npm install @vapi-ai/web

var VAPI_PUBLIC_KEY    = process.env.NEXT_PUBLIC_VAPI_KEY
var VAPI_ASSISTANT_ID  = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID

function VapiHelpWidget() {
  var [expanded,    setExpanded]    = useState(false)
  var [callState,   setCallState]   = useState('idle')    // idle | connecting | active | ended
  var [isMuted,     setIsMuted]     = useState(false)
  var [transcript,  setTranscript]  = useState([])        // { role, text }
  var [vapiInst,    setVapiInst]    = useState(null)
  var [volume,      setVolume]      = useState(0)
  var [errorMsg,    setErrorMsg]    = useState('')

  // Lazily load the VAPI SDK and create the instance once
  async function getVapi() {
    if (vapiInst) return vapiInst
    try {
      var mod  = await import('@vapi-ai/web')
      var Vapi = mod.default || mod.Vapi
      var inst = new Vapi(VAPI_PUBLIC_KEY)

      inst.on('call-start',  function()   { setCallState('active'); setErrorMsg('') })
      inst.on('call-end',    function()   { setCallState('ended');  setVolume(0) })
      inst.on('volume-level',function(v)  { setVolume(v) })
      inst.on('error',       function(e)  {
        console.error('VAPI error:', e)
        setErrorMsg('Connection error — please try again.')
        setCallState('idle')
      })
      inst.on('message', function(msg) {
        // Collect transcript lines from both sides
        if (msg && msg.type === 'transcript' && msg.transcriptType === 'final') {
          setTranscript(function(prev) {
            return prev.concat({ role: msg.role, text: msg.transcript }).slice(-6) // keep last 6 lines
          })
        }
      })

      setVapiInst(inst)
      return inst
    } catch (err) {
      setErrorMsg('Could not load voice SDK. Check your network and try again.')
      setCallState('idle')
      return null
    }
  }

  async function handleStartCall() {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) {
      setErrorMsg('VAPI keys not configured. Add NEXT_PUBLIC_VAPI_KEY and NEXT_PUBLIC_VAPI_ASSISTANT_ID to Vercel.')
      return
    }
    setCallState('connecting')
    setTranscript([])
    setErrorMsg('')
    var inst = await getVapi()
    if (!inst) return
    try {
      await inst.start(VAPI_ASSISTANT_ID)
    } catch (err) {
      setErrorMsg('Could not start call: ' + (err.message || 'Unknown error'))
      setCallState('idle')
    }
  }

  function handleEndCall() {
    if (vapiInst) vapiInst.stop()
    setCallState('idle')
    setVolume(0)
    setIsMuted(false)
    setTranscript([])
  }

  function handleToggleMute() {
    if (!vapiInst) return
    var next = !isMuted
    vapiInst.setMuted(next)
    setIsMuted(next)
  }

  function handleDismiss() {
    handleEndCall()
    setExpanded(false)
    setErrorMsg('')
  }

  // Volume bar — 5 segments lighting up based on volume 0-1
  function VolumeBar() {
    var segs = 5
    var lit  = Math.round(volume * segs)
    return (
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
        {Array.from({ length: segs }).map(function(_, i) {
          var h       = 6 + i * 3
          var active  = i < lit
          return (
            <div key={i} style={{
              width: 3, height: h,
              borderRadius: 2,
              background: active ? 'var(--accent)' : 'var(--surface-3)',
              transition: 'background 80ms',
            }} />
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 14 }}>
      {!expanded ? (
        // ── Collapsed: subtle divider prompt ──────────────────────────
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <button
            onClick={function() { setExpanded(true) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
              <rect x="4" y="0.5" width="4" height="6.5" rx="2"
                fill="none" stroke="var(--text-tertiary)" strokeWidth="1.2"/>
              <path d="M2 6a4 4 0 0 0 8 0" stroke="var(--text-tertiary)"
                strokeWidth="1.2" strokeLinecap="round" fill="none"/>
              <line x1="6" y1="10" x2="6" y2="11.5" stroke="var(--text-tertiary)"
                strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
              Not sure where to start?
            </span>
          </button>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

      ) : (
        // ── Expanded: voice call card ──────────────────────────────────
        <div className="fade-in" style={{
          background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
          border: '1px solid ' + (callState === 'active' ? 'var(--accent-border)' : 'var(--border)'),
          borderRadius: 'var(--radius-lg)',
          padding: '18px 20px',
          position: 'relative', overflow: 'hidden',
          transition: 'border-color var(--transition)',
          boxShadow: callState === 'active' ? '0 0 24px rgba(0,200,240,0.06)' : 'none',
        }}>
          {/* Top accent line */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 1,
            background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
            opacity: callState === 'active' ? 0.5 : 0.2,
            transition: 'opacity var(--transition)',
          }} />

          {/* Corner brackets */}
          <div style={{ position: 'absolute', top: 8, left: 8, width: 10, height: 10,
            borderTop: '1px solid var(--accent-border)', borderLeft: '1px solid var(--accent-border)', opacity: 0.5 }} />
          <div style={{ position: 'absolute', top: 8, right: 8, width: 10, height: 10,
            borderTop: '1px solid var(--accent-border)', borderRight: '1px solid var(--accent-border)', opacity: 0.5 }} />

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Mic orb — pulses when active */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: callState === 'active' ? 'rgba(0,200,240,0.15)' : 'var(--accent-dim)',
                border: '1px solid var(--accent-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
                boxShadow: callState === 'active' ? '0 0 16px rgba(0,200,240,0.2)' : '0 0 8px rgba(0,200,240,0.06)',
                transition: 'all var(--transition)',
              }}>
                {callState === 'connecting' ? (
                  <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="4.5" y="0.5" width="5" height="8" rx="2.5"
                      fill={callState === 'active' ? 'rgba(0,200,240,0.25)' : 'rgba(0,200,240,0.15)'}
                      stroke="var(--accent)" strokeWidth="1.2"/>
                    <path d="M2 7a5 5 0 0 0 10 0" stroke="var(--accent)"
                      strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                    <line x1="7" y1="12" x2="7" y2="13.5" stroke="var(--accent)"
                      strokeWidth="1.2" strokeLinecap="round"/>
                    <line x1="4.5" y1="13.5" x2="9.5" y2="13.5" stroke="var(--accent)"
                      strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                )}
              </div>

              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
                  fontFamily: 'var(--font-display)' }}>
                  {callState === 'idle'       && 'Need help getting started?'}
                  {callState === 'connecting' && 'Connecting...'}
                  {callState === 'active'     && 'Call in progress'}
                  {callState === 'ended'      && 'Call ended'}
                </p>
                <p style={{ fontSize: 10, color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-body)', marginTop: 1 }}>
                  {callState === 'idle'       && 'Talk to our voice assistant · Available 24/7'}
                  {callState === 'connecting' && 'Please wait...'}
                  {callState === 'active'     && 'Speak clearly · Browser mic is active'}
                  {callState === 'ended'      && 'Thanks for calling'}
                </p>
              </div>
            </div>

            {/* Volume bar (active only) + dismiss */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {callState === 'active' && <VolumeBar />}
              <button
                onClick={handleDismiss}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', fontSize: 16, padding: '2px 4px',
                  transition: 'color var(--transition)' }}
                onMouseEnter={function(e) { e.currentTarget.style.color = 'var(--text-secondary)' }}
                onMouseLeave={function(e) { e.currentTarget.style.color = 'var(--text-tertiary)' }}
              >×</button>
            </div>
          </div>

          {/* Topic chips — idle only */}
          {callState === 'idle' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {['How to format metadata','Choosing the right time period','Understanding KPI types','Reading the dashboard'].map(function(t) {
                return (
                  <span key={t} style={{ fontSize: 10, padding: '3px 9px', borderRadius: 99,
                    background: 'var(--surface-3)', border: '1px solid var(--border)',
                    color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
                    {t}
                  </span>
                )
              })}
            </div>
          )}

          {/* Live transcript (active only) */}
          {callState === 'active' && transcript.length > 0 && (
            <div style={{
              marginBottom: 14, padding: '10px 12px',
              background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              maxHeight: 120, overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}>
              {transcript.map(function(line, i) {
                var isUser = line.role === 'user'
                return (
                  <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.08em', flexShrink: 0, marginTop: 1,
                      color: isUser ? 'var(--text-accent)' : 'var(--text-tertiary)',
                      fontFamily: 'var(--font-mono)', width: 28,
                    }}>
                      {isUser ? 'You' : 'AI'}
                    </span>
                    <span style={{ fontSize: 11, color: isUser ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                      {line.text}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Error */}
          {errorMsg && (
            <p style={{ fontSize: 11, color: 'var(--red-text)', background: 'var(--red-light)',
              padding: '7px 10px', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(224,85,85,0.2)', marginBottom: 12,
              fontFamily: 'var(--font-body)' }}>
              {errorMsg}
            </p>
          )}

          {/* Action buttons */}
          {(callState === 'idle' || callState === 'ended') && (
            <button
              onClick={handleStartCall}
              style={{
                width: '100%', padding: '11px 16px',
                background: 'linear-gradient(135deg, rgba(0,200,240,0.14) 0%, rgba(43,127,227,0.1) 100%)',
                border: '1px solid var(--accent-border)',
                borderRadius: 'var(--radius-md)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                cursor: 'pointer', transition: 'all var(--transition)',
              }}
              onMouseEnter={function(e) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,200,240,0.22) 0%, rgba(43,127,227,0.16) 100%)'
                e.currentTarget.style.boxShadow  = '0 0 16px rgba(0,200,240,0.1)'
              }}
              onMouseLeave={function(e) {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,200,240,0.14) 0%, rgba(43,127,227,0.1) 100%)'
                e.currentTarget.style.boxShadow  = 'none'
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%',
                background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)',
                flexShrink: 0, animation: 'glowPulse 2s ease-in-out infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-accent)',
                fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
                {callState === 'ended' ? 'Call Again' : 'Start Voice Call'}
              </span>
            </button>
          )}

          {callState === 'active' && (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Mute toggle */}
              <button
                onClick={handleToggleMute}
                style={{
                  flex: 1, padding: '9px 12px',
                  background: isMuted ? 'rgba(224,85,85,0.1)' : 'var(--surface-3)',
                  border: '1px solid ' + (isMuted ? 'rgba(224,85,85,0.3)' : 'var(--border)'),
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all var(--transition)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  {isMuted ? (
                    // Mic with X
                    <>
                      <rect x="4" y="0.5" width="4" height="6.5" rx="2"
                        fill="none" stroke="var(--red-text)" strokeWidth="1.2"/>
                      <line x1="2" y1="2" x2="10" y2="10" stroke="var(--red-text)" strokeWidth="1.2" strokeLinecap="round"/>
                    </>
                  ) : (
                    // Mic normal
                    <>
                      <rect x="4" y="0.5" width="4" height="6.5" rx="2"
                        fill="none" stroke="var(--text-secondary)" strokeWidth="1.2"/>
                      <path d="M2 6a4 4 0 0 0 8 0" stroke="var(--text-secondary)"
                        strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                    </>
                  )}
                </svg>
                <span style={{ fontSize: 11, color: isMuted ? 'var(--red-text)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-body)' }}>
                  {isMuted ? 'Unmute' : 'Mute'}
                </span>
              </button>

              {/* End call */}
              <button
                onClick={handleEndCall}
                style={{
                  flex: 1, padding: '9px 12px',
                  background: 'rgba(224,85,85,0.1)',
                  border: '1px solid rgba(224,85,85,0.3)',
                  borderRadius: 'var(--radius-md)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all var(--transition)',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 8.5h2.5l1-2-1.3-.8a7 7 0 0 1 3.1-3.1L7 3.5l2-1V5a8 8 0 0 0 2-3.4A10 10 0 0 0 1 8.5Z"
                    stroke="var(--red-text)" strokeWidth="1.1" strokeLinejoin="round" fill="none"/>
                  <line x1="2" y1="2" x2="10" y2="10" stroke="var(--red-text)" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize: 11, color: 'var(--red-text)', fontFamily: 'var(--font-body)' }}>
                  End Call
                </span>
              </button>
            </div>
          )}

          {callState === 'connecting' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '10px', opacity: 0.6 }}>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
                Requesting microphone...
              </span>
            </div>
          )}

          <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center',
            marginTop: 10, fontFamily: 'var(--font-body)' }}>
            Browser mic required · Powered by VAPI
          </p>
        </div>
      )}
    </div>
  )
}

// ── Default export — routes to correct mode based on app-config ───────────────
export default function SetupScreen({ onReady }) {
  if (SETUP_MODE === 'dev') return <SetupScreenDev onReady={onReady} />
  return <SetupScreenProd onReady={onReady} />
}
