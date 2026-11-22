/**
 * Offline Store for Vercel / Disconnected Mode
 * Provides instant in-memory persistence when MongoDB URI is not yet configured or disconnected.
 */

let businessProfile = {
  _id: 'prof_default',
  id: 'prof_default',
  ownerName: 'Ajay Yadav',
  businessName: 'AlertPe Technologies',
  phone: '+917206178232',
  email: 'owner@alertpe.com',
  upiId: '7206178232@ptyes',
  isVerified: true,
  isSetupCompleted: true,
  sessionToken: 'active_session_token',
  lastLoginAt: new Date().toISOString()
};

const clients = [
  {
    _id: 'client_1',
    id: 'client_1',
    name: 'Rampal Enterprises',
    phone: '+919876543210',
    email: 'rampal@enterprises.com',
    businessCategory: 'Manufacturing',
    notes: 'Regular client, pays on time usually',
    createdAt: new Date().toISOString()
  },
  {
    _id: 'client_2',
    id: 'client_2',
    name: 'Sharma Consulting',
    phone: '+919876543211',
    email: 'contact@sharma-consulting.in',
    businessCategory: 'Consulting',
    notes: 'Net 30 terms',
    createdAt: new Date().toISOString()
  },
  {
    _id: 'client_3',
    id: 'client_3',
    name: 'Gupta Medical Store',
    phone: '+919876543212',
    email: 'gupta@medicalstore.com',
    businessCategory: 'Retail',
    notes: 'Small payments, frequent orders',
    createdAt: new Date().toISOString()
  },
  {
    _id: 'client_4',
    id: 'client_4',
    name: 'Patel Design Studio',
    phone: '+919876543213',
    email: 'hello@pateldesign.com',
    businessCategory: 'Design',
    notes: 'Project-based billing',
    createdAt: new Date().toISOString()
  },
  {
    _id: 'client_5',
    id: 'client_5',
    name: 'Singh Construction',
    phone: '+919876543214',
    email: 'billing@singhconstruction.in',
    businessCategory: 'Construction',
    notes: 'Large invoices, milestone payments',
    createdAt: new Date().toISOString()
  }
];

const now = new Date();
const addDays = (d, days) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

const invoices = [
  {
    _id: 'inv_1',
    id: 'inv_1',
    clientId: clients[0],
    invoiceNumber: 'INV-20261120-0001',
    amount: 75000,
    dueDate: addDays(now, 2),
    status: 'PENDING',
    paymentLink: 'https://rzp.io/i/mock_INV-001',
    description: 'Raw material supply delivery',
    reminderIntervalDays: 2,
    createdAt: now.toISOString()
  },
  {
    _id: 'inv_2',
    id: 'inv_2',
    clientId: clients[1],
    invoiceNumber: 'INV-20261120-0002',
    amount: 120000,
    dueDate: addDays(now, 5),
    status: 'REMINDER_SENT',
    paymentLink: 'https://rzp.io/i/mock_INV-002',
    description: 'Monthly ERP consulting retainer',
    reminderIntervalDays: 2,
    createdAt: now.toISOString()
  },
  {
    _id: 'inv_3',
    id: 'inv_3',
    clientId: clients[2],
    invoiceNumber: 'INV-20261120-0003',
    amount: 32000,
    dueDate: addDays(now, -3),
    status: 'OVERDUE',
    isOverdue: true,
    paymentLink: 'https://rzp.io/i/mock_INV-003',
    description: 'Bulk pharmaceuticals order',
    reminderIntervalDays: 1,
    createdAt: now.toISOString()
  },
  {
    _id: 'inv_4',
    id: 'inv_4',
    clientId: clients[3],
    invoiceNumber: 'INV-20261120-0004',
    amount: 45000,
    dueDate: addDays(now, -7),
    status: 'OVERDUE',
    isOverdue: true,
    paymentLink: 'https://rzp.io/i/mock_INV-004',
    description: 'UI/UX Redesign project completion',
    reminderIntervalDays: 1,
    createdAt: now.toISOString()
  },
  {
    _id: 'inv_5',
    id: 'inv_5',
    clientId: clients[4],
    invoiceNumber: 'INV-20261120-0005',
    amount: 250000,
    dueDate: addDays(now, 10),
    status: 'PENDING',
    paymentLink: 'https://rzp.io/i/mock_INV-005',
    description: 'Site civil works milestone payment',
    reminderIntervalDays: 3,
    createdAt: now.toISOString()
  }
];

