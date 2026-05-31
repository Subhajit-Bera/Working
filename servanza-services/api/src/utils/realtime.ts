import { emitToUser as socketEmitToUser, emitToBuddy as socketEmitToBuddy, emitToAdmins as socketEmitToAdmins } from '../socket/index';
import { logger } from './logger';

export function emitToUser(userId: string, event: string, data: any) {
  try {
    socketEmitToUser(userId, event, data).catch(err => {
      logger.error(`Error in emitToUser: ${err}`);
    });
  } catch (err) { 
    logger.error(`Error in emitToUser: ${err}`);
  }
}

export function emitToBuddy(buddyId: string, event: string, data: any) {
  try {
    socketEmitToBuddy(buddyId, event, data).catch(err => {
      logger.error(`Error in emitToBuddy: ${err}`);
    });
  } catch (err) {
    logger.error(`Error in emitToBuddy: ${err}`);
  }
}

export function emitToAdmins(event: string, data: any) {
  try {
    socketEmitToAdmins(event, data);
  } catch (err) {
    logger.error(`Error in emitToAdmins: ${err}`);
  }
}
