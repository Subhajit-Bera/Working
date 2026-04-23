import { CURRENCY_SYMBOLS } from '../constants';

export const formatCurrency = (amount: number, currency: string = 'INR'): string => {
  const symbol = CURRENCY_SYMBOLS[currency as keyof typeof CURRENCY_SYMBOLS] || currency;
  return `${symbol}${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const formatDate = (date: Date | string, format: 'short' | 'long' | 'datetime' = 'short'): string => {
  const d = typeof date === 'string' ? new Date(date) : date;

  switch (format) {
    case 'short':
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    case 'long':
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    case 'datetime':
      return d.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    default:
      return d.toLocaleDateString('en-IN');
  }
};

export const formatTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes} min${minutes !== 1 ? 's' : ''}`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (mins === 0) {
    return `${hours} hr${hours !== 1 ? 's' : ''}`;
  }

  return `${hours} hr${hours !== 1 ? 's' : ''} ${mins} min${mins !== 1 ? 's' : ''}`;
};

export const formatDistance = (km: number): string => {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }
  return `${km.toFixed(1)} km`;
};

export const formatPhone = (phone: string): string => {
  // Format Indian phone numbers: +91 98765 43210
  if (phone.startsWith('+91') && phone.length === 13) {
    return `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}`;
  }
  return phone;
};

export const formatRating = (rating: number, totalRatings?: number): string => {
  const stars = rating.toFixed(1);
  return totalRatings ? `${stars} ★ (${totalRatings})` : `${stars} ★`;
};

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
};

export const formatPercentage = (value: number, decimals: number = 0): string => {
  return `${value.toFixed(decimals)}%`;
};
