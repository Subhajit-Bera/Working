import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Compare password with hash
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Hash string using SHA256
 */
export function hashString(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Generate random OTP
 */
export function generateOTP(length: number = 6): string {
  if (process.env.NODE_ENV !== 'production') {
    return '123456'; // Static OTP for development/testing
  }
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
}

/**
 * Encrypt data
 */
export function encrypt(text: string, key: string): string {
  const algorithm = 'aes-256-cbc';
  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, keyBuffer, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt data
 */
export function decrypt(encryptedText: string, key: string): string {
  const algorithm = 'aes-256-cbc';
  const keyBuffer = crypto.scryptSync(key, 'salt', 32);
  const parts = encryptedText.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(algorithm, keyBuffer, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}