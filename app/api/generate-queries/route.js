import { query } from '../../../lib/db'
import { FISCAL_START_MONTH, MONTH_SHORT, toFiscal, fiscalRangeLabel } from '../../../lib/fiscal-config'

var MONTHS = MONTH_SHORT

function quarterStart(m) { return Math.floor((m - 1) / 3) * 3 + 1 }

function isFiscalField(yearField) {
  return /fiscal/i.test(yearField || '')
}

function buildPeriodFilters(datasetId, tp) {
  var vt = tp.viewType
  var yr = parseInt(tp.year)    // calendar year (as-of)
  var mo = parseInt(tp.month)   // calendar month (as-of)
  var ct = tp.comparisonType
  var yf = tp.yearField  || 'year'
  var mf = tp.monthField || 'month'
  var fiscal = isFiscalField(yf)

  var curYear, curMonthMin, curMonthMax
  var cmpYear, cmpMonthMin, cmpMonthMax
  var viewLabel, cmpLabel

  if (fiscal) {
    // Translate calendar as-of date to fiscal month
    var cur = toFiscal(yr, mo)
    var curFM = cur.fiscalMonth

    // Derive which fiscal year this as-of date belongs to
    // If calMonth >= FISCAL_START_MONTH we are in the fiscal year that started this calendar year
    // Otherwise we are in the fiscal year that started last calendar year
    // The data stores fiscal year as an integer — we need to find the right one
    // We don't track fiscal year number here, we just use curCond on Fiscal_Month
    // and rely on the data's Fiscal_Year field being correct
    // So: curYear in the SQL = the Fiscal_Year value for the as-of calendar month
    // When calMonth >= FISCAL_START_MONTH: fiscal year started in this cal year, so Fiscal_Year = cal year + 1
    // When calMonth < FISCAL_START_MONTH: fiscal year started last cal year, so Fiscal_Year = cal year
    curYear = mo >= FISCAL_START_MONTH ? yr + 1 : yr

    if (vt === 'MTD') {
      curMonthMin = curFM; curMonthMax = curFM
    } else if (vt === 'YTD') {
      curMonthMin = 1; curMonthMax = curFM
    } else {
      var fqStart = quarterStart(curFM)
      curMonthMin = fqStart; curMonthMax = Math.min(curFM, fqStart + 2)
    }

    if (ct === 'YoY') {
      cmpYear = curYear - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax
    } else if (ct === 'MoM') {
      if (curFM === 1) { cmpYear = curYear - 1; cmpMonthMin = cmpMonthMax = 12 }
      else             { cmpYear = curYear;     cmpMonthMin = cmpMonthMax = curFM - 1 }
    } else {
      var cqs = quarterStart(curFM)
      if (cqs <= 3) { cmpYear = curYear - 1; cmpMonthMin = cqs + 9; cmpMonthMax = cmpMonthMin + 2 }
      else          { cmpYear = curYear;     cmpMonthMin = cqs - 3; cmpMonthMax = cmpMonthMin + 2 }
    }

    // Calendar range labels e.g. "Nov 25–Feb 26 (YTD)"
    var curRange = fiscalRangeLabel(yr, mo, curMonthMin, curMonthMax)
    // For comparison, shift the as-of year by 1 back
    var cmpAsOfYr = yr - 1; var cmpAsOfMo = mo
    var cmpRange  = fiscalRangeLabel(cmpAsOfYr, cmpAsOfMo, cmpMonthMin, cmpMonthMax)
    var cmpTag    = ct === 'YoY' ? '(YoY)' : ct === 'MoM' ? '(MoM)' : '(QoQ)'
    viewLabel = curRange + ' (' + vt + ')'
    cmpLabel  = 'vs ' + cmpRange + ' ' + cmpTag

  } else {
    // Calendar mode — original logic unchanged
    curYear     = yr
    curMonthMin = vt === 'MTD' ? mo : vt === 'YTD' ? 1 : quarterStart(mo)
    curMonthMax = mo

    if (ct === 'YoY') {
      cmpYear = yr - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax
    } else if (ct === 'MoM') {
      cmpYear = mo === 1 ? yr - 1 : yr
      cmpMonthMin = cmpMonthMax = mo === 1 ? 12 : mo - 1
    } else {
      var cqs2 = quarterStart(mo)
      cmpYear = cqs2 <= 3 ? yr - 1 : yr
      cmpMonthMin = cqs2 <= 3 ? cqs2 + 9 : cqs2 - 3
      cmpMonthMax = cmpMonthMin + 2
    }

    if (vt === 'MTD')      viewLabel = MONTHS[mo-1] + ' ' + yr + ' (MTD)'
    else if (vt === 'YTD') viewLabel = 'Jan–' + MONTHS[mo-1] + ' ' + yr + ' (YTD)'
    else                   viewLabel = 'Q' + Math.ceil(mo/3) + ' ' + yr + ' (QTD)'

    if (ct === 'YoY') {
      if (vt === 'MTD')      cmpLabel = 'vs ' + MONTHS[mo-1] + ' ' + cmpYear + ' (YoY)'
      else if (vt === 'YTD') cmpLabel = 'vs Jan–' + MONTHS[mo-1] + ' ' + cmpYear + ' (YoY)'
      else                   cmpLabel = 'vs Q' + Math.ceil(mo/3) + ' ' + cmpYear + ' (YoY)'
    } else if (ct === 'MoM') {
      cmpLabel = 'vs ' + MONTHS[cmpMonthMax-1] + ' ' + cmpYear + ' (MoM)'
    } else {
      cmpLabel = 'vs Q' + Math.ceil(cmpMonthMax/3) + ' ' + cmpYear + ' (QoQ)'
    }
  }

  function cond(year, mMin, mMax) {
    var y = "(data->>'" + yf + "')::integer = " + year
    var m = mMin === mMax
      ? "(data->>'" + mf + "')::integer = " + mMax
      : "(data->>'" + mf + "')::integer >= " + mMin + " AND (data->>'" + mf + "')::integer <= " + mMax
    return y + ' AND ' + m
  }

  var curCond    = cond(curYear, curMonthMin, curMonthMax)
  var cmpCond    = cond(cmpYear, cmpMonthMin, cmpMonthMax)
  // Point-in-time conditions — always single latest month only
  // For YTD/QTD these differ from curCond/cmpCond; for MTD they are identical
  var curCondPIT = cond(curYear, curMonthMax, curMonthMax)
  var cmpCondPIT = cond(cmpYear, cmpMonthMax, cmpMonthMax)

  return { curCond, cmpCond, curCondPIT, cmpCondPIT, curYear, cmpYear, viewLabel, cmpLabel, yf, mf, fiscal }
}

