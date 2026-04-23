// /**
//  * Sleep utility
//  */
// export function sleep(ms: number): Promise<void> {
//   return new Promise((resolve) => setTimeout(resolve, ms));
// }

// /**
//  * Retry async function with exponential backoff
//  */
// export async function retry<T>(
//   fn: () => Promise<T>,
//   options: {
//     retries?: number;
//     delay?: number;
//     backoff?: number;
//   } = {}
// ): Promise<T> {
//   const { retries = 3, delay = 1000, backoff = 2 } = options;

//   try {
//     return await fn();
//   } catch (error) {
//     if (retries <= 0) {
//       throw error;
//     }

//     await sleep(delay);
//     return retry(fn, {
//       retries: retries - 1,
//       delay: delay * backoff,
//       backoff,
//     });
//   }
// }

// /**
//  * Chunk array into smaller arrays
//  */
// export function chunkArray<T>(array: T[], size: number): T[][] {
//   const chunks: T[][] = [];
//   for (let i = 0; i < array.length; i += size) {
//     chunks.push(array.slice(i, i + size));
//   }
//   return chunks;
// }

// /**
//  * Calculate percentage
//  */
// export function calculatePercentage(value: number, total: number): number {
//   if (total === 0) return 0;
//   return (value / total) * 100;
// }

// /**
//  * Format duration in milliseconds to human-readable string
//  */
// export function formatDuration(ms: number): string {
//   if (ms < 1000) return `${ms}ms`;
//   if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
//   if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
//   return `${(ms / 3600000).toFixed(2)}h`;
// }

// /**
//  * Safe JSON parse
//  */
// export function safeJsonParse<T>(str: string, fallback: T): T {
//   try {
//     return JSON.parse(str);
//   } catch {
//     return fallback;
//   }
// }

// /**
//  * Batch process with concurrency limit
//  */
// export async function batchProcess<T, R>(
//   items: T[],
//   processor: (item: T) => Promise<R>,
//   options: {
//     concurrency?: number;
//     onProgress?: (completed: number, total: number) => void;
//   } = {}
// ): Promise<R[]> {
//   const { concurrency = 5, onProgress } = options;
//   const results: R[] = [];
//   let completed = 0;

//   for (let i = 0; i < items.length; i += concurrency) {
//     const batch = items.slice(i, i + concurrency);
//     const batchResults = await Promise.all(batch.map(processor));
//     results.push(...batchResults);
//     completed += batch.length;

//     if (onProgress) {
//       onProgress(completed, items.length);
//     }
//   }

//   return results;
// }

// /**
//  * Debounce function
//  */
// export function debounce<T extends (...args: any[]) => any>(
//   func: T,
//   wait: number
// ): (...args: Parameters<T>) => void {
//   let timeout: NodeJS.Timeout | null = null;

//   return function executedFunction(...args: Parameters<T>) {
//     const later = () => {
//       timeout = null;
//       func(...args);
//     };

//     if (timeout) {
//       clearTimeout(timeout);
//     }
//     timeout = setTimeout(later, wait);
//   };
// }

// /**
//  * Throttle function
//  */
// export function throttle<T extends (...args: any[]) => any>(
//   func: T,
//   limit: number
// ): (...args: Parameters<T>) => void {
//   let inThrottle: boolean;

//   return function executedFunction(...args: Parameters<T>) {
//     if (!inThrottle) {
//       func(...args);
//       inThrottle = true;
//       setTimeout(() => (inThrottle = false), limit);
//     }
//   };
// }


import { logger } from './logger';

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry async function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    delay?: number;
    backoff?: number;
  } = {}
): Promise<T> {
  const { retries = 3, delay = 1000, backoff = 2 } = options;

  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) {
      throw error;
    }
    logger.warn(`Retrying function... ${retries} retries left. Delaying ${delay}ms.`);
    await sleep(delay);
    return retry(fn, {
      retries: retries - 1,
      delay: delay * backoff,
      backoff,
    });
  }
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Calculate percentage
 */
export function calculatePercentage(value: number, total: number): number {
  if (total === 0) return 0;
  return (value / total) * 100;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * Safe JSON parse
 */
export function safeJsonParse<T>(str: string | undefined | null, fallback: T): T {
  if (!str) {
    return fallback;
  }
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Batch process with concurrency limit
 */
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  options: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): Promise<R[]> {
  const { concurrency = 5, onProgress } = options;
  const results: R[] = [];
  let completed = 0;

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    completed += batch.length;

    if (onProgress) {
      onProgress(completed, items.length);
    }
  }

  return results;
}