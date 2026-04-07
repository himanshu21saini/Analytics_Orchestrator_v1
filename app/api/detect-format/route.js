import { query } from '../../../lib/db'

// ── Heuristic detection (moved from upload-dataset) ─────────────────────────
function detectDatasetFormat(sampleRows, colNames, colTypes) {
  var format = {
    format: 'wide',
    valueColumn: null,
    hierarchyColumns: [],
    dimensionColumns: [],
    timeColumns: [],
    confidence: 'high',
  }
  if (!sampleRows.length || colNames.length < 4) return format

  var numericCols = colNames.filter(function(c) { return colTypes[c] === 'NUMERIC' })
  var textCols    = colNames.filter(function(c) { return colTypes[c] === 'TEXT' })
  if (textCols.length < 3) return format

  var totalRows = sampleRows.length

  // Value column candidates: numeric cols with high cardinality
  var valueCandidates = numericCols.filter(function(c) {
    var unique = {}
    sampleRows.forEach(function(r) {
      var v = r[c]
      if (v !== null && v !== undefined && String(v).trim() !== '') unique[String(v)] = true
    })
    var uniqueCount = Object.keys(unique).length
    return uniqueCount > Math.max(10, totalRows * 0.3)
  })
  if (valueCandidates.length !== 1) return format

  // Text column cardinality analysis
  var lowCardinalityCols = []
  var dateLikeCols = []
  textCols.forEach(function(c) {
    var unique = {}
    sampleRows.forEach(function(r) {
      var v = r[c]
      if (v !== null && v !== undefined && String(v).trim() !== '') unique[String(v)] = true
    })
    var uniqueCount = Object.keys(unique).length
    var ratio = uniqueCount / totalRows
    if (ratio < 0.5 && uniqueCount < 100) lowCardinalityCols.push(c)

    var firstVal = sampleRows.find(function(r) { return r[c] })
    if (firstVal && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(String(firstVal[c]))) {
      dateLikeCols.push(c)
    }
  })

  if (lowCardinalityCols.length < 3) return format

  // Identify hierarchy columns by NAME pattern first
  var levelPattern = /(?:^|_)(?:level|lvl|tier|l)[_\s]*(\d+)(?:_|$)/i
  var namedLevels = []
  lowCardinalityCols.forEach(function(c) {
    var m = c.match(levelPattern)
    if (m) namedLevels.push({ col: c, level: parseInt(m[1]) })
  })

  // Group by prefix (e.g. category_level_1/2/3 and lob_level_1 are different trees)
  var hierarchyCols = []
  if (namedLevels.length >= 2) {
    var byPrefix = {}
    namedLevels.forEach(function(n) {
      var prefix = n.col.replace(levelPattern, '').replace(/_+$/, '')
      if (!byPrefix[prefix]) byPrefix[prefix] = []
      byPrefix[prefix].push(n)
    })
    // Pick the prefix group with the most levels
    var bestPrefix = null; var bestCount = 0
    Object.keys(byPrefix).forEach(function(p) {
      if (byPrefix[p].length > bestCount) { bestCount = byPrefix[p].length; bestPrefix = p }
    })
    if (bestPrefix && byPrefix[bestPrefix].length >= 2) {
      byPrefix[bestPrefix].sort(function(a, b) { return a.level - b.level })
      hierarchyCols = byPrefix[bestPrefix].map(function(n) { return n.col })
    }
  }

  // Fallback: cardinality-based
  if (hierarchyCols.length < 2) {
    hierarchyCols = lowCardinalityCols
      .filter(function(c) { return dateLikeCols.indexOf(c) === -1 })
      .map(function(c) {
        var unique = {}
        sampleRows.forEach(function(r) { if (r[c]) unique[r[c]] = true })
        return { col: c, uniqueCount: Object.keys(unique).length }
      })
      .sort(function(a, b) { return a.uniqueCount - b.uniqueCount })
      .map(function(h) { return h.col })
  }

  if (hierarchyCols.length < 2) return format

  format.format = 'long_hierarchical'
  format.valueColumn = valueCandidates[0]
  format.hierarchyColumns = hierarchyCols
  format.dimensionColumns = textCols.filter(function(c) {
    return hierarchyCols.indexOf(c) === -1 && dateLikeCols.indexOf(c) === -1
  })
  format.timeColumns = dateLikeCols.concat(
    numericCols.filter(function(c) {
      return valueCandidates.indexOf(c) === -1 &&
             /year|month|qtr|quarter|fiscal|sort/i.test(c)
    })
  )
  return format
}

export async function POST(request) {
  try {
    var body = await request.json()
    var datasetId = body.datasetId
    if (!datasetId) return Response.json({ error: 'datasetId required.' }, { status: 400 })

    var tbl = 'ds_' + datasetId

    // Sample up to 500 rows from the actual table for a reliable signal
    var sampleRows = await query('SELECT * FROM ' + tbl + ' LIMIT 500')
    if (!sampleRows.length) return Response.json({ error: 'Dataset table is empty.' }, { status: 400 })

    var colNames = Object.keys(sampleRows[0])

    // Infer types from the sample (numeric vs text)
    var colTypes = {}
    colNames.forEach(function(c) {
      var vals = sampleRows.map(function(r) { return r[c] }).filter(function(v) {
        return v !== null && v !== undefined && String(v).trim() !== ''
      })
      if (!vals.length) { colTypes[c] = 'TEXT'; return }
      var allNumeric = vals.every(function(v) {
        var s = String(v).trim().replace(/,/g, '')
        return s !== '' && !isNaN(Number(s))
      })
      colTypes[c] = allNumeric ? 'NUMERIC' : 'TEXT'
    })

    var allColumns = colNames
    var detectedFormat = detectDatasetFormat(sampleRows, colNames, colTypes)

    return Response.json({ detectedFormat: detectedFormat, allColumns: allColumns })
  } catch (err) {
    console.error('detect-format error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
