import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cashpilot';

let isConnected = false;

export async function connectDB() {
  if (isConnected) {
    logger.debug('MongoDB already connected');
    return mongoose.connection;
  }

  try {
    // Connection options for production resilience
    const options = {
      maxPoolSize: 10,           // Connection pool size
      minPoolSize: 2,            // Minimum connections
      socketTimeoutMS: 45000,    // Close sockets after 45s inactivity
      family: 4,                 // Use IPv4, skip trying IPv6
      autoIndex: process.env.NODE_ENV !== 'production', // Build indexes in dev
      serverSelectionTimeoutMS: 10000, // Timeout for server selection
      heartbeatFrequencyMS: 10000     // Heartbeat interval
    };

    await mongoose.connect(MONGODB_URI, options);
    isConnected = true;
    
    logger.info({ uri: MONGODB_URI.replace(/\/\/.*@/, '//***:***@') }, 'MongoDB connected');
    
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
      logger.info('MongoDB connection closed due to app termination');
      process.exit(0);
    });
    
    return mongoose.connection;
  } catch (error) {
    logger.fatal({ err: error }, 'MongoDB connection failed');
    throw error;
  }
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