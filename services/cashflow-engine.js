import { startOfDayUTC, endOfDayUTC, addDays } from '../utils/dateUtils.js';

/**
 * Core Cashflow Forecasting Engine
 * Pure functions - no side effects, fully testable
 * 
 * Algorithm:
 * Projected Cash Balance(t) = Current Bank Balance + Σ Expected Inflows(t) - Σ Expected Outflows(t)
 * 
 * Where:
 * - Expected Inflows(t): Sum of unpaid invoices with dueDate <= currentDate + t
 * - Expected Outflows(t): Sum of unpaid bills with dueDate <= currentDate + t
 */

/**
 * Compute daily cashflow forecast for N days
 * @param {Object} params
 * @param {number} params.currentBalance - Current bank balance
 * @param {Array} params.invoices - Array of invoice objects { amount, dueDate, status }
 * @param {Array} params.bills - Array of bill objects { amount, dueDate, status }
 * @param {number} params.days - Forecast horizon (default 90)
 * @param {Date} params.fromDate - Start date (default today)
 * @returns {Array} Daily forecast points
 */
export function computeForecast({
  currentBalance = 0,
  invoices = [],
  bills = [],
  days = 90,
  fromDate = new Date()
}) {
  const start = startOfDayUTC(fromDate);
  const forecast = [];
  let runningBalance = currentBalance;
  
  // Pre-filter and sort active items
  const activeInflows = invoices
    .filter(inv => inv.status !== 'PAID' && inv.status !== 'DRAFT' && inv.amount > 0)
    .map(inv => ({
      amount: Number(inv.amount),
      dueDate: startOfDayUTC(inv.dueDate),
      id: inv._id?.toString() || inv.id,
      invoiceNumber: inv.invoiceNumber
    }))
    .sort((a, b) => a.dueDate - b.dueDate);
  
  const activeOutflows = bills
    .filter(bill => bill.status !== 'PAID' && bill.amount > 0)
    .map(bill => ({
      amount: Number(bill.amount),
      dueDate: startOfDayUTC(bill.dueDate),
      id: bill._id?.toString() || bill.id,
      vendorName: bill.vendorName
    }))
    .sort((a, b) => a.dueDate - b.dueDate);
  
  // Pointer for efficient iteration
  let inflowIdx = 0;
  let outflowIdx = 0;
  
  for (let day = 0; day <= days; day++) {
    const currentDate = addDays(start, day);
    let dayInflows = 0;
    let dayOutflows = 0;
    const inflowDetails = [];
    const outflowDetails = [];
    
    // Collect inflows due on this day
    while (inflowIdx < activeInflows.length && activeInflows[inflowIdx].dueDate <= currentDate) {
      const inv = activeInflows[inflowIdx];
      dayInflows += inv.amount;
      inflowDetails.push({ amount: inv.amount, id: inv.id, invoiceNumber: inv.invoiceNumber });
      inflowIdx++;
    }
    
    // Collect outflows due on this day
    while (outflowIdx < activeOutflows.length && activeOutflows[outflowIdx].dueDate <= currentDate) {
      const bill = activeOutflows[outflowIdx];
      dayOutflows += bill.amount;
      outflowDetails.push({ amount: bill.amount, id: bill.id, vendorName: bill.vendorName });
      outflowIdx++;
    }
    
    runningBalance += dayInflows - dayOutflows;
    
    forecast.push({
      date: currentDate,
      dayIndex: day,
      inflows: dayInflows,
      outflows: dayOutflows,
      netFlow: dayInflows - dayOutflows,
      balance: runningBalance,
      inflowDetails,
      outflowDetails,
      isDeficit: runningBalance < 0
    });
  }
  
  return forecast;
}

/**
 * Get summary statistics from forecast
 */
export function getForecastSummary(forecast) {
  if (!forecast.length) return null;
  
  const lastDay = forecast[forecast.length - 1];
  const minBalanceDay = forecast.reduce((min, day) => 
    day.balance < min.balance ? day : min, forecast[0]);
  
  const deficitDays = forecast.filter(d => d.isDeficit);
  const firstDeficit = deficitDays[0] || null;
  
  return {
    finalBalance: lastDay.balance,
    minBalance: minBalanceDay.balance,
    minBalanceDate: minBalanceDay.date,
    firstDeficitDate: firstDeficit?.date || null,
    firstDeficitAmount: firstDeficit?.balance || null,
    totalInflows: forecast.reduce((sum, d) => sum + d.inflows, 0),
    totalOutflows: forecast.reduce((sum, d) => sum + d.outflows, 0),
    deficitDaysCount: deficitDays.length,
    projectedCash30Day: forecast[30]?.balance ?? lastDay.balance,
    projectedCash60Day: forecast[60]?.balance ?? lastDay.balance,
    projectedCash90Day: forecast[90]?.balance ?? lastDay.balance
  };
}

/**
 * What-If Simulation: Shift specific invoice due dates and recompute
 * @param {Object} params
 * @param {Array} params.forecast - Baseline forecast from computeForecast()
 * @param {Array} params.invoices - Original invoices array
 * @param {Array} params.bills - Original bills array
 * @param {number} params.currentBalance - Current bank balance
 * @param {Object} params.scenario - { invoiceId, shiftDays } or { clientId, shiftDays }
 * @returns {Object} Simulation result with new forecast and deficit analysis
 */
