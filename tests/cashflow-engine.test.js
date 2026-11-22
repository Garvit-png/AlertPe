import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  computeForecast,
  getForecastSummary,
  simulateWhatIf,
  compareScenarios,
  getMonthlyChartData
} from '../services/cashflow-engine.js';
import { addDays } from '../utils/dateUtils.js';

// Test data helpers
const createInvoice = (overrides = {}) => ({
  _id: `inv_${Math.random()}`,
  id: `inv_${Math.random()}`,
  invoiceNumber: `INV-20261122-${Math.random().toString(36).slice(2,6)}`,
  amount: 10000,
  dueDate: new Date('2026-12-01'),
  status: 'PENDING',
  ...overrides
});

const createBill = (overrides = {}) => ({
  _id: `bill_${Math.random()}`,
  id: `bill_${Math.random()}`,
  amount: 5000,
  dueDate: new Date('2026-12-05'),
  status: 'PENDING',
  vendorName: 'Test Vendor',
  ...overrides
});

describe('Cashflow Engine', () => {
  const today = new Date('2026-11-22');
  
  describe('computeForecast', () => {
    it('should return baseline balance when no invoices or bills', () => {
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [],
        bills: [],
        days: 30,
        fromDate: today
      });
      
      assert.strictEqual(forecast.length, 31);
      assert.strictEqual(forecast[0].balance, 50000);
      assert.strictEqual(forecast[30].balance, 50000);
      forecast.forEach(day => {
        assert.strictEqual(day.inflows, 0);
        assert.strictEqual(day.outflows, 0);
        assert.strictEqual(day.netFlow, 0);
      });
    });
    
    it('should add inflow on invoice due date', () => {
      const invoice = createInvoice({ amount: 25000, dueDate: new Date('2026-11-25') });
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [invoice],
        bills: [],
        days: 10,
        fromDate: today
      });
      
      assert.strictEqual(forecast[2].balance, 50000);
      assert.strictEqual(forecast[3].balance, 75000);
      assert.strictEqual(forecast[3].inflows, 25000);
      assert.strictEqual(forecast[10].balance, 75000);
    });
    
    it('should subtract outflow on bill due date', () => {
      const bill = createBill({ amount: 15000, dueDate: new Date('2026-11-25') });
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [],
        bills: [bill],
        days: 10,
        fromDate: today
      });
      
      assert.strictEqual(forecast[2].balance, 50000);
      assert.strictEqual(forecast[3].balance, 35000);
      assert.strictEqual(forecast[3].outflows, 15000);
      assert.strictEqual(forecast[10].balance, 35000);
    });
    
    it('should handle multiple invoices and bills on same day', () => {
      const invoices = [
        createInvoice({ amount: 10000, dueDate: new Date('2026-11-25') }),
        createInvoice({ amount: 15000, dueDate: new Date('2026-11-25') })
      ];
      const bills = [
        createBill({ amount: 5000, dueDate: new Date('2026-11-25') }),
        createBill({ amount: 8000, dueDate: new Date('2026-11-25') })
      ];
      
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices,
        bills,
        days: 5,
        fromDate: today
      });
      
      assert.strictEqual(forecast[3].inflows, 25000);
      assert.strictEqual(forecast[3].outflows, 13000);
      assert.strictEqual(forecast[3].netFlow, 12000);
      assert.strictEqual(forecast[3].balance, 62000);
    });
    
    it('should ignore PAID and DRAFT invoices', () => {
      const invoices = [
        createInvoice({ amount: 10000, status: 'PAID' }),
        createInvoice({ amount: 10000, status: 'DRAFT' }),
        createInvoice({ amount: 10000, status: 'PENDING', dueDate: new Date('2026-11-25') })
      ];
      
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices,
        bills: [],
        days: 5,
        fromDate: today
      });
      
      assert.strictEqual(forecast[3].inflows, 10000);
      assert.strictEqual(forecast[3].balance, 60000);
    });
    
    it('should ignore PAID bills', () => {
      const bills = [
        createBill({ amount: 10000, status: 'PAID' }),
        createBill({ amount: 10000, status: 'PENDING', dueDate: new Date('2026-11-25') })
      ];
      
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [],
        bills,
        days: 5,
        fromDate: today
      });
      
      assert.strictEqual(forecast[3].outflows, 10000);
      assert.strictEqual(forecast[3].balance, 40000);
    });
    
    it('should detect deficit correctly', () => {
      const bill = createBill({ amount: 60000, dueDate: new Date('2026-11-25') });
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [],
        bills: [bill],
        days: 5,
        fromDate: today
      });
      
      assert.strictEqual(forecast[2].isDeficit, false);
      assert.strictEqual(forecast[3].isDeficit, true);
      assert.strictEqual(forecast[3].balance, -10000);
    });
    
    it('should handle month boundary correctly', () => {
      const invoice = createInvoice({ amount: 10000, dueDate: new Date('2026-12-01') });
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [invoice],
        bills: [],
        days: 15,
        fromDate: today
      });
      
      assert.strictEqual(forecast[8].balance, 50000);
      assert.strictEqual(forecast[9].balance, 60000);
    });
    
    it('should handle leap year Feb 29', () => {
      const leapDay = new Date('2024-02-29');
      const invoice = createInvoice({ amount: 10000, dueDate: leapDay });
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [invoice],
        bills: [],
        days: 5,
        fromDate: new Date('2024-02-25')
      });
      
      assert.strictEqual(forecast[3].balance, 50000);
      assert.strictEqual(forecast[4].balance, 60000);
    });
  });
  
  describe('getForecastSummary', () => {
    it('should compute correct summary statistics', () => {
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [createInvoice({ amount: 30000, dueDate: new Date('2026-11-25') })],
        bills: [createBill({ amount: 20000, dueDate: new Date('2026-11-28') })],
        days: 60,
        fromDate: today
      });
      
      const summary = getForecastSummary(forecast);
      
      assert.strictEqual(summary.finalBalance, 60000);
      assert.strictEqual(summary.totalInflows, 30000);
      assert.strictEqual(summary.totalOutflows, 20000);
      assert.strictEqual(summary.deficitDaysCount, 0);
      assert.ok(summary.projectedCash30Day >= 50000);
    });
    
    it('should identify first deficit', () => {
      const forecast = computeForecast({
        currentBalance: 10000,
        invoices: [],
        bills: [createBill({ amount: 20000, dueDate: new Date('2026-11-25') })],
        days: 10,
        fromDate: today
      });
      
      const summary = getForecastSummary(forecast);
      
      assert.ok(summary.firstDeficitDate);
      assert.strictEqual(summary.firstDeficitAmount, -10000);
      assert.strictEqual(summary.deficitDaysCount, 8);
    });
  });
  
  describe('simulateWhatIf', () => {
    it('should return baseline when shiftDays is 0', () => {
      const invoices = [createInvoice({ amount: 20000, dueDate: new Date('2026-11-25') })];
      const bills = [createBill({ amount: 10000, dueDate: new Date('2026-11-28') })];
      const baseline = computeForecast({ currentBalance: 50000, invoices, bills, days: 30, fromDate: today });
      
      const result = simulateWhatIf({
        forecast: baseline,
        invoices,
        bills,
        currentBalance: 50000,
        scenario: { invoiceId: invoices[0].id, shiftDays: 0 }
      });
      
      assert.strictEqual(result.scenario, 'baseline');
      assert.strictEqual(result.finalBalance, 60000);
    });
    
    it('should shift specific invoice and recompute', () => {
      const invoice = createInvoice({ amount: 20000, dueDate: new Date('2026-11-25') });
      const bills = [createBill({ amount: 10000, dueDate: new Date('2026-11-28') })];
      const baseline = computeForecast({ currentBalance: 50000, invoices: [invoice], bills, days: 30, fromDate: today });
      
      const result = simulateWhatIf({
        forecast: baseline,
        invoices: [invoice],
        bills,
        currentBalance: 50000,
        scenario: { invoiceId: invoice.id, shiftDays: 15 }
      });
      
      assert.strictEqual(result.scenario, 'shift_+15d');
      // At day 15 (Dec 7), original invoice would be paid but shifted one isn't yet
      assert.ok(result.forecast[15].balance < baseline[15].balance);
      // balanceChange30Day is 0 because by day 30 both are paid - this is correct behavior
      // The difference shows up in intermediate days
      assert.strictEqual(result.comparison.balanceChange30Day, 0);
    });
    
    it('should shift all invoices for a client', () => {
      const invoices = [
        createInvoice({ id: 'inv1', amount: 10000, dueDate: new Date('2026-11-25'), clientId: 'client1' }),
        createInvoice({ id: 'inv2', amount: 15000, dueDate: new Date('2026-11-28'), clientId: 'client1' }),
        createInvoice({ id: 'inv3', amount: 5000, dueDate: new Date('2026-11-25'), clientId: 'client2' })
      ];
      const bills = [];
      const baseline = computeForecast({ currentBalance: 50000, invoices, bills, days: 30, fromDate: today });
      
      const result = simulateWhatIf({
        forecast: baseline,
        invoices,
        bills,
        currentBalance: 50000,
        scenario: { clientId: 'client1', shiftDays: 10 }
      });
      
      assert.strictEqual(result.scenario, 'shift_+10d');
      // At day 15, client1 invoices delayed so balance lower
      assert.ok(result.forecast[15].balance < baseline[15].balance);
    });
  });
  
  describe('compareScenarios', () => {
    it('should return multiple scenario comparisons', () => {
      const invoices = [createInvoice({ amount: 50000, dueDate: new Date('2026-11-25') })];
      const bills = [createBill({ amount: 30000, dueDate: new Date('2026-11-28') })];
      
      const result = compareScenarios({
        currentBalance: 50000,
        invoices,
        bills,
        scenarios: [0, 7, 15, 30]
      });
      
      assert.strictEqual(result.scenarios.length, 4);
      assert.strictEqual(result.scenarios[0].label, 'Baseline');
      assert.strictEqual(result.scenarios[1].label, '+7d delay');
      assert.strictEqual(result.scenarios[2].label, '+15d delay');
      assert.strictEqual(result.scenarios[3].label, '+30d delay');
      
      for (let i = 1; i < result.scenarios.length; i++) {
        assert.ok(result.scenarios[i].projectedCash30Day <= result.scenarios[i-1].projectedCash30Day);
      }
      
      assert.strictEqual(result.chartData.datasets.length, 4);
    });
  });
  
  describe('getMonthlyChartData', () => {
    it('should aggregate by month correctly', () => {
      const invoices = [
        createInvoice({ amount: 10000, dueDate: new Date('2026-11-15') }),
        createInvoice({ amount: 20000, dueDate: new Date('2026-12-10') })
      ];
      const bills = [
        createBill({ amount: 5000, dueDate: new Date('2026-11-20') }),
        createBill({ amount: 15000, dueDate: new Date('2026-12-05') })
      ];
      
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices,
        bills,
        days: 60,
        fromDate: today
      });
      
      const monthly = getMonthlyChartData(forecast);
      
      assert.ok(monthly.labels.includes('Nov 26'));
      assert.ok(monthly.labels.includes('Dec 26'));
      assert.strictEqual(monthly.inflows[0], 10000);
      assert.strictEqual(monthly.inflows[1], 20000);
      assert.strictEqual(monthly.outflows[0], 5000);
      assert.strictEqual(monthly.outflows[1], 15000);
    });
  });
  
  describe('Edge cases', () => {
    it('should handle zero amounts gracefully', () => {
      const forecast = computeForecast({
        currentBalance: 50000,
        invoices: [createInvoice({ amount: 0 })],
        bills: [createBill({ amount: 0 })],
        days: 5,
        fromDate: today
      });
      
      forecast.forEach(day => {
        assert.strictEqual(day.balance, 50000);
      });
    });
    
    it('should handle negative current balance', () => {
      const forecast = computeForecast({
        currentBalance: -10000,
        invoices: [],
        bills: [],
        days: 5,
        fromDate: today
      });
      
      assert.strictEqual(forecast[0].balance, -10000);
      assert.strictEqual(forecast[0].isDeficit, true);
    });
    
    it('should handle large numbers (crore+ scale)', () => {
      const forecast = computeForecast({
        currentBalance: 1_00_00_000,
        invoices: [createInvoice({ amount: 50_00_000, dueDate: new Date('2026-11-25') })],
        bills: [createBill({ amount: 30_00_000, dueDate: new Date('2026-11-28') })],
        days: 10,
        fromDate: today
      });
      
      assert.strictEqual(forecast[3].balance, 1_50_00_000);
      assert.strictEqual(forecast[6].balance, 1_20_00_000);
    });
  });
});

console.log('Running cashflow-engine tests...');