'use client'

import { useState, useEffect, useRef } from 'react'

var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
var THIS_YEAR   = new Date().getFullYear()
var YEARS       = [THIS_YEAR - 3, THIS_YEAR - 2, THIS_YEAR - 1, THIS_YEAR]

var COMPARISON_OPTIONS = {
  YTD: [{ value: 'YoY', label: 'YoY' }],
  QTD: [{ value: 'YoY', label: 'YoY' }, { value: 'QoQ', label: 'QoQ' }],
  MTD: [{ value: 'YoY', label: 'YoY' }, { value: 'MoM', label: 'MoM' }],
}

export default function SetupScreen({ onReady }) {
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
  var [selYear,      setSelYear]      = useState(THIS_YEAR - 1)
  var [selMonth,     setSelMonth]     = useState(12)
  var [compType,     setCompType]     = useState('YoY')
  var [working,      setWorking]      = useState(false)
  var [progress,     setProgress]     = useState('')
  var [error,        setError]        = useState('')
  var dataRef = useRef(); var metaRef = useRef()

  useEffect(function() { loadLists() }, [])
  useEffect(function() {
    var allowed = COMPARISON_OPTIONS[viewType] || []
    var valid = allowed.some(function(o) { return o.value === compType })
    if (!valid && allowed.length > 0) setCompType(allowed[0].value)
  }, [viewType])

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

  async function handleBuild() {
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
        var mf = new FormData(); mf.append('file', metaFile); mf.append('name', metaName || metaFile.name)
        var mr = await fetch('/api/save-metadata', { method: 'POST', body: mf }); var mj = await mr.json()
        if (!mr.ok) throw new Error(mj.error || 'Metadata save failed.')
        finalMetaId = String(mj.metadataSet.id); await loadLists()
      }
      setProgress('Composing intelligence queries...')
      var timePeriod = { viewType, year: selYear, month: selMonth, comparisonType: compType }
      var gqRes = await fetch('/api/generate-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ datasetId: finalDatasetId, metadataSetId: finalMetaId, timePeriod }) })
      var gqJson = await gqRes.json()
      if (!gqRes.ok) throw new Error(gqJson.error || 'Failed to generate queries.')
      setProgress('Executing ' + (gqJson.queries ? gqJson.queries.length : '') + ' queries...')
      var rqRes = await fetch('/api/run-queries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: gqJson.queries }) })
      var rqJson = await rqRes.json()
      if (!rqRes.ok) throw new Error(rqJson.error || 'Failed to run queries.')
      onReady({ datasetId: finalDatasetId, metadataSetId: finalMetaId, queries: gqJson.queries, queryResults: rqJson.results, metadata: gqJson.metadata, timePeriod, periodInfo: gqJson.periodInfo, initialUsage: gqJson.usage || null })
    } catch (err) { setError(err.message); setWorking(false); setProgress('') }
  }

  var canBuild = !working && (dataMode === 'existing' ? !!selDataset : !!dataFile) && (metaMode === 'existing' ? !!selMeta : !!metaFile)
  var allowedComp = COMPARISON_OPTIONS[viewType] || []
  var previewLabel = viewType + ' · ' + MONTH_NAMES[selMonth-1] + ' ' + selYear + ' · vs ' + compType

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
          Client &amp; Advisor Intelligence
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.15, color: 'var(--text-primary)', marginBottom: 14 }}>
          Configure your Dashboard
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-body)' }}>
          Select your data sources and time horizon. The AI agent composes your intelligence report.
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
            <ModeToggle mode={metaMode} setMode={setMetaMode} hasExisting={metaSets.length > 0} />
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
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-body)' }}>Year</p>
              <select value={selYear} onChange={function(e) { setSelYear(parseInt(e.target.value)) }} style={selectStyle}>
                {YEARS.map(function(y) { return <option key={y} value={y}>{y}</option> })}
              </select>
            </div>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10, fontFamily: 'var(--font-body)' }}>Month</p>
              <select value={selMonth} onChange={function(e) { setSelMonth(parseInt(e.target.value)) }} style={selectStyle}>
                {MONTH_NAMES.map(function(name, i) { return <option key={i+1} value={i+1}>{name}</option> })}
              </select>
            </div>
          </div>

          <div style={{ padding: '10px 14px', background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 6px var(--accent)', flexShrink: 0 }} />
            <p style={{ fontSize: 12, color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
              {previewLabel}
            </p>
          </div>
        </SectionCard>

        {/* Build */}
        <div className="fade-up d4">
          <button
            onClick={handleBuild}
            disabled={!canBuild}
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
              fontFamily: 'var(--font-display)',
              transition: 'all var(--transition)',
              boxShadow: canBuild ? '0 0 20px rgba(0,200,240,0.06)' : 'none',
            }}
          >
            {working
              ? <><span className="spinner" /><span style={{ fontSize: 12 }}>{progress || 'Processing...'}</span></>
              : 'Generate Dashboard'
            }
          </button>

          {error && (
            <p style={{ marginTop: 10, fontSize: 12, color: 'var(--red-text)', background: 'var(--red-light)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(224,85,85,0.2)' }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
