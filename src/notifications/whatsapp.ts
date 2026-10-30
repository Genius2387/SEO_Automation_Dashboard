import { WhatsAppPayload, NotificationResult } from "./types";
import { sendWhatsApp as providerSendWhatsApp, ProviderNotConfiguredError, isMockActive } from "@/services/providers";

/**
 * Validates international phone numbers (E.164 standard or prefixed with whatsapp:)
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;
  const cleaned = phone.replace(/^whatsapp:/i, "").trim();
  // E.164: + followed by 7 to 15 digits
  const e164Regex = /^\+?[1-9]\d{6,14}$/;
  return e164Regex.test(cleaned);
}

/**
 * Redacts a phone number for secure logging (e.g., +1415***7890)
 */
export function redactPhoneNumber(phone: string): string {
  if (!phone) return "REDACTED";
  const clean = phone.trim();
  if (clean.length <= 6) return "***";
  return clean.slice(0, 4) + "***" + clean.slice(-4);
}

/**
 * Dispatches a WhatsApp notification using the Twilio provider abstraction and mock fixture
 */
export async function sendWhatsAppNotification(
  payload: WhatsAppPayload,
  options?: { useMocks?: boolean }
): Promise<NotificationResult> {
  // 1. Recipient validation
  if (!isValidPhoneNumber(payload.recipientPhone)) {
    throw new Error(`Invalid recipient phone number format: '${redactPhoneNumber(payload.recipientPhone)}' (Must conform to E.164 standard)`);
  }

  // 2. Delegate to the established provider abstraction (reusing exact Phase 3 Twilio mock fixture)
  try {
    const result = await providerSendWhatsApp(
      payload.recipientPhone,
      payload.reportUrl,
      payload.score,
      { useMocks: options?.useMocks }
    );

    const isSimulated = isMockActive(options?.useMocks);

    return {
      channel: "WHATSAPP",
      recipient: payload.recipientPhone,
      status: "SENT",
      providerId: result.sid,
      attemptCount: 1,
      simulated: isSimulated,
    };
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[WhatsApp Notification] Failed to send WhatsApp to ${redactPhoneNumber(payload.recipientPhone)}:`, msg);
    throw new Error(`WhatsApp notification failed: ${msg}`);
  }
}
