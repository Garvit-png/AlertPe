import express from 'express';
import { Invoice, Bill, Client } from '../models/index.js';
import { computeForecast, getForecastSummary, getMonthlyChartData } from '../services/cashflow-engine.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route GET /api/dashboard/stats
 * @desc Get aggregated dashboard statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const currentBalance = Number(process.env.CURRENT_BANK_BALANCE) || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Parallel queries for performance
  const [
    totalOwedResult,
    totalDueBillsResult,
    redFlagsResult,
    upcomingInflowsResult,
    upcomingOutflowsResult,
    invoices,
    bills
  ] = await Promise.all([
    // Total money owed (unpaid invoices)
    Invoice.aggregate([
      { $match: { status: { $nin: ['PAID', 'DRAFT'] } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    
    // Total upcoming bills (next 30 days)
    Bill.aggregate([
      { 
        $match: { 
          status: 'PENDING',
          dueDate: { $gte: today, $lte: new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000) }
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    
    // Red flags (overdue invoices)
    Invoice.countDocuments({ 
      status: { $in: ['PENDING', 'REMINDER_SENT'] },
      dueDate: { $lt: today }
    }),
    
    // Upcoming inflows (next 7 days)
    Invoice.find({
      status: { $nin: ['PAID', 'DRAFT'] },
      dueDate: { $gte: today, $lte: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) }
    })
      .sort({ dueDate: 1 })
      .limit(10)
      .lean()
      .populate('clientId', 'name'),
    
    // Upcoming outflows (next 7 days)
    Bill.find({
      status: 'PENDING',
      dueDate: { $gte: today, $lte: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) }
    })
      .sort({ dueDate: 1 })
      .limit(10)
      .lean(),
    
    // All active invoices for forecast
    Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } })
      .lean(),
    
    // All pending bills for forecast
    Bill.find({ status: 'PENDING' })
      .lean()
  ]);
  
  const totalOwed = totalOwedResult[0]?.total || 0;
  const totalOwedCount = totalOwedResult[0]?.count || 0;
  const totalDueBills = totalDueBillsResult[0]?.total || 0;
  const totalDueBillsCount = totalDueBillsResult[0]?.count || 0;
  
  // Compute 90-day forecast
  const forecast = computeForecast({
    currentBalance,
    invoices,
    bills,
    days: 90
  });
  
  const forecastSummary = getForecastSummary(forecast);
  const monthlyChartData = getMonthlyChartData(forecast);
  
  res.json({
    kpis: {
      totalOwed: {
        value: totalOwed,
        count: totalOwedCount,
        label: 'Total Money Owed'
      },
      totalDueBills: {
        value: totalDueBills,
        count: totalDueBillsCount,
        label: 'Upcoming Bills (30 days)'
      },
      projected30DayCash: {
        value: forecastSummary.projectedCash30Day,
        label: 'Projected 30-Day Cash'
      },
      redFlagsCount: {
        value: redFlagsResult,
        label: 'Overdue Invoices'
      },
      currentBalance: {
        value: currentBalance,
        label: 'Current Bank Balance'
      }
    },
    upcoming: {
      inflows: upcomingInflowsResult.map(inv => ({
        id: inv._id.toString(),
        invoiceNumber: inv.invoiceNumber,
        amount: inv.amount,
        dueDate: inv.dueDate,
        clientName: inv.clientId?.name || 'Unknown',
        daysUntilDue: Math.ceil((new Date(inv.dueDate) - today) / (1000 * 60 * 60 * 24))
      })),
      outflows: upcomingOutflowsResult.map(bill => ({
        id: bill._id.toString(),
        vendorName: bill.vendorName,
        amount: bill.amount,
        dueDate: bill.dueDate,
        category: bill.category,
        daysUntilDue: Math.ceil((new Date(bill.dueDate) - today) / (1000 * 60 * 60 * 24))
      }))
    },
    forecast: {
      summary: forecastSummary,
      monthlyChart: monthlyChartData,
      dailyData: forecast.slice(0, 91).map(d => ({
        date: d.date.toISOString().slice(0, 10),
        balance: d.balance,
        inflows: d.inflows,
        outflows: d.outflows,
        isDeficit: d.isDeficit
      }))
    }
  });
}));

/**
 * @route GET /api/dashboard/forecast
 * @desc Get detailed cashflow forecast
 * @query days (default 90)
 */
router.get('/forecast', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 90, 180);
  const currentBalance = Number(process.env.CURRENT_BANK_BALANCE) || 0;
  
  const [invoices, bills] = await Promise.all([
    Invoice.find({ status: { $nin: ['PAID', 'DRAFT'] } }).lean(),
    Bill.find({ status: 'PENDING' }).lean()
  ]);
  
  const forecast = computeForecast({
    currentBalance,
    invoices,
    bills,
    days
  });
  
  const summary = getForecastSummary(forecast);
  const monthlyChartData = getMonthlyChartData(forecast);
  
  res.json({
    summary,
    monthlyChart: monthlyChartData,
    dailyData: forecast.map(d => ({
      date: d.date.toISOString().slice(0, 10),
      balance: d.balance,
      inflows: d.inflows,
      outflows: d.outflows,
      netFlow: d.netFlow,
      isDeficit: d.isDeficit,
      inflowDetails: d.inflowDetails,
      outflowDetails: d.outflowDetails
    }))
  });
}));

export default router;