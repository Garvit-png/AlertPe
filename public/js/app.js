/**
 * CashPilot - Main Application Entry Point
 * Alpine.js SPA with all components
 */

// Global utilities
const API_BASE = '/api';

// Format currency in Indian Rupees
function formatCurrency(amount, showSign = false) {
  if (amount === null || amount === undefined) return '₹0';
  const sign = showSign && amount > 0 ? '+' : '';
  return `${sign}₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Format date as DD MMM YYYY
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Invalid';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Format relative time
function formatRelative(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((date.setHours(0,0,0,0) - now.setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 0) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

// API helper
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  };
  
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  
  try {
    const response = await fetch(url, config);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    throw error;
  }
}

// Toast notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const colors = {
    success: 'bg-success text-white',
    error: 'bg-danger text-white',
    warning: 'bg-warning text-white',
    info: 'bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900'
  };
  
  const icons = {
    success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
    error: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
    warning: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>',
    info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
  };
  
  const toast = document.createElement('div');
  toast.className = `flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${colors[type]} toast-enter pointer-events-auto`;
  toast.innerHTML = `${icons[type]}<span class="text-sm">${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.remove('toast-enter');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Main App Component
function app() {
  return {
    // State
    currentTab: 'dashboard',
    darkMode: false,
    mobileMenuOpen: false,
    sseConnected: false,
    sse: null,
    
    // Data
    stats: {},
    invoices: [],
    bills: [],
    clients: [],
    unpaidInvoices: [],
    billCategories: ['Rent', 'Salaries', 'Suppliers', 'Utilities', 'Software', 'Other'],
    
    // Filters
    invoiceFilter: { status: '' },
    billFilter: { status: '', category: '' },
    clientSearch: '',
    
    // Modals
    showInvoiceModal: false,
    showBillModal: false,
    showClientModal: false,
    editingInvoice: null,
    editingClient: null,
    savingInvoice: false,
    savingBill: false,
    savingClient: false,
    invoiceForm: { clientId: '', amount: '', description: '', dueDate: '', reminderIntervalDays: 2 },
    billForm: { vendorName: '', amount: '', category: 'Other', dueDate: '', notes: '' },
    clientForm: { name: '', phone: '', email: '', businessCategory: 'General', notes: '' },
    
    // Simulator
    simulator: { invoiceId: '', shiftDays: 0 },
    simulationResult: {},
    simulatorChart: null,
    cashflowChart: null,
    monthlyChart: null,
    forecastView: 'balance',
    
    // Tab titles
    tabTitles: {
      dashboard: 'Dashboard',
      invoices: 'Invoices',
      bills: 'Bills',
      clients: 'Clients',
      simulator: 'Simulator'
    },
    
    // Computed
    get filteredInvoices() {
      let result = this.invoices;
      if (this.invoiceFilter.status) {
        result = result.filter(inv => inv.status === this.invoiceFilter.status);
      }
      return result;
    },
    
    get filteredBills() {
      let result = this.bills;
      if (this.billFilter.status) {
        result = result.filter(bill => bill.status === this.billFilter.status);
      }
      if (this.billFilter.category) {
        result = result.filter(bill => bill.category === this.billFilter.category);
      }
      return result;
    },
    
    get filteredClients() {
      let result = this.clients;
      if (this.clientSearch) {
        const search = this.clientSearch.toLowerCase();
        result = result.filter(c => 
          c.name.toLowerCase().includes(search) ||
          c.phone.includes(search) ||
          (c.email && c.email.toLowerCase().includes(search))
        );
      }
      return result;
    },
    
    // Initialization
    async init() {
      // Check dark mode preference
      this.darkMode = localStorage.getItem('darkMode') === 'true' || 
        (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      this.applyDarkMode();
      
      // Load initial data
      await this.loadAllData();
      
      // Connect SSE
      this.connectSSE();
      
      // Initialize charts after DOM ready
      this.$nextTick(() => {
        this.initCharts();
      });
      
      // Keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.openInvoiceModal();
        }
        if (e.key === 'Escape') {
          this.closeInvoiceModal();
          this.closeBillModal();
          this.closeClientModal();
        }
        if (e.key >= '1' && e.key <= '5' && !e.metaKey && !e.ctrlKey) {
          const tabs = ['dashboard', 'invoices', 'bills', 'clients', 'simulator'];
          this.setTab(tabs[parseInt(e.key) - 1]);
        }
      });
    },
    
    applyDarkMode() {
      if (this.darkMode) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      localStorage.setItem('darkMode', this.darkMode);
    },
    
    toggleDarkMode() {
      this.darkMode = !this.darkMode;
      this.applyDarkMode();
    },
    
    setTab(tab) {
      this.currentTab = tab;
      this.mobileMenuOpen = false;
      
      // Trigger chart resize on tab change
      this.$nextTick(() => {
        if (tab === 'dashboard') {
          this.cashflowChart?.resize();
          this.monthlyChart?.resize();
        } else if (tab === 'simulator') {
          this.simulatorChart?.resize();
        }
      });
    },
    
    // SSE Connection
    connectSSE() {
      if (this.sse) this.sse.close();
      
      this.sse = new EventSource('/api/events');
      
      this.sse.onopen = () => {
        this.sseConnected = true;
        console.log('SSE connected');
      };
      
      this.sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSSEEvent(event.type, data);
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      
      this.sse.addEventListener('payment_received', (e) => this.handleSSEEvent('payment_received', JSON.parse(e.data)));
      this.sse.addEventListener('reminder_sent', (e) => this.handleSSEEvent('reminder_sent', JSON.parse(e.data)));
      this.sse.addEventListener('invoice_overdue', (e) => this.handleSSEEvent('invoice_overdue', JSON.parse(e.data)));
      this.sse.addEventListener('stats_updated', (e) => this.handleSSEEvent('stats_updated', JSON.parse(e.data)));
      this.sse.addEventListener('heartbeat', () => {}); // Keep alive
      
      this.sse.onerror = () => {
        this.sseConnected = false;
        console.warn('SSE disconnected, reconnecting...');
        setTimeout(() => this.connectSSE(), 5000);
      };
    },
    
    handleSSEEvent(type, data) {
      console.log('SSE Event:', type, data);
      
      switch (type) {
        case 'payment_received':
          showToast(`🎉 ₹${data.payment.amount.toLocaleString('en-IN')} received from ${data.invoice.clientName}`, 'success');
          this.loadAllData(); // Refresh all data
          break;
        case 'reminder_sent':
          showToast(`📤 Reminder sent for ${data.invoice.invoiceNumber}`, 'info');
          this.loadInvoices();
          break;
        case 'invoice_overdue':
          showToast(`⚠️ ${data.invoice.invoiceNumber} is now overdue`, 'warning');
          this.loadInvoices();
          break;
        case 'stats_updated':
          this.loadStats();
          break;
      }
    },
    
    // Data Loading
    async loadAllData() {
      await Promise.all([
        this.loadStats(),
        this.loadInvoices(),
        this.loadBills(),
        this.loadClients()
      ]);
    },
    
    async loadStats() {
      try {
        this.stats = await apiRequest('/dashboard/stats');
      } catch (error) {
        showToast('Failed to load dashboard stats', 'error');
      }
    },
    
    async loadInvoices() {
      try {
        const response = await apiRequest('/invoices?limit=100');
        this.invoices = response.data || [];
        this.unpaidInvoices = this.invoices.filter(inv => inv.status !== 'PAID' && inv.status !== 'DRAFT');
      } catch (error) {
        showToast('Failed to load invoices', 'error');
      }
    },
    
    async loadBills() {
      try {
        const response = await apiRequest('/bills?limit=100');
        this.bills = response.data || [];
      } catch (error) {
        showToast('Failed to load bills', 'error');
      }
    },
    
    async loadClients() {
      try {
        const response = await apiRequest('/clients?limit=100');
        this.clients = response.data || [];
      } catch (error) {
        showToast('Failed to load clients', 'error');
      }
    },
    
    // Invoice Actions
    async sendReminder(invoice) {
      try {
        const response = await apiRequest('/reminders/trigger-now', {
          method: 'POST',
          body: { invoiceId: invoice.id, type: 'reminder' }
        });
        
        if (response.success) {
          showToast('Reminder sent via WhatsApp', 'success');
        } else {
          showToast(response.error || 'Failed to send reminder', 'error');
        }
      } catch (error) {
        showToast('Failed to send reminder', 'error');
      }
    },
    
    async markPaid(invoice) {
      if (!confirm(`Mark ${invoice.invoiceNumber} as paid?`)) return;
      
      try {
        const response = await apiRequest(`/invoices/${invoice.id}/mark-paid`, {
          method: 'POST',
          body: { paidAt: new Date().toISOString() }
        });
        
        if (response.success) {
          showToast('Invoice marked as paid', 'success');
          await this.loadAllData();
        }
      } catch (error) {
        showToast('Failed to mark as paid', 'error');
      }
    },
    
    async markBillPaid(bill) {
      if (!confirm(`Mark ${bill.vendorName} as paid?`)) return;
      
      try {
        const response = await apiRequest(`/bills/${bill.id}/mark-paid`, {
          method: 'POST',
          body: { paidAt: new Date().toISOString() }
        });
        
        if (response.success) {
          showToast('Bill marked as paid', 'success');
          await this.loadBills();
          await this.loadStats();
        }
      } catch (error) {
        showToast('Failed to mark as paid', 'error');
      }
    },
    
    // Invoice Modal
    openInvoiceModal(invoice = null) {
      this.editingInvoice = invoice;
      this.showInvoiceModal = true;
      
      if (invoice) {
        this.invoiceForm = {
          clientId: invoice.clientId?._id || invoice.clientId,
          amount: invoice.amount,
          description: invoice.description,
          dueDate: formatDateInput(invoice.dueDate),
          reminderIntervalDays: invoice.reminderIntervalDays
        };
      } else {
        this.resetInvoiceForm();
      }
      
      // Set default due date to tomorrow if new
      if (!invoice && !this.invoiceForm.dueDate) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        this.invoiceForm.dueDate = formatDateInput(tomorrow);
      }
    },
    
    closeInvoiceModal() {
      this.showInvoiceModal = false;
      this.editingInvoice = null;
      this.resetInvoiceForm();
    },
    
    resetInvoiceForm() {
      this.invoiceForm = { clientId: '', amount: '', description: '', dueDate: '', reminderIntervalDays: 2 };
    },
    
    async saveInvoice() {
      if (!this.invoiceForm.clientId || !this.invoiceForm.amount || !this.invoiceForm.description || !this.invoiceForm.dueDate) {
        showToast('Please fill all required fields', 'error');
        return;
      }
      
      this.savingInvoice = true;
      
      try {
        let response;
        if (this.editingInvoice) {
          response = await apiRequest(`/invoices/${this.editingInvoice.id}`, {
            method: 'PUT',
            body: this.invoiceForm
          });
        } else {
          response = await apiRequest('/invoices', {
            method: 'POST',
            body: this.invoiceForm
          });
        }
        
        if (response.success) {
          showToast(this.editingInvoice ? 'Invoice updated' : 'Invoice created with payment link', 'success');
          this.closeInvoiceModal();
          await this.loadAllData();
        }
      } catch (error) {
        showToast(error.message || 'Failed to save invoice', 'error');
      } finally {
        this.savingInvoice = false;
      }
    },
    
    // Bill Modal
    openBillModal() {
      this.showBillModal = true;
      this.resetBillForm();
    },
    
    closeBillModal() {
      this.showBillModal = false;
      this.resetBillForm();
    },
    
    resetBillForm() {
      this.billForm = { vendorName: '', amount: '', category: 'Other', dueDate: '', notes: '' };
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      this.billForm.dueDate = formatDateInput(tomorrow);
    },
    
    async saveBill() {
      if (!this.billForm.vendorName || !this.billForm.amount || !this.billForm.dueDate) {
        showToast('Please fill all required fields', 'error');
        return;
      }
      
      this.savingBill = true;
      
      try {
        const response = await apiRequest('/bills', {
          method: 'POST',
          body: this.billForm
        });
        
        if (response.success) {
          showToast('Bill added', 'success');
          this.closeBillModal();
          await this.loadBills();
          await this.loadStats();
        }
      } catch (error) {
        showToast(error.message || 'Failed to add bill', 'error');
      } finally {
        this.savingBill = false;
      }
    },
    
    // Client Methods
    filterClients() {
      // Reactive computed property handles filtering
    },
    
    openClientModal(client = null) {
      this.editingClient = client;
      this.showClientModal = true;
      
      if (client) {
        this.clientForm = {
          name: client.name,
          phone: client.phone,
          email: client.email || '',
          businessCategory: client.businessCategory || 'General',
          notes: client.notes || ''
        };
      } else {
        this.resetClientForm();
      }
    },
    
    closeClientModal() {
      this.showClientModal = false;
      this.editingClient = null;
      this.resetClientForm();
    },
    
    resetClientForm() {
      this.clientForm = { name: '', phone: '', email: '', businessCategory: 'General', notes: '' };
    },
    
    async saveClient() {
      if (!this.clientForm.name || !this.clientForm.phone) {
        showToast('Please fill in name and phone', 'error');
        return;
      }
      
      this.savingClient = true;
      
      try {
        let response;
        if (this.editingClient) {
          response = await apiRequest(`/clients/${this.editingClient.id}`, {
            method: 'PUT',
            body: this.clientForm
          });
        } else {
          response = await apiRequest('/clients', {
            method: 'POST',
            body: this.clientForm
          });
        }
        
        if (response.success) {
          showToast(this.editingClient ? 'Client updated' : 'Client created', 'success');
          this.closeClientModal();
          await this.loadClients();
        }
      } catch (error) {
        showToast(error.message || 'Failed to save client', 'error');
      } finally {
        this.savingClient = false;
      }
    },
    
    editClient(client) {
      this.openClientModal(client);
    },
    
    viewClientInvoices(client) {
      this.setTab('invoices');
    },
    
    async confirmDeleteClient(client) {
      if (!confirm(`Delete ${client.name}? This will fail if they have invoices.`)) return;
      
      try {
        const response = await apiRequest(`/clients/${client.id}`, {
          method: 'DELETE'
        });
        
        if (response.success) {
          showToast('Client deleted', 'success');
          await this.loadClients();
        }
      } catch (error) {
        showToast(error.message || 'Failed to delete client', 'error');
      }
    },
    
    // Simulator
    async runSimulation() {
      if (!this.simulator.invoiceId && this.simulator.shiftDays === 0) return;
      
      try {
        const body = { shiftDays: this.simulator.shiftDays };
        if (this.simulator.invoiceId) body.invoiceId = this.simulator.invoiceId;
        
        const response = await apiRequest('/simulations/what-if', {
          method: 'POST',
          body
        });
        
        this.simulationResult = response;
        this.updateSimulatorChart();
      } catch (error) {
        showToast('Failed to run simulation', 'error');
      }
    },
    
    // Status helpers
    getStatusClasses(status) {
      const classes = {
        PAID: 'bg-success/10 text-success',
        OVERDUE: 'bg-danger/10 text-danger',
        REMINDER_SENT: 'bg-warning/10 text-warning',
        PENDING: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400',
        DRAFT: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500'
      };
      return classes[status] || classes.PENDING;
    },
    
    getStatusLabel(status) {
      const labels = {
        PAID: 'Paid',
        OVERDUE: 'Overdue',
        REMINDER_SENT: 'Reminded',
        PENDING: 'Pending',
        DRAFT: 'Draft'
      };
      return labels[status] || status;
    },
    
    // Charts
    initCharts() {
      this.createCashflowChart();
      this.createMonthlyChart();
      this.createSimulatorChart();
    },
    
    createCashflowChart() {
      const ctx = document.getElementById('cashflow-chart');
      if (!ctx) return;
      
      const data = this.stats.forecast?.dailyData || [];
      const labels = data.map(d => d.date.slice(5)); // MM-DD
      const balances = data.map(d => d.balance);
      const inflows = data.map(d => d.inflows);
      const outflows = data.map(d => d.outflows);
      
      // Find deficit zones
      const deficitZones = [];
      let inDeficit = false;
      let startIdx = 0;
      
      data.forEach((d, i) => {
        if (d.isDeficit && !inDeficit) {
          inDeficit = true;
          startIdx = i;
        } else if (!d.isDeficit && inDeficit) {
          inDeficit = false;
          deficitZones.push({ start: startIdx, end: i - 1 });
        }
      });
      if (inDeficit) deficitZones.push({ start: startIdx, end: data.length - 1 });
      
      this.cashflowChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'Inflows',
              data: inflows,
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.2,
              pointRadius: 0,
              yAxisID: 'y'
            },
            {
              label: 'Outflows',
              data: outflows,
              borderColor: '#EF4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              fill: true,
              tension: 0.2,
              pointRadius: 0,
              yAxisID: 'y'
            },
            {
              label: 'Balance',
              data: balances,
              borderColor: '#111827',
              borderWidth: 2,
              fill: false,
              tension: 0.2,
              pointRadius: 0,
              yAxisID: 'y1',
              borderDash: this.forecastView === 'balance' ? [] : [5, 5]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
              }
            },
            annotation: {
              annotations: {
                zeroLine: {
                  type: 'line',
                  mode: 'horizontal',
                  scaleID: 'y1',
                  value: 0,
                  borderColor: '#EF4444',
                  borderWidth: 1,
                  borderDash: [4, 4]
                },
                ...deficitZones.map((zone, i) => ({
                  type: 'box',
                  xMin: zone.start,
                  xMax: zone.end,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  borderWidth: 0
                }))
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
            y: { 
              type: 'linear', 
              display: true, 
              position: 'left',
              title: { display: true, text: 'Flows (₹)' },
              ticks: { callback: (v) => '₹' + v.toLocaleString('en-IN') }
            },
            y1: { 
              type: 'linear', 
              display: true, 
              position: 'right',
              title: { display: true, text: 'Balance (₹)' },
              ticks: { callback: (v) => '₹' + v.toLocaleString('en-IN') },
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    },
    
    createMonthlyChart() {
      const ctx = document.getElementById('monthly-chart');
      if (!ctx) return;
      
      const monthly = this.stats.forecast?.monthlyChart || { labels: [], inflows: [], outflows: [], balances: [] };
      
      this.monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: monthly.labels,
          datasets: [
            {
              label: 'Inflows',
              data: monthly.inflows,
              backgroundColor: 'rgba(16, 185, 129, 0.8)',
              borderColor: '#10B981',
              borderWidth: 1
            },
            {
              label: 'Outflows',
              data: monthly.outflows,
              backgroundColor: 'rgba(239, 68, 68, 0.8)',
              borderColor: '#EF4444',
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: { 
              beginAtZero: true,
              ticks: { callback: (v) => '₹' + v.toLocaleString('en-IN') }
            }
          }
        }
      });
    },
    
    createSimulatorChart() {
      const ctx = document.getElementById('simulator-chart');
      if (!ctx) return;
      
      this.simulatorChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Baseline',
              data: [],
              borderColor: '#10B981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2
            },
            {
              label: 'Simulated',
              data: [],
              borderColor: '#EF4444',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              fill: true,
              tension: 0.2,
              pointRadius: 0,
              borderWidth: 2,
              borderDash: [5, 5]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { usePointStyle: true } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
              }
            },
            annotation: {
              annotations: {
                zeroLine: {
                  type: 'line',
                  mode: 'horizontal',
                  scaleID: 'y',
                  value: 0,
                  borderColor: '#EF4444',
                  borderWidth: 1,
                  borderDash: [4, 4]
                }
              }
            }
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 10 } },
            y: { 
              ticks: { callback: (v) => '₹' + v.toLocaleString('en-IN') }
            }
          }
        }
      });
    },
    
    updateSimulatorChart() {
      if (!this.simulatorChart || !this.simulationResult.chartData) return;
      
      const chartData = this.simulationResult.chartData;
      this.simulatorChart.data.labels = chartData.labels.map(d => d.slice(5));
      this.simulatorChart.data.datasets[0].data = chartData.datasets[0].data;
      this.simulatorChart.data.datasets[1].data = chartData.datasets[1].data;
      this.simulatorChart.data.datasets[1].label = chartData.datasets[1].label;
      this.simulatorChart.update();
    },
    
    renderForecastChart() {
      if (!this.cashflowChart) return;
      
      const data = this.stats.forecast?.dailyData || [];
      const balances = data.map(d => d.balance);
      const inflows = data.map(d => d.inflows);
      const outflows = data.map(d => d.outflows);
      
      // Toggle balance line visibility
      this.cashflowChart.data.datasets[2].borderDash = this.forecastView === 'balance' ? [] : [5, 5];
      this.cashflowChart.data.datasets[2].hidden = this.forecastView !== 'balance';
      this.cashflowChart.update();
    }
  };
}

