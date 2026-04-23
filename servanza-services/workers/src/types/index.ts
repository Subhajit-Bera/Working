export interface JobData {
  [key: string]: any;
}

export interface AssignmentJobData extends JobData {
  bookingId: string;
}

export interface NotificationJobData extends JobData {
  userId: string;
  type: string;
  data: any;
}

export interface AnalyticsJobData extends JobData {
  type: string;
  startDate?: Date | string;
  endDate?: Date | string;
}

export interface CleanupJobData extends JobData {
  type: string;
}

export interface PaymentJobData extends JobData {
  transactionId?: string;
  bookingId?: string;
  amount?: number;
}

export interface EmailData {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SMSData {
  to: string;
  message: string;
}
