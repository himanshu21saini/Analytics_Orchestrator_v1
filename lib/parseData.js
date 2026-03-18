export function formatNumber(v) {
  var n = parseFloat(v)
  if (isNaN(n)) return String(v || '-')
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2)
}

export function buildStatsFromRows(rows, metadata) {
  if (!rows || !rows.length || !metadata || !metadata.length) return {}
  var stats = {}
  var kpiFields = metadata.filter(function(m) {
    return m.type === 'kpi' || m.type === 'derived_kpi'
  })
  var dimFields = metadata.filter(function(m) { return m.type === 'dimension' })
  var dateFields = metadata.filter(function(m) { return m.type === 'datetime' })

  kpiFields.forEach(function(field) {
    var key = field.field_name
    var vals = rows.map(function(r) {
      return parseFloat(r[key])
    }).filter(function(v) { return !isNaN(v) })
    if (!vals.length) return
    var sum = vals.reduce(function(a, b) { return a + b }, 0)
    stats[key] = {
      display_name: field.display_name || key,
      total: sum,
      avg: sum / vals.length,
      min: Math.min.apply(null, vals),
      max: Math.max.apply(null, vals),
      count: vals.length,
      unit: field.unit || '',
    }
  })
  return stats
}
