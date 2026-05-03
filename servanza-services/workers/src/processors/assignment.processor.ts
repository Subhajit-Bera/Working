import { Job } from 'bullmq';
import { prisma } from '../config/database';
import { Prisma, BookingStatus, AssignmentStatus } from '@prisma/client';
import { logger } from '../utils/logger';
import { addNotificationJob } from '../config/queue';
import { GeoService } from '../services/geospatial.service';
import { emitToBuddy } from '../utils/socket-emitter';

interface AssignmentJobData { bookingId: string; }

/**
 * Assignment Processor
 * 
 * Handles buddy assignment differently based on booking type:
 * - Immediate: Nearby buddies only, busy filter, expanding search if needed
 * - Non-Immediate: ALL available buddies, no location/busy filter
 */
export const assignmentProcessor = async (job: Job<AssignmentJobData>) => {
  const { bookingId } = job.data;
  const geoService = new GeoService();

  // ===== POISON PILL DETECTION =====
  // Validate payload to prevent crash loops from malformed jobs
  if (!bookingId || typeof bookingId !== 'string' || bookingId.length < 10) {
    logger.error(`[Assignment] POISON PILL detected - invalid bookingId: ${JSON.stringify(job.data)}`);
    // Return success to prevent retries - job is malformed and will never succeed
    return { success: false, poisonPill: true, reason: 'Invalid job payload - missing or malformed bookingId' };
  }

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { service: true, address: true, user: true },
    });

    if (!booking) throw new Error(`Booking ${bookingId} not found`);
    if (booking.status !== BookingStatus.PENDING) return { success: false, reason: 'Not pending' };

    // Get excluded buddies (those who rejected after accepting)
    const excludedIds = new Set(booking.excludedBuddyIds || []);

    let selectedBuddies: Array<{ id: string; distance: number; eta: number }> = [];

    if (booking.isImmediate) {
      // ========== IMMEDIATE BOOKING LOGIC ==========
      selectedBuddies = await handleImmediateBooking(booking, excludedIds, geoService);
    } else {
      // ========== NON-IMMEDIATE BOOKING LOGIC ==========
      selectedBuddies = await handleNonImmediateBooking(booking, excludedIds, geoService);
    }

    if (selectedBuddies.length === 0) {
      logger.info(`[Assignment] No available buddies for booking ${bookingId}`);
      return { success: false, reason: 'No available buddies' };
    }

    // Create assignments in a TRANSACTION for atomicity and idempotency
    // Using upsert prevents duplicates if job retries after partial completion
    const assignments = await prisma.$transaction(async (tx) => {
      const created: Array<{ id: string; buddyId: string; eta: number; distance: number }> = [];

      for (const buddy of selectedBuddies) {
        // Use upsert to prevent duplicate assignments on job retry
        const assignment = await tx.assignment.upsert({
          where: {
            bookingId_buddyId: {
              bookingId: booking.id,
              buddyId: buddy.id,
            },
          },
          update: {
            // No-op if already exists - assignment already sent
            estimatedEtaMins: Math.ceil(buddy.eta),
            distanceKm: buddy.distance,
          },
          create: {
            bookingId: booking.id,
            buddyId: buddy.id,
            status: AssignmentStatus.PENDING,
            estimatedEtaMins: Math.ceil(buddy.eta),
            distanceKm: buddy.distance,
          },
        });

        created.push({ id: assignment.id, buddyId: buddy.id, eta: buddy.eta, distance: buddy.distance });
      }

      return created;
    });

    // Send notifications AFTER transaction commits (outside transaction)
    for (const assignment of assignments) {
      const jobPayload = {
        assignmentId: assignment.id,
        bookingId: booking.id,
        serviceTitle: booking.service.title,
        address: booking.address.formattedAddress,
        distance: assignment.distance.toFixed(1),
        price: booking.employeePayout,
        isImmediate: booking.isImmediate,
        scheduledStart: booking.scheduledStart.toISOString(),
      };

      // Send push notification
      await addNotificationJob('buddy-assignment', assignment.buddyId, jobPayload);

      // Emit socket event for real-time
      emitToBuddy(assignment.buddyId, 'job:assigned', jobPayload);

      logger.info(`[Assignment] Created/updated assignment ${assignment.id} for buddy ${assignment.buddyId}`);
    }

    return { success: true, count: assignments.length, isImmediate: booking.isImmediate };

  } catch (error) {
    logger.error(`[Assignment] Failed for booking ${bookingId}:`, error);
    throw error;
  }
};

