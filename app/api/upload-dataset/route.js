import { query, execute } from '../../../lib/db'

// ── Column name sanitizer ─────────────────────────────────────────────────────
// Converts any column name to a valid lowercase SQL identifier
// "Predicted Length" → "predicted_length", "BFI 2 Score" → "bfi_2_score"
function sanitizeColName(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[0-9]/, 'c_$&')
    .replace(/^_+|_+$/g, '') || 'col'
}

// ── Long-format hierarchical detection ───────────────────────────────────────
// Returns { format, valueColumn, hierarchyColumns, dimensionColumns, confidence }
function detectDatasetFormat(sampleRows, cols) {
  var format = {
    format: 'wide',
    valueColumn: null,
    hierarchyColumns: [],
    dimensionColumns: [],
    confidence: 'high',
  }
  if (!sampleRows.length || cols.length < 4) return format

  // Numeric vs text columns (using already-inferred types)
  var numericCols = cols.filter(function(c) { return c.type === 'NUMERIC' })
  var textCols    = cols.filter(function(c) { return c.type === 'TEXT' })

  // Among numeric columns, find ones that look like an actual VALUE column.
  // Real value columns have high cardinality — time/year/month/sort/version
  // columns are numeric but only have a handful of distinct values.
  var totalRows = sampleRows.length
  var valueCandidates = numericCols.filter(function(c) {
    var unique = {}
    sampleRows.forEach(function(r) {
      var v = r[c.raw]
      if (v !== null && v !== undefined && String(v).trim() !== '') unique[String(v)] = true
    })
    var uniqueCount = Object.keys(unique).length
    return uniqueCount > Math.max(10, totalRows * 0.3)
  })

  // Long format signature: exactly 1 high-cardinality numeric col + 3+ text cols
  if (valueCandidates.length !== 1 || textCols.length < 3) return format

  // Check cardinality of text columns — long format has heavy value repetition
  // because hierarchy values repeat thousands of times across periods
  var totalRows = sampleRows.length
  var lowCardinalityCols = []
  var dateLikeCols       = []

  textCols.forEach(function(c) {
    var unique = {}
    sampleRows.forEach(function(r) {
      var v = r[c.raw]
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        unique[String(v)] = true
      }
    })
    var uniqueCount = Object.keys(unique).length
    var cardinalityRatio = uniqueCount / totalRows

    // Heuristic: column has heavy repetition if unique values < 50% of rows
    // AND total unique values is small (< 30 in sample)
    if (cardinalityRatio < 0.5 && uniqueCount < 30) {
      lowCardinalityCols.push(c)
    }

    // Detect date-like text columns (e.g. "01/31/2022") — these are likely time
    var firstVal = sampleRows.find(function(r) { return r[c.raw] })
    if (firstVal && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$|^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(String(firstVal[c.raw]))) {
      dateLikeCols.push(c)
    }
  })

  // Need at least 3 low-cardinality text columns for hierarchical long format
  if (lowCardinalityCols.length < 3) return format

  
  // Looks like long hierarchical format
  format.format = 'long_hierarchical'
  format.valueColumn = valueCandidates[0].sanitized

  // Hierarchy columns = low-cardinality text cols, ordered by ascending cardinality
  // (L1 has fewest values, L3 has most). Exclude date-like cols.
  var hierarchyCandidates = lowCardinalityCols
    .filter(function(c) { return dateLikeCols.indexOf(c) === -1 })
    .map(function(c) {
      var unique = {}
      sampleRows.forEach(function(r) { if (r[c.raw]) unique[r[c.raw]] = true })
      return { col: c, uniqueCount: Object.keys(unique).length }
    })
    .sort(function(a, b) { return a.uniqueCount - b.uniqueCount })

  format.hierarchyColumns  = hierarchyCandidates.map(function(h) { return h.col.sanitized })
  format.dimensionColumns  = textCols
    .filter(function(c) {
      return format.hierarchyColumns.indexOf(c.sanitized) === -1
    })
    .map(function(c) { return c.sanitized })

  // Confidence is medium if we have unusual column counts
  if (textCols.length > 6 || lowCardinalityCols.length > 5) format.confidence = 'medium'

  return format
}
// ── Type inference from sample values ────────────────────────────────────────
function inferColType(sampleValues) {
  var nonNull = sampleValues.filter(function(v) {
    return v !== null && v !== undefined && String(v).trim() !== ''
  })
  if (!nonNull.length) return 'TEXT'
  var allNumeric = nonNull.every(function(v) {
    var s = String(v).trim().replace(/,/g, '')
    return s !== '' && !isNaN(Number(s))
  })
  return allNumeric ? 'NUMERIC' : 'TEXT'
}