export function simulateWhatIf({
  forecast,
  invoices,
  bills,
  currentBalance,
  scenario
}) {
  const { invoiceId, clientId, shiftDays = 0 } = scenario;
  
  if (shiftDays === 0) {
    return { 
      ...getForecastSummary(forecast),
      scenario: 'baseline',
      forecast 
    };
  }
  
  // Create modified invoices array with shifted due dates
  const modifiedInvoices = invoices.map(inv => {
    const matches = invoiceId 
      ? (inv._id?.toString() === invoiceId || inv.id === invoiceId)
      : (clientId && inv.clientId?.toString() === clientId);
    
    if (matches && inv.status !== 'PAID' && inv.status !== 'DRAFT') {
      return {
        ...inv,
        dueDate: addDays(new Date(inv.dueDate), shiftDays)
      };
    }
    return inv;
  });
  
  // Recompute forecast with modified invoices
  const newForecast = computeForecast({
    currentBalance,
    invoices: modifiedInvoices,
    bills,
    days: forecast.length - 1,
    fromDate: forecast[0]?.date || new Date()
  });
  
  const summary = getForecastSummary(newForecast);
  const baselineSummary = getForecastSummary(forecast);
  
  return {
    scenario: `shift_${shiftDays > 0 ? '+' : ''}${shiftDays}d`,
    shiftDays,
    forecast: newForecast,
    summary,
    comparison: {
      balanceChange30Day: summary.projectedCash30Day - baselineSummary.projectedCash30Day,
      balanceChange90Day: summary.projectedCash90Day - baselineSummary.projectedCash90Day,
      newDeficit: summary.firstDeficitDate !== null,
      baselineDeficit: baselineSummary.firstDeficitDate !== null,
      deficitDateChanged: summary.firstDeficitDate?.getTime() !== baselineSummary.firstDeficitDate?.getTime(),
      worstCaseBalance: summary.minBalance
    }
  };
}

/**
 * Multi-scenario comparison for UI
 */
export function compareScenarios({
  currentBalance,
  invoices,
  bills,
  scenarios = [0, 7, 15, 30] // days to shift
}) {
  const baseline = computeForecast({ currentBalance, invoices, bills, days: 90 });
  const baselineSummary = getForecastSummary(baseline);
  
  const results = scenarios.map(shiftDays => {
    if (shiftDays === 0) {
      return { shiftDays: 0, label: 'Baseline', ...baselineSummary };
    }
    
    // Shift ALL unpaid invoices (worst case)
    const modifiedInvoices = invoices.map(inv => 
      inv.status !== 'PAID' && inv.status !== 'DRAFT'
        ? { ...inv, dueDate: addDays(new Date(inv.dueDate), shiftDays) }
        : inv
    );
    
    const forecast = computeForecast({
      currentBalance,
      invoices: modifiedInvoices,
      bills,
      days: 90
    });
    
    return { shiftDays, label: `+${shiftDays}d delay`, ...getForecastSummary(forecast) };
  });
  
  return {
    baseline: baselineSummary,
    scenarios: results,
    chartData: {
      labels: baseline.map(d => d.date),
      datasets: [
        {
          label: 'Baseline Balance',
          data: baseline.map(d => d.balance),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true
        },
        ...results.filter(r => r.shiftDays > 0).map((r, i) => ({
          label: r.label,
          data: computeForecast({
            currentBalance,
            invoices: invoices.map(inv => 
              inv.status !== 'PAID' && inv.status !== 'DRAFT'
                ? { ...inv, dueDate: addDays(new Date(inv.dueDate), r.shiftDays) }
                : inv
            ),
            bills,
            days: 90
          }).map(d => d.balance),
          borderColor: ['#EF4444', '#F59E0B', '#8B5CF6'][i % 3],
          backgroundColor: 'transparent',
          fill: false,
          borderDash: [5, 5]
        }))
      ]
    }
  };
}

/**
 * Get chart-ready data for dual bar chart (Inflows vs Outflows by month)
 */
export function getMonthlyChartData(forecast) {
  const monthly = new Map();
  
  forecast.forEach(day => {
    const monthKey = day.date.toISOString().slice(0, 7); // YYYY-MM
    if (!monthly.has(monthKey)) {
      monthly.set(monthKey, { inflows: 0, outflows: 0, balance: 0, month: monthKey });
    }
    const m = monthly.get(monthKey);
    m.inflows += day.inflows;
    m.outflows += day.outflows;
    m.balance = day.balance; // Last day of month balance
  });
  
  const sorted = Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
  
  return {
    labels: sorted.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(y, mo - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
    }),
    inflows: sorted.map(m => m.inflows),
    outflows: sorted.map(m => m.outflows),
    balances: sorted.map(m => m.balance)
  };
}

export default {
  computeForecast,
  getForecastSummary,
  simulateWhatIf,
  compareScenarios,
  getMonthlyChartData
};