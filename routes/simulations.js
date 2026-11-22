import express from 'express';
import { z } from 'zod';
import { Invoice, Bill } from '../models/index.js';
import { simulateWhatIf, compareScenarios, computeForecast, getForecastSummary } from '../services/cashflow-engine.js';
import { validateBody, validateQuery, validateParams, simulateWhatIfSchema } from '../middleware/validate.js';
import { asyncHandler, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * @route POST /api/simulations/what-if
 * @desc Run cashflow stress test for specific invoice/client delay
 * @body { invoiceId?, clientId?, shiftDays }
 */
router.post('/what-if', validateBody(simulateWhatIfSchema), asyncHandler(async (req, res) => {
  const { invoiceId, clientId, shiftDays } = req.body;
  
  if (shiftDays === 0) {
    return res.status(400).json({
      error: 'shiftDays must be non-zero for simulation',
      code: 'INVALID_SHIFT'
    });
  }
  
  // Fetch current data
  const [invoices, bills] = await Promise.all([
    Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } }).lean(),
    Bill.find({ status: 'PENDING' }).lean()
  ]);
  
  const currentBalance = Number(process.env.CURRENT_BANK_BALANCE) || 0;
  
  // Compute baseline forecast
  const baselineForecast = computeForecast({
    currentBalance,
    invoices,
    bills,
    days: 90
  });
  
  // Run simulation
  const result = simulateWhatIf({
    forecast: baselineForecast,
    invoices,
    bills,
    currentBalance,
    scenario: { invoiceId, clientId, shiftDays }
  });
  
  // Format response for UI
  res.json({
    scenario: {
      invoiceId,
      clientId,
      shiftDays,
      label: shiftDays > 0 ? `+${shiftDays}d delay` : `${shiftDays}d early`
    },
    baseline: {
      projectedCash30Day: result.comparison ? 
        result.summary.projectedCash30Day - result.comparison.balanceChange30Day : 
        result.summary.projectedCash30Day,
      firstDeficitDate: result.comparison?.baselineDeficit ? 
        result.summary.firstDeficitDate : null
    },
    simulated: {
      projectedCash30Day: result.summary.projectedCash30Day,
      firstDeficitDate: result.summary.firstDeficitDate,
      firstDeficitAmount: result.summary.firstDeficitAmount,
      minBalance: result.summary.minBalance,
      minBalanceDate: result.summary.minBalanceDate,
      deficitDaysCount: result.summary.deficitDaysCount
    },
    comparison: {
      balanceChange30Day: result.comparison?.balanceChange30Day || 0,
      balanceChange90Day: result.comparison?.balanceChange90Day || 0,
      newDeficit: result.comparison?.newDeficit || false,
      baselineDeficit: result.comparison?.baselineDeficit || false,
      deficitDateChanged: result.comparison?.deficitDateChanged || false,
      worstCaseBalance: result.comparison?.worstCaseBalance || result.summary.minBalance
    },
    chartData: {
      labels: result.forecast.map(d => d.date.toISOString().slice(0, 10)),
      datasets: [
        {
          label: 'Baseline',
          data: baselineForecast.map(d => d.balance),
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.1
        },
        {
          label: `Simulated (${shiftDays > 0 ? '+' : ''}${shiftDays}d)`,
          data: result.forecast.map(d => d.balance),
          borderColor: '#EF4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          fill: true,
          tension: 0.1,
          borderDash: [5, 5]
        }
      ]
    }
  });
}));

/**
 * @route GET /api/simulations/compare
 * @desc Compare multiple delay scenarios
 * @query scenarios (comma-separated, default: 7,15,30)
 */
router.get('/compare', validateQuery(z.object({
  scenarios: z.string().optional()
})), asyncHandler(async (req, res) => {
  const scenarioStr = req.query.scenarios || '7,15,30';
  const scenarios = [0, ...scenarioStr.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))];
  
  const [invoices, bills] = await Promise.all([
    Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } }).lean(),
    Bill.find({ status: 'PENDING' }).lean()
  ]);
  
  const currentBalance = Number(process.env.CURRENT_BANK_BALANCE) || 0;
  
  const result = compareScenarios({
    currentBalance,
    invoices,
    bills,
    scenarios
  });
  
  res.json({
    scenarios: result.scenarios.map(s => ({
      shiftDays: s.shiftDays,
      label: s.label,
      projectedCash30Day: s.projectedCash30Day,
      projectedCash90Day: s.projectedCash90Day,
      firstDeficitDate: s.firstDeficitDate,
      minBalance: s.minBalance
    })),
    chartData: result.chartData
  });
}));

/**
 * @route GET /api/simulations/quick/:invoiceId
 * @desc Quick what-if for specific invoice (predefined delays)
 */
router.get('/quick/:invoiceId', validateParams(z.object({ 
  invoiceId: z.string().min(1) 
})), asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  
  // Verify invoice exists
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    throw new NotFoundError('Invoice');
  }
  
  const [invoices, bills] = await Promise.all([
    Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } }).lean(),
    Bill.find({ status: 'PENDING' }).lean()
  ]);
  
  const currentBalance = Number(process.env.CURRENT_BANK_BALANCE) || 0;
  
  // Test common scenarios
  const delays = [7, 15, 30];
  const results = [];
  
  for (const delay of delays) {
    const baselineForecast = computeForecast({ currentBalance, invoices, bills, days: 90 });
    const result = simulateWhatIf({
      forecast: baselineForecast,
      invoices,
      bills,
      currentBalance,
      scenario: { invoiceId, shiftDays: delay }
    });
    
    results.push({
      delayDays: delay,
      label: `+${delay} days`,
      deficitDetected: result.comparison.newDeficit && !result.comparison.baselineDeficit,
      deficitDate: result.summary.firstDeficitDate,
      deficitAmount: result.summary.firstDeficitAmount,
      balanceAtDay30: result.summary.projectedCash30Day,
      balanceChange: result.comparison.balanceChange30Day
    });
  }
  
  res.json({
    invoice: {
      id: invoice._id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      dueDate: invoice.dueDate,
      clientName: invoice.clientId?.name
    },
    scenarios: results,
    recommendation: results.find(r => r.deficitDetected) 
      ? `⚠️ Payment delay of ${results.find(r => r.deficitDetected).delayDays} days will cause cash deficit`
      : 'No immediate cash flow risk detected for tested delays'
  });
}));

export default router;