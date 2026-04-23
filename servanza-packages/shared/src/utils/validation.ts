import { REGEX_PATTERNS } from '../constants';

export const validateEmail = (email: string): boolean => {
  return REGEX_PATTERNS.EMAIL.test(email);
};

export const validatePhone = (phone: string): boolean => {
  return REGEX_PATTERNS.PHONE.test(phone);
};

export const validatePassword = (password: string): boolean => {
  return REGEX_PATTERNS.PASSWORD.test(password);
};

export const validateOTP = (otp: string): boolean => {
  return REGEX_PATTERNS.OTP.test(otp);
};

export const validateTime = (time: string): boolean => {
  return REGEX_PATTERNS.TIME.test(time);
};

export const validatePostalCode = (postalCode: string): boolean => {
  return REGEX_PATTERNS.POSTAL_CODE.test(postalCode);
};

export const isValidCoordinate = (lat: number, lng: number): boolean => {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
};

export const sanitizeString = (str: string): string => {
  return str.trim().replace(/\s+/g, ' ');
};

export const normalizePhone = (phone: string): string => {
  // Remove all non-digit characters except leading +
  return phone.replace(/[^\d+]/g, '');
};

export const normalizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};