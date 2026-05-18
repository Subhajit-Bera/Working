import { BookingStatus } from '@prisma/client';
import { prisma } from '../config/database';

export const CHAT_POST_COMPLETION_HOURS_CUSTOMER = 24;
export const CHAT_POST_COMPLETION_HOURS_BUDDY = 12;

export interface CommunicationOptions {
  channel: 'chat' | 'call';
}

export interface CommunicationCapabilities {
  role: 'CUSTOMER' | 'BUDDY' | 'NONE';
  canChat: boolean;
  canCall: boolean;
  chatReason?: string;
  callReason?: string;
}

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

export const getCommunicationCapabilities = async (
  userId: string,
  bookingId: string
): Promise<CommunicationCapabilities> => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      userId: true,
      status: true,
      completedAt: true,
      assignments: {
        where: { status: { in: ['ACCEPTED', 'ON_WAY', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED'] } },
        select: { buddyId: true },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    }
  });

  if (!booking) return { role: 'NONE', canChat: false, canCall: false, chatReason: 'Booking not found', callReason: 'Booking not found' };

  const assignedBuddyUserId = booking.assignments[0]?.buddyId;
  const isCustomer = booking.userId === userId;
  const isBuddy = assignedBuddyUserId === userId;

  if (!isCustomer && !isBuddy) {
    return { role: 'NONE', canChat: false, canCall: false, chatReason: 'Unauthorized', callReason: 'Unauthorized' };
  }

  const role = isCustomer ? 'CUSTOMER' : 'BUDDY';

  // Base customer rules (Call and Chat are identical)
  if (isCustomer) {
    const allowedCustomerStatuses: BookingStatus[] = [
      BookingStatus.ASSIGNED, BookingStatus.ACCEPTED, BookingStatus.ON_WAY,
      BookingStatus.ARRIVED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED
    ];

    if (!allowedCustomerStatuses.includes(booking.status)) {
      return { role, canChat: false, canCall: false, chatReason: 'Not available for this status', callReason: 'Not available for this status' };
    }

    if (booking.status === BookingStatus.COMPLETED && booking.completedAt) {
      const hoursSinceCompletion = (Date.now() - new Date(booking.completedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSinceCompletion > CHAT_POST_COMPLETION_HOURS_CUSTOMER) {
        return { role, canChat: false, canCall: false, chatReason: 'Window expired', callReason: 'Window expired' };
      }
    }
    return { role, canChat: true, canCall: true };
  }

  // Base Buddy Rules
  const activeBuddyStatuses: BookingStatus[] = [
    BookingStatus.ON_WAY, BookingStatus.ARRIVED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED
  ];
  
  let canCall = true;
  let canChat = true;

  if (!activeBuddyStatuses.includes(booking.status)) {
    canCall = false;
    canChat = false;
  }

  let hoursSinceCompletion = 0;
  if (booking.status === BookingStatus.COMPLETED && booking.completedAt) {
    hoursSinceCompletion = (Date.now() - new Date(booking.completedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceCompletion > CHAT_POST_COMPLETION_HOURS_BUDDY) {
      canCall = false;
      canChat = false;
    }
  }

  // If chat is denied, check for "Unread Grace" / Unlock logic
  if (!canChat) {
    // Determine if customer sent a message that unlocks chat
    let query: any = { bookingId, senderId: booking.userId };
    
    if (booking.status === BookingStatus.ACCEPTED) {
       // Pre-navigation: check if there's ANY message from customer
       query = { ...query };
    } else if (booking.status === BookingStatus.COMPLETED && hoursSinceCompletion > CHAT_POST_COMPLETION_HOURS_BUDDY) {
       // Post 12h: Unread message OR message sent after the 12h mark
       if (hoursSinceCompletion > CHAT_POST_COMPLETION_HOURS_CUSTOMER) {
         // Even unlocked, max 24h
         query = null; 
       } else {
         const twelveHoursPostCompletion = new Date(booking.completedAt!.getTime() + (CHAT_POST_COMPLETION_HOURS_BUDDY * 60 * 60 * 1000));
         query.OR = [
           { isRead: false },
           { createdAt: { gt: twelveHoursPostCompletion } }
         ];
       }
    } else {
       query = null;
    }

    if (query) {
       const customerMessage = await prisma.chatMessage.findFirst({
         where: query,
         select: { id: true }
       });
       if (customerMessage) {
         canChat = true;
       }
    }
  }

  return { role, canChat, canCall };
};

export const validateCommunicationAccess = async (
  userId: string,
  bookingId: string,
  options: CommunicationOptions
): Promise<CommunicationAccessResult | null> => {
  
  const caps = await getCommunicationCapabilities(userId, bookingId);
  if (options.channel === 'chat' && !caps.canChat) return null;
  if (options.channel === 'call' && !caps.canCall) return null;

  // Re-fetch booking for the access result payload
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
  const isCustomer = caps.role === 'CUSTOMER';
  const isBuddy = caps.role === 'BUDDY';

  const recipientUserId = isCustomer ? assignedBuddyUserId! : booking.userId;
  const callerInfo = isCustomer ? booking.user : booking.assignments[0]?.buddy?.user!;

  return {
    booking,
    isCustomer,
    isBuddy,
    recipientUserId,
    callerInfo,
    assignedBuddyUserId: assignedBuddyUserId!
  };
};
