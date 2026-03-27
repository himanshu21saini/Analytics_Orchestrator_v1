import { query } from '../../../lib/db'
import { FISCAL_START_MONTH, MONTH_SHORT, toFiscal, fiscalRangeLabel } from '../../../lib/fiscal-config'

var MONTHS = MONTH_SHORT

function quarterStart(m) { return Math.floor((m - 1) / 3) * 3 + 1 }

function isFiscalField(yearField) {
  return /fiscal/i.test(yearField || '')
}

function buildPeriodFilters(datasetId, tp) {
  var vt = tp.viewType
  var yr = parseInt(tp.year)
  var mo = parseInt(tp.month)
  var ct = tp.comparisonType
  var yf = tp.yearField  || 'year'
  var mf = tp.monthField || 'month'
  var fiscal = isFiscalField(yf)

  var curYear, curMonthMin, curMonthMax
  var cmpYear, cmpMonthMin, cmpMonthMax
  var viewLabel, cmpLabel

  if (fiscal) {
    var cur = toFiscal(yr, mo)
    var curFM = cur.fiscalMonth
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

    var curRange = fiscalRangeLabel(yr, mo, curMonthMin, curMonthMax)
    var cmpAsOfYr = yr - 1; var cmpAsOfMo = mo
    var cmpRange  = fiscalRangeLabel(cmpAsOfYr, cmpAsOfMo, cmpMonthMin, cmpMonthMax)
    var cmpTag    = ct === 'YoY' ? '(YoY)' : ct === 'MoM' ? '(MoM)' : '(QoQ)'
    viewLabel = curRange + ' (' + vt + ')'
    cmpLabel  = 'vs ' + cmpRange + ' ' + cmpTag

  } else {
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
  var curCondPIT = cond(curYear, curMonthMax, curMonthMax)
  var cmpCondPIT = cond(cmpYear, cmpMonthMax, cmpMonthMax)

  return { curCond, cmpCond, curCondPIT, cmpCondPIT, curYear, cmpYear, viewLabel, cmpLabel, yf, mf, fiscal }
}

// ── PRE-ANALYSIS ──────────────────────────────────────────────────────────────
async function runPreAnalysis(datasetId, kpis, dims, curCond, cmpCond, curCondPIT, cmpCondPIT) {
  var results = []
  var kpiSample = kpis.slice(0, 5)
  var dimSample = dims.slice(0, 6)

  for (var ki = 0; ki < kpiSample.length; ki++) {
    var kpi = kpiSample[ki]
    var isCountDistinct = /distinct/i.test(kpi.calculation_logic || '') || /count_distinct/i.test(kpi.aggregation || '')
    var distField = isCountDistinct ? (kpi.dependencies || kpi.field_name) : null
    var isPIT     = !isCountDistinct && kpi.accumulation_type === 'point_in_time'
    var agg       = isCountDistinct ? null : (isPIT ? 'AVG' : 'SUM')
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
        if (!rows || rows.length < 2) continue

        var curVals = rows.map(function(r) { return parseFloat(r.cur_val) || 0 })
        var mean    = curVals.reduce(function(a, b) { return a + b }, 0) / curVals.length
        if (mean === 0) continue

        var variance = curVals.reduce(function(acc, v) { return acc + Math.pow(v - mean, 2) }, 0) / curVals.length
        var stdDev   = Math.sqrt(variance)
        var cv       = stdDev / Math.abs(mean)

        var outliers = rows
          .map(function(r) {
            var cur = parseFloat(r.cur_val) || 0
            var cmp = parseFloat(r.cmp_val) || 0
            var devFromMean = ((cur - mean) / Math.abs(mean) * 100)
            var yoyDelta    = cmp !== 0 ? ((cur - cmp) / Math.abs(cmp) * 100) : null
            return { segment: r.segment, cur_val: cur, cmp_val: cmp, dev_from_mean_pct: devFromMean, yoy_delta_pct: yoyDelta }
          })
          .sort(function(a, b) { return Math.abs(b.dev_from_mean_pct) - Math.abs(a.dev_from_mean_pct) })

        var topOutlier   = outliers[0]
        var topSegment   = rows[0]
        var worstSegment = rows[rows.length - 1]

        results.push({
          kpi_field:     kpi.field_name,
          kpi_display:   kpi.display_name,
          kpi_unit:      kpi.unit || '',
          kpi_priority:  kpi.business_priority || 'medium',
          dim_field:     dim.field_name,
          dim_display:   dim.display_name,
          segment_count: rows.length,
          cv:            Math.round(cv * 1000) / 1000,
          cv_label:      cv > 0.3 ? 'high' : cv > 0.1 ? 'medium' : 'low',
          mean_val:      Math.round(mean * 100) / 100,
          top_segment:   topSegment ? { name: topSegment.segment, value: Math.round((parseFloat(topSegment.cur_val) || 0) * 100) / 100 } : null,
          worst_segment: worstSegment ? { name: worstSegment.segment, value: Math.round((parseFloat(worstSegment.cur_val) || 0) * 100) / 100 } : null,
          top_outlier:   topOutlier ? {
            name:              topOutlier.segment,
            dev_from_mean_pct: Math.round(topOutlier.dev_from_mean_pct * 10) / 10,
            yoy_delta_pct:     topOutlier.yoy_delta_pct !== null ? Math.round(topOutlier.yoy_delta_pct * 10) / 10 : null,
          } : null,
        })
      } catch (e) {
        console.warn('pre-analysis skip:', kpi.field_name, 'x', dim.field_name, e.message)
      }
    }
  }

  var priOrder = { high: 3, medium: 2, low: 1 }
  results.sort(function(a, b) {
    var pa = priOrder[a.kpi_priority.toLowerCase()] || 1
    var pb = priOrder[b.kpi_priority.toLowerCase()] || 1
    if (pa !== pb) return pb - pa
    return b.cv - a.cv
  })

  return results
}

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

  var byKpi = {}
  preAnalysis.forEach(function(r) {
    if (!byKpi[r.kpi_field]) byKpi[r.kpi_field] = []
    byKpi[r.kpi_field].push(r)
  })

  Object.keys(byKpi).forEach(function(kpiField) {
    var rows  = byKpi[kpiField]
    var first = rows[0]
    lines.push('── ' + first.kpi_display + ' (' + first.kpi_field + ', priority: ' + first.kpi_priority + ')')
    rows.forEach(function(r) {
      var outStr = ''
      if (r.top_outlier) {
        outStr = ' | outlier: ' + r.top_outlier.name +
          ' (' + (r.top_outlier.dev_from_mean_pct > 0 ? '+' : '') + r.top_outlier.dev_from_mean_pct + '% from mean' +
          (r.top_outlier.yoy_delta_pct !== null ? ', YoY: ' + (r.top_outlier.yoy_delta_pct > 0 ? '+' : '') + r.top_outlier.yoy_delta_pct + '%' : '') + ')'
      }
      var topStr  = r.top_segment ? ' | top: ' + r.top_segment.name : ''
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

function buildIntentQueries(intent, datasetId, f, CF, metaRows) {
  if (!intent || !intent.type || intent.type === "null") return []

  var queries = []
  var base = "FROM dataset_rows WHERE dataset_id = " + datasetId + " AND " + f.curCond + CF

  function aggFn(fieldName) {
    var normalised = (fieldName || '').toLowerCase()
    var meta = metaRows && metaRows.find(function(m) {
      return (m.field_name || '').toLowerCase() === normalised
    })
    if (meta) {
      var agg = (meta.aggregation || '').toUpperCase()
      if (agg === 'SUM')            return 'SUM'
      if (agg === 'AVG')            return 'AVG'
      if (agg === 'COUNT')          return 'COUNT'
      if (agg === 'MAX')            return 'MAX'
      if (agg === 'MIN')            return 'MIN'
      if (agg === 'COUNT_DISTINCT') return 'COUNT'
      if (meta.accumulation_type === 'cumulative')    return 'SUM'
      if (meta.accumulation_type === 'point_in_time') return 'AVG'
    }
    return 'AVG'
  }

  function safeIntOrder(field) {
    if (/sort|order|seq|num|idx|id$/i.test(field)) {
      return "CASE WHEN (data->>'" + field + "') ~ '^[0-9]+$' THEN (data->>'" + field + "')::integer ELSE 0 END ASC, data->>'" + field + "' ASC"
    }
    return "data->>'" + field + "' ASC"
  }

  if (intent.type === "ranking" || intent.type === "ranking_with_drilldown") {
    var entity = intent.primary_entity         || "branch_name"
    var metric = intent.primary_metric         || "bfi_2_score"
    var topN   = parseInt(intent.top_n)        || 10
    var dir    = (intent.direction || "desc").toUpperCase()
    var eDisp  = intent.primary_entity_display || entity
    var mDisp  = intent.primary_metric_display || metric

    var rankSQL = "SELECT data->>'" + entity + "' AS label, " +
      "" + aggFn(metric) + "(COALESCE((data->>'" + metric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + entity + "' IS NOT NULL AND data->>'" + entity + "' != '' " +
      "GROUP BY data->>'" + entity + "' ORDER BY current_value " + dir + " LIMIT " + topN

    queries.push({
      id: "intent_ranking_" + entity, title: mDisp + " by " + eDisp + " — Ranked",
      chart_type: "bar", sql: rankSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", unit: "", insight: "Ranks every " + eDisp + " by " + aggFn(metric).toLowerCase() + " " + mDisp + ".",
      priority: 50, intent_generated: true,
    })
  }

  if (intent.type === "ranking_with_drilldown") {
    var ddDim    = intent.drilldown_dimension    || "interval_sort_order"
    var ddLabel  = intent.drilldown_label_field  || ddDim
    var ddDisp   = intent.drilldown_display      || ddDim
    var ddMetric = intent.primary_metric         || "bfi_2_score"
    var ddEntity = intent.primary_entity         || "branch_name"
    var ddMDisp  = intent.primary_metric_display || ddMetric
    var ddEDisp  = intent.primary_entity_display || ddEntity
    var ddTopN   = parseInt(intent.top_n)        || 5

    var groupByDrill = ddDim !== ddLabel
      ? "GROUP BY data->>'" + ddLabel + "', data->>'" + ddDim + "'"
      : "GROUP BY data->>'" + ddLabel + "'"

    var drillSQL = "SELECT data->>'" + ddLabel + "' AS label, " +
      "" + aggFn(ddMetric) + "(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + ddLabel + "' IS NOT NULL " +
      groupByDrill + " ORDER BY " + safeIntOrder(ddDim)

    queries.push({
      id: "intent_drilldown_" + ddDim, title: ddMDisp + " across " + ddDisp + "s",
      chart_type: "line", sql: drillSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", unit: "", insight: aggFn(ddMetric) + " of " + ddMDisp + " per " + ddDisp.toLowerCase() + " across all entities.",
      priority: 52, intent_generated: true,
    })

    var groupByHeat = "GROUP BY data->>'" + ddEntity + "', data->>'" + ddLabel + "'" +
      (ddDim !== ddLabel ? ", data->>'" + ddDim + "'" : "")

    var subquery = "SELECT data->>'" + ddEntity + "' FROM dataset_rows " +
      "WHERE dataset_id = " + datasetId + " AND " + f.curCond + CF +
      " AND data->>'" + ddEntity + "' IS NOT NULL " +
      "GROUP BY data->>'" + ddEntity + "' " +
      "ORDER BY " + aggFn(ddMetric) + "(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) DESC " +
      "LIMIT " + ddTopN

    var heatSQL = "SELECT data->>'" + ddEntity + "' AS label, " +
      "data->>'" + ddLabel + "' AS slot, " +
      (ddDim !== ddLabel ? "data->>'" + ddDim + "' AS slot_sort, " : "data->>'" + ddLabel + "' AS slot_sort, ") +
      "" + aggFn(ddMetric) + "(COALESCE((data->>'" + ddMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + ddEntity + "' IN (" + subquery + ") " +
      groupByHeat + " ORDER BY data->>'" + ddEntity + "', " + safeIntOrder(ddDim)

    queries.push({
      id: "intent_heatmap_" + ddEntity + "_" + ddDim,
      title: "Top " + ddTopN + " " + ddEDisp + "s — " + ddMDisp + " by " + ddDisp,
      chart_type: "drilldown", sql: heatSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", slot_key: "slot", slot_sort_key: "slot_sort",
      entity_display: ddEDisp, slot_display: ddDisp, metric_display: ddMDisp,
      unit: "", insight: "Click any " + ddEDisp.toLowerCase() + " to see its " + ddDisp.toLowerCase() + " breakdown.",
      priority: 53, intent_generated: true,
    })
  }

  if (intent.type === "distribution") {
    var distDim    = intent.distribution_dimension || "Stress Type"
    var distMetric = intent.distribution_metric    || "bfi_2_score"

    var distSQL = "SELECT data->>'" + distDim + "' AS label, COUNT(*) AS current_value " +
      base + " AND data->>'" + distDim + "' IS NOT NULL AND data->>'" + distDim + "' != '' " +
      "GROUP BY data->>'" + distDim + "' ORDER BY current_value DESC"

    queries.push({
      id: "intent_dist_" + distDim.replace(/\s+/g, "_"), title: "Distribution by " + distDim,
      chart_type: "donut", sql: distSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", unit: "count", insight: "Spread of records across each " + distDim + " category.",
      priority: 50, intent_generated: true,
    })

    var distBarSQL = "SELECT data->>'" + distDim + "' AS label, " +
      "" + aggFn(distMetric) + "(COALESCE((data->>'" + distMetric + "')::numeric, 0)) AS current_value " +
      base + " AND data->>'" + distDim + "' IS NOT NULL " +
      "GROUP BY data->>'" + distDim + "' ORDER BY current_value DESC"

    queries.push({
      id: "intent_dist_bar_" + distDim.replace(/\s+/g, "_"), title: "Avg " + distMetric + " by " + distDim,
      chart_type: "bar", sql: distBarSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", unit: "", insight: aggFn(distMetric) + " of " + distMetric + " for each " + distDim + " category.",
      priority: 51, intent_generated: true,
    })
  }

  if (intent.type === "temporal") {
    var timeDim   = intent.time_dimension   || "interval_sort_order"
    var timeLabel = intent.time_label_field || timeDim
    var timeMet   = intent.temporal_metric  || "bfi_2_score"

    var groupByTemporal = timeDim !== timeLabel
      ? "GROUP BY data->>'" + timeLabel + "', data->>'" + timeDim + "'"
      : "GROUP BY data->>'" + timeLabel + "'"

    var temporalSQL = "SELECT data->>'" + timeLabel + "' AS label, " +
      "" + aggFn(timeMet) + "(COALESCE((data->>'" + timeMet + "')::numeric, 0)) AS current_value, " +
      "COUNT(*) AS record_count " +
      base + " AND data->>'" + timeLabel + "' IS NOT NULL " +
      groupByTemporal + " ORDER BY " + safeIntOrder(timeDim)

    queries.push({
      id: "intent_temporal_" + timeDim, title: timeMet + " Pattern by " + (timeLabel !== timeDim ? timeLabel : timeDim),
      chart_type: "area", sql: temporalSQL, current_key: "current_value", value_key: "current_value",
      label_key: "label", unit: "", insight: "How " + timeMet + " evolves across each " + timeLabel + ".",
      priority: 50, intent_generated: true,
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

  var metadataSetId    = body.metadataSetId
  var datasetId        = body.datasetId
  var timePeriod       = body.timePeriod || { viewType: 'YTD', year: 2024, month: 12, comparisonType: 'YoY' }
  var userContext      = body.userContext      || null
  var mandatoryFilters = body.mandatoryFilters || []   // ── NEW

  if (!metadataSetId || !datasetId) {
    return Response.json({ error: 'metadataSetId and datasetId are required.' }, { status: 400 })
  }

  // ── Build context filter SQL ──────────────────────────────────────────────
  var contextFilterSQL = ''
  if (userContext && userContext.filters && userContext.filters.length) {
    contextFilterSQL = userContext.filters.map(function(f) {
      var op  = f.operator || '='
      var val = String(f.value || '').replace(/'/g, "''")
      return "AND data->>'" + f.field + "' " + op + " '" + val + "'"
    }).join(' ')
  }

  // ── Build mandatory filter SQL ────────────────────────────────────────────
  var mandatoryFilterSQL = ''
  if (mandatoryFilters && mandatoryFilters.length) {
    mandatoryFilterSQL = mandatoryFilters.map(function(f) {
      var val = String(f.value || '').replace(/'/g, "''")
      return " AND data->>'" + f.field + "' = '" + val + "'"
    }).join('')
  }

  function applyFocusPriority(kpiArray) {
    if (!userContext || !userContext.kpi_focus || !userContext.kpi_focus.length) return kpiArray
    var focus = userContext.kpi_focus
    return kpiArray.slice().sort(function(a, b) {
      var aFocus = focus.indexOf(a.field_name) >= 0 ? 1 : 0
      var bFocus = focus.indexOf(b.field_name) >= 0 ? 1 : 0
      return bFocus - aFocus
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

  var kpis    = metaRows.filter(function(m) { return m.type === 'kpi'         && m.is_output !== 'N' }).sort(function(a,b) { return pri(b)-pri(a) })
  var derived = metaRows.filter(function(m) { return m.type === 'derived_kpi' && m.is_output !== 'N' })
  var dims    = metaRows.filter(function(m) { return m.type === 'dimension'   && m.is_output !== 'N' })

  kpis    = applyFocusPriority(kpis)
  derived = applyFocusPriority(derived)

  var topKpis    = kpis.slice(0, 6)
  var topDerived = derived.slice(0, 4)

  // ── CF = context filters + mandatory filters ──────────────────────────────
  var CF = (contextFilterSQL ? ' ' + contextFilterSQL : '') + mandatoryFilterSQL

  var contextCurCond    = f.curCond    + (CF ? ' ' + CF.trim() : '')
  var contextCmpCond    = f.cmpCond    + (CF ? ' ' + CF.trim() : '')
  var contextCurCondPIT = f.curCondPIT + (CF ? ' ' + CF.trim() : '')
  var contextCmpCondPIT = f.cmpCondPIT + (CF ? ' ' + CF.trim() : '')

  console.log('=== pre-analysis: running', topKpis.length, 'KPIs ×', dims.length, 'dims')
  var preAnalysis = await runPreAnalysis(datasetId, topKpis, dims, contextCurCond, contextCmpCond, contextCurCondPIT, contextCmpCondPIT)
  var preAnalysisText = formatPreAnalysis(preAnalysis)
  console.log('=== pre-analysis: done,', preAnalysis.length, 'combinations scored')

  function fieldList(arr) {
    return arr.map(function(m) {
      return {
        field_name:          m.field_name,
        display_name:        m.display_name,
        unit:                m.unit || '',
        definition:          m.definition || '',
        aggregation:         m.aggregation || 'SUM',
        business_priority:   m.business_priority || 'Medium',
        accumulation_type:   m.accumulation_type || 'cumulative',
        favorable_direction: m.favorable_direction || 'i',
        calculation_logic:   m.type === 'derived_kpi' ? (m.calculation_logic || '') : undefined,
        dependencies:        m.type === 'derived_kpi' ? (m.dependencies || '') : undefined,
        benchmark:           m.benchmark || '',
      }
    })
  }

  // SQL templates
  var tplSum  = "SELECT SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF
  var tplPIT  = "SELECT AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCondPIT + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF
  var tplAvg  = "SELECT AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__FIELD__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF
  var tplCountDistinct    = "SELECT COUNT(DISTINCT CASE WHEN " + f.curCondPIT + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN " + f.cmpCondPIT + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF
  var tplCountDistinctBar = "SELECT data->>'__DIM__' AS label, COUNT(DISTINCT CASE WHEN " + f.curCond + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS current_value, COUNT(DISTINCT CASE WHEN " + f.cmpCond + " THEN data->>'__DIST_FIELD__' ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY current_value DESC LIMIT 10"
  var tplBar  = "SELECT data->>'__DIM__' AS label, SUM(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS current_value, SUM(CASE WHEN " + f.cmpCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY current_value DESC LIMIT 10"
  var tplBarPIT = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE NULL END) AS current_value, AVG(CASE WHEN " + f.cmpCondPIT + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE NULL END) AS comparison_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY current_value DESC LIMIT 10"
  var tplPiePIT = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE NULL END) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY value DESC LIMIT 6"
  var tplScatterPIT = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__KPI1__')::numeric,0) ELSE NULL END) AS x_value, AVG(CASE WHEN " + f.curCondPIT + " THEN COALESCE((data->>'__KPI2__')::numeric,0) ELSE NULL END) AS y_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND " + f.curCondPIT + " GROUP BY label"
  var tplLine = "SELECT CONCAT(data->>'" + f.yf + "','-',LPAD(CAST((data->>'" + f.mf + "')::integer AS TEXT),2,'0')) AS period, __AGG__(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND (data->>'" + f.yf + "')::integer = " + f.curYear + " GROUP BY data->>'" + f.yf + "', data->>'" + f.mf + "' ORDER BY period ASC"
  var tplPie  = "SELECT data->>'__DIM__' AS label, __AGG__(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI__')::numeric,0) ELSE 0 END) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " GROUP BY label ORDER BY value DESC LIMIT 6"
  var tplScatter = "SELECT data->>'__DIM__' AS label, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI1__')::numeric,0) ELSE NULL END) AS x_value, AVG(CASE WHEN " + f.curCond + " THEN COALESCE((data->>'__KPI2__')::numeric,0) ELSE NULL END) AS y_value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND " + f.curCond + " GROUP BY label"
  var tplArea = "SELECT CONCAT(data->>'" + f.yf + "','-',LPAD(CAST((data->>'" + f.mf + "')::integer AS TEXT),2,'0')) AS period, SUM(COALESCE((data->>'__KPI__')::numeric,0)) AS value FROM dataset_rows WHERE dataset_id = " + datasetId + CF + " AND (data->>'" + f.yf + "')::integer = " + f.curYear + " GROUP BY data->>'" + f.yf + "', data->>'" + f.mf + "' ORDER BY period ASC"

  // ── Mandatory filters note for prompt ─────────────────────────────────────
  var mandatoryPromptNote = mandatoryFilters && mandatoryFilters.length
    ? '\n## MANDATORY FILTERS (pre-applied to all SQL templates above — DO NOT add them again)\n' +
      mandatoryFilters.map(function(f) {
        return '  ' + (f.display_name || f.field) + ' = "' + f.value + '"'
      }).join('\n')
    : ''

  var systemMsg = 'You are a senior banking BI analyst and SQL engineer. Return only valid JSON. CRITICAL SQL RULES: (1) current_value uses ' + f.yf + '=' + f.curYear + ' and comparison_value uses ' + f.yf + '=' + f.cmpYear + ' — DIFFERENT years. (2) For point_in_time KPIs use T-PIT not T-SUM — never sum balance sheet items across months. (3) Use CASE WHEN to split periods. Never use IN. The year field is "' + f.yf + '" and month field is "' + f.mf + '" — always use these exact names.'

  var promptLines = [
    '## ROLE',
    'You are a senior banking BI analyst. Your job is to design the most insightful dashboard possible.',
    'You have been given REAL DATA ANALYSIS (pre-computed variance scores) to guide your decisions.',
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
    mandatoryPromptNote,
    '',
  ].concat(userContext && (userContext.filters.length || userContext.kpi_focus.length || userContext.intent) ? [
    '## USER CONTEXT (applied to this dashboard)',
    userContext.explanation || '',
    userContext.filters && userContext.filters.length
      ? 'Active filters: ' + userContext.filters.map(function(fi) { return fi.field + ' ' + fi.operator + ' ' + fi.value }).join(', ')
      : '',
    userContext.kpi_focus && userContext.kpi_focus.length
      ? 'KPI focus fields: ' + userContext.kpi_focus.join(', ') + ' — PRIORITISE these in chart selection and KPI cards.'
      : '',
    userContext.intent && userContext.intent.type
      ? 'User intent: ' + userContext.intent.type + ' — ' + (userContext.intent.summary || '')
      : '',
    'NOTE: All SQL templates already include the context filter — do NOT add extra WHERE conditions for the filter.',
    '',
  ] : []).concat([
    '## SQL TEMPLATES (replace __FIELD__, __KPI__, __DIM__, __AGG__, __DIST_FIELD__ with actual values)',
    'T-SUM (KPI card, cumulative): ' + tplSum,
    'T-PIT (KPI card, point_in_time): ' + tplPIT,
    'T-AVG (KPI card, legacy average): ' + tplAvg,
    'T-COUNT-DISTINCT (KPI card, count distinct): ' + tplCountDistinct,
    'T-COUNT-DISTINCT-BAR (bar with count distinct): ' + tplCountDistinctBar,
    'T-BAR (grouped bar, cumulative KPIs): ' + tplBar,
    'T-BAR-PIT (grouped bar, point_in_time KPIs): ' + tplBarPIT,
    'T-LINE (trend line): ' + tplLine,
    'T-PIE (pie/donut, cumulative): ' + tplPie,
    'T-PIE-PIT (pie/donut, point_in_time): ' + tplPiePIT,
    'T-SCATTER (scatter, cumulative): ' + tplScatter,
    'T-SCATTER-PIT (scatter, point_in_time): ' + tplScatterPIT,
    'T-AREA (area chart): ' + tplArea,
    '',
    '## ACCUMULATION TYPE — CRITICAL',
    'KPI CARDS: cumulative → T-SUM | point_in_time → T-PIT',
    'BAR CHARTS: cumulative → T-BAR | point_in_time → T-BAR-PIT',
    'PIE/DONUT:  cumulative → T-PIE | point_in_time → T-PIE-PIT',
    'SCATTER:    cumulative → T-SCATTER | point_in_time → T-SCATTER-PIT',
    'LINE/AREA:  use __AGG__=AVG for point_in_time, SUM for cumulative.',
    '',
    '## FIELD CATALOGUE',
    'KPI fields: ' + JSON.stringify(fieldList(topKpis)),
    'Derived KPIs: ' + JSON.stringify(fieldList(topDerived)),
    'Dimensions: ' + JSON.stringify(dims.map(function(d) { return { field_name: d.field_name, display_name: d.display_name } })),
    '',
    '## FAVORABLE DIRECTION',
    '"i" = increase is good | "d" = decrease is good. Use when writing insight field.',
    '',
    '## PRE-ANALYSIS: DATA-DRIVEN VARIANCE SCORES',
    preAnalysisText,
    '',
    '## YOUR INTELLIGENT DESIGN TASK',
    '',
    'STEP 1 — KPI Cards (max 8 total):',
    '  - One kpi card per top-priority KPI and derived_kpi field',
    '  - cumulative → T-SUM | point_in_time → T-PIT | COUNT_DISTINCT → T-COUNT-DISTINCT',
    '',
    'STEP 2 — Charts (8-12 charts):',
    '  - For each KPI use the dimension with HIGHEST CV from pre-analysis',
    '  - EXACTLY 2 area or line charts for top flow KPIs',
    '  - AT LEAST 1 donut chart showing segment distribution',
    '  - AT LEAST 1 scatter if two or more ratio/rate KPIs exist',
    '  - NO single dimension in more than 2 bar charts',
    '  - bar MUST include comparison_key: "comparison_value"',
    '',
    '## OUTPUT FORMAT — JSON only, no markdown',
    '{',
    '  "queries": [',
    '    {',
    '      "id": "string (snake_case unique)",',
    '      "title": "string",',
    '      "chart_type": "kpi|bar|line|area|pie|donut|stacked_bar|scatter",',
    '      "sql": "string (complete valid SQL)",',
    '      "current_key": "current_value",',
    '      "comparison_key": "comparison_value",',
    '      "value_key": "value or current_value",',
    '      "label_key": "label or period",',
    '      "unit": "",',
    '      "insight": "one sentence with specific segment names",',
    '      "priority": 1',
    '    }',
    '  ]',
    '}',
  ])

  var prompt = promptLines.join('\n')

  console.log('=== generate-queries: curCond=' + f.curCond)
  console.log('=== generate-queries: cmpCond=' + f.cmpCond)
  console.log('=== generate-queries: mandatoryFilters=' + mandatoryFilters.length)

  try {
    var response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
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

    var intent = userContext && userContext.intent ? userContext.intent : null
    if (intent && intent.type && intent.type !== 'null') {
      var intentQueries = buildIntentQueries(intent, datasetId, f, CF, metaRows)
      console.log('=== Intent queries built: ' + intentQueries.length + ' (' + intent.type + ')')
      queries = queries.concat(intentQueries)
    }

    console.log('=== Queries generated: ' + queries.length)

    var usage = json.usage || {}

    var allKpis = metaRows.filter(function(m) { return (m.type === 'kpi' || m.type === 'derived_kpi') && m.is_output !== 'N' })
    var kpiCoverage = allKpis.map(function(m) {
      var inTopKpis  = topKpis.concat(topDerived).some(function(k) { return k.field_name === m.field_name })
      var hasKpiCard = queries.some(function(q) { return q.chart_type === 'kpi' && (q.id === m.field_name || (q.title || '').toLowerCase().includes((m.display_name || '').toLowerCase())) })
      var reason = hasKpiCard ? 'shown' : !inTopKpis ? 'not_in_topkpis' : 'cap_hit'
      return { field_name: m.field_name, display_name: m.display_name, type: m.type, business_priority: m.business_priority, accumulation_type: m.accumulation_type, aggregation: m.aggregation, reason }
    })

    var dimCoverage = preAnalysis.map(function(r) {
      var cvNum   = parseFloat(r.cv) || 0
      var charted = queries.some(function(q) {
        return q.chart_type !== 'kpi' && q.sql && q.sql.indexOf("'" + r.kpi_field + "'") >= 0 && q.sql.indexOf("'" + r.dim_field + "'") >= 0
      })
      return {
        kpi_field: r.kpi_field, kpi_display: r.kpi_display,
        dim_field: r.dim_field, dim_display: r.dim_display,
        cv: r.cv, cv_label: r.cv_label,
        top_segment: r.top_segment, top_outlier: r.top_outlier,
        charted,
        reason: charted ? 'charted' : cvNum < 0.05 ? 'flat' : cvNum < 0.15 ? 'low_cv' : 'not_selected',
      }
    })

    return Response.json({
      queries,
      model:      'gpt-4o',
      metadata:   metaRows,
      timePeriod,
      periodInfo: { viewLabel: f.viewLabel, cmpLabel: f.cmpLabel, yf: f.yf, mf: f.mf, curYear: f.curYear, curCond: f.curCond },
      preAnalysis,
      coverageData: { kpiCoverage, dimCoverage, kpiCapUsed: kpiCoverage.filter(function(k) { return k.reason === 'shown' }).length, kpiCapMax: 8 },
      usage: { prompt_tokens: usage.prompt_tokens || 0, completion_tokens: usage.completion_tokens || 0, model: 'gpt-4o' },
    })
  } catch (err) {
    console.error('generate-queries error:', err.message)
    return Response.json({ error: err.message || 'Failed to generate queries.' }, { status: 500 })
  }
}
