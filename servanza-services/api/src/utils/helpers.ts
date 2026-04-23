import { Response } from 'express';

/**
 * Send success response
 */
export function sendSuccess(res: Response, data: any, message?: string, statusCode: number = 200) {
  res.status(statusCode).json({
    success: true,
    ...(message && { message }),
    data,
  });
}

/**
 * Send error response
 */
export function sendError(res: Response, message: string, statusCode: number = 400, errors?: any) {
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(errors && { errors }),
    },
  });
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse boolean from string
 */
export function parseBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
}

/**
 * Remove undefined values from object
 */
export function removeUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Paginate array
 */
export function paginate<T>(array: T[], page: number = 1, limit: number = 10) {
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const items = array.slice(startIndex, endIndex);

  return {
    items,
    pagination: {
      page,
      limit,
      total: array.length,
      pages: Math.ceil(array.length / limit),
    },
  };
}

/**
 * Calculate pagination metadata
 */
export function calculatePagination(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    pages: totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Format date
 */
export function formatDate(date: Date, format: string = 'yyyy-MM-dd'): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('yyyy', String(year))
    .replace('MM', month)
    .replace('dd', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * Chunk array
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Retry async function
 */
export async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retry(fn, retries - 1, delay * 2);
  }
}