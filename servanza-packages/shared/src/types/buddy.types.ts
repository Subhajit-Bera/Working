import { User } from './user.types';

export enum DayOfWeek {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY',
}

// Bank Details Interface
export interface BankDetails {
  accountNumber?: string;
  ifscCode?: string;
  accountHolderName?: string;
  bankName?: string;
}

// Emergency Contact Interface
export interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

// Documents Interface
export interface Documents {
  aadhaar?: string;
  pan?: string;
  drivingLicense?: string;
  rcBook?: string;
  vehicleImage?: string;
}

export interface Buddy {
  id: string;
  bio?: string;
  skills: string[];
  experience?: number;
  languages: string[];
  
  // New Profile Fields
  dob?: string;
  whatsapp?: string;
  secondaryPhone?: string;
  bloodGroup?: string;
  city?: string;
  permanentAddress?: string;
  currentAddress?: string;
  
  // Progress Tracking Objects
  bankDetails?: BankDetails;
  emergencyContact?: EmergencyContact;
  documents?: Documents;
  
  rating: number;
  totalRatings: number;
  totalJobs: number;
  completionRate: number;
  isAvailable: boolean;
  isOnline: boolean;
  isVerified: boolean;
  verifiedAt?: Date;
  maxRadius: number;
  lastLocationLat?: number;
  lastLocationLong?: number;
  lastLocationTime?: Date;
  totalEarnings: number;
  createdAt: Date;
  updatedAt: Date;
  user?: User;
}

export interface BuddySchedule {
  id: string;
  buddyId: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM format
  endTime: string; // HH:MM format
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocationEvent {
  id: string;
  buddyId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface UpdateBuddyProfileDto {
  bio?: string;
  skills?: string[];
  experience?: number;
  languages?: string[];
  maxRadius?: number;
  
  // New fields
  dob?: string;
  whatsapp?: string;
  secondaryPhone?: string;
  bloodGroup?: string;
  city?: string;
  permanentAddress?: string;
  currentAddress?: string;
  bankDetails?: BankDetails;
  emergencyContact?: EmergencyContact;
  documents?: Documents;
}

export interface UpdateAvailabilityDto {
  isAvailable?: boolean;
  isOnline?: boolean;
}

export interface UpdateScheduleDto {
  schedules: Array<{
    dayOfWeek: DayOfWeek;
    startTime: string;
    endTime: string;
    isActive: boolean;
  }>;
}

export interface BuddyLocation {
  buddyId: string;
  name: string;
  latitude: number;
  longitude: number;
  lastUpdate: Date;
  isOnline: boolean;
  isAvailable: boolean;
  currentBooking?: {
    id: string;
    service: string;
    customerAddress: string;
  };
}

export interface BuddyEarnings {
  totalEarnings: number;
  totalJobs: number;
  today: {
    amount: number;
    count: number;
  };
  thisWeek: {
    amount: number;
    count: number;
  };
  thisMonth: {
    amount: number;
    count: number;
  };
}
