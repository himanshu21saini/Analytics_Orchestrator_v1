import * as XLSX from 'xlsx'
import { execute, query } from '../../../lib/db'

export async function POST(request) {
  try {
    var formData = await request.formData()
    var file = formData.get('file')
    var metaName = formData.get('name') || file.name
    if (!file) return Response.json({ error: 'No file provided.' }, { status: 400 })

    var arrayBuffer = await file.arrayBuffer()
    var buffer = Buffer.from(arrayBuffer)
    var wb = file.name.toLowerCase().endsWith('.csv')
      ? XLSX.read(new TextDecoder('utf-8').decode(buffer), { type: 'string' })
      : XLSX.read(buffer, { type: 'buffer' })

    var rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: null })
    if (!rows.length) return Response.json({ error: 'Metadata file is empty.' }, { status: 400 })

    var keys = Object.keys(rows[0]).map(function(k) { return k.toLowerCase().trim() })
    var required = ['field_name', 'type', 'display_name']
    for (var i = 0; i < required.length; i++) {
      if (keys.indexOf(required[i]) === -1) {
        return Response.json({
          error: 'Missing required column: "' + required[i] + '". Required: field_name, type, display_name'
        }, { status: 400 })
      }
    }

    // Replace existing set with same name
    var existing = await query('SELECT id FROM metadata_sets WHERE name = $1', [metaName])
    var setId
    var isReplacement = false
    if (existing.length > 0) {
      setId = existing[0].id
      isReplacement = true
      await execute('DELETE FROM metadata_rows WHERE metadata_set_id = $1', [setId])
      await execute('UPDATE metadata_sets SET uploaded_at = NOW() WHERE id = $1', [setId])
    } else {
      var result = await query('INSERT INTO metadata_sets (name) VALUES ($1) RETURNING id', [metaName])
      setId = result[0].id
    }

    function getVal(row, key) {
      var found = Object.keys(row).find(function(k) { return k.toLowerCase().trim() === key })
      return found ? (row[found] || null) : null
    }

    function inferUnit(row) {
      var unit = getVal(row, 'unit')
      if (unit) return unit
      var fn = String(getVal(row, 'field_name') || '').toLowerCase()
      var sv = String(getVal(row, 'sample_values') || '')
      if (sv.includes('%') || /margin|rate|ratio|percent|pct|share|growth|yield|nim|roe|roa|npa|casa/i.test(fn)) return '%'
      if (sv.includes('$') || /revenue|income|profit|loss|cost|expense|fee|provision|nii|aum|loan|deposit|amount|value|spend|budget/i.test(fn)) return 'USD'
      if (/count|number|num|qty|quantity|units|orders|customers|transactions|accounts/i.test(fn)) return 'count'
      if (/days|duration|age|lag|lead/i.test(fn)) return 'days'
      return ''
    }

    function inferTimeGrain(row) {
      var grain = getVal(row, 'time_grain')
      if (grain) return grain
      var type = String(getVal(row, 'type') || '').toLowerCase()
      if (type !== 'datetime' && type !== 'year_month') return null
      var fn = String(getVal(row, 'field_name') || '').toLowerCase()
      if (/year/.test(fn) && /month/.test(fn)) return 'monthly'
      if (/year/.test(fn)) return 'yearly'
      if (/month/.test(fn)) return 'monthly'
      if (/quarter|qtr/.test(fn)) return 'quarterly'
      return 'monthly'
    }

    // Auto-detect accumulation_type if not supplied
    // point_in_time = stock/balance/rate metrics (snapshot at a moment)
    // cumulative    = flow metrics that accumulate over a period
    function inferAccumulationType(row) {
      var acc = getVal(row, 'accumulation_type')
      if (acc) return String(acc).toLowerCase().trim()
      var fn   = String(getVal(row, 'field_name') || '').toLowerCase()
      var type = String(getVal(row, 'type') || '').toLowerCase()
      // All derived KPIs that are ratios/rates are point_in_time
      if (type === 'derived_kpi') return 'point_in_time'
      // Balance sheet / stock items
      if (/deposit|balance|outstanding|aum|asset|liability|equity|total_customer|customer_count/i.test(fn)) return 'point_in_time'
      // Rate / ratio fields
      if (/ratio|rate|margin|nim|roe|roa|npa|casa|yield|score|index|pct|percent/i.test(fn)) return 'point_in_time'
      // Flow / income statement items
      if (/revenue|income|profit|loss|expense|cost|fee|provision|disbursed|new_customer|churn|transaction|sale|units_sold/i.test(fn)) return 'cumulative'
      return 'cumulative'
    }

    var savedCount = 0
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j]
      var fieldName = getVal(r, 'field_name')
      if (!fieldName) continue
      await execute(
        `INSERT INTO metadata_rows (
          metadata_set_id, field_name, display_name, type, data_type,
          unit, definition, aggregation, calculation_logic, dependencies,
          sample_values, business_priority, filters_applicable, time_grain,
          benchmark, accumulation_type
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          setId,
          String(fieldName),
          getVal(r, 'display_name'),
          getVal(r, 'type'),
          getVal(r, 'data_type'),
          inferUnit(r),
          getVal(r, 'definition'),
          getVal(r, 'aggregation'),
          getVal(r, 'calculation_logic'),
          getVal(r, 'dependencies'),
          getVal(r, 'sample_values'),
          getVal(r, 'business_priority'),
          getVal(r, 'filters_applicable'),
          inferTimeGrain(r),
          getVal(r, 'benchmark'),
          inferAccumulationType(r),
        ]
      )
      savedCount++
    }

    return Response.json({
      message: isReplacement
        ? savedCount + ' metadata rows replaced for "' + metaName + '".'
        : savedCount + ' metadata rows saved.',
      replaced: isReplacement,
      metadataSet: { id: setId, name: metaName, row_count: savedCount }
    })
  } catch (err) {
    console.error('save-metadata error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
