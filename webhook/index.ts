/*****************************************************************
 *  LOOPMESSAGE  WEBHOOK  ADAPTER  —  v2
 *****************************************************************/

import { randomUUID } from "crypto";
import type { MessageResponse, ChatResponse } from "../new/types";
import { DataSource } from "typeorm";

type LoopAlert =
  | "message_inbound"
  | "message_sent"
  | "message_failed"
  | "message_reaction";

const REACTION_MAP = {
  love: "love",
  like: "like",
  dislike: "dislike",
  laugh: "laugh",
  emphasize: "exclaim",
  question: "question"
} as const;

const deliveryType = (svc?: string) =>
  svc?.toLowerCase() === "sms" ? "sms" : "imessage";

const baseFields = (msg: MessageResponse) => ({
  webhook_id : randomUUID(),
  api_version: "1.0",
  message_id : msg.guid,
  recipient  : msg.handle?.address ?? "unknown",
  delivery_type: deliveryType(msg.service),
  text       : msg.text ?? undefined,
  subject    : msg.subject ?? undefined,
  group      : buildGroup(msg.chats?.[0])
});

function buildGroup(chat?: ChatResponse) {
  if (!chat || chat.style !== 43) return undefined;
  return {
    group_id    : chat.guid,
    name        : chat.displayName ?? undefined,
    participants: (chat.participants ?? []).map(p => p.address)
  };
}

function detectMessageType(m: MessageResponse) {
  if (m.associatedMessageType) return "reaction";
  if (m.isAudioMessage)        return "audio";
  if (m.attachments?.length)   return "attachments";
  if (m.balloonBundleId?.includes("Sticker")) return "sticker";
  return "text";
}

/**
 * Build webhook payload for *one* serialized Message.
 */
export async function buildLoopPayload(
  m: MessageResponse,
  db: DataSource
): Promise<Record<string, any>> {
  // ----- 1. TAP-BACKS ------------------------------------------------
  if (m.associatedMessageType) {
    return {
      ...baseFields(m),
      alert_type : "message_reaction" satisfies LoopAlert,
      message_type: "reaction",
      reaction   : REACTION_MAP[m.associatedMessageType.replace(/^-/, "") as keyof typeof REACTION_MAP] ?? "unknown",
      thread_id  : m.threadOriginatorGuid ?? undefined
    };
  }

  // Determine direction
  const inbound = !m.isFromMe;
  const alert: LoopAlert = inbound ? "message_inbound" : "message_sent";

  const payload: Record<string, any> = {
    ...baseFields(m),
    alert_type : alert,
    message_type: detectMessageType(m),
    thread_id  : m.threadOriginatorGuid ?? undefined
  };

  /********* fields common to *both* inbound & sent **********/
  if (m.attachments?.length) {
    payload.attachments = m.attachments.map(a => buildDownloadURL(a.guid));
  }

  /********* extra fields only LoopMessage expects for “sent” *******/
  if (!inbound) {
    // You could look at m.isDelivered / m.dateDelivered to refine this
    payload.success = true;
  }

  return payload;
}

/* --- helpers ----------------------------------------------------- */
function buildDownloadURL(guid: string) {
  return `file:///Attachments/${guid}`;        // swap for real CDN/S3 URL
}