import { FISCAL_START_MONTH, MONTH_SHORT, toFiscal, fiscalRangeLabel } from './fiscal-config'

function quarterStart(m) { return Math.floor((m - 1) / 3) * 3 + 1 }
function isFiscalField(yf) { return /fiscal/i.test(yf || '') }

// ── Shared period filter builder ─────────────────────────────────────────
// Produces period conditions for wide + long format queries.
// Handles fiscal vs calendar, MTD/YTD/QTD, YoY/MoM/QoQ, PIT vs cumulative.
export function buildPeriodFilters(tp) {
  var vt = tp.viewType; var yr = parseInt(tp.year); var mo = parseInt(tp.month)
  var ct = tp.comparisonType; var yf = tp.yearField || 'year'; var mf = tp.monthField || 'month'
  var fiscal = isFiscalField(yf)
  var curYear, curMonthMin, curMonthMax, cmpYear, cmpMonthMin, cmpMonthMax, viewLabel, cmpLabel

  if (fiscal) {
    var cur = toFiscal(yr, mo); var curFM = cur.fiscalMonth
    curYear = mo >= FISCAL_START_MONTH ? yr + 1 : yr
    if (vt === 'MTD')      { curMonthMin = curFM; curMonthMax = curFM }
    else if (vt === 'YTD') { curMonthMin = 1; curMonthMax = curFM }
    else { var fqs = quarterStart(curFM); curMonthMin = fqs; curMonthMax = Math.min(curFM, fqs + 2) }
    if (ct === 'YoY')      { cmpYear = curYear - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax }
    else if (ct === 'MoM') {
      if (curFM === 1) { cmpYear = curYear - 1; cmpMonthMin = cmpMonthMax = 12 }
      else             { cmpYear = curYear; cmpMonthMin = cmpMonthMax = curFM - 1 }
    } else {
      var cqs = quarterStart(curFM)
      if (cqs <= 3) { cmpYear = curYear - 1; cmpMonthMin = cqs + 9; cmpMonthMax = cmpMonthMin + 2 }
      else          { cmpYear = curYear; cmpMonthMin = cqs - 3; cmpMonthMax = cmpMonthMin + 2 }
    }
    viewLabel = fiscalRangeLabel(yr, mo, curMonthMin, curMonthMax) + ' (' + vt + ')'
    var cmpTag = ct === 'YoY' ? '(YoY)' : ct === 'MoM' ? '(MoM)' : '(QoQ)'
    cmpLabel  = 'vs ' + fiscalRangeLabel(yr - 1, mo, cmpMonthMin, cmpMonthMax) + ' ' + cmpTag
  } else {
    curYear = yr
    curMonthMin = vt === 'MTD' ? mo : vt === 'YTD' ? 1 : quarterStart(mo)
    curMonthMax = mo
    if (ct === 'YoY')      { cmpYear = yr - 1; cmpMonthMin = curMonthMin; cmpMonthMax = curMonthMax }
    else if (ct === 'MoM') { cmpYear = mo === 1 ? yr - 1 : yr; cmpMonthMin = cmpMonthMax = mo === 1 ? 12 : mo - 1 }
    else { var cqs2 = quarterStart(mo); cmpYear = cqs2 <= 3 ? yr - 1 : yr; cmpMonthMin = cqs2 <= 3 ? cqs2 + 9 : cqs2 - 3; cmpMonthMax = cmpMonthMin + 2 }
    viewLabel = vt === 'MTD' ? MONTH_SHORT[mo-1] + ' ' + yr + ' (MTD)' : vt === 'YTD' ? 'Jan–' + MONTH_SHORT[mo-1] + ' ' + yr + ' (YTD)' : 'Q' + Math.ceil(mo/3) + ' ' + yr + ' (QTD)'
    if (ct === 'YoY')      cmpLabel = 'vs ' + (vt === 'MTD' ? MONTH_SHORT[mo-1] : vt === 'YTD' ? 'Jan–' + MONTH_SHORT[mo-1] : 'Q' + Math.ceil(mo/3)) + ' ' + cmpYear + ' (YoY)'
    else if (ct === 'MoM') cmpLabel = 'vs ' + MONTH_SHORT[cmpMonthMax-1] + ' ' + cmpYear + ' (MoM)'
    else                   cmpLabel = 'vs Q' + Math.ceil(cmpMonthMax/3) + ' ' + cmpYear + ' (QoQ)'
  }

  function cond(year, mMin, mMax) {
    var y = yf + ' = ' + year
    var m = mMin === mMax ? mf + ' = ' + mMax : mf + ' >= ' + mMin + ' AND ' + mf + ' <= ' + mMax
    return y + ' AND ' + m
  }

  return {
    curCond:    cond(curYear, curMonthMin, curMonthMax),
    cmpCond:    cond(cmpYear, cmpMonthMin, cmpMonthMax),
    curCondPIT: cond(curYear, curMonthMax, curMonthMax),
    cmpCondPIT: cond(cmpYear, cmpMonthMax, cmpMonthMax),
    curYear:    curYear,
    cmpYear:    cmpYear,
    viewLabel:  viewLabel,
    cmpLabel:   cmpLabel,
    yf:         yf,
    mf:         mf,
    fiscal:     fiscal,
  }
}
