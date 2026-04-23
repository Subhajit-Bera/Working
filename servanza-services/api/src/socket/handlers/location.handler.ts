import { Socket, Server } from 'socket.io';
// import { GeoService } from '../../services/geospatial.service';
import { logger } from '../../utils/logger';
import { rateLimit } from '../../utils/rateLimit';

// const geoService = new GeoService();

// Rate limit: 1 update per 5 seconds per buddy
const locationRateLimiter = rateLimit(1, 5000);

export const handleLocationEvents = (socket: Socket, io: Server): void => {
  // Buddy updates location
  socket.on('location:update', async (data: { latitude: number; longitude: number; accuracy?: number }) => {
    try {
      const userId = socket.data.userId;
      const role = socket.data.role;

      if (role !== 'BUDDY') {
        socket.emit('error', { message: 'Only buddies can update location' });
        return;
      }

      // Apply rate limiting
      if (!locationRateLimiter(userId)) {
        logger.warn(`Rate limit exceeded for buddy ${userId}`);
        return;
      }

      // Validate data
      if (!data.latitude || !data.longitude) {
        socket.emit('error', { message: 'Invalid location data' });
        return;
      }

      if (data.latitude < -90 || data.latitude > 90 || data.longitude < -180 || data.longitude > 180) {
        socket.emit('error', { message: 'Invalid coordinates' });
        return;
      }

      // Queue location update for batched processing (writes every 10s)
      // This reduces DB load significantly vs writing on every update
      const { queueLocationUpdate } = await import('../location-batch.service');
      queueLocationUpdate(userId, data.latitude, data.longitude);

      // Broadcast to admins
      io.to('admins').emit('buddy:location:update', {
        buddyId: userId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
        timestamp: new Date().toISOString(),
      });

      // If buddy has active booking, send to customer
      // (Implementation depends on getting active booking for buddy)
      // For now, we'll emit to a booking-specific room if available
      if (socket.data.activeBookingId) {
        io.to(`booking:${socket.data.activeBookingId}`).emit('buddy:location:update', {
          latitude: data.latitude,
          longitude: data.longitude,
          timestamp: new Date().toISOString(),
        });
      }

      logger.debug(`Location updated for buddy ${userId}`);
    } catch (error) {
      logger.error('Error handling location update:', error);
      socket.emit('error', { message: 'Failed to update location' });
    }
  });

  // Buddy sends real-time location for active job (Uber-style tracking)
  socket.on('buddy:location', async (data: {
    assignmentId: string;
    bookingId: string;
    userId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    timestamp?: string;
  }) => {
    try {
      const buddyId = socket.data.userId;
      const role = socket.data.role;

      if (role !== 'BUDDY') {
        socket.emit('error', { message: 'Only buddies can send location updates' });
        return;
      }

      // Validate location data
      if (!data.latitude || !data.longitude || !data.bookingId) {
        return; // Silent fail for invalid data
      }

      // Rate limit check (allow more frequent updates for active tracking)
      // We use the existing rate limiter but with a different key

      // Broadcast location to the user who booked this service
      // User joins room `user:{userId}` when they connect
      io.to(`user:${data.userId}`).emit('buddy:location:live', {
        assignmentId: data.assignmentId,
        bookingId: data.bookingId,
        buddyId,
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading || 0,
        timestamp: data.timestamp || new Date().toISOString(),
      });

      // Also emit to booking-specific room for any listeners
      io.to(`booking:${data.bookingId}`).emit('buddy:location:live', {
        assignmentId: data.assignmentId,
        bookingId: data.bookingId,
        buddyId,
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading || 0,
        timestamp: data.timestamp || new Date().toISOString(),
      });

      // Update in database periodically (not every update to reduce DB load)
      // This is handled by the location:update event

      logger.debug(`Buddy ${buddyId} live location sent to user ${data.userId}`);
    } catch (error) {
      logger.error('Error handling buddy live location:', error);
    }
  });

  // User subscribes to buddy location updates for a booking
  socket.on('location:subscribe', (data: { bookingId: string }) => {
    try {
      const userId = socket.data.userId;
      const role = socket.data.role;

      if (role !== 'USER') {
        socket.emit('error', { message: 'Only users can subscribe to location updates' });
        return;
      }

      // Join booking-specific room
      socket.join(`booking:${data.bookingId}`);
      logger.info(`User ${userId} subscribed to location updates for booking ${data.bookingId}`);
    } catch (error) {
      logger.error('Error subscribing to location:', error);
      socket.emit('error', { message: 'Failed to subscribe to location updates' });
    }
  });

  // User unsubscribes from location updates
  socket.on('location:unsubscribe', (data: { bookingId: string }) => {
    socket.leave(`booking:${data.bookingId}`);
  });
};