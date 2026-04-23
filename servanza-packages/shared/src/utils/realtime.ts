export function emitToUser(userId: string, event: string, data: any) {
  try {
    // If have a socket.io server attached to global, use it; otherwise this is a safe no-op.
    // In actual socket.ts ,typically set `global.io = ioServer`.
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to(userId).emit(event, data);
    }
  } catch (err) {
    // swallow to avoid crashes during module load
    // real logging should use your logger
    console.error('emitToUser error', err);
  }
}

export function emitToBuddy(buddyId: string, event: string, data: any) {
  try {
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to(buddyId).emit(event, data);
    }
  } catch (err) {}
}

export function emitToAdmins(event: string, data: any) {
  try {
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to('admins').emit(event, data);
    }
  } catch (err) {}
}
