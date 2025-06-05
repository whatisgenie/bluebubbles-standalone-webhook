import { randomUUID } from "crypto";
import { DateTime } from "luxon";          // bun add luxon
import type { MessageResponse, ChatResponse } from "../new/types";
import { DataSource } from "typeorm";

/*****************************************************************
 *  buildWebhookPayload  —  returns **flat** Loop webhook payload
 *****************************************************************/

const SENDER_NAME = "genie@ai.imsg.bot";

const REACTION_MAP = {
  love: "love",
  like: "like",
  dislike: "dislike",
  laugh: "laugh",
  emphasize: "exclaim",
  question: "question"
} as const;

/* ------------------------------------------------------------- */
/*  helpers                                                      */
/* ------------------------------------------------------------- */
function dlvType(svc?: string) {
  return svc?.toLowerCase() === "sms" ? "sms" : "imessage";
}

function buildGroup(chat?: ChatResponse) {
  if (!chat || chat.style !== 43) return undefined; // not a group chat
  return {
    group_id: chat.guid,
    name: chat.displayName ?? "",
    participants: (chat.participants ?? []).map(p => p.address)
  };
}

function buildAttachmentURL(guid: string) {
  // 🔧 swap for your own CDN / Firebase URL signer
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
/*  MAIN                                                          */
/* ============================================================= */
export async function buildWebhookPayload(
  m : MessageResponse,
  _db: DataSource               // kept for parity / future look-ups
): Promise<Record<string, any>> {
  const alert_type = m.associatedMessageType
    ? "message_reaction"
    : (m.isFromMe ? "message_sent" : "message_inbound");

  /* ---------- base flattened payload ------------------------ */
  const payload: any = {
    _id          : randomUUID().replace(/-/g, "").slice(0, 24),
    timestamp    : DateTime.utc().toISO(),
    alert_type,
    event_type   : alert_type,          // <— still included for convenience
    delivery_type: dlvType(m.handle?.service),
    language     : { code: "en", name: "English" }, // 🛈 stub; plug real detector

    message_id   : m.associatedMessageGuid
                    ? m.associatedMessageGuid.replace(/^p:\d+\//, "")
                    : m.guid,
    recipient    : m.handle?.address ?? "unknown",
    sender_name  : SENDER_NAME,
    text         : m.text ?? undefined,
    subject      : m.subject ?? undefined,
    webhook_id   : randomUUID(),

    message_type : detectMessageType(m)
  };

  /* group chat details */
  const group = buildGroup(m.chats?.[0]);
  if (group) payload.group = group;

  /* single-chat guid handy for 1-on-1 threads */
  if (m.chats?.[0]?.guid) payload.chatGuid = m.chats[0].guid;

  /* ---------- reactions -------------------------------------- */
  if (payload.message_type === "reaction") {
    const clean = m.associatedMessageType?.replace(/^-/, "") as keyof typeof REACTION_MAP;
    payload.reaction       = REACTION_MAP[clean] ?? "unknown";
    payload.reaction_event = m.associatedMessageType?.startsWith("-") ? "removed" : "placed";
    if (m.threadOriginatorGuid) payload.thread_id = m.threadOriginatorGuid;
    return payload; // early return; nothing else needed
  }

  /* ---------- normal messages -------------------------------- */
  if (m.attachments?.length) {
    payload.attachments = m.attachments.map(a => buildAttachmentURL(a.guid));
  }
  if (m.threadOriginatorGuid) payload.thread_id = m.threadOriginatorGuid;
  if (alert_type === "message_sent") payload.success = true;

  return payload;
}


export function postWebhook(webhookPayload: Record<string, any>, webhookUrl: string): void {
    fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    }).then((response) => {
      console.log('Webhook posted successfully.');
    }).catch((error: any) => {
      console.error(`Error posting webhook: ${error.message}`);
    });
  }
  