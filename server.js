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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Express App ---
const app = express();
const PORT = process.env.PORT || 3000;

// --- Trust Proxy (for Railway/Render behind load balancer) ---
app.set('trust proxy', 1);

// --- Security Middleware ---
app.use(helmet({
  contentSecurityPolicy: false, // We'll use Tailwind CDN, inline scripts for Alpine
  crossOriginEmbedderPolicy: false
}));

// --- CORS ---
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.options('*', cors());

// --- Rate Limiting ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', globalLimiter);

const mutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: 'Too many write requests, please slow down' }
});

// --- Body Parsers ---
app.use('/api/webhooks/payment', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// --- Static Files ---
const isDev = process.env.NODE_ENV !== 'production';
app.use(express.static(join(__dirname, 'public'), {
  maxAge: isDev ? '0' : '1y',
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
      durationMs: duration,
      ip: req.ip
    }, 'HTTP Request');
  });
  next();
});

// --- Health Check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// --- Test Route ---
app.get('/api/test', (req, res) => {
  res.json({ message: 'API routes working!' });
});

// --- Database Connection ---
import { connectDB } from './services/db.js';

// --- Start Server ---
async function start() {
  try {
    await connectDB();
    
    // Import routes after DB connected (models need connection)
    const clientRoutes = (await import('./routes/clients.js')).default;
    logger.info({ stackLen: clientRoutes.stack?.length, routes: clientRoutes.stack?.map(r => r.route?.path) }, 'Loaded clients routes');
    const invoiceRoutes = (await import('./routes/invoices.js')).default;
    logger.info({ stackLen: invoiceRoutes.stack?.length }, 'Loaded invoices routes');
    const billRoutes = (await import('./routes/bills.js')).default;
    logger.info({ stackLen: billRoutes.stack?.length }, 'Loaded bills routes');
    const dashboardRoutes = (await import('./routes/dashboard.js')).default;
    logger.info({ stackLen: dashboardRoutes.stack?.length }, 'Loaded dashboard routes');
    const webhookRoutes = (await import('./routes/webhooks.js')).default;
    logger.info({ stackLen: webhookRoutes.stack?.length }, 'Loaded webhooks routes');
    const simulationRoutes = (await import('./routes/simulations.js')).default;
    logger.info({ stackLen: simulationRoutes.stack?.length }, 'Loaded simulations routes');
    const reminderRoutes = (await import('./routes/reminders.js')).default;
    logger.info({ stackLen: reminderRoutes.stack?.length }, 'Loaded reminders routes');
    const authRoutes = (await import('./routes/auth.js')).default;
    logger.info({ stackLen: authRoutes.stack?.length }, 'Loaded auth routes');
    
    // Mount API routes
    app.use('/api/auth', authRoutes);
    app.use('/api/clients', clientRoutes);
    app.use('/api/invoices', mutationLimiter, invoiceRoutes);
    app.use('/api/bills', mutationLimiter, billRoutes);
    app.use('/api/dashboard', dashboardRoutes);
    app.use('/api/webhooks', webhookRoutes);
    app.use('/api/simulations', simulationRoutes);
    app.use('/api/reminders', mutationLimiter, reminderRoutes);
    
    // --- Test mounted routes ---
    app.get('/api/test-mounted', (req, res) => {
      res.json({ message: 'Mounted routes working!' });
    });
    
    // Start cron jobs (in same process for MVP)
    if (process.env.NODE_ENV !== 'test') {
      const { startCronJobs } = await import('./services/cron-jobs.js');
      startCronJobs();
    }
    
    // --- SPA Fallback (serve index.html for non-API routes) ---
    // This MUST be after all API routes so it only catches non-API requests
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        logger.debug({ path: req.path }, 'SPA fallback: passing to next for API route');
        return next();
      }
      res.sendFile(join(__dirname, 'public', 'index.html'));
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
    
    // --- Error Handler ---
    app.use((err, req, res, next) => {
      logger.error({ err, url: req.originalUrl, method: req.method }, 'Unhandled Error');
      
      // Zod validation errors
      if (err.name === 'ZodError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
        });
      }
      
      // Mongoose validation errors
      if (err.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Validation failed',
          details: Object.values(err.errors).map(e => ({ field: e.path, message: e.message }))
        });
      }
      
      // Mongoose duplicate key
      if (err.code === 11000) {
        return res.status(409).json({ error: 'Duplicate entry', field: Object.keys(err.keyPattern)[0] });
      }
      
      res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
      });
    });

    // --- SSE Endpoint for Real-time Updates ---
    app.get('/api/events', async (req, res) => {
      const { addClient } = await import('./services/sse.js');
      if (!addClient(req.query.clientId || 'default', res)) {
        return res.status(503).json({ error: 'Max connections reached' });
      }
    });

    // --- 404 Handler ---
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    
    app.listen(PORT, () => {
      logger.info(`🚀 CashPilot server running on http://localhost:${PORT}`);
      logger.info(`📊 Dashboard: http://localhost:${PORT}`);
      logger.info(`🔗 API Health: http://localhost:${PORT}/health`);
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

start();

export { app, logger };