// Layer 4 — Forecast overlay
// Accepts historical time-series data points and returns 3-month forward projections.
// Uses linear regression + simple seasonal decomposition.
// No LLM call — pure statistics, fast and deterministic.

// ── Linear regression (least squares) ────────────────────────────────────────
function linearRegression(xs, ys) {
  var n    = xs.length
  var sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

  for (var i = 0; i < n; i++) {
    sumX  += xs[i]
    sumY  += ys[i]
    sumXY += xs[i] * ys[i]
    sumX2 += xs[i] * xs[i]
  }

  var denom = (n * sumX2 - sumX * sumX)
  if (denom === 0) return { slope: 0, intercept: sumY / n }

  var slope     = (n * sumXY - sumX * sumY) / denom
  var intercept = (sumY - slope * sumX) / n

  return { slope, intercept }
}

// ── R-squared confidence score ────────────────────────────────────────────────
function rSquared(xs, ys, slope, intercept) {
  var n    = ys.length
  var mean = ys.reduce(function(a, b) { return a + b }, 0) / n
  var ssTot = 0, ssRes = 0

  for (var i = 0; i < n; i++) {
    var predicted = slope * xs[i] + intercept
    ssTot += Math.pow(ys[i] - mean, 2)
    ssRes += Math.pow(ys[i] - predicted, 2)
  }

  return ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot)
}

// ── Seasonal index per month (ratio-to-moving-average) ───────────────────────
function computeSeasonalIndices(values) {
  // Need at least 12 months for seasonality to be meaningful
  if (values.length < 12) return null

  var indices = {}
  var counts  = {}

  // Detrend first with a 12-month centred moving average
  var ma = []
  for (var i = 0; i < values.length; i++) {
    if (i < 6 || i >= values.length - 6) { ma.push(null); continue }
    var sum = 0
    for (var j = i - 6; j <= i + 5; j++) sum += values[j]
    ma.push(sum / 12)
  }

  // Compute ratio of actual to moving average per month-of-year
  for (var k = 0; k < values.length; k++) {
    if (ma[k] === null || ma[k] === 0) continue
    var month = (k % 12) + 1
    if (!indices[month]) { indices[month] = 0; counts[month] = 0 }
    indices[month] += values[k] / ma[k]
    counts[month]++
  }

  // Normalise so indices average to 1.0
  var result = {}
  var total  = 0
  var filled = 0

  for (var m = 1; m <= 12; m++) {
    if (counts[m]) {
      result[m] = indices[m] / counts[m]
      total    += result[m]
      filled++
    } else {
      result[m] = 1.0
    }
  }

  if (filled > 0) {
    var avg = total / filled
    for (var n = 1; n <= 12; n++) result[n] /= avg
  }

  return result
}

// ── Next N period labels after the last observed period ───────────────────────
function nextPeriods(lastPeriod, n) {
  // lastPeriod format: "YYYY-MM"
  var parts = lastPeriod.split('-')
  var year  = parseInt(parts[0])
  var month = parseInt(parts[1])
  var out   = []

  for (var i = 0; i < n; i++) {
    month++
    if (month > 12) { month = 1; year++ }
    out.push(year + '-' + String(month).padStart(2, '0'))
  }

  return out
}

// ── Confidence interval width (±1.5σ of residuals) ───────────────────────────
function residualStdDev(xs, ys, slope, intercept) {
  var n = xs.length
  if (n < 3) return 0
  var sumSq = 0
  for (var i = 0; i < n; i++) {
    var pred = slope * xs[i] + intercept
    sumSq += Math.pow(ys[i] - pred, 2)
  }
  return Math.sqrt(sumSq / (n - 2))
}

// ── Main forecast function ────────────────────────────────────────────────────
function forecastSeries(data, valueKey, labelKey, horizonMonths) {
  horizonMonths = horizonMonths || 3

  if (!data || data.length < 3) {
    return { error: 'Not enough data points (need at least 3).' }
  }

  // Extract ordered values
  var sorted = data.slice().sort(function(a, b) {
    var la = String(a[labelKey] || ''), lb = String(b[labelKey] || '')
    return la < lb ? -1 : la > lb ? 1 : 0
  })

  var xs     = sorted.map(function(_, i) { return i })
  var ys     = sorted.map(function(row) { return parseFloat(row[valueKey]) || 0 })
  var labels = sorted.map(function(row) { return String(row[labelKey] || '') })

  var reg      = linearRegression(xs, ys)
  var r2       = rSquared(xs, ys, reg.slope, reg.intercept)
  var stdDev   = residualStdDev(xs, ys, reg.slope, reg.intercept)
  var seasonal = computeSeasonalIndices(ys)

  var lastLabel = labels[labels.length - 1]
  var futureLabels = nextPeriods(lastLabel, horizonMonths)

  var forecasts = futureLabels.map(function(label, i) {
    var x         = xs.length + i
    var trend     = reg.slope * x + reg.intercept
    var monthNum  = parseInt(label.split('-')[1])
    var seasIdx   = seasonal ? (seasonal[monthNum] || 1.0) : 1.0
    var predicted = trend * seasIdx

    // Widen CI as we project further out
    var ci = stdDev * 1.5 * (1 + i * 0.3)

    return {
      period:       label,
      forecast:     Math.round(predicted * 100) / 100,
      forecast_low:  Math.round((predicted - ci) * 100) / 100,
      forecast_high: Math.round((predicted + ci) * 100) / 100,
      is_forecast:  true,
    }
  })

  return {
    forecasts,
    r_squared:   Math.round(r2 * 100) / 100,
    trend:       reg.slope > 0 ? 'up' : reg.slope < 0 ? 'down' : 'flat',
    slope:       Math.round(reg.slope * 100) / 100,
    confidence:  r2 >= 0.75 ? 'high' : r2 >= 0.45 ? 'medium' : 'low',
    method:      seasonal ? 'linear_regression_with_seasonality' : 'linear_regression',
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request) {
  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var seriesData   = body.seriesData    // array of { period, value } rows
  var valueKey     = body.valueKey  || 'value'
  var labelKey     = body.labelKey  || 'period'
  var horizonMonths = body.horizonMonths || 3

  if (!seriesData || !Array.isArray(seriesData) || seriesData.length < 3) {
    return Response.json({ error: 'seriesData must be an array with at least 3 data points.' }, { status: 400 })
  }

  try {
    var result = forecastSeries(seriesData, valueKey, labelKey, horizonMonths)
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 })
    }
    return Response.json(result)
  } catch (err) {
    console.error('generate-forecast error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
