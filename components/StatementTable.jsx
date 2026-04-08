'use client'

import { useState, useEffect, useMemo, useRef } from 'react'

// Number formatting that preserves sign as stored in data
function fmt(v) {
  if (v === null || v === undefined || isNaN(parseFloat(v))) return '—'
  var n = parseFloat(v)
  var abs = Math.abs(n)
  var sign = n < 0 ? '-' : ''
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

function fmtDelta(cur, cmp, favDir) {
  if (cur === null || cmp === null || cur === undefined || cmp === undefined || isNaN(cur) || isNaN(cmp) || cmp === 0) {
    return { text: '—', color: 'var(--text-tertiary)' }
  }
  var pct = ((cur - cmp) / Math.abs(cmp)) * 100
  var isPositive = pct >= 0
  var isFavorable = favDir === 'd' ? !isPositive : isPositive
  var color = isFavorable ? '#10C48A' : '#E05555'
  return {
    text: (isPositive ? '+' : '') + pct.toFixed(1) + '%',
    color: color,
  }
}

export default function StatementTable({ session }) {
  var [values,         setValues]         = useState({})   // keyed by node_path
  var [loadingPaths,   setLoadingPaths]   = useState({})   // which paths are currently fetching
  var [expandedPaths,  setExpandedPaths]  = useState({})   // which paths are currently expanded
  var [initialLoading, setInitialLoading] = useState(true)
  var [error,          setError]          = useState('')

  // ── Stage 3: dimension filter state ──────────────────────────────────
  var [dimensions,      setDimensions]      = useState([])     // [{field_name, display_name?}, ...]
  var [dimValues,       setDimValues]       = useState({})     // { fieldName: ['v1','v2',...] }
  var [loadingDimVals,  setLoadingDimVals]  = useState({})     // { fieldName: true }
  var [selectedFilters, setSelectedFilters] = useState({})     // { fieldName: ['v1','v2'] }
  var [openDropdown,    setOpenDropdown]    = useState(null)   // currently open dropdown field name

  var hierarchyNodes   = session.hierarchyNodes   || []
  var datasetId        = session.datasetId
  var metadataSetId    = session.metadataSetId
  var timePeriod       = session.timePeriod
  var mandatoryFilters = session.mandatoryFilters || []
  var periodInfo       = session.periodInfo || {}

  // ── Build parent → children index once ────────────────────────────────
  var childrenByParent = useMemo(function() {
    var map = {}
    hierarchyNodes.forEach(function(n) {
      var parent = n.parent_path || '__ROOT__'
      if (!map[parent]) map[parent] = []
      map[parent].push(n)
    })
    Object.keys(map).forEach(function(k) {
      map[k].sort(function(a, b) { return (a.display_name || a.node_name).localeCompare(b.display_name || b.node_name) })
    })
    return map
  }, [hierarchyNodes])

  function hasChildren(nodePath) {
    return !!(childrenByParent[nodePath] && childrenByParent[nodePath].length)
  }

  // ── Convert selectedFilters state → backend payload shape ────────────
  function buildDimensionFilterPayload(sel) {
    var out = []
    Object.keys(sel).forEach(function(field) {
      var vals = sel[field]
      if (vals && vals.length) out.push({ field: field, values: vals })
    })
    return out
  }

  // ── Fetch values for a list of paths, using a given filter snapshot ──
  async function fetchValues(pathsToFetch, filterSnapshot) {
    if (!pathsToFetch.length) return
    setLoadingPaths(function(prev) {
      var next = Object.assign({}, prev)
      pathsToFetch.forEach(function(p) { next[p] = true })
      return next
    })
    try {
      var res = await fetch('/api/statement-values', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId:        datasetId,
          metadataSetId:    metadataSetId,
          nodePaths:        pathsToFetch,
          timePeriod:       timePeriod,
          mandatoryFilters: mandatoryFilters,
          dimensionFilters: buildDimensionFilterPayload(filterSnapshot || selectedFilters),
        }),
      })
      var json = await res.json()
      if (json.error) throw new Error(json.error)
      setValues(function(prev) {
        var next = Object.assign({}, prev)
        Object.keys(json.values || {}).forEach(function(k) { next[k] = json.values[k] })
        return next
      })
    } catch(err) {
      setError(err.message)
    }
    setLoadingPaths(function(prev) {
      var next = Object.assign({}, prev)
      pathsToFetch.forEach(function(p) { delete next[p] })
      return next
    })
  }

  // ── Load dimensions list once ─────────────────────────────────────────
  useEffect(function() {
    if (!metadataSetId) return
    fetch('/api/metadata-fields?metadataSetId=' + metadataSetId)
      .then(function(r) { return r.json() })
      .then(function(json) {
        var fields = json.fields || []
        var dims = fields.filter(function(f) {
  return f.type === 'dimension' &&
    (f.mandatory_filter_value === null || f.mandatory_filter_value === undefined || f.mandatory_filter_value === '')
})
        setDimensions(dims)
      })
      .catch(function(err) { console.error('metadata-fields fetch failed:', err.message) })
  }, [metadataSetId])

  // ── Initial L1 load ───────────────────────────────────────────────────
  useEffect(function() {
    var l1Nodes = hierarchyNodes.filter(function(n) { return n.level === 1 })
    if (!l1Nodes.length || !datasetId || !metadataSetId) {
      setInitialLoading(false)
      return
    }
    setInitialLoading(true); setError('')
    fetchValues(l1Nodes.map(function(n) { return n.node_path }), {})
      .finally(function() { setInitialLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, metadataSetId])

  // ── Lazy-load distinct values for a dimension when dropdown opens ────
  async function loadDimValues(field) {
    if (dimValues[field] || loadingDimVals[field]) return
    setLoadingDimVals(function(prev) { var n = Object.assign({}, prev); n[field] = true; return n })
    try {
      var res = await fetch('/api/distinct-values?datasetId=' + datasetId + '&field=' + encodeURIComponent(field))
      var json = await res.json()
      if (json.error) throw new Error(json.error)
      setDimValues(function(prev) { var n = Object.assign({}, prev); n[field] = json.values || []; return n })
    } catch(err) {
      console.error('distinct-values error for', field, ':', err.message)
    }
    setLoadingDimVals(function(prev) { var n = Object.assign({}, prev); delete n[field]; return n })
  }

  // ── Toggle dropdown open/close ───────────────────────────────────────
  function toggleDropdown(field) {
    if (openDropdown === field) { setOpenDropdown(null); return }
    setOpenDropdown(field)
    loadDimValues(field)
  }

  // Close dropdown on outside click
  var rootRef = useRef(null)
  useEffect(function() {
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpenDropdown(null)
    }
    document.addEventListener('mousedown', onDocClick)
    return function() { document.removeEventListener('mousedown', onDocClick) }
  }, [])

  // ── Apply a new filter state: optimistic collapse + refetch L1 ───────
  function applyFilters(nextFilters) {
    setSelectedFilters(nextFilters)
    setExpandedPaths({})      // collapse everything
    setValues({})             // drop cache
    setError('')
    var l1 = hierarchyNodes.filter(function(n) { return n.level === 1 }).map(function(n) { return n.node_path })
    if (l1.length) {
      setInitialLoading(true)
      fetchValues(l1, nextFilters).finally(function() { setInitialLoading(false) })
    }
  }

  function toggleFilterValue(field, value) {
    var current = selectedFilters[field] || []
    var next
    if (current.indexOf(value) !== -1) {
      next = current.filter(function(v) { return v !== value })
    } else {
      next = current.concat([value])
    }
    var nextFilters = Object.assign({}, selectedFilters)
    if (next.length) nextFilters[field] = next
    else delete nextFilters[field]
    applyFilters(nextFilters)
  }

  function clearAllFilters() {
    applyFilters({})
  }

  var activeFilterCount = Object.keys(selectedFilters).reduce(function(acc, k) {
    return acc + ((selectedFilters[k] && selectedFilters[k].length) ? 1 : 0)
  }, 0)

  // ── Expand/collapse a node ────────────────────────────────────────────
  async function toggleExpand(nodePath) {
    var isExpanded = !!expandedPaths[nodePath]
    if (isExpanded) {
      setExpandedPaths(function(prev) { var n = Object.assign({}, prev); delete n[nodePath]; return n })
      return
    }
    setExpandedPaths(function(prev) { var n = Object.assign({}, prev); n[nodePath] = true; return n })

    var children = childrenByParent[nodePath] || []
    var missing = children
      .map(function(c) { return c.node_path })
      .filter(function(p) { return !values[p] })
    if (missing.length) await fetchValues(missing, selectedFilters)
  }

  // ── Build the flat list of visible rows (top-down traversal) ──────────
  var visibleRows = useMemo(function() {
    var out = []
    function walk(parent) {
  var kids = childrenByParent[parent] || []
  kids.forEach(function(node) {
    var v = values[node.node_path]
    var bothNull = v && (v.current_value === null || v.current_value === undefined) &&
                         (v.comparison_value === null || v.comparison_value === undefined)
    if (activeFilterCount > 0 && bothNull) return  // skip this node and its subtree
    out.push(node)
    if (expandedPaths[node.node_path]) walk(node.node_path)
  })
}
    walk('__ROOT__')
    return out
  }, [hierarchyNodes, expandedPaths, childrenByParent,values, activeFilterCount])

  if (!hierarchyNodes.length) return null

  return (
    <div ref={rootRef} style={{
      background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-2) 100%)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
      padding: '20px 24px 16px', marginBottom: 20,
      position: 'relative', overflow: 'visible', backdropFilter: 'blur(8px)',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent), rgba(43,127,227,0.3), transparent)', opacity: 0.6 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <p style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
          Statement View
        </p>
        <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 3, background: 'var(--accent-dim)', color: 'var(--text-accent)', border: '1px solid var(--accent-border)', fontFamily: 'var(--font-mono)' }}>
          {hierarchyNodes.filter(function(n) { return n.level === 1 }).length} top-level lines
        </span>
        {initialLoading && (
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="spinner" /> loading values...
          </span>
        )}
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      {dimensions.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
            Filters
          </span>
          {dimensions.map(function(dim) {
            var field = dim.field_name
            var label = dim.display_name || field
            var selected = selectedFilters[field] || []
            var isOpen = openDropdown === field
            var vals = dimValues[field] || []
            var isLoadingVals = !!loadingDimVals[field]
            var badgeText = selected.length
              ? (selected.length === 1 ? selected[0] : selected.length + ' selected')
              : 'All'

            return (
              <div key={field} style={{ position: 'relative' }}>
                <button
                  onClick={function() { toggleDropdown(field) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px',
                    background: selected.length ? 'var(--accent-dim)' : 'var(--surface-2)',
                    border: '1px solid ' + (selected.length ? 'var(--accent-border)' : 'var(--border)'),
                    borderRadius: 4,
                    color: selected.length ? 'var(--text-accent)' : 'var(--text-secondary)',
                    fontSize: 10,
                    fontFamily: 'var(--font-body)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{label}:</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{badgeText}</span>
                  <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
                </button>

                {isOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
                    minWidth: 180, maxHeight: 280, overflowY: 'auto',
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '6px 0',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  }}>
                    {isLoadingVals && (
                      <div style={{ padding: '8px 12px', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
                        Loading…
                      </div>
                    )}
                    {!isLoadingVals && vals.length === 0 && (
                      <div style={{ padding: '8px 12px', fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>
                        No values
                      </div>
                    )}
                    {!isLoadingVals && vals.map(function(val) {
                      var checked = selected.indexOf(val) !== -1
                      return (
                        <label key={val} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 12px',
                          fontSize: 11, color: 'var(--text-primary)',
                          fontFamily: 'var(--font-body)', cursor: 'pointer',
                        }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={function() { toggleFilterValue(field, val) }}
                            style={{ cursor: 'pointer' }}
                          />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              style={{
                marginLeft: 'auto',
                padding: '5px 10px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 4,
                color: 'var(--text-tertiary)',
                fontSize: 10,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {error && (
        <div style={{ padding: '14px', textAlign: 'center', border: '1px dashed rgba(224,85,85,0.3)', borderRadius: 8, marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: '#E05555', fontFamily: 'var(--font-body)' }}>{error}</p>
        </div>
      )}

      {/* Table */}
      {!initialLoading && !error && visibleRows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-body)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ textAlign: 'left',  padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Line Item</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{periodInfo.viewLabel || 'Current'}</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>{periodInfo.cmpLabel ? periodInfo.cmpLabel.replace(/^vs /, '') : 'Comparison'}</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>Δ</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(function(node) {
              var v = values[node.node_path] || {}
              var cur = v.current_value
              var cmp = v.comparison_value
              var favDir = v.favorable_direction || node.favorable_direction
              var delta = fmtDelta(cur, cmp, favDir)
              var indent = (node.level - 1) * 18
              var expanded = !!expandedPaths[node.node_path]
              var loading  = !!loadingPaths[node.node_path]
              var canExpand = hasChildren(node.node_path)
              var isL1 = node.level === 1
              var rowWeight = isL1 ? 600 : 400

              return (
                <tr key={node.node_path}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      background: isL1 ? 'rgba(0,200,240,0.02)' : 'transparent',
                    }}>
                  <td style={{ padding: '8px 10px', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontWeight: rowWeight }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: indent }}>
                      {canExpand ? (
                        <button
                          onClick={function() { toggleExpand(node.node_path) }}
                          disabled={loading}
                          style={{
                            width: 16, height: 16, padding: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'transparent', border: 'none',
                            color: 'var(--text-accent)',
                            cursor: loading ? 'wait' : 'pointer',
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            flexShrink: 0,
                          }}
                        >
                          {loading
                            ? <span className="spinner" style={{ width: 9, height: 9, borderWidth: 1 }} />
                            : <span style={{ display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }}>▸</span>
                          }
                        </button>
                      ) : (
                        <span style={{ width: 16, flexShrink: 0, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 8 }}>·</span>
                      )}
                      <span>{node.display_name || node.node_name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-accent)', fontFamily: 'var(--font-mono)', fontWeight: rowWeight }}>
                    {loading ? '…' : fmt(cur)}{cur !== null && cur !== undefined && node.unit ? ' ' + node.unit : ''}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {loading ? '…' : fmt(cmp)}{cmp !== null && cmp !== undefined && node.unit ? ' ' + node.unit : ''}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: delta.color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {loading ? '' : delta.text}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
