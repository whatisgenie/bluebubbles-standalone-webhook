import { randomUUID } from "crypto";
import { DateTime } from "luxon";          // add to deps:  bun add luxon
import type { MessageResponse, ChatResponse } from "../new/types";
import { DataSource } from "typeorm";

/* ------------------------------------------------------------- */
/*  helpers                                                      */
/* ------------------------------------------------------------- */
const SENDER_NAME = "genie@ai.imsg.bot";

const REACTION_MAP = {
  love:      "love",
  like:      "like",
  dislike:   "dislike",
  laugh:     "laugh",
  emphasize: "exclaim",
  question:  "question"
} as const;

function dlvType(svc?: string) {
  return svc?.toLowerCase() === "sms" ? "sms" : "imessage";
}

function buildGroup(chat?: ChatResponse) {
  if (!chat || chat.style !== 43) return undefined;    // not a group iMessage
  return {
    group_id    : chat.guid,
    name        : chat.displayName ?? "",
    participants: (chat.participants ?? []).map(p => p.address)
  };
}

function buildAttachmentURL(guid: string) {
  // 🔧 swap for your own CDN / Firebase path generator
  return `file:///Attachments/${guid}`;
}

function detectMessageType(m: MessageResponse): string {
  if (m.associatedMessageType)      return "reaction";
  if (m.isAudioMessage)             return "audio";
  if (m.attachments?.length)        return "attachments";
  if (m.balloonBundleId?.includes("Sticker")) return "sticker";
  return "text";
}

/* ============================================================= */
/*  buildLoopPayload – v2                                         */
/* ============================================================= */
export async function buildLoopPayload(
  m : MessageResponse,
  db: DataSource
): Promise<Record<string, any>> {

  /* ---------- core fields used for ALL alerts ---------------- */
  const alert_type      = m.associatedMessageType
                            ? "message_reaction"
                            : (m.isFromMe ? "message_sent" : "message_inbound");
  const delivery_type   = dlvType(m.service);
  const baseEvent: any  = {
    alert_type,
    delivery_type,
    language    : { code: "en", name: "English" },          // 🛈 stub – swap in real detector if you like
    message_id  : m.guid,
    recipient   : m.handle?.address ?? "unknown",
    sender_name : SENDER_NAME,
    text        : m.text ?? undefined,
    subject     : m.subject ?? undefined,
    group       : buildGroup(m.chats?.[0]),
    webhook_id  : randomUUID()
  };

  /* ---------- reactions -------------------------------------- */
  if (alert_type === "message_reaction") {
    baseEvent.message_type  = "reaction";
    baseEvent.reaction      = REACTION_MAP[
      m.associatedMessageType?.replace(/^-/, "") as keyof typeof REACTION_MAP
    ] ?? "unknown";
    baseEvent.reaction_event = m.dateRetracted ? "removed" : "placed";
  }

  /* ---------- normal messages -------------------------------- */
  else {
    baseEvent.message_type = detectMessageType(m);
    if (m.attachments?.length) {
      baseEvent.attachments = m.attachments.map(a => buildAttachmentURL(a.guid));
    }
    if (m.threadOriginatorGuid) baseEvent.thread_id = m.threadOriginatorGuid;
    if (alert_type === "message_sent") baseEvent.success = true;
  }

  /* ---------- wrap in { _id, timestamp, event, event_type } --- */
  return {
    _id        : randomUUID().replace(/-/g, "").slice(0, 24),   // 24-char mongo-style id
    timestamp  : DateTime.utc().toISO(),
    event      : baseEvent,
    event_type : alert_type
  };
}