// KPI Card Component - Register when Alpine is ready
function registerKpiCard() {
  if (window.Alpine) {
    window.Alpine.component('KpiCard', {
      props: ['title', 'value', 'count', 'deficit', 'icon', 'color'],
      template: kpiCardTemplate
    });
  } else {
    document.addEventListener('alpine:init', () => {
      if (window.Alpine) {
        window.Alpine.component('KpiCard', {
          props: ['title', 'value', 'count', 'deficit', 'icon', 'color'],
          template: kpiCardTemplate
        });
      }
    });
  }
}

// KPI Card Template (as regular string to avoid template literal parsing issues)
var kpiCardTemplate = [
  '<div class="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5" :class="deficit ? \'border-danger\' : \'\'">',
  '  <div class="flex items-start justify-between">',
  '    <div>',
  '      <p class="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider" x-text="title"></p>',
  '      <p class="text-3xl font-bold tracking-tight mt-1" :class="deficit ? \'text-danger\' : (color === \'success\' ? \'text-success\' : color === \'warning\' ? \'text-warning\' : \'text-zinc-900 dark:text-white\')" x-text="value"></p>',
  '      <template x-if="count !== undefined">',
  '        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1" x-text="count + \' items\'"></p>',
  '      </template>',
  '    </div>',
  '    <div class="w-10 h-10 rounded-lg flex items-center justify-center" :class="color === \'success\' ? \'bg-success/10\' : color === \'warning\' ? \'bg-warning/10\' : color === \'danger\' ? \'bg-danger/10\' : \'bg-zinc-100 dark:bg-zinc-800\'">',
  '      <svg class="w-5 h-5" :class="color === \'success\' ? \'text-success\' : color === \'warning\' ? \'text-warning\' : color === \'danger\' ? \'text-danger\' : \'text-zinc-500\'" fill="none" stroke="currentColor" viewBox="0 0 24 24">',
  '        <template x-if="icon === \'arrow-down-tray\'"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 17V9a2 2 0 012-2h2a2 2 0 012 2v2m-6 0h10a2 2 0 002-2V7a2 2 0 00-2-2H9a2 2 0 00-2 2v2a2 2 0 01-2 2H5m14 0v2a2 2 0 01-2 2H3a2 2 0 01-2-2v-2m0 0l3-3m0 0l-3-3m3 3H3"></path></template>',
  '        <template x-if="icon === \'arrow-up-tray\'"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5V7.5a2.25 2.25 0 012.25-2.25h.08a11.95 11.95 0 011.438.208 8.5 8.5 0 016.562 0 11.95 11.95 0 011.438-.208H18.75A2.25 2.25 0 0121 7.5v9a2.25 2.25 0 01-2.25 2.25h-1.134a11.95 11.95 0 01-1.438.208 8.5 8.5 0 016.562 0 11.95 11.95 0 011.438-.208H5.25A2.25 2.25 0 013 16.5zM9.75 9.75v3.5m3-3.5v3.5m-7.5 6h13.5a.75.75 0 000-1.5H6.75a.75.75 0 000 1.5z"></path></template>',
  '        <template x-if="icon === \'chart-line\'"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></template>',
  '        <template x-if="icon === \'flag\'"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></template>',
  '      </svg>',
  '    </div>',
  '  </div>',
  '</div>'
].join('\n');

// Register component when Alpine is ready
registerKpiCard();

// Make globals available
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.formatRelative = formatRelative;
window.formatDateInput = formatDateInput;
window.showToast = showToast;
