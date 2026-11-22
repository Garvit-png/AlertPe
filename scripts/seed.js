#!/usr/bin/env node

/**
 * Seed Script - Creates demo data for hackathon presentation
 * Run with: npm run seed
 */

import 'dotenv/config';
import { connectDB, disconnectDB } from '../services/db.js';
import { Client, Invoice, Bill } from '../models/index.js';
import { generateInvoiceNumber } from '../utils/invoiceNumber.js';
import logger from '../utils/logger.js';

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

async function seed() {
  try {
    await connectDB();
    logger.info('Connected to database, seeding demo data...');
    
    // Clear existing data for fresh seed
    await Promise.all([Client.deleteMany({}), Invoice.deleteMany({}), Bill.deleteMany({})]);
    
    // Create Clients
    const clients = await Client.create([
      {
        name: 'Rampal Enterprises',
        phone: '+919876543210',
        email: 'rampal@enterprises.com',
        businessCategory: 'Manufacturing',
        notes: 'Regular client, pays on time usually'
      },
      {
        name: 'Sharma Consulting',
        phone: '+919876543211',
        email: 'contact@sharma-consulting.in',
        businessCategory: 'Consulting',
        notes: 'Net 30 terms'
      },
      {
        name: 'Gupta Medical Store',
        phone: '+919876543212',
        email: 'gupta@medicalstore.com',
        businessCategory: 'Retail',
        notes: 'Small payments, frequent orders'
      },
      {
        name: 'Patel Design Studio',
        phone: '+919876543213',
        email: 'hello@pateldesign.com',
        businessCategory: 'Design',
        notes: 'Project-based billing'
      },
      {
        name: 'Singh Construction',
        phone: '+919876543214',
        email: 'billing@singhconstruction.in',
        businessCategory: 'Construction',
        notes: 'Large invoices, milestone payments'
      }
    ]);
    
    logger.info({ count: clients.length }, 'Clients created');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Create Invoices with various statuses
    const invoices = [];
    
    // 1. PAID invoice (recent)
    invoices.push({
      clientId: clients[0]._id,
      amount: 50000,
      description: 'Website Development - Phase 1',
      dueDate: addDays(today, -5),
      reminderIntervalDays: 2,
      status: 'PAID',
      paymentLink: 'https://rzp.io/i/paid_001',
      paymentGatewayId: 'plink_paid_001',
      transactionId: 'pay_demo_001',
      paidAt: addDays(today, -3)
    });
    
    // 2. PENDING - due in 3 days
    invoices.push({
      clientId: clients[1]._id,
      amount: 75000,
      description: 'Quarterly Consulting Retainer - Q4',
      dueDate: addDays(today, 3),
      reminderIntervalDays: 2,
      status: 'PENDING',
      paymentLink: 'https://rzp.io/i/pending_002',
      paymentGatewayId: 'plink_pending_002'
    });
    
    // 3. REMINDER_SENT - due tomorrow
    invoices.push({
      clientId: clients[2]._id,
      amount: 25000,
      description: 'Medical Supplies - Monthly Order',
      dueDate: addDays(today, 1),
      reminderIntervalDays: 2,
      status: 'REMINDER_SENT',
      lastReminderSentAt: addDays(today, -1),
      paymentLink: 'https://rzp.io/i/reminder_003',
      paymentGatewayId: 'plink_reminder_003'
    });
    
    // 4. OVERDUE - 5 days overdue
    invoices.push({
      clientId: clients[0]._id,
      amount: 120000,
      description: 'Raw Materials - Bulk Order',
      dueDate: addDays(today, -5),
      reminderIntervalDays: 2,
      status: 'OVERDUE',
      lastReminderSentAt: addDays(today, -1),
      paymentLink: 'https://rzp.io/i/overdue_004',
      paymentGatewayId: 'plink_overdue_004'
    });
    
    // 5. OVERDUE - 12 days overdue (RED FLAG)
    invoices.push({
      clientId: clients[3]._id,
      amount: 45000,
      description: 'Logo Design & Brand Guidelines',
      dueDate: addDays(today, -12),
      reminderIntervalDays: 2,
      status: 'OVERDUE',
      lastReminderSentAt: addDays(today, -1),
      paymentLink: 'https://rzp.io/i/overdue_005',
      paymentGatewayId: 'plink_overdue_005'
    });
    
    // 6. PENDING - due in 10 days
    invoices.push({
      clientId: clients[4]._id,
      amount: 200000,
      description: 'Construction Materials - Phase 2',
      dueDate: addDays(today, 10),
      reminderIntervalDays: 3,
      status: 'PENDING',
      paymentLink: 'https://rzp.io/i/pending_006',
      paymentGatewayId: 'plink_pending_006'
    });
    
    // 7. DRAFT - not sent yet
    invoices.push({
      clientId: clients[1]._id,
      amount: 30000,
      description: 'Additional Consulting Hours - November',
      dueDate: addDays(today, 15),
      reminderIntervalDays: 2,
      status: 'DRAFT'
    });
    
    // Create all invoices with auto-generated numbers
    const createdInvoices = [];
    for (const inv of invoices) {
      const invoiceNumber = await generateInvoiceNumber();
      const created = await Invoice.create({ ...inv, invoiceNumber });
      createdInvoices.push(created);
    }
    
    logger.info({ count: createdInvoices.length }, 'Invoices created');
    
    // Create Bills
    const bills = await Bill.create([
      {
        vendorName: 'Office Rent',
        amount: 45000,
        category: 'Rent',
        dueDate: addDays(today, 2), // Due in 2 days
        status: 'PENDING'
      },
      {
        vendorName: 'Employee Salaries - November',
        amount: 120000,
        category: 'Salaries',
        dueDate: addDays(today, 5),
        status: 'PENDING'
      },
      {
        vendorName: 'AWS Cloud Services',
        amount: 15000,
        category: 'Software',
        dueDate: addDays(today, 10),
        status: 'PENDING'
      },
      {
        vendorName: 'Electricity Bill',
        amount: 8000,
        category: 'Utilities',
        dueDate: addDays(today, -1), // Overdue! (will be marked overdue by virtual)
        status: 'PENDING'
      },
      {
        vendorName: 'Raw Material Supplier - ABC Corp',
        amount: 80000,
        category: 'Suppliers',
        dueDate: addDays(today, 15),
        status: 'PENDING'
      },
      {
        vendorName: 'Internet & Phone',
        amount: 3500,
        category: 'Utilities',
        dueDate: addDays(today, 7),
        status: 'PENDING'
      },
      {
        vendorName: 'Accountant Fees - Quarterly',
        amount: 25000,
        category: 'Software',
        dueDate: addDays(today, 20),
        status: 'PENDING'
      }
    ]);
    
    logger.info({ count: bills.length }, 'Bills created');
    
    // Summary
    const stats = {
      clients: clients.length,
      invoices: createdInvoices.length,
      bills: bills.length,
      totalOwed: createdInvoices
        .filter(i => i.status !== 'PAID' && i.status !== 'DRAFT')
        .reduce((sum, i) => sum + i.amount, 0),
      totalDueBills: bills
        .filter(b => b.status === 'PENDING')
        .reduce((sum, b) => sum + b.amount, 0),
      overdueInvoices: createdInvoices.filter(i => i.status === 'OVERDUE').length,
      overdueBills: bills.filter(b => b.status === 'OVERDUE').length
    };
    
    logger.info(stats, 'Seeding completed successfully!');
    
    console.log('\n📊 Demo Data Summary:');
    console.log('=====================');
    console.log(`Clients: ${stats.clients}`);
    console.log(`Invoices: ${stats.invoices} (${stats.overdueInvoices} overdue)`);
    console.log(`Bills: ${stats.bills} (${stats.overdueBills} overdue)`);
    console.log(`Total Owed: ₹${stats.totalOwed.toLocaleString('en-IN')}`);
    console.log(`Total Due Bills: ₹${stats.totalDueBills.toLocaleString('en-IN')}`);
    console.log('\n🎯 Ready for demo!');
    console.log('   - 2 overdue invoices (red flags)');
    console.log('   - 1 overdue bill (electricity)');
    console.log('   - Rent due in 2 days');
    console.log('   - Salaries due in 5 days');
    
  } catch (error) {
    logger.error({ err: error }, 'Seeding failed');
    throw error;
  } finally {
    await disconnectDB();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default seed;