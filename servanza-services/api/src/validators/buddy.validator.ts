import { z } from 'zod';

// Bank Details Schema - supports both account details and document upload
const bankDetailsSchema = z.object({
  // Account details method
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  accountHolderName: z.string().optional(),
  bankName: z.string().optional(),
  // Document upload method
  bankDocument: z.string().url().optional(),
}).refine(
  (data) => {
    // Either all account details OR bankDocument must be provided
    const hasAccountDetails = data.accountNumber && data.ifscCode && data.accountHolderName;
    const hasDocument = data.bankDocument;
    return hasAccountDetails || hasDocument;
  },
  {
    message: 'Either account details (accountNumber, ifscCode, accountHolderName) or bankDocument must be provided',
  }
).optional();

// Emergency Contact Schema
const emergencyContactSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  relationship: z.string().optional(),
}).optional();

// Documents Schema - updated for new structure
const documentsSchema = z.object({
  aadhaarFront: z.string().url().optional(),
  aadhaarBack: z.string().url().optional(),
  pan: z.string().url().optional(),
  bankDocument: z.string().url().optional(),
}).optional();

// export const updateBuddyProfileSchema = z.object({
//   body: z.object({
//     name: z.string().min(2).optional(),
//     email: z.string().email().optional(),

//     bio: z.string().max(500).optional(),
//     experience: z.number().int().min(0).max(50).optional(),
//     languages: z.array(z.string()).optional(),
//     maxRadius: z.number().int().min(1).max(100).optional(),
//     workingAreas: z.any().optional(), // JSON
    
//     // New profile fields
//     dob: z.string().optional(),
//     whatsapp: z.string().optional(),
//     secondaryPhone: z.string().optional(),
//     bloodGroup: z.string().optional(),
//     permanentAddress: z.string().max(500).optional(),
//     currentAddress: z.string().max(500).optional(),

//     // Added Missing Fields
//     city: z.string().optional(),
//     profileImage: z.string().optional(), 
    
//     // Progress tracking objects
//     bankDetails: bankDetailsSchema,
//     emergencyContact: emergencyContactSchema,
//     documents: documentsSchema,
    
//     // For Service Selection
//     serviceIds: z.array(z.string()).optional(),
//   }),
// });

export const updateBuddyProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2).optional(),
    email: z.string().email().optional(),
    bio: z.string().max(500).optional(),
    experience: z.number().int().min(0).max(50).optional(),
    languages: z.array(z.string()).optional(),
    maxRadius: z.number().int().min(1).max(100).optional(),
    workingAreas: z.any().optional(),
    
    dob: z.string().optional(),
    whatsapp: z.string().optional(),
    secondaryPhone: z.string().optional(),
    bloodGroup: z.string().optional(),
    permanentAddress: z.string().max(500).optional(),
    currentAddress: z.string().max(500).optional(),
    city: z.string().optional(),
    profileImage: z.string().optional(), 
    
    // Training fields
    trainingStartDate: z.string().optional(), // Accepts ISO string

    // Bank details with method
    bankDetails: bankDetailsSchema,
    bankDetailsMethod: z.enum(['ACCOUNT_DETAILS', 'DOCUMENT_UPLOAD']).optional(),
    
    emergencyContact: emergencyContactSchema,
    documents: documentsSchema,
    serviceIds: z.array(z.string()).optional(),
  }),
});

export const updateAvailabilitySchema = z.object({
  body: z.object({
    isAvailable: z.boolean().optional(),
    isOnline: z.boolean().optional(),
  }),
});

export const updateScheduleSchema = z.object({
  body: z.object({
    schedules: z.array(
      z.object({
        dayOfWeek: z.enum(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']),
        startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
        isActive: z.boolean(),
      })
    ),
  }),
});

export const checkPhoneSchema = z.object({
  body: z.object({
    phone: z.string().min(10, "Phone number is required"),
    role: z.string().optional(),
  })
});