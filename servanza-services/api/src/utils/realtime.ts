export function emitToUser(userId: string, event: string, data: any) {
  try {
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to(`user:${userId}`).emit(event, data);
    }
  } catch (err) { }
}

export function emitToBuddy(buddyId: string, event: string, data: any) {
  try {
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to(`buddy:${buddyId}`).emit(event, data);
    }
  } catch (err) { }
}

export function emitToAdmins(event: string, data: any) {
  try {
    if ((global as any).io && typeof (global as any).io.to === 'function') {
      (global as any).io.to('admins').emit(event, data);
    }
  } catch (err) { }
}

