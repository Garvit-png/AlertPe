import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load env first
dotenv.config();

import logger from './utils/logger.js';
import { connectDB } from './services/db.js';

// Import route modules
import authRoutes from './routes/auth.js';
import clientRoutes from './routes/clients.js';
import invoiceRoutes from './routes/invoices.js';
import billRoutes from './routes/bills.js';
import dashboardRoutes from './routes/dashboard.js';
import webhookRoutes from './routes/webhooks.js';
import simulationRoutes from './routes/simulations.js';
import reminderRoutes from './routes/reminders.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Express App ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- Trust Proxy (for Vercel/Railway/Render behind load balancer) ---
app.set('trust proxy', 1);

// --- Security Middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // Tailwind CDN, inline scripts for Alpine
  crossOriginEmbedderPolicy: false
}));

// --- CORS ---
app.use(cors({
  origin: process.env.FRONTEND_URL || true,
  credentials: true
}));

app.options('*', cors());

// --- Rate Limiting ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', globalLimiter);

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many write requests, please slow down' }
});

// --- Body Parsers ---
app.use('/api/webhooks/payment', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// --- Static Files ---
const isDev = process.env.NODE_ENV !== 'production';
app.use(express.static(join(__dirname, 'public'), {
  maxAge: isDev ? '0' : '1d',
  immutable: !isDev,
  etag: true
}));

// --- Request Logging ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: duration
    }, 'HTTP Request');
  });
  next();
});

// --- Lazy DB Connection Middleware for API routes ---
let dbPromise = null;
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api/') && req.path !== '/api/health') {
    if (!dbPromise) {
      dbPromise = connectDB().catch(err => {
        logger.warn({ err: err?.message }, 'Lazy DB connection warning');
        dbPromise = null;
      });
    }
    try {
      await dbPromise;
    } catch (e) {}
  }
  next();
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.VERCEL ? 'vercel_serverless' : 'node_server'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.VERCEL ? 'vercel_serverless' : 'node_server'
  });
});

// --- Mount Synchronous API Routes ---
app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/invoices', mutationLimiter, invoiceRoutes);
app.use('/api/bills', mutationLimiter, billRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/simulations', simulationRoutes);
app.use('/api/reminders', mutationLimiter, reminderRoutes);

// --- SSE Endpoint for Real-time Updates ---
app.get('/api/events', async (req, res) => {
  const { addClient } = await import('./services/sse.js');
  if (!addClient(req.query.clientId || 'default', res)) {
    return res.status(503).json({ error: 'Max connections reached' });
  }
});

// --- Catch-all 404 handler for undefined API routes ---
app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `404 Not Found: ${req.method} ${req.originalUrl} does not exist`,
    code: 'NOT_FOUND',
    details: 'The requested API endpoint was not found on this AlertPe server. Check the URL and HTTP method.'
  });
});

// --- SPA Fallback (serve index.html for non-API routes) ---
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  const indexPath = join(__dirname, 'public', 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err && !res.headersSent) {
      // In serverless, static index.html is served directly by Vercel CDN.
      // If Express is reached for a non-API route, safely redirect to root.
      res.redirect('/');
    }
  });
});

// --- Error Handler ---
app.use((err, req, res, next) => {
  logger.error({ err, url: req.originalUrl, method: req.method }, 'Unhandled Error');
  
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
    });
  }
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: Object.values(err.errors).map(e => ({ field: e.path, message: e.message }))
    });
  }
  
  if (err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate entry', field: Object.keys(err.keyPattern)[0] });
  }
  
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// --- Server Startup Function (Local only) ---
async function start() {
  try {
    await connectDB();
    
    // Start cron jobs in local environment
    if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
      const { startCronJobs } = await import('./services/cron-jobs.js');
      startCronJobs();
    }
    
    app.listen(PORT, () => {
      logger.info(`AlertPe server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Local server startup error');
  }
}

// Graceful shutdown (local only)
if (!process.env.VERCEL) {
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
  });
}

// Automatically start local server when run via CLI: node server.js
const isDirectRun = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (isDirectRun && !process.env.VERCEL) {
  start();
}

export default app;
export { app, logger, start };