/**
 * Handle IMMEDIATE Booking Assignment
 * 
 * 1. Find nearby buddies within MAX_RADIUS
 * 2. Filter out busy buddies (overlapping schedules)
 * 3. If candidates < 5, expand search by +3km
 * 4. If still < 7, get ALL available buddies and filter busy
 * 5. Select top candidates by ETA
 */
async function handleImmediateBooking(
  booking: any,
  excludedIds: Set<string>,
  geoService: GeoService
): Promise<Array<{ id: string; distance: number; eta: number }>> {

  const configs = await prisma.config.findMany({
    where: { key: { in: ['MAX_BUDDY_RADIUS', 'MIN_GAP_MINUTES'] } }
  });
  const configMap = new Map(configs.map((c: any) => [c.key, Number(c.value)]));
  const baseRadiusKm = Number(configMap.get('MAX_BUDDY_RADIUS') ?? 10);
  const minGapMinutes = Number(configMap.get('MIN_GAP_MINUTES') ?? 30);

  const bookingLocation = { latitude: booking.address.latitude, longitude: booking.address.longitude };

  // Helper to find nearby buddies
  const findNearbyBuddies = async (radiusKm: number) => {
    const radiusMeters = radiusKm * 1000;
    return prisma.$queryRaw<Array<{ id: string; latitude: number; longitude: number; distance: number }>>(Prisma.sql`
      SELECT b.id, ST_Y(b."lastKnownLocation"::geometry) as latitude, 
             ST_X(b."lastKnownLocation"::geometry) as longitude,
             ST_Distance(b."lastKnownLocation", ST_SetSRID(ST_MakePoint(${booking.address.longitude}, ${booking.address.latitude}), 4326)::geography) as distance
      FROM "buddies" b 
      JOIN "users" u ON b.id = u.id 
      WHERE u."isActive" = true AND b."isVerified" = true 
        AND b."isAvailable" = true AND b."isOnline" = true 
        AND b."lastKnownLocation" IS NOT NULL
        AND ST_DWithin(b."lastKnownLocation", ST_SetSRID(ST_MakePoint(${booking.address.longitude}, ${booking.address.latitude}), 4326)::geography, ${radiusMeters})
      ORDER BY distance ASC
    `);
  };

  // Helper to get ALL available buddies (no location filter)
  const findAllAvailableBuddies = async () => {
    return prisma.$queryRaw<Array<{ id: string; latitude: number; longitude: number; distance: number }>>(Prisma.sql`
      SELECT b.id, ST_Y(b."lastKnownLocation"::geometry) as latitude, 
             ST_X(b."lastKnownLocation"::geometry) as longitude,
             ST_Distance(b."lastKnownLocation", ST_SetSRID(ST_MakePoint(${booking.address.longitude}, ${booking.address.latitude}), 4326)::geography) as distance
      FROM "buddies" b 
      JOIN "users" u ON b.id = u.id 
      WHERE u."isActive" = true AND b."isVerified" = true 
        AND b."isAvailable" = true AND b."isOnline" = true 
        AND b."lastKnownLocation" IS NOT NULL
      ORDER BY distance ASC
    `);
  };

  // Helper to filter busy buddies
  const filterBusyBuddies = async (buddyIds: string[]) => {
    if (buddyIds.length === 0) return new Set<string>();

    const newStart = new Date(booking.scheduledStart);
    const newEnd = new Date(booking.scheduledEnd);
    newStart.setMinutes(newStart.getMinutes() - minGapMinutes);
    newEnd.setMinutes(newEnd.getMinutes() + minGapMinutes);

    const activeAssignments = await prisma.assignment.findMany({
      where: {
        buddyId: { in: buddyIds },
        status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.ARRIVED] },
        booking: { scheduledStart: { lt: newEnd }, scheduledEnd: { gt: newStart } },
      },
      select: { buddyId: true },
    });
    return new Set(activeAssignments.map(a => a.buddyId));
  };

  // Helper to process candidates
  const processCandidat = async (
    buddies: Array<{ id: string; latitude: number; longitude: number; distance: number }>,
    busyIds: Set<string>
  ) => {
    const candidates = [];
    for (const buddy of buddies) {
      if (busyIds.has(buddy.id)) continue;
      if (excludedIds.has(buddy.id)) continue;

      const buddyLocation = { latitude: buddy.latitude, longitude: buddy.longitude };
      const eta = await geoService.getETA(buddyLocation, bookingLocation);
      candidates.push({ id: buddy.id, eta, distance: buddy.distance / 1000 });
    }
    candidates.sort((a, b) => a.eta - b.eta);
    return candidates;
  };

  // Step 1: Find nearby buddies within base radius
  logger.info(`[Immediate] Step 1: Searching within ${baseRadiusKm}km`);
  let nearbyBuddies = await findNearbyBuddies(baseRadiusKm);
  let busyIds = await filterBusyBuddies(nearbyBuddies.map(b => b.id));
  let candidates = await processCandidat(nearbyBuddies, busyIds);

  // Step 2: If < 5 candidates, expand by +3km
  if (candidates.length < 5) {
    const expandedRadius = baseRadiusKm + 3;
    logger.info(`[Immediate] Step 2: Only ${candidates.length} found, expanding to ${expandedRadius}km`);
    nearbyBuddies = await findNearbyBuddies(expandedRadius);
    busyIds = await filterBusyBuddies(nearbyBuddies.map(b => b.id));
    candidates = await processCandidat(nearbyBuddies, busyIds);
  }

  // Step 3: If still < 7 candidates, get ALL available buddies
  if (candidates.length < 7) {
    logger.info(`[Immediate] Step 3: Only ${candidates.length} found, searching all available buddies`);
    const allBuddies = await findAllAvailableBuddies();
    busyIds = await filterBusyBuddies(allBuddies.map(b => b.id));
    candidates = await processCandidat(allBuddies, busyIds);
  }

  logger.info(`[Immediate] Final selection: ${candidates.length} candidates`);
  return candidates;
}

