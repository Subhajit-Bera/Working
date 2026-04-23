import { Router } from 'express';
import multer from 'multer';
import { BuddyDocumentsController } from '../controllers/buddy-documents.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { UserRole } from '@prisma/client';

const router = Router();
const buddyDocumentsController = new BuddyDocumentsController();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'image/jpeg',
      'image/jpg',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: PDF, DOC, DOCX, PNG, JPEG, JPG'));
    }
  },
});

// All routes require authentication
router.use(authenticate);

// Buddy document management 
router.post(
  '/upload',
  authorize(UserRole.BUDDY),
  upload.single('file'),
  buddyDocumentsController.uploadDocument
);

// Profile image upload
router.post(
  '/upload-profile-image',
  authorize(UserRole.BUDDY),
  upload.single('file'),
  buddyDocumentsController.uploadProfileImage
);

// Get all documents for authenticated buddy
router.get(
  '/',
  authorize(UserRole.BUDDY),
  buddyDocumentsController.getDocuments
);

// Delete a specific document
router.delete(
  '/:documentType',
  authorize(UserRole.BUDDY),
  buddyDocumentsController.deleteDocument
);

// Admin routes for document verification
router.post(
  '/verify/:buddyId/:documentType',
  authorize(UserRole.ADMIN),
  buddyDocumentsController.verifyDocument
);

// Admin route to get documents for a specific buddy
router.get(
  '/:buddyId',
  authorize(UserRole.ADMIN),
  buddyDocumentsController.getBuddyDocuments
);

export default router;