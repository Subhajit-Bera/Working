import { Emitter } from '@socket.io/redis-emitter';
import { redisPub } from '../config/redis';
import { logger } from './logger';

// Lazy-init the emitter
let emitter: Emitter | null = null;

function getEmitter(): Emitter {
    if (!emitter) {
        emitter = new Emitter(redisPub);
        logger.info('Socket.IO Redis Emitter initialized in workers');
    }
    return emitter;
}

/**
 * Emit an event to a specific user's socket room
 */
export function emitToUser(userId: string, event: string, data: any): void {
    try {
        getEmitter().to(`user:${userId}`).emit(event, data);
        logger.info(`[SOCKET-EMIT] Emitted ${event} to user:${userId}`);
    } catch (err) {
        logger.error(`[SOCKET-EMIT] Failed to emit ${event} to user:${userId}:`, err);
    }
}

/**
 * Emit an event to a specific buddy's socket room
 */
export function emitToBuddy(buddyId: string, event: string, data: any): void {
    try {
        getEmitter().to(`buddy:${buddyId}`).emit(event, data);
        logger.info(`[SOCKET-EMIT] Emitted ${event} to buddy:${buddyId}`, JSON.stringify(data));
    } catch (err) {
        logger.error(`[SOCKET-EMIT] Failed to emit ${event} to buddy:${buddyId}:`, err);
    }
}

/**
 * Emit an event to all admins
 */
export function emitToAdmins(event: string, data: any): void {
    try {
        getEmitter().to('admins').emit(event, data);
        logger.debug(`Emitted ${event} to admins`);
    } catch (err) {
        logger.error(`Failed to emit ${event} to admins:`, err);
    }
}