/**
 * Handle NON-IMMEDIATE Booking Assignment
 * 
 * 1. Get ALL available+verified+online buddies (no location filter)
 * 2. NO busy filter (they can have overlapping pending offers)
 * 3. Send to all (dispatch/retry queue handles follow-up)
 */
async function handleNonImmediateBooking(
  booking: any,
  excludedIds: Set<string>,
  geoService: GeoService
): Promise<Array<{ id: string; distance: number; eta: number }>> {

  const bookingLocation = { latitude: booking.address.latitude, longitude: booking.address.longitude };

  // Get ALL available buddies (no location filter)
  const allBuddies = await prisma.$queryRaw<Array<{ id: string; latitude: number; longitude: number; distance: number }>>(Prisma.sql`
    SELECT b.id, 
           COALESCE(ST_Y(b."lastKnownLocation"::geometry), 0) as latitude, 
           COALESCE(ST_X(b."lastKnownLocation"::geometry), 0) as longitude,
           COALESCE(ST_Distance(b."lastKnownLocation", ST_SetSRID(ST_MakePoint(${booking.address.longitude}, ${booking.address.latitude}), 4326)::geography), 0) as distance
    FROM "buddies" b 
    JOIN "users" u ON b.id = u.id 
    WHERE u."isActive" = true AND b."isVerified" = true 
      AND b."isAvailable" = true AND b."isOnline" = true
    ORDER BY distance ASC
  `);

  logger.info(`[NonImmediate] Found ${allBuddies.length} available buddies`);

  // No busy filter for non-immediate bookings
  // Filter out excluded buddies and calculate ETA
  const candidates = [];
  for (const buddy of allBuddies) {
    if (excludedIds.has(buddy.id)) continue;

    // Use distance-based ETA estimate if no location
    let eta = 30; // Default 30 mins
    if (buddy.latitude && buddy.longitude) {
      const buddyLocation = { latitude: buddy.latitude, longitude: buddy.longitude };
      try {
        eta = await geoService.getETA(buddyLocation, bookingLocation);
      } catch {
        eta = Math.ceil((buddy.distance / 1000) * 3); // Rough estimate: 3 mins per km
      }
    }
    candidates.push({ id: buddy.id, eta, distance: buddy.distance / 1000 });
  }

  logger.info(`[NonImmediate] Sending to ${candidates.length} buddies`);
  return candidates;
}

export default assignmentProcessor;