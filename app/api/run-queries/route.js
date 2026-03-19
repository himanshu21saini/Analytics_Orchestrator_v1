import { query } from '../../../lib/db'

export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var queries = body.queries
  if (!queries || !queries.length) {
    return Response.json({ error: 'No queries provided.' }, { status: 400 })
  }

  var results = []

  for (var i = 0; i < queries.length; i++) {
    var q = queries[i]
    try {
      // Safety check — only allow SELECT statements
      var sqlTrimmed = q.sql.trim().toUpperCase()
      if (!sqlTrimmed.startsWith('SELECT')) {
        results.push({ id: q.id, title: q.title, chart_type: q.chart_type, error: 'Only SELECT queries are allowed.' })
        continue
      }

      var rows = await query(q.sql)
      results.push({
        id: q.id,
        title: q.title,
        chart_type: q.chart_type,
        label_key:      q.label_key      || 'label',
        value_key:      q.value_key      || 'value',
        // Defensively set current_key and comparison_key for bar/kpi charts
        // LLM sometimes omits these even though the SQL produces the columns
        current_key:    q.current_key    || (q.chart_type === 'bar' || q.chart_type === 'kpi' ? 'current_value' : undefined),
        comparison_key: q.comparison_key || (q.chart_type === 'bar' || q.chart_type === 'kpi' ? 'comparison_value' : undefined),
        unit: q.unit || '',
        data: rows,
      })
    } catch (err) {
      console.error('Query error for', q.id, err.message)
      results.push({
        id: q.id,
        title: q.title,
        chart_type: q.chart_type,
        error: err.message,
        data: [],
      })
    }
  }

  return Response.json({ results: results })
}