const bills = [
  {
    _id: 'bill_1',
    id: 'bill_1',
    vendor: 'Office Space Commercial Hub',
    category: 'Rent',
    amount: 40000,
    dueDate: addDays(now, 4),
    status: 'PENDING',
    description: 'Main commercial lease for office space',
    createdAt: now.toISOString()
  },
  {
    _id: 'bill_2',
    id: 'bill_2',
    vendor: 'Cloud Hosting & Infra',
    category: 'Software',
    amount: 15000,
    dueDate: addDays(now, 8),
    status: 'PENDING',
    description: 'Cloud compute and database hosting',
    createdAt: now.toISOString()
  },
  {
    _id: 'bill_3',
    id: 'bill_3',
    vendor: 'Tata Power / Electricity',
    category: 'Utilities',
    amount: 8500,
    dueDate: addDays(now, -2),
    status: 'PENDING',
    description: 'Commercial 3-phase electricity consumption',
    createdAt: now.toISOString()
  }
];

// Profile
export function getOfflineProfile() {
  return businessProfile;
}

export function updateOfflineProfile(updates) {
  businessProfile = { ...businessProfile, ...updates, updatedAt: new Date().toISOString() };
  return businessProfile;
}

// Clients
export function getOfflineClients(search = '') {
  if (!search) return [...clients];
  const s = search.toLowerCase();
  return clients.filter(c => c.name.toLowerCase().includes(s) || c.phone.includes(s) || (c.email && c.email.toLowerCase().includes(s)));
}

export function addOfflineClient(clientData) {
  const newClient = {
    _id: `client_${Date.now()}`,
    id: `client_${Date.now()}`,
    ...clientData,
    createdAt: new Date().toISOString()
  };
  clients.push(newClient);
  return newClient;
}

// Invoices
export function getOfflineInvoices(filter = {}) {
  let list = [...invoices];
  if (filter.status) {
    list = list.filter(i => i.status === filter.status);
  }
  return list;
}

export function findOfflineInvoice(id) {
  return invoices.find(i => i._id === id || i.id === id);
}

export function addOfflineInvoice(invData) {
  const client = clients.find(c => c._id === invData.clientId || c.id === invData.clientId) || clients[0];
  const newInv = {
    _id: `inv_${Date.now()}`,
    id: `inv_${Date.now()}`,
    ...invData,
    clientId: client,
    dueTime: invData.dueTime || '18:00',
    reminderTime: invData.reminderTime || '16:00',
    status: invData.status || 'PENDING',
    createdAt: new Date().toISOString()
  };
  invoices.unshift(newInv);
  return newInv;
}

export function markOfflineInvoicePaid(id) {
  const inv = findOfflineInvoice(id);
  if (inv) {
    inv.status = 'PAID';
    inv.paidAt = new Date().toISOString();
  }
  return inv;
}

// Bills
export function getOfflineBills() {
  return [...bills];
}

export function findOfflineBill(id) {
  return bills.find(b => b._id === id || b.id === id);
}

export function addOfflineBill(billData) {
  const newBill = {
    _id: `bill_${Date.now()}`,
    id: `bill_${Date.now()}`,
    ...billData,
    status: billData.status || 'PENDING',
    createdAt: new Date().toISOString()
  };
  bills.unshift(newBill);
  return newBill;
}

export function markOfflineBillPaid(id) {
  const bill = findOfflineBill(id);
  if (bill) {
    bill.status = 'PAID';
    bill.paidAt = new Date().toISOString();
  }
  return bill;
}

// Stats
export function getOfflineStats() {
  const unpaidInvoices = invoices.filter(i => i.status !== 'PAID');
  const unpaidBills = bills.filter(b => b.status !== 'PAID');
  const today = new Date();

  const totalOwed = unpaidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  const totalDueBills = unpaidBills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const overdueCount = unpaidInvoices.filter(i => new Date(i.dueDate) < today).length;

  return {
    totalOwed,
    unpaidInvoicesCount: unpaidInvoices.length,
    totalDueBills,
    unpaidBillsCount: unpaidBills.length,
    redFlagsCount: overdueCount,
    currentBalance: 85000,
    lowestProjectedBalance: 45000,
    firstDeficitDate: null,
    deficitsCount: 0,
    projectedCashflow: []
  };
}
