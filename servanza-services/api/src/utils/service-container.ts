// Lazy service container - use require() to avoid import-time cycles in Node/ts-node.
export function getNotificationService() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../services/notification.service');
  return new mod.NotificationService();
}
export function getBookingService() {
  const mod = require('../services/booking.service');
  return new mod.BookingService();
}
export function getBuddyService() {
  const mod = require('../services/buddy.service');
  return new mod.BuddyService();
}
export function getPaymentService() {
  const mod = require('../services/payment.service');
  return new mod.PaymentService();
}