// ── PRE-ANALYSIS: compute real variance for every KPI × dimension pair ────────
//
// For each combination we run a lightweight SQL query that groups the KPI by
// the dimension and computes:
//   - mean across segments
//   - coefficient of variation (CV = stddev / mean)  ← key signal
//   - min / max segment values
//   - number of distinct segments
//
// CV is the best proxy for "does this dimension actually reveal something
// interesting about this KPI?":
//   CV > 0.3  → high variance → great breakdown candidate
//   CV 0.1-0.3 → moderate → worth showing
//   CV < 0.1  → low variance → dimension adds little insight
//
// We also compute YoY delta per segment so the LLM knows which segments
// are diverging (a segment moving away from peers is the most exec-relevant signal).

async function runPreAnalysis(datasetId, kpis, dims, curCond, cmpCond, curCondPIT, cmpCondPIT) {
  var results = []

  // Cap: analyse top 5 KPIs × top 6 dimensions = max 30 queries
  // Each is a tiny GROUP BY on an indexed JSONB column — fast
  var kpiSample = kpis.slice(0, 5)
  var dimSample = dims.slice(0, 6)

  for (var ki = 0; ki < kpiSample.length; ki++) {
    var kpi = kpiSample[ki]
    // Detect COUNT DISTINCT KPIs from calculation_logic or aggregation field
    var isCountDistinct = /distinct/i.test(kpi.calculation_logic || '') || /count_distinct/i.test(kpi.aggregation || '')
    var distField = isCountDistinct ? (kpi.dependencies || kpi.field_name) : null
    var isPIT     = !isCountDistinct && kpi.accumulation_type === 'point_in_time'
    var agg       = isCountDistinct ? null : (isPIT ? 'AVG' : 'SUM')
    // Use PIT conditions for point_in_time KPIs
    var useCurCond = (isPIT && curCondPIT) ? curCondPIT : curCond
    var useCmpCond = (isPIT && cmpCondPIT) ? cmpCondPIT : cmpCond

    for (var di = 0; di < dimSample.length; di++) {
      var dim = dimSample[di]

      try {
        var sql
        if (isCountDistinct && distField) {
          sql = [
            'SELECT',
            "  data->>'" + dim.field_name + "' AS segment,",
            "  COUNT(DISTINCT CASE WHEN " + useCurCond + " THEN data->>'" + distField + "' ELSE NULL END) AS cur_val,",
            "  COUNT(DISTINCT CASE WHEN " + useCmpCond + " THEN data->>'" + distField + "' ELSE NULL END) AS cmp_val",
            'FROM dataset_rows',
            'WHERE dataset_id = ' + datasetId,
            "  AND data->>'" + dim.field_name + "' IS NOT NULL",
            "  AND data->>'" + dim.field_name + "' != ''",
            "GROUP BY data->>'" + dim.field_name + "'",
            'ORDER BY cur_val DESC NULLS LAST',
            'LIMIT 20',
          ].join('\n')
        } else {
          sql = [
            'SELECT',
            "  data->>'" + dim.field_name + "' AS segment,",
            '  ' + agg + "(CASE WHEN " + useCurCond + " THEN COALESCE((data->>'" + kpi.field_name + "')::numeric, 0) ELSE NULL END) AS cur_val,",
            '  ' + agg + "(CASE WHEN " + useCmpCond + " THEN COALESCE((data->>'" + kpi.field_name + "')::numeric, 0) ELSE NULL END) AS cmp_val",
            'FROM dataset_rows',
            'WHERE dataset_id = ' + datasetId,
            "  AND data->>'" + dim.field_name + "' IS NOT NULL",
            "  AND data->>'" + dim.field_name + "' != ''",
            "GROUP BY data->>'" + dim.field_name + "'",
            'ORDER BY cur_val DESC NULLS LAST',
            'LIMIT 20',
          ].join('\n')
        }

        var rows = await query(sql)

        // Need at least 2 segments to compute variance meaningfully
        if (!rows || rows.length < 2) continue

        var curVals = rows.map(function(r) { return parseFloat(r.cur_val) || 0 })
        var mean    = curVals.reduce(function(a, b) { return a + b }, 0) / curVals.length
        if (mean === 0) continue

        // Population std dev
        var variance = curVals.reduce(function(acc, v) { return acc + Math.pow(v - mean, 2) }, 0) / curVals.length
        var stdDev   = Math.sqrt(variance)
        var cv       = stdDev / Math.abs(mean)

        // Segments diverging from peers (largest absolute delta vs mean)
        var outliers = rows
          .map(function(r) {
            var cur     = parseFloat(r.cur_val) || 0
            var cmp     = parseFloat(r.cmp_val) || 0
            var devFromMean = ((cur - mean) / Math.abs(mean) * 100)
            var yoyDelta    = cmp !== 0 ? ((cur - cmp) / Math.abs(cmp) * 100) : null
            return { segment: r.segment, cur_val: cur, cmp_val: cmp, dev_from_mean_pct: devFromMean, yoy_delta_pct: yoyDelta }
          })
          .sort(function(a, b) { return Math.abs(b.dev_from_mean_pct) - Math.abs(a.dev_from_mean_pct) })

        // Top outlier = the most diverging segment
        var topOutlier   = outliers[0]
        var topSegment   = rows[0]  // highest current value segment
        var worstSegment = rows[rows.length - 1] // lowest

        results.push({
          kpi_field:       kpi.field_name,
          kpi_display:     kpi.display_name,
          kpi_unit:        kpi.unit || '',
          kpi_priority:    kpi.business_priority || 'medium',
          dim_field:       dim.field_name,
          dim_display:     dim.display_name,
          segment_count:   rows.length,
          cv:              Math.round(cv * 1000) / 1000,
          cv_label:        cv > 0.3 ? 'high' : cv > 0.1 ? 'medium' : 'low',
          mean_val:        Math.round(mean * 100) / 100,
          top_segment:     topSegment ? { name: topSegment.segment, value: Math.round((parseFloat(topSegment.cur_val) || 0) * 100) / 100 } : null,
          worst_segment:   worstSegment ? { name: worstSegment.segment, value: Math.round((parseFloat(worstSegment.cur_val) || 0) * 100) / 100 } : null,
          top_outlier:     topOutlier ? {
            name:             topOutlier.segment,
            dev_from_mean_pct: Math.round(topOutlier.dev_from_mean_pct * 10) / 10,
            yoy_delta_pct:    topOutlier.yoy_delta_pct !== null ? Math.round(topOutlier.yoy_delta_pct * 10) / 10 : null,
          } : null,
        })
      } catch (e) {
        // Non-fatal — skip this KPI × dim pair if SQL fails
        console.warn('pre-analysis skip:', kpi.field_name, 'x', dim.field_name, e.message)
      }
    }
  }

  // Sort by informativeness: KPI priority first, then CV descending
  var priOrder = { high: 3, medium: 2, low: 1 }
  results.sort(function(a, b) {
    var pa = priOrder[a.kpi_priority.toLowerCase()] || 1
    var pb = priOrder[b.kpi_priority.toLowerCase()] || 1
    if (pa !== pb) return pb - pa
    return b.cv - a.cv
  })

  return results
}

