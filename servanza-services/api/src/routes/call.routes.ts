import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { getPendingCall, rejectCall, endCall } from '../controllers/call.controller';

const router = Router();

// Retrieve pending call signaling by callId
router.get('/:callId/pending', authenticate, getPendingCall);

// Reject an incoming call via REST
router.post('/:callId/reject', authenticate, rejectCall);

// End an ongoing or pending call via REST
router.post('/:callId/end', authenticate, endCall);

export default router;
