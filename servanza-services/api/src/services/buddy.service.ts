import { prisma } from '../config/database';
import { AssignmentStatus, BookingStatus, BankDetailsMethod } from '@prisma/client';
import { ApiError } from '../utils/errors';
import { logger } from '../utils/logger';
import { emitToUser, emitToBuddy } from '../utils/realtime';
// import { setImmediate } from 'timers';
import eventBus from '../utils/event-bus';
import { BuddyVerificationService } from './buddy-verification.service';

interface AvailabilityUpdate {
  isAvailable?: boolean;
  isOnline?: boolean;
}

interface ScheduleData {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  isActive: boolean;
}

export class BuddyService {
  private verificationService: BuddyVerificationService;

  constructor() {
    this.verificationService = new BuddyVerificationService();
  }

  /**
   * Get buddy profile
   */
  async getProfile(buddyId: string) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profileImage: true,
          },
        },
        services: {
          select: {
            id: true,
            title: true,
            categoryId: true
          }
        },
        schedules: {
          orderBy: { dayOfWeek: 'asc' },
        },
        verification: true,
      },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy profile not found');
    }

    // Get verification status
    const verificationStatus = await this.verificationService.getVerificationStatus(buddyId);

    // Add verification status to response
    return {
      ...buddy,
      verificationStatus,
    };
  }

  /**
   * Update buddy profile
   * Enhanced with validation for JSON fields and bank details method locking
   */
  async updateProfile(buddyId: string, updates: any) {
    const allowedBuddyFields = [
      'bio',
      'experience',
      'languages',
      'maxRadius',
      'workingAreas',
      'dob',
      'whatsapp',
      'secondaryPhone',
      'bloodGroup',
      'city',
      'permanentAddress',
      'currentAddress',
      'bankDetails',
      'bankDetailsMethod',
      'emergencyContact',
      'documents',
      'trainingStartDate',
    ];

    const allowedUserFields = [
      'name',
      'email',
      'profileImage',
    ];

    const buddyUpdateData: any = {};
    const userUpdateData: any = {};

    // Check existing buddy to enforce bank details method locking
    const existingBuddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: { bankDetailsMethod: true },
    });

    // If buddy already has a bank details method, prevent changing it
    if (existingBuddy?.bankDetailsMethod && updates.bankDetailsMethod) {
      if (updates.bankDetailsMethod !== existingBuddy.bankDetailsMethod) {
        throw new ApiError(400, 'Bank details method cannot be changed once set');
      }
    }

    // Process buddy fields
    for (const field of allowedBuddyFields) {
      if (updates[field] !== undefined) {
        // Special check for trainingStartDate to ensure it's a Date object
        if (field === 'trainingStartDate' && typeof updates[field] === 'string') {
          buddyUpdateData[field] = new Date(updates[field]);
        }
        else if (['bankDetails', 'emergencyContact', 'documents'].includes(field)) {
          if (typeof updates[field] === 'object' && updates[field] !== null) {
            buddyUpdateData[field] = updates[field];
          }
        } else if (field === 'bankDetailsMethod') {
          // Validate enum value
          if (updates[field] && !Object.values(BankDetailsMethod).includes(updates[field])) {
            throw new ApiError(400, `Invalid bankDetailsMethod: ${updates[field]}`);
          }
          buddyUpdateData[field] = updates[field];
        } else {
          buddyUpdateData[field] = updates[field];
        }
      }
    }

    // If bankDetails is being updated, ensure method is set
    if (updates.bankDetails && !buddyUpdateData.bankDetailsMethod && !existingBuddy?.bankDetailsMethod) {
      // Determine method based on bankDetails structure
      const bankDetails = updates.bankDetails as any;
      if (bankDetails.bankDocument) {
        buddyUpdateData.bankDetailsMethod = BankDetailsMethod.DOCUMENT_UPLOAD;
      } else if (bankDetails.accountNumber || bankDetails.ifscCode) {
        buddyUpdateData.bankDetailsMethod = BankDetailsMethod.ACCOUNT_DETAILS;
      }
    }

    // Reset verification for fields that are being updated
    if (updates.bankDetails) {
      await this.verificationService.resetFieldVerification(buddyId, 'bankDetails');
    }
    if (updates.emergencyContact) {
      await this.verificationService.resetFieldVerification(buddyId, 'emergencyContact');
    }
    if (updates.documents) {
      const documents = updates.documents as any;
      if (documents.aadhaarFront) {
        await this.verificationService.resetFieldVerification(buddyId, 'aadhaarFront');
      }
      if (documents.aadhaarBack) {
        await this.verificationService.resetFieldVerification(buddyId, 'aadhaarBack');
      }
      if (documents.pan) {
        await this.verificationService.resetFieldVerification(buddyId, 'pan');
      }
    }

    //Handle Services Relation (Expects 'serviceIds' array in updates)
    if (updates.serviceIds && Array.isArray(updates.serviceIds)) {
      buddyUpdateData.services = {
        set: updates.serviceIds.map((id: string) => ({ id })),
      };
    }

    // Process user fields
    for (const field of allowedUserFields) {
      if (updates[field] !== undefined) {
        userUpdateData[field] = updates[field];
      }
    }

    // Update user table if there are user fields
    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: buddyId },
        data: userUpdateData,
      });
      logger.info(`User profile updated: ${buddyId}`);
    }

    // Update buddy table
    const buddy = await prisma.buddy.update({
      where: { id: buddyId },
      data: buddyUpdateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            profileImage: true,
          },
        },
        services: true,
        verification: true,
      },
    });

    logger.info(`Buddy profile updated: ${buddyId}`);

    // Get verification status
    const verificationStatus = await this.verificationService.getVerificationStatus(buddyId);

    return {
      ...buddy,
      verificationStatus,
    };
  }

  /**
   * Select training start date
   * Buddy can select from next 3 consecutive days from verification date
   */
  async selectTrainingStartDate(buddyId: string, trainingStartDate: Date): Promise<void> {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: { isVerified: true, verifiedAt: true },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    if (!buddy.isVerified) {
      throw new ApiError(400, 'Buddy must be verified before selecting training start date');
    }

    if (!buddy.verifiedAt) {
      throw new ApiError(400, 'Verification date not found');
    }

    // Calculate next 3 consecutive days from verification
    const verifiedDate = new Date(buddy.verifiedAt);
    verifiedDate.setHours(0, 0, 0, 0);

    const minDate = new Date(verifiedDate);
    minDate.setDate(minDate.getDate() + 1); // Next day

    const maxDate = new Date(verifiedDate);
    maxDate.setDate(maxDate.getDate() + 3); // 3 days from verification

    const selectedDate = new Date(trainingStartDate);
    selectedDate.setHours(0, 0, 0, 0);

    if (selectedDate < minDate || selectedDate > maxDate) {
      throw new ApiError(400, 'Training start date must be within next 3 consecutive days from verification');
    }

    await prisma.buddy.update({
      where: { id: buddyId },
      data: { trainingStartDate: selectedDate },
    });

    logger.info(`Training start date selected for buddy ${buddyId}: ${selectedDate.toISOString()}`);
  }

  /**
   * Get availability status
   */
  async getAvailability(buddyId: string) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: {
        isAvailable: true,
        isOnline: true,
        maxRadius: true,
      },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    return buddy;
  }

  /**
   * Update availability
   */
  async updateAvailability(buddyId: string, data: AvailabilityUpdate) {
    const buddy = await prisma.buddy.update({
      where: { id: buddyId },
      data: {
        isAvailable: data.isAvailable,
        isOnline: data.isOnline,
      },
    });

    logger.info(`Buddy availability updated: ${buddyId} - Available: ${data.isAvailable}, Online: ${data.isOnline}`);

    return {
      isAvailable: buddy.isAvailable,
      isOnline: buddy.isOnline,
    };
  }

  /**
   * Get buddy schedule
   */
  async getSchedule(buddyId: string) {
    const schedules = await prisma.buddySchedule.findMany({
      where: { buddyId },
      orderBy: { dayOfWeek: 'asc' },
    });

    return schedules;
  }

  /**
   * Update buddy schedule
   */
  async updateSchedule(buddyId: string, schedules: ScheduleData[]) {
    // Delete existing schedules
    await prisma.buddySchedule.deleteMany({
      where: { buddyId },
    });

    // Create new schedules
    await prisma.buddySchedule.createMany({
      data: schedules.map((schedule) => ({
        buddyId,
        dayOfWeek: schedule.dayOfWeek as any,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        isActive: schedule.isActive,
      })),
    });

    logger.info(`Buddy schedule updated: ${buddyId}`);

    return await this.getSchedule(buddyId);
  }

  /**
   * Get jobs for buddy
   */
  async getJobs(buddyId: string, filters: any) {
    const { status, page = 1, limit = 10 } = filters;

    const where: any = { buddyId };

    if (status) {
      where.status = status;
    } else {
      // By default, show all jobs that are not rejected or cancelled
      // This includes: PENDING, ACCEPTED, ON_WAY, ARRIVED, IN_PROGRESS, COMPLETED
      where.status = {
        in: [
          'PENDING',
          'ACCEPTED',
          'ON_WAY',
          'ARRIVED',
          'IN_PROGRESS',
          'COMPLETED'
        ]
      };
    }

    const [assignments, total] = await Promise.all([
      prisma.assignment.findMany({
        where,
        include: {
          booking: {
            include: {
              service: {
                include: {
                  category: true,
                },
              },
              address: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  profileImage: true,
                },
              },
            },
          },
        },
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.assignment.count({ where }),
    ]);

    return {
      jobs: assignments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get active job
   */
  async getActiveJob(buddyId: string) {
    const assignment = await prisma.assignment.findFirst({
      where: {
        buddyId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
      include: {
        booking: {
          include: {
            service: {
              include: {
                category: true,
              },
            },
            address: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                profileImage: true,
              },
            },
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignment;
  }

  /**
   * Get job history
   */
  async getJobHistory(buddyId: string, filters: any) {
    const { page = 1, limit = 20 } = filters;

    const [assignments, total] = await Promise.all([
      prisma.assignment.findMany({
        where: {
          buddyId,
          status: { in: ['COMPLETED', 'CANCELLED', 'REJECTED'] },
        },
        include: {
          booking: {
            include: {
              service: true,
              address: true,
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
              reviews: true,
            },
          },
        },
        orderBy: { completedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.assignment.count({
        where: {
          buddyId,
          status: { in: ['COMPLETED', 'CANCELLED', 'REJECTED'] },
        },
      }),
    ]);

    return {
      history: assignments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Accept job (Race-condition safe)
   * Uses a transaction to ensure only the first buddy to accept gets the job.
   * Other buddies are notified that the job was taken.
   */
  async acceptJob(buddyId: string, assignmentId: string) {
    // Step 1: Validate assignment belongs to this buddy
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: {
          include: {
            service: true,
            address: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized');
    }

    if (assignment.status !== AssignmentStatus.PENDING) {
      throw new ApiError(400, 'This job offer has expired or already been processed');
    }

    // Step 2: Use atomic UPDATE with status guard to claim the job.
    // This eliminates the TOCTOU race: if two buddies fire simultaneously,
    // only one will match WHERE status = 'PENDING', the other gets 0 rows.
    try {
      await prisma.$transaction(async (tx) => {
        // Atomic claim: only succeeds if booking is still PENDING
        const claimResult = await tx.booking.updateMany({
          where: {
            id: assignment.bookingId,
            status: BookingStatus.PENDING,
          },
          data: {
            status: BookingStatus.ACCEPTED,
          },
        });

        // If no rows were updated, another buddy already claimed it
        if (claimResult.count === 0) {
          throw new ApiError(409, 'JOB_ALREADY_TAKEN');
        }

        // Update this assignment to ACCEPTED
        await tx.assignment.update({
          where: { id: assignmentId },
          data: {
            status: AssignmentStatus.ACCEPTED,
            acceptedAt: new Date(),
          },
        });

        // Cancel all OTHER pending assignments for this booking
        await tx.assignment.updateMany({
          where: {
            bookingId: assignment.bookingId,
            id: { not: assignmentId },
            status: AssignmentStatus.PENDING,
          },
          data: {
            status: AssignmentStatus.CANCELLED,
            cancelledAt: new Date(),
            notes: 'Job accepted by another buddy',
          },
        });

        // Create audit log
        await tx.auditLog.create({
          data: {
            userId: buddyId,
            bookingId: assignment.bookingId,
            assignmentId,
            action: 'ASSIGNMENT_ACCEPTED',
            entity: 'Assignment',
            entityId: assignmentId,
          },
        });
      });

      // Step 3: After successful transaction, send notifications

      // Notify the customer that their booking was accepted
      eventBus.emit('notify:user:accepted', { args: [assignment.booking.userId, assignment.booking] });
      emitToUser(assignment.booking.userId, 'booking:accepted', {
        bookingId: assignment.bookingId,
        assignmentId,
      });

      // Notify OTHER buddies who had pending assignments that the job is taken
      const otherAssignments = await prisma.assignment.findMany({
        where: {
          bookingId: assignment.bookingId,
          id: { not: assignmentId },
        },
        select: { buddyId: true },
      });

      for (const otherAssignment of otherAssignments) {
        emitToBuddy(otherAssignment.buddyId, 'job:taken', {
          bookingId: assignment.bookingId,
          assignmentId: assignmentId,
          message: 'This job has been accepted by another buddy. You will receive more job offers soon!',
        });
      }

      logger.info(`Job accepted: ${assignmentId} by buddy ${buddyId}. Notified ${otherAssignments.length} other buddies.`);

    } catch (error: any) {
      // Handle the specific "job already taken" error gracefully
      if (error.message === 'JOB_ALREADY_TAKEN' || error.statusCode === 409) {
        throw new ApiError(409, 'This job has already been accepted by another buddy. You will receive more job offers soon!');
      }
      throw error;
    }
  }

  /**
   * Reject job
   */
  async rejectJob(buddyId: string, assignmentId: string, reason?: string) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: true,
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized');
    }

    // Check if this was an ACCEPTED assignment being rejected (post-acceptance rejection)
    const wasAccepted = assignment.status === AssignmentStatus.ACCEPTED ||
      assignment.status === AssignmentStatus.ON_WAY ||
      assignment.status === AssignmentStatus.ARRIVED;

    // === ATOMIC TRANSACTION: Rejection limit check + DB updates + Job Backup ===
    // The rejection count MUST be inside the transaction to prevent TOCTOU bypasses
    // under concurrent requests from modified clients.
    const { backupJobInTransaction } = await import('./job-backup.service');
    const { addQueueJobWithBackupId } = await import('../queues/assignment.queue');

    let backupId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // === WEEKLY REJECTION LIMIT VALIDATION (inside transaction) ===
      const MAX_REJECTIONS_PER_WEEK = 2;
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const rejectionsThisWeek = await tx.assignment.count({
        where: {
          buddyId,
          status: AssignmentStatus.REJECTED,
          rejectedAt: { gte: oneWeekAgo },
        },
      });

      if (rejectionsThisWeek >= MAX_REJECTIONS_PER_WEEK) {
        throw new ApiError(
          400,
          `You have already rejected ${rejectionsThisWeek} jobs this week. Maximum allowed is ${MAX_REJECTIONS_PER_WEEK} per week.`
        );
      }

      logger.info(`Buddy ${buddyId} has ${rejectionsThisWeek}/${MAX_REJECTIONS_PER_WEEK} rejections this week`);

      // Update assignment
      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.REJECTED,
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      });

      // Reset booking to PENDING for reassignment
      // If this was a post-acceptance rejection, add buddy to exclusion list
      if (wasAccepted) {
        // Add buddy to exclusion list so they don't get reassigned
        await tx.booking.update({
          where: { id: assignment.bookingId },
          data: {
            status: BookingStatus.PENDING,
            excludedBuddyIds: { push: buddyId },
          },
        });
        logger.info(`Buddy ${buddyId} added to exclusion list for booking ${assignment.bookingId}`);
      } else {
        await tx.booking.update({
          where: { id: assignment.bookingId },
          data: {
            status: BookingStatus.PENDING,
          },
        });
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: buddyId,
          bookingId: assignment.bookingId,
          assignmentId,
          action: wasAccepted ? 'ASSIGNMENT_REJECTED_POST_ACCEPT' : 'ASSIGNMENT_REJECTED',
          entity: 'Assignment',
          entityId: assignmentId,
          changes: { reason, wasAccepted },
        },
      });

      // Create job backup in same transaction
      backupId = await backupJobInTransaction(
        tx,
        'assignment-queue',
        'assign-buddy',
        { bookingId: assignment.bookingId },
        1  // High priority
      );
    });

    logger.info(`Job rejected: ${assignmentId} by buddy ${buddyId}${wasAccepted ? ' (post-acceptance)' : ''}`);

    // Add to queue after transaction commits
    if (backupId) {
      await addQueueJobWithBackupId(assignment.bookingId, backupId, 1);
    }

  }

  /**
   * Get job details for tracking screen
   */
  async getJobDetails(buddyId: string, assignmentId: string) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: {
          include: {
            service: true,
            address: true,
            user: {
              select: {
                id: true,
                name: true,
                phone: true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized');
    }

    return assignment;
  }

  /**
   * Start tracking - sets status to ON_WAY and notifies user
   */
  async startTracking(buddyId: string, assignmentId: string) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: true,
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized');
    }

    if (assignment.status !== AssignmentStatus.ACCEPTED) {
      throw new ApiError(400, 'Job must be accepted before starting tracking');
    }

    // Update status to ON_WAY
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          status: 'ON_WAY' as AssignmentStatus,
        },
      }),
      prisma.booking.update({
        where: { id: assignment.bookingId },
        data: {
          status: 'ON_WAY' as BookingStatus,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: buddyId,
          bookingId: assignment.bookingId,
          assignmentId,
          action: 'BUDDY_ON_WAY',
          entity: 'Assignment',
          entityId: assignmentId,
        },
      }),
    ]);

    // Notify user that buddy is on the way
    emitToUser(assignment.booking.userId, 'buddy:on_way', {
      bookingId: assignment.bookingId,
      assignmentId,
      message: 'Your service provider is on the way!',
    });

    logger.info(`Buddy ${buddyId} started tracking for job ${assignmentId}`);
  }

  async markArrived(buddyId: string, assignmentId: string) {
    // 1. Verify Assignment belongs to buddy
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: true,
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Job not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized access to this job');
    }

    // Ensure logic flow: ACCEPTED -> ON_WAY -> ARRIVED or ACCEPTED -> ARRIVED
    const validStatuses: AssignmentStatus[] = [AssignmentStatus.ACCEPTED, AssignmentStatus.ON_WAY];
    if (!validStatuses.includes(assignment.status)) {
      throw new ApiError(400, 'Job must be accepted or on the way before marking as arrived');
    }

    // 2. Update Status in Transaction
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.ARRIVED,
        },
      }),
      prisma.booking.update({
        where: { id: assignment.bookingId },
        data: {
          status: BookingStatus.ARRIVED,
        },
      }),
      // 3. Create Audit Log
      prisma.auditLog.create({
        data: {
          userId: buddyId,
          bookingId: assignment.bookingId,
          assignmentId,
          action: 'BUDDY_ARRIVED',
          entity: 'Assignment',
          entityId: assignmentId,
        },
      }),
    ]);

    // 4. Notify user via EventBus (decoupled)
    eventBus.emit('notify:user:arrived', { args: [assignment.booking.userId, assignment.booking] });

    // 5. Emit Realtime Event directly to user socket
    emitToUser(assignment.booking.userId, 'booking:arrived', {
      bookingId: assignment.bookingId,
      assignmentId,
      message: 'Buddy at your doorstep',
    });

    logger.info(`Buddy arrived: ${assignmentId} by buddy ${buddyId}`);
  }

  async startJob(buddyId: string, assignmentId: string) {
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: true,
      },
    });

    if (!assignment) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.buddyId !== buddyId) {
      throw new ApiError(403, 'Unauthorized');
    }

    // Job can be started from ACCEPTED or ARRIVED status
    const validStatuses: AssignmentStatus[] = [AssignmentStatus.ACCEPTED, AssignmentStatus.ON_WAY, AssignmentStatus.ARRIVED];
    if (!validStatuses.includes(assignment.status)) {
      throw new ApiError(400, 'Job must be accepted or arrived before starting');
    }

    // Update BOTH assignment status AND booking status in a transaction
    await prisma.$transaction([
      // Update assignment status to IN_PROGRESS and set startedAt
      prisma.assignment.update({
        where: { id: assignmentId },
        data: {
          status: AssignmentStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
      }),
      // Update booking status to IN_PROGRESS
      prisma.booking.update({
        where: { id: assignment.bookingId },
        data: {
          status: BookingStatus.IN_PROGRESS,
        },
      }),
      // Create audit log
      prisma.auditLog.create({
        data: {
          userId: buddyId,
          bookingId: assignment.bookingId,
          assignmentId,
          action: 'JOB_STARTED',
          entity: 'Assignment',
          entityId: assignmentId,
        },
      }),
    ]);

    // Notify user
    eventBus.emit('notify:user:started', { args: [assignment.booking.userId, assignment.booking] });

    emitToUser(assignment.booking.userId, 'booking:started', {
      bookingId: assignment.bookingId,
    });

    logger.info(`Job started: ${assignmentId} by buddy ${buddyId}`);
  }


  /**
   * Complete job
   */
  async completeJob(buddyId: string, assignmentId: string, otp?: string) {
    // centralized function in BookingService
    // Initialize it here -> avoid circular dependency
    const { BookingService } = await import('./booking.service');
    const bookingService = new BookingService();
    await bookingService.completeBookingAndAssignment(
      assignmentId,
      buddyId,
      otp
    );
  }

  /**
   * Updates buddy stats after a job is completed.
   */
  async updateBuddyStatsOnCompletion(buddyId: string, earnings: number) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: { totalJobs: true },
    });

    if (!buddy) {
      logger.error(`Could not find buddy ${buddyId} to update stats.`);
      return;
    }

    // Get total assignments (completed, cancelled by user/buddy)
    const totalResolvedAssignments = await prisma.assignment.count({
      where: {
        buddyId,
        status: {
          in: [
            AssignmentStatus.COMPLETED,
            AssignmentStatus.CANCELLED,
            AssignmentStatus.REJECTED
          ]
        }
      }
    });

    const newTotalCompleted = buddy.totalJobs + 1;

    // We add 1 to totalResolved because this function runs *before* the current job's
    // status is committed if not in a transaction (which it is now, but this is safer)
    const newCompletionRate = (totalResolvedAssignments + 1 > 0)
      ? (newTotalCompleted / (totalResolvedAssignments + 1)) * 100
      : 100; // 100% if this is their first job

    await prisma.buddy.update({
      where: { id: buddyId },
      data: {
        totalJobs: { increment: 1 },
        totalEarnings: { increment: earnings },
        completionRate: newCompletionRate,
        isAvailable: true, // Make buddy available for next job
      },
    });
    logger.info(`Updated stats for buddy ${buddyId}: ${newTotalCompleted} jobs, ${newCompletionRate.toFixed(2)}% completion`);
  }

  /**
   * Get earnings
   */
  async getEarnings(buddyId: string, filters: any) {
    const { startDate, endDate } = filters;

    const where: any = {
      buddyId,
      status: AssignmentStatus.COMPLETED,
    };

    if (startDate) {
      where.completedAt = { gte: startDate };
    }

    if (endDate) {
      where.completedAt = { ...where.completedAt, lte: endDate };
    }

    const assignments = await prisma.assignment.findMany({
      where,
      include: {
        booking: {
          select: {
            id: true,
            totalAmount: true,
            completedAt: true,
            service: {
              select: {
                title: true,
              },
            },
          },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    const totalEarnings = assignments.reduce((sum: number, assignment: any) => sum + assignment.booking.totalAmount, 0);

    return {
      earnings: assignments,
      totalEarnings,
      count: assignments.length,
    };
  }

  /**
   * Get earnings summary
   */
  async getEarningsSummary(buddyId: string) {
    const buddy = await prisma.buddy.findUnique({
      where: { id: buddyId },
      select: {
        totalEarnings: true,
        totalJobs: true,
      },
    });

    if (!buddy) {
      throw new ApiError(404, 'Buddy not found');
    }

    // Get earnings for different time periods
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayEarnings, weekEarnings, monthEarnings] = await Promise.all([
      this.getEarningsForPeriod(buddyId, startOfToday),
      this.getEarningsForPeriod(buddyId, startOfWeek),
      this.getEarningsForPeriod(buddyId, startOfMonth),
    ]);

    return {
      totalEarnings: buddy.totalEarnings,
      totalJobs: buddy.totalJobs,
      today: todayEarnings,
      thisWeek: weekEarnings,
      thisMonth: monthEarnings,
    };
  }

  private async getEarningsForPeriod(buddyId: string, startDate: Date) {
    const assignments = await prisma.assignment.findMany({
      where: {
        buddyId,
        status: AssignmentStatus.COMPLETED,
        completedAt: { gte: startDate },
      },
      include: {
        booking: {
          select: {
            totalAmount: true,
          },
        },
      },
    });

    const total = assignments.reduce((sum: number, assignment: any) => sum + assignment.booking.totalAmount, 0);

    return {
      amount: total,
      count: assignments.length,
    };
  }

  /**
   * Get reviews
   */
  async getReviews(buddyId: string, filters: any) {
    const { page = 1, limit = 10 } = filters;

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where: { buddyId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              profileImage: true,
            },
          },
          booking: {
            select: {
              id: true,
              service: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.review.count({ where: { buddyId } }),
    ]);

    // Calculate rating distribution
    const ratingDistribution = await prisma.review.groupBy({
      by: ['rating'],
      where: { buddyId },
      _count: true,
    });

    return {
      reviews,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      ratingDistribution,
    };
  }

  /**
   * Send OTP to customer for job completion verification
   */
  async sendCompletionOTP(buddyId: string, assignmentId: string) {
    // Verify assignment belongs to buddy and is in valid state
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: {
          include: {
            user: true,
            service: true,
          },
        },
      },
    });

    if (!assignment || assignment.buddyId !== buddyId) {
      throw new ApiError(404, 'Assignment not found');
    }

    // Job must be in progress to send completion OTP
    if (assignment.status !== AssignmentStatus.IN_PROGRESS) {
      throw new ApiError(400, 'Job must be in progress to send completion OTP');
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    console.log(`Generated OTP for assignment ${assignmentId}: ${otp} (expires at ${otpExpiry.toISOString()}`);
    // Store OTP in booking
    await prisma.booking.update({
      where: { id: assignment.bookingId },
      data: {
        completionOtp: otp,
        completionOtpExpiry: otpExpiry,
      },
    });

    // Send notification to user with OTP
    eventBus.emit('notify:user:completion-otp', {
      args: [
        assignment.booking.userId,
        {
          bookingId: assignment.bookingId,
          serviceName: assignment.booking.service.title,
          otp,
        },
      ],
    });

    logger.info(`[BuddyService] Sent completion OTP for assignment ${assignmentId} to user ${assignment.booking.userId}`);
  }

  /**
   * Verify OTP and complete the job
   */
  async verifyCompletionOTP(buddyId: string, assignmentId: string, otp: string) {
    if (!otp) {
      throw new ApiError(400, 'OTP is required');
    }

    // Verify assignment belongs to buddy
    const assignment = await prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        booking: true,
      },
    });

    if (!assignment || assignment.buddyId !== buddyId) {
      throw new ApiError(404, 'Assignment not found');
    }

    if (assignment.status !== AssignmentStatus.IN_PROGRESS) {
      throw new ApiError(400, 'Job must be in progress to complete');
    }

    // Verify OTP
    const booking = assignment.booking;
    if (!booking.completionOtp || booking.completionOtp !== otp) {
      throw new ApiError(400, 'Invalid OTP');
    }

    if (booking.completionOtpExpiry && new Date() > booking.completionOtpExpiry) {
      throw new ApiError(400, 'OTP has expired. Please request a new one.');
    }

    // Complete the job using existing completeJob logic
    await this.completeJob(buddyId, assignmentId, otp);

    // Clear OTP
    await prisma.booking.update({
      where: { id: assignment.bookingId },
      data: {
        completionOtp: null,
        completionOtpExpiry: null,
      },
    });

    logger.info(`[BuddyService] Job ${assignmentId} completed with OTP verification`);
  }
}