// ── Format pre-analysis for the LLM prompt ───────────────────────────────────
function formatPreAnalysis(preAnalysis) {
  if (!preAnalysis || !preAnalysis.length) return '(pre-analysis unavailable)'

  var lines = [
    'Each row = one KPI × dimension combination, ranked by business priority then data variance.',
    'CV (coefficient of variation) = how much the KPI varies across segments of that dimension.',
    'CV > 0.3 = high variance = this dimension reveals meaningful differences in this KPI.',
    'CV < 0.1 = low variance = this dimension adds little insight for this KPI.',
    '',
    'USE THIS DATA to decide:',
    '  1. Which KPI × dimension pairs to chart (prefer high CV)',
    '  2. Which dimension to use for breakdown charts (prefer highest CV for that KPI)',
    '  3. Which outlier segments to call out in the insight field',
    '  4. Skip combinations where CV < 0.05 — they are visually flat and uninformative',
    '',
  ]

  // Group by KPI for readability
  var byKpi = {}
  preAnalysis.forEach(function(r) {
    if (!byKpi[r.kpi_field]) byKpi[r.kpi_field] = []
    byKpi[r.kpi_field].push(r)
  })

  Object.keys(byKpi).forEach(function(kpiField) {
    var rows = byKpi[kpiField]
    var first = rows[0]
    lines.push('── ' + first.kpi_display + ' (' + first.kpi_field + ', priority: ' + first.kpi_priority + ')')

    rows.forEach(function(r) {
      var outStr = ''
      if (r.top_outlier) {
        outStr = ' | outlier: ' + r.top_outlier.name +
          ' (' + (r.top_outlier.dev_from_mean_pct > 0 ? '+' : '') + r.top_outlier.dev_from_mean_pct + '% from mean' +
          (r.top_outlier.yoy_delta_pct !== null ? ', YoY: ' + (r.top_outlier.yoy_delta_pct > 0 ? '+' : '') + r.top_outlier.yoy_delta_pct + '%' : '') + ')'
      }
      var topStr = r.top_segment ? ' | top: ' + r.top_segment.name : ''
      var wrstStr = r.worst_segment && r.worst_segment.name !== (r.top_segment && r.top_segment.name) ? ' | worst: ' + r.worst_segment.name : ''

      lines.push(
        '   dim=' + r.dim_display.padEnd(18) +
        ' CV=' + String(r.cv).padEnd(6) +
        ' [' + r.cv_label.toUpperCase().padEnd(6) + ']' +
        ' segments=' + r.segment_count +
        topStr + wrstStr + outStr
      )
    })
    lines.push('')
  })

  return lines.join('\n')
}

