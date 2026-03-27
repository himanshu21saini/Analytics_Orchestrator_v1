// ── MANDATORY FILTERS CHANGES FOR SetupScreen.jsx ────────────────────────────
//
// This file documents the exact additions needed to SetupScreen.jsx.
// Since SetupScreen is very large, apply these changes to the existing file.
//
// ─────────────────────────────────────────────────────────────────────────────

// CHANGE 1: Add state for mandatory filters (add alongside existing state vars)
// In BOTH SetupScreenDev and SetupScreenProd, after: var [selPairIdx, setSelPairIdx] = useState(0)
// Add:
var [mandatoryFilterFields, setMandatoryFilterFields] = useState([])  // fields that require a filter
var [mandatoryFilterValues, setMandatoryFilterValues] = useState({})  // { field_name: selected_value }

// ─────────────────────────────────────────────────────────────────────────────

// CHANGE 2: Add useEffect to detect mandatory filter fields from metadata
// In BOTH SetupScreenDev and SetupScreenProd, add this useEffect alongside
// the existing metadata-loading useEffect (the one that fetches year_month fields):

useEffect(function() {
  var metaId = metaMode === 'existing' ? selMeta : null
  if (!metaId) { setMandatoryFilterFields([]); setMandatoryFilterValues({}); return }
  fetch('/api/metadata-fields?metadataSetId=' + metaId)
    .then(function(r) { return r.json() })
    .then(function(j) {
      var fields = (j.fields || []).filter(function(f) {
        return f.mandatory_filter_value && String(f.mandatory_filter_value).trim()
      })
      setMandatoryFilterFields(fields)
      // Set defaults from mandatory_filter_value
      var defaults = {}
      fields.forEach(function(f) {
        defaults[f.field_name] = String(f.mandatory_filter_value).trim()
      })
      setMandatoryFilterValues(defaults)
    })
    .catch(function() { setMandatoryFilterFields([]); setMandatoryFilterValues({}) })
}, [selMeta, metaMode])

// ─────────────────────────────────────────────────────────────────────────────

// CHANGE 3: Build mandatoryFilters array in doBuild() before the generate-queries call
// In BOTH SetupScreenDev and SetupScreenProd doBuild(), add before the timePeriod line:

var mandatoryFilters = mandatoryFilterFields.map(function(f) {
  return {
    field:        f.field_name,
    value:        mandatoryFilterValues[f.field_name] || String(f.mandatory_filter_value).trim(),
    display_name: f.display_name || f.field_name,
  }
})

// Then add mandatoryFilters to the generate-queries call body:
// body: JSON.stringify({ datasetId: finalDatasetId, metadataSetId: finalMetaId, timePeriod, userContext: userContext || null, mandatoryFilters })

// And add to the onReady call:
// onReady({ ..., mandatoryFilters })

// ─────────────────────────────────────────────────────────────────────────────

// CHANGE 4: Add the UI section in SetupScreenDev
// In SetupScreenDev, after the Time Period SectionCard and before the User Context SectionCard,
// add this section (only rendered when mandatoryFilterFields.length > 0):

{mandatoryFilterFields.length > 0 && (
  <SectionCard n="3b" title="Data Filters">
    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 14, lineHeight: 1.5 }}>
      These filters are required by your dataset to avoid double-counting. Defaults are set from your metadata — adjust if needed.
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {mandatoryFilterFields.map(function(f) {
        // Parse sample_values into options array
        var options = f.sample_values
          ? String(f.sample_values).split(',').map(function(v) { return v.trim() }).filter(Boolean)
          : []
        // Always include the mandatory_filter_value as an option if not already present
        var defaultVal = String(f.mandatory_filter_value).trim()
        if (defaultVal && options.indexOf(defaultVal) === -1) options.unshift(defaultVal)
        var selected = mandatoryFilterValues[f.field_name] || defaultVal

        return (
          <div key={f.field_name}>
            <p style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, fontFamily: 'var(--font-body)' }}>
              {f.display_name || f.field_name}
            </p>
            {options.length > 0 ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {options.map(function(opt) {
                  var isActive = selected === opt
                  return (
                    <button
                      key={opt}
                      onClick={function() {
                        setMandatoryFilterValues(function(prev) {
                          var next = Object.assign({}, prev)
                          next[f.field_name] = opt
                          return next
                        })
                      }}
                      style={{
                        padding: '6px 16px', borderRadius: 'var(--radius-sm)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                        fontFamily: 'var(--font-body)', letterSpacing: '0.06em',
                        border: '1px solid ' + (isActive ? 'rgba(240,160,48,0.5)' : 'var(--border)'),
                        background: isActive ? 'rgba(240,160,48,0.12)' : 'transparent',
                        color: isActive ? '#F0A030' : 'var(--text-secondary)',
                        transition: 'all var(--transition)',
                      }}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            ) : (
              // Fallback: free text input if no sample_values
              <input
                type="text"
                value={selected}
                onChange={function(e) {
                  var val = e.target.value
                  setMandatoryFilterValues(function(prev) {
                    var next = Object.assign({}, prev)
                    next[f.field_name] = val
                    return next
                  })
                }}
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

// ─────────────────────────────────────────────────────────────────────────────

// CHANGE 5: Same UI section for SetupScreenProd
// In SetupScreenProd right card (sections 3+4), after the Time Period ProdSectionCard,
// add the same section using ProdSectionCard instead of SectionCard:

{mandatoryFilterFields.length > 0 && (
  <ProdSectionCard n="2b" title="Data Filters">
    <p style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', marginBottom: 10 }}>
      Required filters to avoid double-counting. Defaults from metadata — adjust if needed.
    </p>
    {mandatoryFilterFields.map(function(f) {
      var options = f.sample_values
        ? String(f.sample_values).split(',').map(function(v) { return v.trim() }).filter(Boolean)
        : []
      var defaultVal = String(f.mandatory_filter_value).trim()
      if (defaultVal && options.indexOf(defaultVal) === -1) options.unshift(defaultVal)
      var selected = mandatoryFilterValues[f.field_name] || defaultVal

      return (
        <div key={f.field_name} style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, fontFamily: 'var(--font-body)' }}>
            {f.display_name || f.field_name}
          </p>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {options.map(function(opt) {
              var isActive = selected === opt
              return (
                <ProdChip
                  key={opt}
                  active={isActive}
                  onClick={function() {
                    setMandatoryFilterValues(function(prev) {
                      var next = Object.assign({}, prev); next[f.field_name] = opt; return next
                    })
                  }}
                >
                  {opt}
                </ProdChip>
              )
            })}
          </div>
          {selected !== defaultVal && (
            <p style={{ fontSize: 9, color: 'var(--text-accent)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>Changed from default: {defaultVal}</p>
          )}
        </div>
      )
    })}
  </ProdSectionCard>
)}
