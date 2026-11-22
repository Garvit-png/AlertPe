import app from '../server.js';
import { connectDB } from '../services/db.js';

let isDbInitialized = false;

/**
 * Vercel Serverless Function Entrypoint
 * Handles all /api/* requests and serves the Express application.
 */
export default async function handler(req, res) {
  if (!isDbInitialized) {
    try {
      await connectDB();
    } catch (err) {
      console.warn('DB initialization warning in serverless handler:', err?.message);
    }
    isDbInitialized = true;
  }

  return app(req, res);
}
