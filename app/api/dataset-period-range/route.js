import { query } from '../../../lib/db'

export async function POST(request) {
  try {
    var body = await request.json()
    var datasetId = body.datasetId
    var pairs     = body.pairs || []  // [{ yearField, monthField }, ...]

    if (!datasetId) return Response.json({ error: 'datasetId required.' }, { status: 400 })
    if (!pairs.length) return Response.json({ pairs: [] })

    var tbl = 'ds_' + datasetId
    var out = []

    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i]
      if (!p.yearField || !p.monthField) continue
      try {
        var sql = 'SELECT DISTINCT CAST(' + p.yearField + ' AS INTEGER) AS y, CAST(' + p.monthField + ' AS INTEGER) AS m FROM ' + tbl +
                  ' WHERE ' + p.yearField + ' IS NOT NULL AND ' + p.monthField + ' IS NOT NULL' +
                  ' ORDER BY y, m'
        var rows = await query(sql)
        var months = rows
          .filter(function(r) { return r.y != null && r.m != null })
          .map(function(r) { return { year: parseInt(r.y), month: parseInt(r.m) } })
          .filter(function(m) { return !isNaN(m.year) && !isNaN(m.month) && m.month >= 1 && m.month <= 12 })
        if (!months.length) continue
        out.push({
          yearField:  p.yearField,
          monthField: p.monthField,
          label:      p.label || '',
          months:     months,
          minYear:    months[0].year,
          minMonth:   months[0].month,
          maxYear:    months[months.length - 1].year,
          maxMonth:   months[months.length - 1].month,
        })
      } catch(e) {
        console.warn('dataset-period-range: skipping pair', p.yearField, p.monthField, '-', e.message)
      }
    }

    return Response.json({ pairs: out })
  } catch (err) {
    console.error('dataset-period-range error:', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
