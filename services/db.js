import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashpilot';

let isConnected = false;
let mongodInstance = null;

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return mongoose.connection;
  }

  const isVercel = !!process.env.VERCEL;
  const isProduction = process.env.NODE_ENV === 'production';
  const hasRemoteUri = !!process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('localhost');

  // If on Vercel without a remote MongoDB URI, do not attempt to connect to localhost:27017
  if (isVercel && !hasRemoteUri) {
    logger.warn('VERCEL DEPLOYMENT: No remote MONGODB_URI provided in environment variables. Running in graceful offline mode.');
    mongoose.set('bufferCommands', false);
    return null;
  }

  const options = {
    maxPoolSize: 10,
    minPoolSize: 1,
    socketTimeoutMS: 45000,
    family: 4,
    autoIndex: !isProduction,
    serverSelectionTimeoutMS: hasRemoteUri ? 8000 : 2000,
    heartbeatFrequencyMS: 10000
  };

  try {
    await mongoose.connect(MONGODB_URI, options);
    isConnected = true;
    logger.info({ uri: MONGODB_URI.replace(/\/\/.*@/, '//***:***@') }, 'MongoDB connected');
    return mongoose.connection;
  } catch (error) {
    if (!isProduction && !isVercel) {
      logger.warn({ err: error.message }, 'Local MongoDB unavailable. Starting in-memory MongoDB...');
      try {
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        mongodInstance = await MongoMemoryServer.create();
        const memUri = mongodInstance.getUri();
        await mongoose.connect(memUri);
        isConnected = true;
        logger.info({ uri: memUri }, 'Connected to in-memory MongoDB');

        try {
          const { populateDemoData } = await import('../scripts/seed.js');
          await populateDemoData();
          logger.info('Sample demo data loaded into in-memory MongoDB');
        } catch (seedErr) {
          logger.warn({ err: seedErr.message }, 'Demo data seeding skipped');
        }
        return mongoose.connection;
      } catch (memError) {
        logger.error({ err: memError }, 'Failed to start in-memory MongoDB');
        throw error;
      }
    } else {
      // Vercel / Cloud serverless: NEVER crash the process with 500 error!
      logger.warn({ err: error.message }, 'MongoDB connection failed; running in fallback offline mode');
      mongoose.set('bufferCommands', false);
      if (isVercel) {
        return null;
      }
      throw error;
    }
  }
}

// Connection event handlers
mongoose.connection.on('error', (err) => {
  logger.error({ err: err?.message }, 'MongoDB connection error');
  isConnected = false;
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
  isConnected = false;
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
  isConnected = true;
});

// Graceful shutdown (local only)
if (!process.env.VERCEL) {
  process.on('SIGINT', async () => {
    try {
      await mongoose.connection.close();
      if (mongodInstance) await mongodInstance.stop();
    } catch (e) {}
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });
}

export function getConnectionStatus() {
  return {
    connected: isConnected && mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    name: mongoose.connection.name
  };
}

export async function disconnectDB() {
  if (isConnected) {
    await mongoose.connection.close();
    isConnected = false;
    if (mongodInstance) {
      await mongodInstance.stop();
      mongodInstance = null;
    }
    logger.info('MongoDB disconnected');
  }
}

export async function withTransaction(callback) {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
}

export default { connectDB, disconnectDB, getConnectionStatus, withTransaction };
