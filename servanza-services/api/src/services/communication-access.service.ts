import { BookingStatus } from '@prisma/client';
import { prisma } from '../config/database';

export const CHAT_POST_COMPLETION_HOURS_CUSTOMER = 24;
export const CHAT_POST_COMPLETION_HOURS_BUDDY = 12;

export interface CommunicationAccessResult {
  booking: any;
  isCustomer: boolean;
  isBuddy: boolean;
  recipientUserId: string;
  callerInfo: {
    id: string;
    name: string;
    profileImage: string | null;
  };
  assignedBuddyUserId: string;
}

export const validateCommunicationAccess = async (
  userId: string,
  bookingId: string
): Promise<CommunicationAccessResult | null> => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      userId: true,
      status: true,
      completedAt: true,
      assignments: {
        where: { status: { in: ['ACCEPTED', 'ON_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] } },
        select: {
          buddyId: true,
          buddy: {
            select: {
              user: { select: { id: true, name: true, profileImage: true } },
            },
          },
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
      user: {
        select: { id: true, name: true, profileImage: true },
      },
    },
  });

  if (!booking) return null;

  const assignedBuddyUserId = booking.assignments[0]?.buddyId;
  if (!assignedBuddyUserId) return null; // Deny if no assigned buddy exists

  const isCustomer = booking.userId === userId;
  const isBuddy = assignedBuddyUserId === userId;

  if (!isCustomer && !isBuddy) return null;

  // Determine allowed statuses based on role
  const allowedCustomerStatuses: BookingStatus[] = [
    BookingStatus.ASSIGNED,
    BookingStatus.ACCEPTED,
    BookingStatus.ON_WAY,
    BookingStatus.ARRIVED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
  ];

  const allowedBuddyStatuses: BookingStatus[] = [
    BookingStatus.ACCEPTED,
    BookingStatus.ON_WAY,
    BookingStatus.ARRIVED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
  ];

  const allowedStatuses = isCustomer ? allowedCustomerStatuses : allowedBuddyStatuses;

  if (!allowedStatuses.includes(booking.status)) return null;

  // Handle COMPLETED window limits
  if (booking.status === BookingStatus.COMPLETED) {
    if (!booking.completedAt) return null; // Deny if completedAt is missing

    const hoursSinceCompletion =
      (Date.now() - new Date(booking.completedAt).getTime()) / (1000 * 60 * 60);

    const limitHours = isCustomer ? CHAT_POST_COMPLETION_HOURS_CUSTOMER : CHAT_POST_COMPLETION_HOURS_BUDDY;

    if (hoursSinceCompletion > limitHours) return null;
  }

  const recipientUserId = isCustomer ? assignedBuddyUserId : booking.userId;
  const callerInfo = isCustomer ? booking.user : booking.assignments[0]?.buddy?.user!;

  return {
    booking,
    isCustomer,
    isBuddy,
    recipientUserId,
    callerInfo,
    assignedBuddyUserId
  };
};
