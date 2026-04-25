import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();
const chatController = new ChatController();

// All chat routes require authentication
router.use(authenticate);

// Chat message history (cursor-based pagination)
router.get('/bookings/:bookingId/messages', chatController.getMessages);

// Unread message count
router.get('/bookings/:bookingId/messages/unread-count', chatController.getUnreadCount);

export default router;
