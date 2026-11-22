import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashpilot';

let isConnected = false;
let mongodInstance = null;

export async function connectDB() {
  if (isConnected) {
    logger.debug('MongoDB already connected');
    return mongoose.connection;
  }

  const options = {
    maxPoolSize: 10,           // Connection pool size
    minPoolSize: 2,            // Minimum connections
    socketTimeoutMS: 45000,    // Close sockets after 45s inactivity
    family: 4,                 // Use IPv4, skip trying IPv6
    autoIndex: process.env.NODE_ENV !== 'production', // Build indexes in dev
    serverSelectionTimeoutMS: process.env.MONGODB_URI && !process.env.MONGODB_URI.includes('localhost') ? 10000 : 2000,
    heartbeatFrequencyMS: 10000     // Heartbeat interval
  };

  try {
    await mongoose.connect(MONGODB_URI, options);
    isConnected = true;
    logger.info({ uri: MONGODB_URI.replace(/\/\/.*@/, '//***:***@') }, 'MongoDB connected');
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
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
      } catch (memError) {
        logger.fatal({ err: memError }, 'Failed to start in-memory MongoDB');
        throw error;
      }
    } else {
      logger.fatal({ err: error }, 'MongoDB connection failed');
      throw error;
    }
  }

  // Connection event handlers
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB connection error');
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

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    if (mongodInstance) await mongodInstance.stop();
    logger.info('MongoDB connection closed due to app termination');
    process.exit(0);
  });

  return mongoose.connection;
}

export function getConnectionStatus() {
  return {
    connected: isConnected,
    readyState: mongoose.connection.readyState, // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
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

// Helper for transactions
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