// ── Intent-specific query builder ────────────────────────────────────────────
function buildIntentQueries(intent, datasetId, f, CF) {
  if (!intent || !intent.type || intent.type === 'null') return []

  var queries = []
  var base = 'FROM dataset_rows WHERE dataset_id = ' + datasetId + ' AND ' + f.curCond + CF

  // Safe ORDER BY helper — casts to integer only when the field is a
  // known numeric sort field (contains 'sort' or 'order' in name).
  // Otherwise falls back to text order so string values like "1.00PM to 1:30 PM"
  // never cause "invalid input syntax for type integer" errors.
  function safeIntOrder(field) {
    if (/sort|order|seq|num|idx|id$/i.test(field)) {
      return "CASE WHEN (data->>'"+field+"') ~ '^[0-9]+$' THEN (data->>'"+field+"')::integer ELSE 0 END ASC, data->>'"+field+"' ASC"
    }
    return "data->>'"+field+"' ASC"
  }

  // ── RANKING ───────────────────────────────────────────────────────────────
  if (intent.type === 'ranking' || intent.type === 'ranking_with_drilldown') {
    var entity = intent.primary_entity        || 'branch_name'
    var metric = intent.primary_metric        || 'bfi_2_score'
    var topN   = parseInt(intent.top_n)       || 10
    var dir    = (intent.direction || 'desc').toUpperCase()
    var eDisp  = intent.primary_entity_display  || entity
    var mDisp  = intent.primary_metric_display  || metric

    var rankSQL = [
      'SELECT',
      "  data->>'"+entity+"' AS label,",
      "  AVG(COALESCE((data->>'"+metric+"')::numeric, 0)) AS current_value",
      base,
      "  AND data->>'"+entity+"' IS NOT NULL",
      "  AND data->>'"+entity+"' != ''",
      "GROUP BY data->>'"+entity+"'",
      'ORDER BY current_value '+dir,
      'LIMIT '+topN,
    ].join('\n')

    queries.push({
      id:               'intent_ranking_'+entity,
      title:            mDisp+' by '+eDisp+' — Ranked',
      chart_type:       'bar',
      sql:              rankSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             '',
      insight:          'Ranks every '+eDisp+' by average '+mDisp+'. '+(dir==='DESC'?'Highest values first.':'Lowest values first.'),
      priority:         50,
      intent_generated: true,
    })

    // Stress category distribution — COUNT(*) per category
    var stressDim = 'Stress Type'
    var stressSQL = [
      'SELECT',
      "  data->>'"+stressDim+"' AS label,",
      '  COUNT(*) AS current_value',
      base,
      "  AND data->>'"+stressDim+"' IS NOT NULL",
      "  AND data->>'"+stressDim+"' != ''",
      "GROUP BY data->>'"+stressDim+"'",
      'ORDER BY current_value DESC',
    ].join('\n')

    queries.push({
      id:               'intent_stress_distribution',
      title:            'Distribution by '+stressDim,
      chart_type:       'donut',
      sql:              stressSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             'count',
      insight:          'Proportion of intervals in each stress category for the selected period.',
      priority:         51,
      intent_generated: true,
    })
  }

  // ── RANKING WITH DRILLDOWN ────────────────────────────────────────────────
  if (intent.type === 'ranking_with_drilldown') {
    var ddDim    = intent.drilldown_dimension   || 'interval_sort_order'
    var ddLabel  = intent.drilldown_label_field || ddDim
    var ddDisp   = intent.drilldown_display     || ddDim
    var ddMetric = intent.primary_metric        || 'bfi_2_score'
    var ddEntity = intent.primary_entity        || 'branch_name'
    var ddMDisp  = intent.primary_metric_display || ddMetric
    var ddTopN   = parseInt(intent.top_n)       || 5

    // Intra-day profile: avg metric grouped by time slot across all branches.
    // FIX: use safeIntOrder so text fields like interval don't get ::integer cast.
    // FIX: both ddDim and ddLabel appear in GROUP BY — ORDER BY references the
    // sort field via safeIntOrder so no text-field cast error.
    var drillSQL = [
      'SELECT',
      "  data->>'"+ddLabel+"' AS label,",
      "  AVG(COALESCE((data->>'"+ddMetric+"')::numeric, 0)) AS current_value",
      base,
      "  AND data->>'"+ddLabel+"' IS NOT NULL",
      "GROUP BY data->>'"+ddLabel+"'"+(ddDim !== ddLabel ? ", data->>'"+ddDim+"'" : ''),
      'ORDER BY '+safeIntOrder(ddDim),
    ].join('\n')

    queries.push({
      id:               'intent_drilldown_'+ddDim,
      title:            mDisp+' across '+ddDisp+'s',
      chart_type:       'line',
      sql:              drillSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             '',
      insight:          'Average '+ddMDisp+' per '+ddDisp.toLowerCase()+', across all branches. Peaks = highest-stress time slots.',
      priority:         52,
      intent_generated: true,
    })

    // Top-N entity breakdown by drilldown slot.
    // FIX 1: Remove SELECT DISTINCT — use plain GROUP BY + ORDER BY aggregate.
    // FIX 2: Safe integer cast on ORDER BY.
    var heatSQL = [
      'SELECT',
      "  data->>'"+ddEntity+"' AS label,",
      "  data->>'"+ddDim+"' AS slot,",
      "  AVG(COALESCE((data->>'"+ddMetric+"')::numeric, 0)) AS current_value",
      base,
      "  AND data->>'"+ddEntity+"' IN (",
      '    SELECT '+    "data->>'"+ddEntity+"'",
      '    FROM dataset_rows',
      '    WHERE dataset_id = '+datasetId+' AND '+f.curCond+CF,
      "    AND data->>'"+ddEntity+"' IS NOT NULL",
      "    GROUP BY data->>'"+ddEntity+"'",
      "    ORDER BY AVG(COALESCE((data->>'"+ddMetric+"')::numeric, 0)) DESC",
      '    LIMIT '+ddTopN,
      '  )',
      "GROUP BY data->>'"+ddEntity+"', data->>'"+ddDim+"'",
      "ORDER BY data->>'"+ddEntity+"', "+safeIntOrder(ddDim),
    ].join('\n')

    queries.push({
      id:               'intent_heatmap_'+ddEntity+'_'+ddDim,
      title:            'Top '+ddTopN+' '+eDisp+'s — '+ddMDisp+' by '+ddDisp,
      chart_type:       'bar',
      sql:              heatSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             '',
      insight:          'Avg '+ddMDisp+' per '+ddDisp.toLowerCase()+' for the top '+ddTopN+' most stressed '+eDisp.toLowerCase()+'s.',
      priority:         53,
      intent_generated: true,
    })
  }

  // ── DISTRIBUTION ─────────────────────────────────────────────────────────
  if (intent.type === 'distribution') {
    var distDim    = intent.distribution_dimension || 'Stress Type'
    var distMetric = intent.distribution_metric    || 'bfi_2_score'

    var distSQL = [
      'SELECT',
      "  data->>'"+distDim+"' AS label,",
      '  COUNT(*) AS current_value',
      base,
      "  AND data->>'"+distDim+"' IS NOT NULL",
      "  AND data->>'"+distDim+"' != ''",
      "GROUP BY data->>'"+distDim+"'",
      'ORDER BY current_value DESC',
    ].join('\n')

    queries.push({
      id:               'intent_distribution_'+distDim.replace(/\s+/g,'_'),
      title:            'Distribution by '+distDim,
      chart_type:       'donut',
      sql:              distSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             'count',
      insight:          'Spread of records across each '+distDim+' category.',
      priority:         50,
      intent_generated: true,
    })

    var distBarSQL = [
      'SELECT',
      "  data->>'"+distDim+"' AS label,",
      "  AVG(COALESCE((data->>'"+distMetric+"')::numeric, 0)) AS current_value",
      base,
      "  AND data->>'"+distDim+"' IS NOT NULL",
      "GROUP BY data->>'"+distDim+"'",
      'ORDER BY current_value DESC',
    ].join('\n')

    queries.push({
      id:               'intent_distribution_bar_'+distDim.replace(/\s+/g,'_'),
      title:            'Avg '+distMetric+' by '+distDim,
      chart_type:       'bar',
      sql:              distBarSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             '',
      insight:          'Average '+distMetric+' per '+distDim+' category.',
      priority:         51,
      intent_generated: true,
    })
  }

  // ── TEMPORAL ─────────────────────────────────────────────────────────────
  if (intent.type === 'temporal') {
    var timeDim   = intent.time_dimension   || 'interval_sort_order'
    var timeLabel = intent.time_label_field || timeDim
    var timeMet   = intent.temporal_metric  || 'bfi_2_score'

    var temporalSQL = [
      'SELECT',
      "  data->>'"+timeLabel+"' AS label,",
      "  AVG(COALESCE((data->>'"+timeMet+"')::numeric, 0)) AS current_value,",
      '  COUNT(*) AS record_count',
      base,
      "  AND data->>'"+timeLabel+"' IS NOT NULL",
      "GROUP BY data->>'"+timeLabel+"'"+(timeDim !== timeLabel ? ", data->>'"+timeDim+"'" : ''),
      'ORDER BY '+safeIntOrder(timeDim),
    ].join('\n')

    queries.push({
      id:               'intent_temporal_'+timeDim,
      title:            timeMet+' Pattern by '+(timeLabel !== timeDim ? timeLabel : timeDim),
      chart_type:       'area',
      sql:              temporalSQL,
      current_key:      'current_value',
      value_key:        'current_value',
      label_key:        'label',
      unit:             '',
      insight:          'How '+timeMet+' evolves across each '+timeLabel+'. Peaks reveal the highest-stress time slots.',
      priority:         50,
      intent_generated: true,
    })
  }

  return queries
}

