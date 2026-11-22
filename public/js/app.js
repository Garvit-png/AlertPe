/**
 * AlertPe / CashPilot - Core Client Logic
 * Clean, organized, minimal financial back-office SPA (Light Mode, Left Sidebar)
 */

const API_BASE = '/api';

// Format currency in Indian Rupees
function formatCurrency(amount, showSign = false) {
  if (amount === null || amount === undefined || isNaN(amount)) return '₹0';
  const num = Number(amount);
  const sign = showSign && num > 0 ? '+' : '';
  return `${sign}₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

// Format date as 24 Nov 2026
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Format input date YYYY-MM-DD
function formatDateInput(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

// Format humanized relative date
function formatRelative(dateStr, isPaid = false) {
  if (!dateStr) return '—';
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return '—';
  const now = new Date();
  
  const d1 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((d1 - d2) / (1000 * 60 * 60 * 24));

  if (isPaid) {
    if (diffDays === 0) return 'Paid today';
    if (diffDays === -1) return 'Paid yesterday';
    if (diffDays < 0) return `Paid ${Math.abs(diffDays)}d ago`;
    return `Paid`;
  }

  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays === -1) return 'Overdue by 1d';
  if (diffDays > 1) return `In ${diffDays} days`;
  return `Overdue by ${Math.abs(diffDays)}d`;
}

// Normalize phone to E.164 (+91 for 10-digit Indian numbers)
function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.trim().replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) {
      cleaned = '+91' + cleaned;
    } else {
      cleaned = '+' + cleaned;
    }
  }
  return cleaned;
}

// Split E.164 phone into country code and local number
function splitPhone(fullPhone) {
  if (!fullPhone) return { country: '+91', local: '' };
  const cleaned = String(fullPhone).trim();
  const knownCountries = ['+971', '+966', '+91', '+44', '+65', '+61', '+49', '+1'];
  for (const c of knownCountries) {
    if (cleaned.startsWith(c)) {
      return { country: c, local: cleaned.slice(c.length).replace(/^[-\s]+/, '') };
    }
  }
  if (cleaned.startsWith('+')) {
    return { country: cleaned.slice(0, 3), local: cleaned.slice(3).replace(/^[-\s]+/, '') };
  }
  return { country: '+91', local: cleaned.replace(/\D/g, '') };
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

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    let msg = data.error || `Request failed (${response.status})`;
    if (data.details && Array.isArray(data.details)) {
      msg = data.details.map(d => d.message).join(', ');
    } else if (typeof data.details === 'string') {
      msg = `${msg}: ${data.details}`;
    }
    const err = new Error(msg);
    err.status = response.status;
    err.code = data.code || `HTTP_${response.status}`;
    err.details = data.details || '';
    throw err;
  }

  return data;
}

// Minimal, high-contrast toast notifications
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const typeStyles = {
    success: 'border-emerald-500/30 text-emerald-800 bg-white shadow-sm',
    error: 'border-rose-500/30 text-rose-800 bg-white shadow-sm',
    warning: 'border-amber-500/30 text-amber-800 bg-white shadow-sm',
    info: 'border-zinc-300 text-zinc-900 bg-white shadow-sm'
  };

  const dotStyles = {
    success: 'bg-emerald-500',
    error: 'bg-rose-500',
    warning: 'bg-amber-500',
    info: 'bg-zinc-900'
  };

  toast.className = `flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-all duration-200 opacity-0 translate-y-1 ${typeStyles[type] || typeStyles.info}`;
  toast.innerHTML = `
    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${dotStyles[type] || dotStyles.info}"></span>
    <span class="truncate">${message}</span>
  `;

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('opacity-0', 'translate-y-1');
    toast.classList.add('opacity-100', 'translate-y-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-1');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// Main Alpine Application
function app() {
  return {
    // Navigation
    currentTab: 'dashboard',
    mobileMenuOpen: false,
    sseConnected: false,
    sse: null,

    // Loading states
    isLoading: true,
    refreshing: false,
    actionLoading: {},

    // Core Data
    stats: {},
    invoices: [],
    bills: [],
    clients: [],
    billCategories: ['Rent', 'Salaries', 'Suppliers', 'Utilities', 'Software', 'Other'],

    // Filters & Searches
    dashboardFilter: 'all', // 'all' | 'inflow' | 'outflow' | 'overdue' | 'paid'
    dashboardSearch: '',
    invoiceFilter: { status: '', search: '' },
    billFilter: { status: '', category: '', search: '' },
    clientSearch: '',

    // Modals
    showInvoiceModal: false,
    showBillModal: false,
    showClientModal: false,
    showSetupModal: false,
    showAuthModal: false,
    showProfileModal: false,
    editingInvoice: null,
    editingClient: null,
    savingInvoice: false,
    savingBill: false,
    savingClient: false,
    savingProfile: false,
    sendingOtp: false,
    verifyingOtp: false,

    // Dedicated Auth & Screen States: 'setup' | 'login' | 'verify' | 'error'
    // authGateEnabled: Set to false to bypass sign-in & enter workspace directly; true to enforce gate.
    authGateEnabled: false,
    isAuthenticated: false,
    authScreen: 'setup',
    authContext: 'setup', // which flow initiated verification ('setup' or 'login')
    lastAction: null,

    // Form inputs (100% EMPTY, NO PRE-WRITTEN VALUES)
    setupForm: {
      ownerName: '',
      businessName: '',
      phone: '',
      upiId: '',
      email: '',
      otp: ''
    },
    setupPhoneCountry: '+91',
    setupPhoneLocal: '',
    loginPhoneCountry: '+91',
    loginPhoneLocal: '',
    verifyPhone: '',
    verifyOtp: '',
    authInlineError: '',

    // Dedicated Error & 404 Page Diagnostic State
    errorState: {
      code: '404',
      title: 'Resource Not Found',
      message: 'The requested route or API endpoint does not exist on this server.',
      detail: 'GET /api/v1/undefined-endpoint returned 404 Not Found',
      resolution: 'Please check that the backend route is defined in server.js and matches the requested URL.',
      returnScreen: 'setup'
    },

    completingSetup: false,
    loggingIn: false,
    verifyingOtp: false,
    sendingLoginOtp: false,

    // Business Owner Profile State
    businessProfile: {
      ownerName: 'Ajay Yadav',
      businessName: 'AlertPe Technologies',
      phone: '+919876543210',
      email: 'owner@alertpe.com',
      upiId: 'alertpe@okhdfcbank',
      isVerified: false,
      isSetupCompleted: false
    },
    authStep: 'phone', // 'phone' | 'otp'
    authPhone: '+919876543210',
    authOtp: '',
    profileForm: {
      ownerName: '',
      businessName: '',
      phone: '',
      email: '',
      upiId: ''
    },

    // Form Models
    invoiceForm: { 
      clientId: '', 
      amount: '', 
      description: '', 
      dueDate: '', 
      reminderIntervalDays: 2,
      paymentLinkMode: 'auto',
      paymentLink: ''
    },
    billForm: { vendorName: '', amount: '', category: 'Other', dueDate: '', notes: '' },
    clientForm: { name: '', phone: '', email: '', businessCategory: 'General', notes: '' },
    generatingLink: false,
    gatewayStatus: { razorpay: { configured: false }, whatsapp: { configured: false } },

    // What-If Simulator
    simulator: { invoiceId: '', shiftDays: 0 },
    simulationResult: null,
    simulating: false,

    // Lifecycle
    async init() {
      // Force clean light mode (remove dark class)
      document.documentElement.classList.remove('dark');
      localStorage.removeItem('cp_theme');

      // Check stored auth gate preference (default is OFF - direct workspace access)
      const storedGatePref = localStorage.getItem('alertpe_auth_gate_enabled');
      if (storedGatePref !== null) {
        this.authGateEnabled = (storedGatePref === 'true');
      } else {
        this.authGateEnabled = false; // Default OFF as requested
      }

      // Fetch profile
      await this.loadProfile();

      // If sign-in gate is turned off, enter workspace directly
      if (!this.authGateEnabled) {
        this.isAuthenticated = true;
        await this.loadAllData(false);
        this.connectSSE();
      } else {
        // Check stored auth session if gate is ON
        const storedAuth = localStorage.getItem('alertpe_authenticated');

        if (storedAuth === 'true' && this.businessProfile.isVerified && this.businessProfile.isSetupCompleted) {
          this.isAuthenticated = true;
          await this.loadAllData(false);
          this.connectSSE();
        } else {
          // Enforce Setup & Login gate upfront with CLEAN, EMPTY inputs (no pre-filled data)
          this.isAuthenticated = false;
          this.isLoading = false;
          this.setupForm = {
            ownerName: '',
            businessName: '',
            phone: '',
            upiId: '',
            email: '',
            otp: ''
          };
          this.setupPhoneCountry = '+91';
          this.setupPhoneLocal = '';
          this.loginPhoneCountry = '+91';
          this.loginPhoneLocal = '';
          this.verifyPhone = '';
          this.verifyOtp = '';
          this.authInlineError = '';
          this.authScreen = (this.businessProfile && this.businessProfile.isSetupCompleted) ? 'login' : 'setup';
        }
      }

      // Global keyboard shortcuts
      document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          const searchInput = document.getElementById('dashboard-search') || document.getElementById('client-search');
          if (searchInput) searchInput.focus();
        }
        if (e.key === 'Escape') {
          this.closeInvoiceModal();
          this.closeBillModal();
          this.closeClientModal();
        }
      });
    },

    setTab(tab) {
      this.currentTab = tab;
      this.mobileMenuOpen = false;
      if (tab === 'simulator' && !this.simulationResult) {
        this.runSimulation();
      }
    },

    // Real-Time Server-Sent Events
    connectSSE() {
      if (this.sse) {
        try { this.sse.close(); } catch (e) {}
      }

      try {
        this.sse = new EventSource('/api/events');

        this.sse.onopen = () => {
          this.sseConnected = true;
        };

        this.sse.addEventListener('payment_received', (e) => {
          try {
            const data = JSON.parse(e.data);
            showToast(`Payment received: ${formatCurrency(data.payment?.amount)} from ${data.invoice?.clientName || 'Client'}`, 'success');
            this.loadAllData(false);
          } catch (err) {}
        });

        this.sse.addEventListener('reminder_sent', (e) => {
          try {
            const data = JSON.parse(e.data);
            showToast(`WhatsApp reminder sent for ${data.invoice?.invoiceNumber}`, 'info');
            this.loadInvoices();
          } catch (err) {}
        });

        this.sse.addEventListener('stats_updated', () => {
          this.loadStats();
        });

        this.sse.onerror = () => {
          this.sseConnected = false;
        };
      } catch (e) {
        this.sseConnected = false;
      }
    },

    // Data Loaders
    async loadAllData(showLoader = true) {
      if (showLoader) this.isLoading = true;
      try {
        await Promise.all([
          this.loadStats(),
          this.loadInvoices(),
          this.loadBills(),
          this.loadClients(),
          this.loadGatewayStatus(),
          this.loadProfile()
        ]);
      } catch (err) {
        console.error('Error loading data:', err);
      } finally {
        this.isLoading = false;
      }
    },

    async loadProfile() {
      try {
        const res = await apiRequest('/auth/profile');
        if (res.success && res.profile) {
          this.businessProfile = res.profile;
        }
      } catch (e) {
        console.warn('Could not fetch business profile', e);
      }
    },

    openProfileModal() {
      const parsed = splitPhone(this.businessProfile.phone || '+919876543210');
      this.profilePhoneCountry = parsed.country;
      this.profilePhoneLocal = parsed.local;
      this.profileForm = {
        ownerName: this.businessProfile.ownerName || '',
        businessName: this.businessProfile.businessName || '',
        phone: this.businessProfile.phone || '',
        email: this.businessProfile.email || '',
        upiId: this.businessProfile.upiId || ''
      };
      this.showProfileModal = true;
    },

    closeProfileModal() {
      this.showProfileModal = false;
    },

    async saveProfile() {
      const fullPhone = this.profilePhoneLocal ? `${this.profilePhoneCountry}${this.profilePhoneLocal.trim()}` : this.profileForm.phone;
      this.profileForm.phone = fullPhone;
      if (!this.profileForm.businessName || !this.profileForm.phone || !this.profileForm.upiId) {
        showToast('Business Name, WhatsApp Number, and UPI ID are required', 'error');
        return;
      }
      this.savingProfile = true;
      try {
        const res = await apiRequest('/auth/profile', {
          method: 'PUT',
          body: { ...this.profileForm, phone: fullPhone }
        });
        if (res.success) {
          this.businessProfile = res.profile;
          showToast('Business profile & WhatsApp sender updated!', 'success');
          this.closeProfileModal();
        }
      } catch (err) {
        showToast(err.message || 'Failed to update profile', 'error');
      } finally {
        this.savingProfile = false;
      }
    },

    // Dedicated Screen Navigation
    goToSetup() {
      this.authInlineError = '';
      this.authScreen = 'setup';
    },

    goToLogin() {
      this.authInlineError = '';
      this.authScreen = 'login';
    },

    toggleAuthGate() {
      this.authGateEnabled = !this.authGateEnabled;
      localStorage.setItem('alertpe_auth_gate_enabled', this.authGateEnabled ? 'true' : 'false');
      if (this.authGateEnabled) {
        this.isAuthenticated = false;
        this.authScreen = (this.businessProfile && this.businessProfile.isSetupCompleted) ? 'login' : 'setup';
        showToast('Sign-in & Setup gate turned ON', 'info');
      } else {
        this.isAuthenticated = true;
        this.loadAllData(false);
        this.connectSSE();
        showToast('Sign-in gate turned OFF (Direct workspace access)', 'success');
      }
    },

    skipAuth() {
      this.authGateEnabled = false;
      localStorage.setItem('alertpe_auth_gate_enabled', 'false');
      this.isAuthenticated = true;
      this.loadAllData(false);
      this.connectSSE();
      showToast('Entered workspace directly (Sign-in gate OFF)', 'success');
    },

    showErrorScreen(code, title, message, detail = '', resolution = '', returnScreen = 'setup') {
      this.errorState = {
        code: String(code || '500'),
        title: title || 'Error Occurred',
        message: message || 'An unexpected issue occurred.',
        detail: detail || '',
        resolution: resolution || 'Please review your parameters and try again.',
        returnScreen: returnScreen || this.authScreen || 'setup'
      };
      this.authScreen = 'error';
    },

    dismissError() {
      this.authScreen = this.errorState.returnScreen || 'setup';
    },

    async proceedToVerificationFromSetup() {
      this.authInlineError = '';
      const localPhone = String(this.setupPhoneLocal || '').trim();
      const ownerName = String(this.setupForm.ownerName || '').trim();
      const businessName = String(this.setupForm.businessName || '').trim();
      const upiId = String(this.setupForm.upiId || '').trim();

      if (!ownerName) {
        this.authInlineError = 'Please enter your full name.';
        return;
      }
      if (!businessName) {
        this.authInlineError = 'Please enter your business or legal entity name.';
        return;
      }
      if (!localPhone || localPhone.length < 6) {
        this.authInlineError = 'Please enter a valid phone number (e.g. 98765 43210).';
        return;
      }
      if (!upiId || !upiId.includes('@')) {
        this.authInlineError = 'Please enter a valid UPI ID (e.g. name@okhdfcbank or business@upi).';
        return;
      }

      const fullPhone = `${this.setupPhoneCountry}${localPhone}`;
      this.setupForm.phone = fullPhone;
      this.verifyPhone = fullPhone;
      this.authContext = 'setup';
      this.completingSetup = true;

      try {
        const res = await apiRequest('/auth/send-otp', {
          method: 'POST',
          body: { phone: fullPhone }
        });
        if (res.success) {
          this.verifyOtp = '';
          this.authScreen = 'verify';
          showToast(`Verification code sent to ${fullPhone}`, 'info');
        }
      } catch (err) {
        if (err.status === 404) {
          this.showErrorScreen(404, 'API Route Not Found', 'The backend authentication route was not found.', err.message, 'Check backend server route configuration in server.js', 'setup');
        } else {
          this.authInlineError = err.message || 'Failed to send verification code. Please try again.';
        }
      } finally {
        this.completingSetup = false;
      }
    },

    async proceedToVerificationFromLogin() {
      this.authInlineError = '';
      const localPhone = String(this.loginPhoneLocal || '').trim();
      if (!localPhone || localPhone.length < 6) {
        this.authInlineError = 'Please enter your registered phone number.';
        return;
      }

      const fullPhone = `${this.loginPhoneCountry}${localPhone}`;
      this.verifyPhone = fullPhone;
      this.authContext = 'login';
      this.sendingLoginOtp = true;

      try {
        const res = await apiRequest('/auth/send-otp', {
          method: 'POST',
          body: { phone: fullPhone }
        });
        if (res.success) {
          this.verifyOtp = '';
          this.authScreen = 'verify';
          showToast(`Verification code sent to ${fullPhone}`, 'info');
        }
      } catch (err) {
        if (err.status === 404) {
          this.showErrorScreen(404, 'API Route Not Found', 'The backend authentication route was not found.', err.message, 'Check backend server route configuration in server.js', 'login');
        } else {
          this.authInlineError = err.message || 'Failed to send verification code.';
        }
      } finally {
        this.sendingLoginOtp = false;
      }
    },

    async submitVerification() {
      this.authInlineError = '';
      const code = String(this.verifyOtp || '').trim();
      if (!code || code.length < 4) {
        this.authInlineError = 'Please enter the 6-digit verification code.';
        return;
      }

      this.verifyingOtp = true;
      try {
        if (this.authContext === 'setup') {
          const res = await apiRequest('/auth/setup', {
            method: 'POST',
            body: {
              ownerName: this.setupForm.ownerName.trim(),
              businessName: this.setupForm.businessName.trim(),
              phone: this.verifyPhone,
              upiId: this.setupForm.upiId.trim(),
              email: (this.setupForm.email || '').trim(),
              otp: code
            }
          });
          if (res.success && res.profile) {
            this.businessProfile = res.profile;
            this.isAuthenticated = true;
            localStorage.setItem('alertpe_authenticated', 'true');
            localStorage.setItem('alertpe_session_token', res.profile.sessionToken || 'active');
            showToast(`Business profile activated. Welcome, ${res.profile.ownerName}`, 'success');
            await this.loadAllData(false);
            this.connectSSE();
          }
        } else {
          const res = await apiRequest('/auth/verify-otp', {
            method: 'POST',
            body: { phone: this.verifyPhone, otp: code }
          });
          if (res.success && res.profile) {
            this.businessProfile = res.profile;
            this.isAuthenticated = true;
            localStorage.setItem('alertpe_authenticated', 'true');
            localStorage.setItem('alertpe_session_token', res.profile.sessionToken || 'active');
            showToast(`Signed in successfully. Welcome back, ${res.profile.ownerName || 'Owner'}`, 'success');
            await this.loadAllData(false);
            this.connectSSE();
          }
        }
      } catch (err) {
        if (err.status === 404) {
          this.showErrorScreen(404, 'Endpoint Not Found', 'The verification endpoint was not found on the server.', err.message, 'Verify server.js route registration.', 'verify');
        } else {
          this.authInlineError = err.message || 'Invalid verification code. Please check and try again.';
        }
      } finally {
        this.verifyingOtp = false;
      }
    },

    async resendOtp() {
      this.authInlineError = '';
      try {
        const res = await apiRequest('/auth/send-otp', {
          method: 'POST',
          body: { phone: this.verifyPhone }
        });
        if (res.success) {
          showToast(`Code resent to ${this.verifyPhone}. Test PIN is 482910`, 'info', 4000);
        }
      } catch (err) {
        this.authInlineError = err.message || 'Could not resend verification code.';
      }
    },

    async logout() {
      try {
        await apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
      } catch (e) {}
      localStorage.removeItem('alertpe_authenticated');
      localStorage.removeItem('alertpe_session_token');
      this.authGateEnabled = true;
      localStorage.setItem('alertpe_auth_gate_enabled', 'true');
      this.isAuthenticated = false;
      this.authScreen = 'login';
      this.setupPhoneLocal = '';
      this.loginPhoneLocal = '';
      this.verifyOtp = '';
      this.authInlineError = '';
      if (this.sse) {
        try { this.sse.close(); } catch (e) {}
      }
      showToast('Signed out of AlertPe', 'info');
    },

    async resetWorkspace() {
      if (!confirm('Are you sure you want to reset your business profile setup and test the onboarding gate again?')) {
        return;
      }
      try {
        await apiRequest('/auth/reset', { method: 'POST' }).catch(() => {});
      } catch (e) {}
      localStorage.removeItem('alertpe_authenticated');
      localStorage.removeItem('alertpe_session_token');
      this.authGateEnabled = true;
      localStorage.setItem('alertpe_auth_gate_enabled', 'true');
      this.isAuthenticated = false;
      this.authScreen = 'setup';
      this.setupForm = {
        ownerName: '',
        businessName: '',
        phone: '',
        upiId: '',
        email: '',
        otp: ''
      };
      this.setupPhoneLocal = '';
      this.loginPhoneLocal = '';
      this.verifyOtp = '';
      this.authInlineError = '';
      if (this.sse) {
        try { this.sse.close(); } catch (e) {}
      }
      showToast('Workspace reset to initial state', 'info');
    },

    openAuthModal() {
      this.authPhone = this.businessProfile.phone || '+919876543210';
      this.authOtp = '';
      this.authStep = 'phone';
      this.showAuthModal = true;
    },

    closeAuthModal() {
      this.showAuthModal = false;
      this.authStep = 'phone';
      this.authOtp = '';
    },

    async sendAuthOtp() {
      if (!this.authPhone || this.authPhone.trim().length < 8) {
        showToast('Please enter a valid phone number', 'warning');
        return;
      }
      this.sendingOtp = true;
      try {
        const res = await apiRequest('/auth/send-otp', {
          method: 'POST',
          body: { phone: this.authPhone }
        });
        if (res.success) {
          this.authStep = 'otp';
          this.authOtp = res.demoOtp || '482910';
          showToast(`Verification code sent! Demo OTP: ${res.demoOtp}`, 'info', 5000);
        }
      } catch (err) {
        showToast(err.message || 'Could not send OTP', 'error');
      } finally {
        this.sendingOtp = false;
      }
    },

    async verifyAuthOtp() {
      if (!this.authOtp || this.authOtp.trim().length < 4) {
        showToast('Please enter the 6-digit OTP code', 'warning');
        return;
      }
      this.verifyingOtp = true;
      try {
        const res = await apiRequest('/auth/verify-otp', {
          method: 'POST',
          body: { phone: this.authPhone, otp: this.authOtp.trim() }
        });
        if (res.success) {
          this.businessProfile = res.profile;
          showToast('Signed in successfully! Welcome, ' + (res.profile.ownerName || 'Owner'), 'success');
          this.closeAuthModal();
        }
      } catch (err) {
        showToast(err.message || 'Invalid verification code', 'error');
      } finally {
        this.verifyingOtp = false;
      }
    },

    async loadGatewayStatus() {
      try {
        this.gatewayStatus = await apiRequest('/invoices/gateway-status');
      } catch (e) {
        console.warn('Could not fetch gateway status', e);
      }
    },

    async refreshData() {
      this.refreshing = true;
      try {
        await this.loadAllData(false);
        showToast('Data refreshed', 'info');
      } catch (err) {
        showToast('Failed to refresh data', 'error');
      } finally {
        setTimeout(() => { this.refreshing = false; }, 400);
      }
    },

    async loadStats() {
      try {
        this.stats = await apiRequest('/dashboard/stats');
      } catch (err) {
        console.warn('Could not fetch stats', err);
      }
    },

    async loadInvoices() {
      try {
        const res = await apiRequest('/invoices?limit=100');
        this.invoices = res.data || [];
      } catch (err) {
        console.warn('Could not fetch invoices', err);
      }
    },

    async loadBills() {
      try {
        const res = await apiRequest('/bills?limit=100');
        this.bills = res.data || [];
      } catch (err) {
        console.warn('Could not fetch bills', err);
      }
    },

    async loadClients() {
      try {
        const res = await apiRequest('/clients?limit=100');
        this.clients = res.data || [];
      } catch (err) {
        console.warn('Could not fetch clients', err);
      }
    },

    // Computed: Unified Transactions for Minimal Dashboard
    get unifiedTransactions() {
      const list = [];
      const now = new Date();
      now.setHours(0, 0, 0, 0);

      // Inflows (Invoices - Money coming in)
      for (const inv of this.invoices) {
        const isPaid = inv.status === 'PAID';
        const dDate = new Date(inv.dueDate);
        const isOverdue = !isPaid && dDate < now;

        list.push({
          id: inv.id || inv._id,
          type: 'inflow',
          title: inv.clientId?.name || 'Client',
          subtitle: inv.description || inv.invoiceNumber,
          reference: inv.invoiceNumber,
          amount: Number(inv.amount) || 0,
          dueDate: inv.dueDate,
          status: isOverdue ? 'OVERDUE' : inv.status,
          isPaid,
          isOverdue,
          phone: inv.clientId?.phone,
          paymentLink: inv.paymentLink,
          raw: inv
        });
      }

      // Outflows (Bills - Money going out)
      for (const bill of this.bills) {
        const isPaid = bill.status === 'PAID';
        const dDate = new Date(bill.dueDate);
        const isOverdue = !isPaid && dDate < now;

        list.push({
          id: bill.id || bill._id,
          type: 'outflow',
          title: bill.vendorName,
          subtitle: bill.category + (bill.notes ? ` · ${bill.notes}` : ''),
          reference: bill.category,
          amount: Number(bill.amount) || 0,
          dueDate: bill.dueDate,
          status: isOverdue ? 'OVERDUE' : bill.status,
          isPaid,
          isOverdue,
          phone: '',
          paymentLink: null,
          raw: bill
        });
      }

      // Filter by Tab
      let filtered = list;
      if (this.dashboardFilter === 'inflow') {
        filtered = filtered.filter(item => item.type === 'inflow');
      } else if (this.dashboardFilter === 'outflow') {
        filtered = filtered.filter(item => item.type === 'outflow');
      } else if (this.dashboardFilter === 'overdue') {
        filtered = filtered.filter(item => item.isOverdue);
      } else if (this.dashboardFilter === 'paid') {
        filtered = filtered.filter(item => item.isPaid);
      }

      // Search Query
      if (this.dashboardSearch.trim()) {
        const q = this.dashboardSearch.trim().toLowerCase();
        filtered = filtered.filter(item =>
          item.title.toLowerCase().includes(q) ||
          item.subtitle.toLowerCase().includes(q) ||
          item.reference.toLowerCase().includes(q) ||
          String(item.amount).includes(q)
        );
      }

      // Sort: Overdue first, then upcoming due dates, then paid
      return filtered.sort((a, b) => {
        if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
    },

    // Computed Dashboard Metrics
    get dashboardMetrics() {
      const currentBank = Number(this.stats?.kpis?.currentBalance?.value || 50000);
      
      const unpaidInvoices = this.invoices.filter(i => i.status !== 'PAID' && i.status !== 'DRAFT');
      const totalToReceive = unpaidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

      const pendingBills = this.bills.filter(b => b.status === 'PENDING');
      const totalToPay = pendingBills.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const overdueCount = unpaidInvoices.filter(i => new Date(i.dueDate) < now).length +
                           pendingBills.filter(b => new Date(b.dueDate) < now).length;

      return {
        currentBank,
        totalToReceive,
        toReceiveCount: unpaidInvoices.length,
        totalToPay,
        toPayCount: pendingBills.length,
        netCashflow: currentBank + totalToReceive - totalToPay,
        overdueCount
      };
    },

    // Computed Clients Overview Metrics
    get clientsMetrics() {
      const totalClients = this.clients.length;
      const totalOutstanding = this.clients.reduce((sum, c) => sum + (Number(c.totalOwed) || 0), 0);
      const clientsWithPending = this.clients.filter(c => (Number(c.totalOwed) || 0) > 0).length;
      return {
        totalClients,
        totalOutstanding,
        clientsWithPending
      };
    },

    // Computed Invoices List
    get filteredInvoices() {
      let list = this.invoices;
      if (this.invoiceFilter.status) {
        list = list.filter(i => i.status === this.invoiceFilter.status);
      }
      if (this.invoiceFilter.search.trim()) {
        const q = this.invoiceFilter.search.trim().toLowerCase();
        list = list.filter(i =>
          (i.clientId?.name || '').toLowerCase().includes(q) ||
          (i.invoiceNumber || '').toLowerCase().includes(q) ||
          (i.description || '').toLowerCase().includes(q)
        );
      }
      return list;
    },

    // Computed Bills List
    get filteredBills() {
      let list = this.bills;
      if (this.billFilter.status) {
        list = list.filter(b => b.status === this.billFilter.status);
      }
      if (this.billFilter.category) {
        list = list.filter(b => b.category === this.billFilter.category);
      }
      if (this.billFilter.search.trim()) {
        const q = this.billFilter.search.trim().toLowerCase();
        list = list.filter(b =>
          (b.vendorName || '').toLowerCase().includes(q) ||
          (b.notes || '').toLowerCase().includes(q)
        );
      }
      return list;
    },

    // Computed Clients List
    get filteredClients() {
      let list = this.clients;
      if (this.clientSearch.trim()) {
        const q = this.clientSearch.trim().toLowerCase();
        list = list.filter(c =>
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.businessCategory || '').toLowerCase().includes(q)
        );
      }
      return list;
    },

    // One-Click Actions
    async sendReminder(invoice) {
      const id = invoice.id || invoice._id;
      this.actionLoading[`remind_${id}`] = true;
      try {
        const res = await apiRequest('/reminders/trigger-now', {
          method: 'POST',
          body: { invoiceId: id, type: 'reminder' }
        });
        if (res.success) {
          if (res.whatsappUrl) {
            window.open(res.whatsappUrl, '_blank');
            showToast(`WhatsApp chat opened for ${invoice.clientId?.name || 'client'}!`, 'success');
          } else {
            showToast(`WhatsApp reminder recorded for ${invoice.clientId?.name || 'client'}`, 'success');
          }
          await this.loadInvoices();
          await this.loadAllData(false);
        } else {
          showToast(res.error || 'Failed to dispatch reminder', 'error');
        }
      } catch (err) {
        showToast(err.message || 'WhatsApp API request failed', 'error');
      } finally {
        this.actionLoading[`remind_${id}`] = false;
      }
    },

    async markInvoicePaid(invoice) {
      const id = invoice.id || invoice._id;
      this.actionLoading[`paid_${id}`] = true;
      try {
        const res = await apiRequest(`/invoices/${id}/mark-paid`, {
          method: 'POST',
          body: { paidAt: new Date().toISOString() }
        });
        if (res.success) {
          showToast(`Invoice ${invoice.invoiceNumber || ''} marked paid`, 'success');
          await this.loadAllData(false);
        }
      } catch (err) {
        showToast(err.message || 'Failed to update invoice', 'error');
      } finally {
        this.actionLoading[`paid_${id}`] = false;
      }
    },

    async markBillPaid(bill) {
      const id = bill.id || bill._id;
      this.actionLoading[`bill_paid_${id}`] = true;
      try {
        const res = await apiRequest(`/bills/${id}/mark-paid`, {
          method: 'POST',
          body: { paidAt: new Date().toISOString() }
        });
        if (res.success) {
          showToast(`Bill marked paid: ${bill.vendorName}`, 'success');
          await this.loadBills();
          await this.loadStats();
        }
      } catch (err) {
        showToast(err.message || 'Failed to update bill', 'error');
      } finally {
        this.actionLoading[`bill_paid_${id}`] = false;
      }
    },

    async copyPaymentLink(link) {
      if (!link) {
        showToast('No payment link available for this record', 'warning');
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        showToast('Payment link copied', 'success');
      } catch (err) {
        const ta = document.createElement('textarea');
        ta.value = link;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Payment link copied', 'success');
      }
    },

    // Direct WhatsApp Web Trigger
    openWhatsApp(phone, clientName = '') {
      if (!phone) {
        showToast('No phone number recorded', 'warning');
        return;
      }
      const clean = phone.replace(/[^\d]/g, '');
      const msg = encodeURIComponent(`Hello ${clientName}, this is regarding your invoice with AlertPe.`);
      window.open(`https://wa.me/${clean}?text=${msg}`, '_blank');
    },

    // Create Invoice Directly For A Selected Client
    createInvoiceForClient(client) {
      this.editingInvoice = null;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      this.invoiceForm = {
        clientId: client.id || client._id,
        amount: '',
        description: '',
        dueDate: formatDateInput(tomorrow),
        reminderIntervalDays: 2,
        paymentLinkMode: 'auto',
        paymentLink: ''
      };
      this.showInvoiceModal = true;
    },

    // Dynamic Payment Link Generator (e.g. ₹500 test or preview)
    async generatePaymentLinkPreview() {
      if (!this.invoiceForm.amount || Number(this.invoiceForm.amount) <= 0) {
        showToast('Please enter an invoice amount first (e.g. 500)', 'warning');
        return;
      }
      this.generatingLink = true;
      try {
        const selectedClient = this.clients.find(c => (c.id || c._id) === this.invoiceForm.clientId);
        const res = await apiRequest('/invoices/generate-payment-link', {
          method: 'POST',
          body: {
            amount: Number(this.invoiceForm.amount),
            description: this.invoiceForm.description || 'Invoice Payment',
            customerName: selectedClient?.name || 'Client',
            customerPhone: selectedClient?.phone || '+919876543210'
          }
        });
        if (res.success) {
          this.invoiceForm.paymentLink = res.paymentLink;
          showToast(`₹${res.amount} payment link generated successfully!`, 'success');
        }
      } catch (err) {
        showToast(err.message || 'Could not generate link', 'error');
      } finally {
        this.generatingLink = false;
      }
    },

    // Modals Management
    openInvoiceModal(invoice = null) {
      this.editingInvoice = invoice;
      if (invoice) {
        this.invoiceForm = {
          clientId: invoice.clientId?._id || invoice.clientId?.id || invoice.clientId,
          amount: invoice.amount,
          description: invoice.description,
          dueDate: formatDateInput(invoice.dueDate),
          reminderIntervalDays: invoice.reminderIntervalDays || 2,
          paymentLinkMode: invoice.paymentLink ? 'custom' : 'auto',
          paymentLink: invoice.paymentLink || ''
        };
      } else {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 2);
        this.invoiceForm = {
          clientId: this.clients[0]?.id || this.clients[0]?._id || '',
          amount: '',
          description: '',
          dueDate: formatDateInput(tomorrow),
          reminderIntervalDays: 2,
          paymentLinkMode: 'auto',
          paymentLink: ''
        };
      }
      this.showInvoiceModal = true;
    },

    closeInvoiceModal() {
      this.showInvoiceModal = false;
      this.editingInvoice = null;
    },

    async saveInvoice() {
      if (!this.invoiceForm.clientId || !this.invoiceForm.amount || !this.invoiceForm.description || !this.invoiceForm.dueDate) {
        showToast('Please fill all required fields', 'error');
        return;
      }

      this.savingInvoice = true;
      try {
        let res;
        const id = this.editingInvoice?.id || this.editingInvoice?._id;
        const payload = {
          ...this.invoiceForm,
          paymentLink: this.invoiceForm.paymentLink?.trim() || undefined
        };

        if (this.editingInvoice) {
          res = await apiRequest(`/invoices/${id}`, {
            method: 'PUT',
            body: payload
          });
        } else {
          res = await apiRequest('/invoices', {
            method: 'POST',
            body: payload
          });
        }

        if (res.success) {
          showToast(this.editingInvoice ? 'Invoice updated' : 'Invoice created with payment link', 'success');
          this.closeInvoiceModal();
          await this.loadAllData(false);
        }
      } catch (err) {
        showToast(err.message || 'Failed to save invoice', 'error');
      } finally {
        this.savingInvoice = false;
      }
    },

    async deleteInvoice(invoice) {
      const id = invoice.id || invoice._id;
      if (!confirm(`Delete invoice ${invoice.invoiceNumber}?`)) return;
      try {
        const res = await apiRequest(`/invoices/${id}`, { method: 'DELETE' });
        if (res.success) {
          showToast('Invoice deleted', 'info');
          await this.loadAllData(false);
        }
      } catch (err) {
        showToast(err.message || 'Failed to delete invoice', 'error');
      }
    },

    openBillModal() {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 3);
      this.billForm = {
        vendorName: '',
        amount: '',
        category: 'Utilities',
        dueDate: formatDateInput(tomorrow),
        notes: ''
      };
      this.showBillModal = true;
    },

    closeBillModal() {
      this.showBillModal = false;
    },

    async saveBill() {
      if (!this.billForm.vendorName || !this.billForm.amount || !this.billForm.dueDate) {
        showToast('Please fill vendor, amount, and due date', 'error');
        return;
      }

      this.savingBill = true;
      try {
        const res = await apiRequest('/bills', {
          method: 'POST',
          body: this.billForm
        });
        if (res.success) {
          showToast('Bill recorded', 'success');
          this.closeBillModal();
          await this.loadBills();
          await this.loadStats();
        }
      } catch (err) {
        showToast(err.message || 'Failed to save bill', 'error');
      } finally {
        this.savingBill = false;
      }
    },

    async deleteBill(bill) {
      const id = bill.id || bill._id;
      if (!confirm(`Delete bill for ${bill.vendorName}?`)) return;
      try {
        const res = await apiRequest(`/bills/${id}`, { method: 'DELETE' });
        if (res.success) {
          showToast('Bill deleted', 'info');
          await this.loadBills();
          await this.loadStats();
        }
      } catch (err) {
        showToast(err.message || 'Failed to delete bill', 'error');
      }
    },

    openClientModal(client = null) {
      this.editingClient = client;
      if (client) {
        this.clientForm = {
          name: client.name,
          phone: client.phone,
          email: client.email || '',
          businessCategory: client.businessCategory || 'General',
          notes: client.notes || ''
        };
      } else {
        this.clientForm = {
          name: '',
          phone: '+91',
          email: '',
          businessCategory: 'Consulting',
          notes: ''
        };
      }
      this.showClientModal = true;
    },

    closeClientModal() {
      this.showClientModal = false;
      this.editingClient = null;
    },

    autoChecking: false,
    async runAutoCheck() {
      this.autoChecking = true;
      try {
        const res = await apiRequest('/reminders/auto-check', { method: 'POST' });
        showToast(res.message || 'Payment status checked and reconciled!', 'success');
        await this.loadAllData(false);
      } catch (err) {
        showToast(err.message || 'Auto-check failed', 'error');
      } finally {
        this.autoChecking = false;
      }
    },

    async saveClient() {
      if (!this.clientForm.name || !this.clientForm.phone) {
        showToast('Name and phone are required', 'error');
        return;
      }

      // Automatically normalize phone
      this.clientForm.phone = normalizePhone(this.clientForm.phone);
      const payload = { ...this.clientForm };
      if (!payload.email || payload.email.trim() === '') {
        delete payload.email;
      }

      this.savingClient = true;
      try {
        let res;
        const id = this.editingClient?.id || this.editingClient?._id;
        if (this.editingClient) {
          res = await apiRequest(`/clients/${id}`, {
            method: 'PUT',
            body: payload
          });
        } else {
          res = await apiRequest('/clients', {
            method: 'POST',
            body: payload
          });
        }

        if (res.success) {
          showToast(this.editingClient ? 'Client updated' : 'Client created successfully!', 'success');
          this.closeClientModal();
          await this.loadClients();
          await this.loadAllData(false);
        }
      } catch (err) {
        showToast(err.message || 'Failed to save client', 'error');
      } finally {
        this.savingClient = false;
      }
    },

    async deleteClient(client) {
      const id = client.id || client._id;
      if (!confirm(`Delete client ${client.name}?`)) return;
      try {
        const res = await apiRequest(`/clients/${id}`, { method: 'DELETE' });
        if (res.success) {
          showToast('Client removed', 'info');
          await this.loadClients();
        }
      } catch (err) {
        showToast(err.message || 'Cannot delete client with active invoices', 'error');
      }
    },

    // What-If Simulator
    async runSimulation() {
      this.simulating = true;
      try {
        const body = { shiftDays: Number(this.simulator.shiftDays) || 0 };
        if (this.simulator.invoiceId) {
          body.invoiceId = this.simulator.invoiceId;
        }
        const res = await apiRequest('/simulations/what-if', {
          method: 'POST',
          body
        });
        this.simulationResult = res;
      } catch (err) {
        console.warn('Simulation failed', err);
      } finally {
        this.simulating = false;
      }
    }
  };
}
