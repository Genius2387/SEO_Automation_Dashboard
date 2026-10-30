export type NotificationChannel = "EMAIL" | "WHATSAPP";

export type NotificationStatus = "PENDING" | "SENT" | "DELIVERED" | "FAILED" | "SKIPPED";

export interface EmailPayload {
  auditId: string;
  recipientEmail: string;
  targetUrl: string;
  score: number;
  summary: string;
  reportUrl: string;
  dashboardUrl?: string;
}

export interface WhatsAppPayload {
  auditId: string;
  recipientPhone: string;
  targetUrl: string;
  score: number;
  reportUrl: string;
}

export interface NotificationResult {
  channel: NotificationChannel;
  recipient: string;
  status: NotificationStatus;
  providerId?: string;
  attemptCount: number;
  errorMessage?: string;
  simulated: boolean;
}

export interface DispatchNotificationOptions {
  channels?: NotificationChannel[];
  emailRecipient?: string;
  whatsappRecipient?: string;
  useMocks?: boolean;
  force?: boolean;
}
