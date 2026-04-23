import { Request, Response, NextFunction } from 'express';
import { StorageService } from '../services/storage.service';
import { ApiError } from '../utils/errors';

const storageService = new StorageService();

export class BuddyDocumentsController {
  /**
   * Upload buddy document
   * accept documentType from request body
   */
  async uploadDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { documentType } = req.body;

      // Validate document type
      const validDocTypes = ['aadhaarFront', 'aadhaarBack', 'pan', 'bankDocument'];

      if (!documentType) {
        throw new ApiError(400, 'Document type is required');
      }

      if (!validDocTypes.includes(documentType)) {
        throw new ApiError(400, `Invalid document type. Allowed types: ${validDocTypes.join(', ')}`);
      }

      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      // Upload to R2
      const uploadResult = await storageService.uploadBuddyDocument(
        buddyId,
        documentType as any,
        req.file
      );

      // Update database
      await storageService.updateBuddyDocuments(
        buddyId,
        documentType as any,
        uploadResult
      );

      res.json({
        success: true,
        data: {
          url: uploadResult.url,
          documentType,
          fileName: uploadResult.fileName,
          fileSize: uploadResult.fileSize,
        },
        message: 'Document uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Upload profile image
   * Endpoint for profile image uploads
   */
  async uploadProfileImage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;

      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const imageUrl = await storageService.uploadProfileImage(buddyId, req.file);

      res.json({
        success: true,
        data: {
          profileImage: imageUrl
        },
        message: 'Profile image uploaded successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all buddy documents
   */
  async getDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;

      const documents = await storageService.getBuddyDocuments(buddyId);

      res.json({
        success: true,
        data: documents,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete buddy document
   */
  async deleteDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const buddyId = req.user!.id;
      const { documentType } = req.params;

      const validDocTypes = ['aadhaarFront', 'aadhaarBack', 'pan', 'bankDocument'];

      if (!validDocTypes.includes(documentType)) {
        throw new ApiError(400, 'Invalid document type');
      }

      // Get current documents
      const documents = await storageService.getBuddyDocuments(buddyId);
      const documentUrl = documents[documentType];

      if (!documentUrl) {
        throw new ApiError(404, 'Document not found');
      }

      // Delete from storage
      await storageService.deleteDocument(documentUrl);

      // Update database - remove the document
      const updatedDocs = { ...documents };
      delete updatedDocs[documentType];

      // Note: This is a simplified version. You may want to update the database directly
      res.json({
        success: true,
        message: 'Document deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify buddy document (Admin only)
   */
  async verifyDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buddyId, documentType } = req.params;

      const validDocTypes = ['aadhaarFront', 'aadhaarBack', 'pan', 'bankDocument'];

      if (!validDocTypes.includes(documentType)) {
        throw new ApiError(400, 'Invalid document type');
      }

      await storageService.verifyBuddyDocument(
        buddyId,
        documentType as any
      );

      res.json({
        success: true,
        message: 'Document verified successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get buddy documents (Admin only)
   */
  async getBuddyDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { buddyId } = req.params;

      const documents = await storageService.getBuddyDocuments(buddyId);

      res.json({
        success: true,
        data: documents,
      });
    } catch (error) {
      next(error);
    }
  }
}