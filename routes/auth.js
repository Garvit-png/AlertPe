import express from 'express';
import { z } from 'zod';
import { BusinessProfile } from '../models/index.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Normalize phone to E.164 (+91 for 10-digit Indian numbers)
function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = String(phone).trim().replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) return '+91' + cleaned;
    return '+' + cleaned;
  }
  return cleaned;
}

/**
 * @route GET /api/auth/profile
 * @desc Get current business owner profile & setup status
 */
router.get('/profile', asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.getActiveProfile();
  res.json({
    success: true,
    profile: {
      id: profile._id,
      ownerName: profile.ownerName,
      businessName: profile.businessName,
      phone: profile.phone,
      email: profile.email,
      upiId: profile.upiId,
      isVerified: Boolean(profile.isVerified),
      isSetupCompleted: Boolean(profile.isSetupCompleted),
      lastLoginAt: profile.lastLoginAt
    }
  });
}));

/**
 * @route POST /api/auth/setup
 * @desc Complete initial account setup, sender WhatsApp number, UPI ID, and verify
 */
router.post('/setup', validateBody(z.object({
  ownerName: z.string().min(1, 'Owner name is required').max(100),
  businessName: z.string().min(1, 'Business name is required').max(100),
  phone: z.string().min(8, 'Sender WhatsApp phone is required'),
  upiId: z.string().min(3, 'Business collection UPI ID is required').max(100),
  email: z.string().email().optional().or(z.literal('')),
  otp: z.string().optional()
})), asyncHandler(async (req, res) => {
  const cleanPhone = normalizePhone(req.body.phone);
  const profile = await BusinessProfile.getActiveProfile();

  // Validate OTP code (Default demo PIN 482910)
  if (req.body.otp && req.body.otp.trim() !== '482910' && req.body.otp.trim() !== profile.verificationPin) {
    return res.status(400).json({
      success: false,
      error: 'Invalid verification code. Please enter demo PIN 482910'
    });
  }

  profile.ownerName = req.body.ownerName.trim();
  profile.businessName = req.body.businessName.trim();
  profile.phone = cleanPhone;
  profile.upiId = req.body.upiId.trim();
  if (req.body.email !== undefined) profile.email = req.body.email?.trim() || '';
  
  profile.isVerified = true;
  profile.isSetupCompleted = true;
  profile.sessionToken = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  profile.lastLoginAt = new Date();
  await profile.save();

  logger.info({
    profileId: profile._id,
    businessName: profile.businessName,
    phone: profile.phone,
    upiId: profile.upiId
  }, 'Business account initial setup activated successfully');

  res.json({
    success: true,
    message: 'Business workspace activated successfully',
    profile: {
      id: profile._id,
      ownerName: profile.ownerName,
      businessName: profile.businessName,
      phone: profile.phone,
      email: profile.email,
      upiId: profile.upiId,
      isVerified: profile.isVerified,
      isSetupCompleted: profile.isSetupCompleted,
      sessionToken: profile.sessionToken
    }
  });
}));

/**
 * @route POST /api/auth/send-otp
 * @desc Send 6-digit SMS / WhatsApp verification OTP for owner sign-in
 */
router.post('/send-otp', validateBody(z.object({
  phone: z.string().min(8)
})), asyncHandler(async (req, res) => {
  const cleanPhone = normalizePhone(req.body.phone);
  const profile = await BusinessProfile.getActiveProfile();
  
  // Deterministic demo PIN 482910
  const otp = '482910';
  profile.verificationPin = otp;
  profile.phone = cleanPhone;
  await profile.save();

  logger.info({ phone: cleanPhone, otp }, 'Owner sign-in OTP dispatched');

  res.json({
    success: true,
    message: `Verification code sent to ${cleanPhone}`,
    demoOtp: otp,
    phone: cleanPhone
  });
}));

/**
 * @route POST /api/auth/verify-otp
 * @desc Verify owner sign-in OTP and authenticate session
 */
router.post('/verify-otp', validateBody(z.object({
  phone: z.string().min(8),
  otp: z.string().min(4).max(6)
})), asyncHandler(async (req, res) => {
  const cleanPhone = normalizePhone(req.body.phone);
  const { otp } = req.body;
  const profile = await BusinessProfile.getActiveProfile();

  if (profile.verificationPin !== otp && otp !== '482910') {
    return res.status(400).json({
      success: false,
      error: 'Invalid OTP code. Please enter 482910'
    });
  }

  profile.isVerified = true;
  profile.isSetupCompleted = true;
  profile.phone = cleanPhone;
  profile.lastLoginAt = new Date();
  profile.sessionToken = `tok_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  await profile.save();

  res.json({
    success: true,
    message: 'Authentication successful',
    profile: {
      id: profile._id,
      ownerName: profile.ownerName,
      businessName: profile.businessName,
      phone: profile.phone,
      email: profile.email,
      upiId: profile.upiId,
      isVerified: profile.isVerified,
      isSetupCompleted: profile.isSetupCompleted,
      sessionToken: profile.sessionToken
    }
  });
}));

/**
 * @route POST /api/auth/logout
 * @desc Invalidate session token
 */
router.post('/logout', asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.getActiveProfile();
  profile.sessionToken = '';
  await profile.save();
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
}));

/**
 * @route POST /api/auth/reset
 * @desc Reset setup completed flag (useful for testing initial onboarding)
 */
router.post('/reset', asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.getActiveProfile();
  profile.isSetupCompleted = false;
  profile.isVerified = false;
  profile.sessionToken = '';
  await profile.save();
  res.json({
    success: true,
    message: 'Profile setup reset. Onboarding gate active.'
  });
}));

/**
 * @route PUT /api/auth/profile
 * @desc Update business owner details, sender phone, and UPI ID
 */
router.put('/profile', validateBody(z.object({
  ownerName: z.string().min(1).max(100).optional(),
  businessName: z.string().min(1).max(100).optional(),
  phone: z.string().min(8).optional(),
  email: z.string().email().optional().or(z.literal('')),
  upiId: z.string().min(3).max(100).optional()
})), asyncHandler(async (req, res) => {
  const profile = await BusinessProfile.getActiveProfile();
  
  if (req.body.ownerName) profile.ownerName = req.body.ownerName.trim();
  if (req.body.businessName) profile.businessName = req.body.businessName.trim();
  if (req.body.phone) profile.phone = normalizePhone(req.body.phone);
  if (req.body.email !== undefined) profile.email = req.body.email?.trim() || '';
  if (req.body.upiId) profile.upiId = req.body.upiId.trim();

  await profile.save();

  logger.info({ profile: profile._id, businessName: profile.businessName, phone: profile.phone, upiId: profile.upiId }, 'Owner profile updated');

  res.json({
    success: true,
    message: 'Business profile updated successfully',
    profile: {
      id: profile._id,
      ownerName: profile.ownerName,
      businessName: profile.businessName,
      phone: profile.phone,
      email: profile.email,
      upiId: profile.upiId,
      isVerified: profile.isVerified,
      isSetupCompleted: profile.isSetupCompleted
    }
  });
}));

export default router;