// ── Main route handler ────────────────────────────────────────────────────────
export async function POST(request) {
  var apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return Response.json({ error: 'OPENAI_API_KEY is not set.' }, { status: 500 })

  var body
  try { body = await request.json() } catch (e) {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  var metadataSetId = body.metadataSetId
  var datasetId     = body.datasetId
  var timePeriod    = body.timePeriod || { viewType: 'YTD', year: 2024, month: 12, comparisonType: 'YoY' }
  var userContext   = body.userContext || null  // { filters, kpi_focus, explanation, intent }

  if (!metadataSetId || !datasetId) {
    return Response.json({ error: 'metadataSetId and datasetId are required.' }, { status: 400 })
  }

  // Build SQL fragment for user context filters
  // e.g. "AND data->>'Region' = 'West'"
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(f) {
      var op = f.operator || '='
      var val = String(f.value || '').replace(/'/g, "''")  // escape single quotes
      return "AND data->>'" + f.field + "' " + op + " '" + val + "'"
    }).join(' ')
  }

  // Boost priority of KPI focus fields by sorting them to front of kpis array
  function applyFocusPriority(kpiArray) {
    if (!userContext || !userContext.kpi_focus || !userContext.kpi_focus.length) return kpiArray
    var focus = userContext.kpi_focus
    return kpiArray.slice().sort(function(a, b) {
      var aFocus = focus.indexOf(a.field_name) >= 0 ? 1 : 0
      var bFocus = focus.indexOf(b.field_name) >= 0 ? 1 : 0
      return bFocus - aFocus  // focus fields first
    })
  }

  var metaRows = await query('SELECT * FROM metadata_rows WHERE metadata_set_id = $1 ORDER BY id', [metadataSetId])
  if (!metaRows.length) return Response.json({ error: 'No metadata found.' }, { status: 404 })

  var dataset = await query('SELECT * FROM datasets WHERE id = $1', [datasetId])
  if (!dataset.length) return Response.json({ error: 'Dataset not found.' }, { status: 404 })

  var sampleRows = await query('SELECT data FROM dataset_rows WHERE dataset_id = $1 LIMIT 3', [datasetId])
  var sampleData = sampleRows.map(function(r) { return r.data })

  var f = buildPeriodFilters(datasetId, timePeriod)

  function pri(m) {
    var p = (m.business_priority || '').toLowerCase()
    return p === 'high' ? 3 : p === 'medium' ? 2 : 1
  }

  // is_output = 'N' rows are excluded entirely — LLM never sees them
  var kpis    = metaRows.filter(function(m) { return m.type === 'kpi'         && m.is_output !== 'N' }).sort(function(a,b) { return pri(b)-pri(a) })
  var derived = metaRows.filter(function(m) { return m.type === 'derived_kpi' && m.is_output !== 'N' })
  var dims    = metaRows.filter(function(m) { return m.type === 'dimension'   && m.is_output !== 'N' })

  // Apply KPI focus priority — focus KPIs bubble to front
  kpis    = applyFocusPriority(kpis)
  derived = applyFocusPriority(derived)

  var topKpis    = kpis.slice(0, 6)
  var topDerived = derived.slice(0, 4)

  // ── RUN PRE-ANALYSIS before calling LLM ──────────────────────────────────
  // Context filter is applied here too so CV scores reflect the filtered population
  var contextCurCond    = f.curCond    + (contextFilterSQL ? ' ' + contextFilterSQL : '')
  var contextCmpCond    = f.cmpCond    + (contextFilterSQL ? ' ' + contextFilterSQL : '')
  var contextCurCondPIT = f.curCondPIT + (contextFilterSQL ? ' ' + contextFilterSQL : '')
  var contextCmpCondPIT = f.cmpCondPIT + (contextFilterSQL ? ' ' + contextFilterSQL : '')
  console.log('=== pre-analysis: running', topKpis.length, 'KPIs ×', dims.length, 'dims')
  var preAnalysis = await runPreAnalysis(datasetId, topKpis, dims, contextCurCond, contextCmpCond, contextCurCondPIT, contextCmpCondPIT)
  var preAnalysisText = formatPreAnalysis(preAnalysis)
  console.log('=== pre-analysis: done,', preAnalysis.length, 'combinations scored')

  function fieldList(arr) {
    return arr.map(function(m) {
      return {
        field_name:           m.field_name,
        display_name:         m.display_name,
        unit:                 m.unit || '',
        definition:           m.definition || '',
        aggregation:          m.aggregation || 'SUM',
        business_priority:    m.business_priority || 'Medium',
        accumulation_type:    m.accumulation_type || 'cumulative',
        favorable_direction:  m.favorable_direction || 'i',
        calculation_logic:    m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined,
        dependencies:         m.type === 'derived_kpi' ? (m.dependencies || '') : undefined,
        benchmark:            m.benchmark || '',
      }
    })
  }

  var CF = contextFilterSQL ? ' ' + contextFilterSQL : ''  // context filter fragment

  // Standard cumulative template — sums across the full period range (YTD, QTD, MTD)
  var tplSum = "SELECT SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF

  // Point-in-time template — uses latest single month only, not the full range
  // Use this for balance sheet / stock metrics (Loans, Deposits, AUM, etc.)
  var tplPIT  = "SELECT AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCondPIT + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF

  // Legacy AVG template (kept for backward compat — prefer T-PIT for point_in_time)
  var tplAvg  = "SELECT AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF

  // Count distinct templates — for # Accounts, # Clients, # Households, # Bankers
  // Uses PIT conditions so count reflects snapshot at as-of month, not cumulative unique count
  var tplCountDistinct    = "SELECT COUNT(DISTINCT CASE WHEN " + f.curCondPIT + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN " + f.cmpCondPIT + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF
  var tplCountDistinctBar = "SELECT data->>'__DIM__' AS label, COUNT(DISTINCT CASE WHEN " + f.curCond + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN " + f.cmpCond + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY current_value DESC LIMIT 10"

  var tplBar = "SELECT data->>'__DIM__' AS label, SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY current_value DESC LIMIT 10"

  var tplLine = "SELECT CONCAT(data->>'" + f.yf + "','-',LPAD(CAST((data->>'" + f.mf + "')::integer AS TEXT),2,'0')) AS period, __AGG__(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND (data->>'" + f.yf + "')::integer = " + f.curYear + " GROUP BY data->>'" + f.yf + "', data->>'" + f.mf + "' ORDER BY period ASC"

  var tplPie = "SELECT data->>'__DIM__' AS label, __AGG__(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY value DESC LIMIT 6"

  var tplScatter = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI1__')::numeric,0) ELSE NULL END) AS x_value, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI2__')::numeric,0) ELSE NULL END) AS y_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND " + f.curCond + " GROUP BY label"

  var tplArea = "SELECT CONCAT(data->>'" + f.yf + "','-',LPAD(CAST((data->>'" + f.mf + "')::integer AS TEXT),2,'0')) AS period, SUM(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND (data->>'" + f.yf + "')::integer = " + f.curYear + " GROUP BY data->>'" + f.yf + "', data->>'" + f.mf + "' ORDER BY period ASC"

  var systemMsg = 'You are a senior banking BI analyst and SQL engineer. Return only valid JSON. CRITICAL SQL RULES: (1) current_value uses ' + f.yf + '=' + f.curYear + ' and comparison_value uses ' + f.yf + '=' + f.cmpYear + ' — DIFFERENT years. (2) For point_in_time KPIs use T-PIT not T-SUM — never sum balance sheet items across months. (3) Use CASE WHEN to split periods. Never use IN. The year field is "' + f.yf + '" and month field is "' + f.mf + '" — always use these exact names.'

  var promptLines = [
    '## ROLE',
    'You are a senior banking BI analyst. Your job is to design the most insightful dashboard possible.',
    'You have been given REAL DATA ANALYSIS (pre-computed variance scores) to guide your decisions.',
    'Use this data — do not guess at which dimensions are interesting.',
    '',
    '## DATABASE',
    'Table: dataset_rows | data column is JSONB',
    "Text: data->>'field' | Numeric: COALESCE((data->>'field')::numeric, 0)",
    'All queries must include: WHERE dataset_id = ' + datasetId,
    '',
    '## SAMPLE DATA (all field names must match these keys exactly)',
    JSON.stringify(sampleData, null, 2),
    '',
    '## TIME PERIOD',
    'Year field: "' + f.yf + '" | Month field: "' + f.mf + '" — use ONLY these field names in WHERE conditions.',
    'Current period  : ' + f.viewLabel + '  |  WHERE: ' + f.curCond,
    'Comparison period: ' + f.cmpLabel + '  |  WHERE: ' + f.cmpCond,
    'Current PIT (latest month only): WHERE: ' + f.curCondPIT,
    'Comparison PIT (latest month only): WHERE: ' + f.cmpCondPIT,
    'current year = ' + f.curYear + '  |  comparison year = ' + f.cmpYear,
    '',
  ].concat(userContext && (userContext.filters.length || userContext.kpi_focus.length || userContext.intent) ? [
    '## USER CONTEXT (applied to this dashboard)',
    userContext.explanation || '',
    userContext.filters && userContext.filters.length
      ? 'Active filters: ' + userContext.filters.map(function(fi) { return fi.field + ' ' + fi.operator + ' ' + fi.value }).join(', ')
      : '',
    userContext.kpi_focus && userContext.kpi_focus.length
      ? 'KPI focus fields: ' + userContext.kpi_focus.join(', ') + ' — PRIORITISE these in chart selection and KPI cards. Allocate at least 60% of chart slots to these KPIs and their breakdowns. Other KPIs may still appear but should receive fewer chart slots.'
      : '',
    userContext.intent && userContext.intent.type
      ? 'User intent: ' + userContext.intent.type + ' — ' + (userContext.intent.summary || '') +
        '. NOTE: Intent-specific queries are appended automatically after your output. ' +
        'Do NOT generate a separate ranking chart for ' + (userContext.intent.primary_entity || 'the same entity') + ' — that is handled by intent queries.'
      : '',
    'NOTE: All SQL templates already include the context filter — do NOT add extra WHERE conditions for the filter.',
    '',
  ] : []).concat([
    '## SQL TEMPLATES (replace __FIELD__, __KPI__, __DIM__, __AGG__, __DIST_FIELD__ with actual values)',
    'T-SUM (KPI card, cumulative — sums across full period): ' + tplSum,
    'T-PIT (KPI card, point_in_time — single latest month only): ' + tplPIT,
    'T-AVG (KPI card, legacy average — avoid, use T-PIT instead): ' + tplAvg,
    'T-COUNT-DISTINCT (KPI card, count distinct at latest month): ' + tplCountDistinct,
    'T-COUNT-DISTINCT-BAR (bar with count distinct): ' + tplCountDistinctBar,
    'T-BAR (grouped bar): ' + tplBar,
    'T-LINE (trend line): ' + tplLine,
    'T-PIE (pie/donut): ' + tplPie,
    'T-SCATTER (scatter): ' + tplScatter,
    'T-AREA (area chart): ' + tplArea,
    '',
    '## ACCUMULATION TYPE — CRITICAL',
    'Each KPI has an accumulation_type. This determines which KPI card template to use:',
    '  cumulative    → T-SUM  (Revenue, Fees, new customers — things that ADD UP over a period)',
    '  point_in_time → T-PIT  (Loans Balance, Deposits Balance, AUM — snapshot at latest month)',
    'WRONG: Using T-SUM for Loans Balance in YTD Jan–Mar would sum Jan+Feb+Mar balances = 3x inflated.',
    'RIGHT: T-PIT returns the Mar balance only vs Mar prior year.',
    'Rule: check accumulation_type for EVERY KPI field — use T-SUM for cumulative, T-PIT for point_in_time.',
    '',
    '## FIELD CATALOGUE',
    'KPI fields: ' + JSON.stringify(fieldList(topKpis)),
    'Derived KPIs: ' + JSON.stringify(fieldList(topDerived)),
    'Dimensions: ' + JSON.stringify(dims.map(function(d) { return { field_name: d.field_name, display_name: d.display_name } })),
    '',
    '## ACCUMULATION TYPE',
    'cumulative → SUM | point_in_time → AVG. Check accumulation_type on each field.',
    '',
    '## FAVORABLE DIRECTION',
    'Each KPI has a favorable_direction: "i" = increase is good (revenue, income, customers)',
    '"d" = decrease is good (cost, NPA ratio, expenses, churn).',
    'Use this when writing the insight field — frame changes correctly.',
    'E.g. if NPA ratio (d) is rising, the insight should flag this as a risk, not growth.',
    '',
    '## PRE-ANALYSIS: DATA-DRIVEN VARIANCE SCORES (computed from actual data)',
    preAnalysisText,
    '',
    '## YOUR INTELLIGENT DESIGN TASK',
    '',
    'STEP 1 — KPI Cards (max 8 total, 4 per row × 2 rows):',
    '  - Generate one kpi card for EACH of the top-priority KPI and derived_kpi fields',
    '  - Cap at 8 total KPI cards — prioritise by business_priority (High first)',
    '  - Use T-SUM for cumulative fields',
    '  - Use T-PIT for point_in_time fields (balance sheet / stock items) — NOT T-SUM',
    '  - Use T-COUNT-DISTINCT for any field whose calculation_logic contains "Distinct" or aggregation = "COUNT_DISTINCT"',
    '    Replace __DIST_FIELD__ with the raw field name from the dependencies column',
    '    Example: # Accounts (dependencies: Account) → __DIST_FIELD__ = Account',
    '',
    'STEP 2 — Charts (generate 8-12 charts):',
    '  DIMENSION SELECTION RULES (enforce strictly):',
    '    - For each KPI, use the dimension with the HIGHEST CV from the pre-analysis above',
    '    - Only use a dimension with CV < 0.05 if no better option exists',
    '    - When a top_outlier is present (a segment diverging from peers), call it out in the insight field',
    '    - Prefer dimensions where the top and worst segments show meaningful divergence',
    '',
      '  CHART TYPE RULES:',
    '    bar         → compare a KPI across categories (use highest-CV dimension)',
    '                  MANDATORY: bar charts MUST include comparison_key: "comparison_value" in the output JSON.',
    '                  MANDATORY: bar chart SQL MUST include the comparison_value column using the cmpCond.',
    '                  A bar chart without comparison bars is useless — always show current vs prior.',
    '    line        → trend over time (best for cumulative flow metrics)',
    '    area        → trend with visual weight (best for revenue/profit over time)',
    '    donut       → distribution/share (segment mix, top 5-6 slices)',
    '    pie         → fewer than 5 categories only',
    '    stacked_bar → composition over time (e.g. revenue by segment by month)',
    '    scatter     → correlation between two ratio/rate KPIs',
    '',
    '  MANDATORY CHART MIX (strictly enforce):',
    '  - EXACTLY 2 area or line charts for the top flow KPIs (Revenue, Loans, Deposits or similar)',
    '  - AT LEAST 1 donut chart showing segment distribution for a top KPI',
    '  - AT LEAST 1 scatter if two or more ratio/rate KPIs exist',
    '  - Remaining slots filled with bar charts',
    '',
    '  DIMENSION VARIETY RULE (strictly enforce):',
    '  - NO single dimension may appear in more than 2 bar charts across the entire output',
    '  - You MUST use at least 3 different dimensions across all bar charts',
    '  - Use the highest-CV dimension for each KPI individually — do NOT reuse the same dimension for every KPI',
    '  - Valid dimensions to rotate through: ' + dims.slice(0,8).map(function(d) { return d.field_name }).join(', '),
    '',
    '  INSIGHT FIELD RULES:',
    '    - Always reference the outlier segment when pre-analysis shows one (e.g. "North region is +34% above peer average")',
    '    - Always mention YoY direction if pre-analysis shows it',
    '    - Be specific — name actual segments, not generic descriptions',
    '',
    '## OUTPUT FORMAT — JSON only, no markdown',
    '{',
    '  "queries": [',
    '    {',
    '      "id": "string (snake_case unique)",',
    '      "title": "string (executive-friendly, e.g. Net Interest Income by Region)",',
    '      "chart_type": "kpi|bar|line|area|pie|donut|stacked_bar|scatter",',
    '      "sql": "string (complete valid SQL, no placeholders)",',
    '      "current_key": "current_value (for kpi/bar)",',
    '      "comparison_key": "comparison_value (for kpi/bar)",',
    '      "value_key": "value or current_value (main numeric alias)",',
    '      "label_key": "label or period (category/time alias)",',
    '      "series_keys": ["array", "for", "stacked_bar", "only"],',
    '      "x_key": "x_value (scatter only)",',
    '      "y_key": "y_value (scatter only)",',
    '      "unit": "USD|%|count|etc",',
    '      "insight": "one sentence with specific segment names and numbers from pre-analysis",',
    '      "priority": 1',
    '    }',
    '  ]',
    '}',
    '',
    'Order by priority: KPI cards first (priority 1-8), then charts by insight value.',
    'Generate all KPI cards + all charts you deem insightful. Do not artificially limit.',
  ])

  var prompt = promptLines.join('\n')

  console.log('=== generate-queries: curCond=' + f.curCond)
  console.log('=== generate-queries: cmpCond=' + f.cmpCond)

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 6000,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user',   content: prompt },
        ],
      }),
    })

    var json = await response.json()
    if (!response.ok) {
      throw new Error((json.error && json.error.message) ? json.error.message : 'OpenAI error ' + response.status)
    }

    var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
    if (!content) throw new Error('Empty response from OpenAI')

    var cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim()
    var parsed
    try { parsed = JSON.parse(cleaned) } catch (e) {
      throw new Error('Could not parse JSON: ' + cleaned.slice(0, 300))
    }

    var queries = parsed.queries || parsed
    if (!Array.isArray(queries)) throw new Error('Expected queries array, got: ' + typeof queries)

    queries.sort(function(a, b) { return (a.priority || 99) - (b.priority || 99) })

    // Append intent-specific bonus queries
    var intent = userContext && userContext.intent ? userContext.intent : null
    if (intent && intent.type && intent.type !== 'null') {
      var intentQueries = buildIntentQueries(intent, datasetId, f, CF)
      console.log('=== Intent queries built: ' + intentQueries.length + ' (' + intent.type + ')')
      queries = queries.concat(intentQueries)
    }

    console.log('=== Queries generated: ' + queries.length)

    var usage = json.usage || {}

    // Build coverage data — summarises every decision made so CoveragePanel can explain them
    var generatedKpiIds  = new Set(queries.filter(function(q) { return q.chart_type === 'kpi' }).map(function(q) { return q.id }))
    var generatedChartSignatures = new Set(queries.filter(function(q) { return q.chart_type !== 'kpi' }).map(function(q) { return q.title }))

    var allKpis = metaRows.filter(function(m) { return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N' })
    var kpiCoverage = allKpis.map(function(m) {
      var inTopKpis  = topKpis.concat(topDerived).some(function(k) { return k.field_name === m.field_name })
      var hasKpiCard = queries.some(function(q) { return q.chart_type === 'kpi' && (q.id === m.field_name || (q.title || '').toLowerCase().includes((m.display_name || '').toLowerCase())) })
      var reason = hasKpiCard ? 'shown'
        : !inTopKpis         ? 'not_in_topkpis'
        :                      'cap_hit'
      return { field_name: m.field_name, display_name: m.display_name, type: m.type, business_priority: m.business_priority, accumulation_type: m.accumulation_type, aggregation: m.aggregation, reason }
    })

    var dimCoverage = preAnalysis.map(function(r) {
      var cvNum = parseFloat(r.cv) || 0
      var charted = queries.some(function(q) {
        return q.chart_type !== 'kpi' && q.sql && q.sql.indexOf("'" + r.kpi_field + "'") >= 0 && q.sql.indexOf("'" + r.dim_field + "'") >= 0
      })
      return {
        kpi_field: r.kpi_field, kpi_display: r.kpi_display,
        dim_field:  r.dim_field,  dim_display:  r.dim_display,
        cv: r.cv, cv_label: r.cv_label,
        top_segment: r.top_segment, top_outlier: r.top_outlier,
        charted,
        reason: charted ? 'charted' : cvNum < 0.05 ? 'flat' : cvNum < 0.15 ? 'low_cv' : 'not_selected',
      }
    })

    return Response.json({
      queries,
      model:       'gpt-4o',
      metadata:    metaRows,
      timePeriod,
      periodInfo:  { viewLabel: f.viewLabel, cmpLabel: f.cmpLabel },
      preAnalysis,
      coverageData: { kpiCoverage, dimCoverage, kpiCapUsed: kpiCoverage.filter(function(k) { return k.reason === 'shown' }).length, kpiCapMax: 8 },
      usage:       { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o' },
    })
  } catch (err) {
    console.error('generate-queries error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate queries.' }, { status: 500 })
  }
}