export async function POST(request) {
  try {
    var body = await request.json()
    var action = body.action

    // ── INIT ────────────────────────────────────────────────────────────────
    // Creates/replaces the dataset record and the typed data table
    if (action === 'init') {
      var name       = body.name
      var rowCount   = body.rowCount
      var sampleRows = body.sampleRows || []

      if (!name) return Response.json({ error: 'name is required.' }, { status: 400 })
      if (!sampleRows.length) return Response.json({ error: 'sampleRows is required for type inference.' }, { status: 400 })

      // Ensure column_map column exists on datasets table
      await execute(
        'ALTER TABLE datasets ADD COLUMN IF NOT EXISTS column_map JSONB',
        []
      )
      await execute(
        'ALTER TABLE datasets ADD COLUMN IF NOT EXISTS dataset_format JSONB',
        []
      )
      // Upsert dataset record
      var existing = await query('SELECT id FROM datasets WHERE name = $1', [name])
      var datasetId
      if (existing.length > 0) {
        datasetId = existing[0].id
        await execute(
          'UPDATE datasets SET row_count = $1, uploaded_at = NOW() WHERE id = $2',
          [rowCount, datasetId]
        )
      } else {
        var result = await query(
          'INSERT INTO datasets (name, row_count) VALUES ($1, $2) RETURNING id',
          [name, rowCount]
        )
        datasetId = result[0].id
      }

      // Build column definitions from sample rows
      var rawCols = Object.keys(sampleRows[0])
      var cols = rawCols.map(function(raw) {
        var sanitized   = sanitizeColName(raw)
        var sampleVals  = sampleRows.map(function(r) { return r[raw] })
        var type        = inferColType(sampleVals)
        return { raw: raw, sanitized: sanitized, type: type }
      })

      // Deduplicate sanitized names (edge case: two cols sanitize to same name)
      var seen = {}
      cols = cols.map(function(c) {
        var name = c.sanitized
        if (seen[name]) { seen[name]++; name = name + '_' + seen[name] }
        else seen[name] = 1
        return Object.assign({}, c, { sanitized: name })
      })

      // Build column_map: { "Original Name": "sanitized_name" }
      var colMap = {}
      cols.forEach(function(c) { colMap[c.raw] = c.sanitized })

      // Save column map (dataset_format is set later by generate-metadata)
      await execute(
        'UPDATE datasets SET column_map = $1 WHERE id = $2',
        [JSON.stringify(colMap), datasetId]
      )
      
      // Drop old data table if exists, create fresh
      await execute('DROP TABLE IF EXISTS ds_' + datasetId, [])
      var colDefs = cols.map(function(c) { return c.sanitized + ' ' + c.type }).join(', ')
      await execute('CREATE TABLE ds_' + datasetId + ' (' + colDefs + ')', [])

      
     // Save column map and detected format to datasets record
      await execute(
        'UPDATE datasets SET column_map = $1, dataset_format = $2 WHERE id = $3',
        [JSON.stringify(colMap), JSON.stringify(detectedFormat), datasetId]
      )
      console.log('=== upload-dataset init: dataset', datasetId, 'table ds_' + datasetId, 'cols:', cols.length)
      return Response.json({ datasetId: datasetId, columns: cols, colMap: colMap })
    }

    // ── CHUNK ───────────────────────────────────────────────────────────────
    // Inserts a batch of rows into the typed table
    if (action === 'chunk') {
      var datasetId = body.datasetId
      var rows      = body.rows || []

      if (!datasetId || !rows.length) {
        return Response.json({ error: 'datasetId and rows required.' }, { status: 400 })
      }

      // Load column map
      var dsRow = await query('SELECT column_map FROM datasets WHERE id = $1', [datasetId])
      if (!dsRow.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })
      var colMap = dsRow[0].column_map || {}
      var rawCols       = Object.keys(colMap)
      var sanitizedCols = rawCols.map(function(r) { return colMap[r] })
      var colList       = sanitizedCols.join(', ')

      // Insert in sub-batches of 100 rows to keep payload size manageable
      var SUB = 100
      var totalInserted = 0
      for (var b = 0; b < rows.length; b += SUB) {
        var batch       = rows.slice(b, b + SUB)
        var placeholders = []
        var values       = []
        var idx          = 1

        batch.forEach(function(row) {
          var rowPH = rawCols.map(function(raw) {
            var v = row[raw]
            values.push(v !== null && v !== undefined ? String(v) : null)
            return '$' + (idx++)
          })
          placeholders.push('(' + rowPH.join(', ') + ')')
        })

        await execute(
          'INSERT INTO ds_' + datasetId + ' (' + colList + ') VALUES ' + placeholders.join(', '),
          values
        )
        totalInserted += batch.length
      }

      return Response.json({ inserted: totalInserted })
    }

    // ── FINALISE ────────────────────────────────────────────────────────────
    if (action === 'finalise') {
      var datasetId = body.datasetId
      var rowCount  = body.rowCount
      var name      = body.name

      await execute(
        'UPDATE datasets SET row_count = $1 WHERE id = $2',
        [rowCount, datasetId]
      )
      var ds = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])
      console.log('=== upload-dataset finalise: dataset', datasetId, rowCount, 'rows')
      return Response.json({ dataset: ds[0] })
    }

    // ── UPDATE-FORMAT ───────────────────────────────────────────────────────
    // Updates the dataset_format JSONB after user confirms/corrects in the modal
    if (action === 'update-format') {
      var datasetId      = body.datasetId
      var datasetFormat  = body.datasetFormat
      if (!datasetId || !datasetFormat) {
        return Response.json({ error: 'datasetId and datasetFormat required.' }, { status: 400 })
      }
      await execute(
        'UPDATE datasets SET dataset_format = $1 WHERE id = $2',
        [JSON.stringify(datasetFormat), datasetId]
      )
      console.log('=== upload-dataset update-format: dataset', datasetId, 'format:', datasetFormat.format)
      return Response.json({ ok: true })
    }
    
    return Response.json({ error: 'Unknown action: ' + action }, { status: 400 })

  } catch (err) {
    console.error('upload-dataset error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
