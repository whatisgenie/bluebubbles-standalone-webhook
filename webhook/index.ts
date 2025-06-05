import { randomUUID } from "crypto";
import { DateTime }   from "luxon";
import type { MessageResponse, ChatResponse } from "../new/types";
import { DataSource } from "typeorm";

/*****************************************************************
 * buildWebhookPayload — returns one **flat** Loop webhook payload
 *****************************************************************/

const SENDER_NAME = "genie@ai.imsg.bot";

const REACTION_MAP = {
  love:      "love",
  like:      "like",
  dislike:   "dislike",
  laugh:     "laugh",
  emphasize: "exclaim",
  question:  "question"
} as const;

/* ───────────────────────── helpers ─────────────────────────── */

const dlvType = (svc?: string) =>
  svc?.toLowerCase() === "sms" ? "sms" : "imessage";

const buildGroup = (c?: ChatResponse) =>
  !c || c.style !== 43
    ? undefined
    : {
        group_id    : c.guid,
        name        : c.displayName ?? "",
        participants: (c.participants ?? []).map(p => p.address)
      };

const buildAttachmentURL = (g: string) =>
  /* 🔧 swap for your CDN / Firebase signer if you have one */
  `file:///Attachments/${g}`;

const msgType = (m: MessageResponse): string => {
  if (m.associatedMessageType)      return "reaction";
  if (m.isAudioMessage)             return "audio";
  if (m.attachments?.length)        return "attachments";
  if (m.balloonBundleId?.includes("Sticker")) return "sticker";
  return "text";
};

/* inline helper: decide if this was edited or unsent */
const updInfo = (m: MessageResponse) => {
  if (m.dateRetracted) {
    return {
      update_event: "unsent" as const,
      update_at   : DateTime.fromMillis(m.dateRetracted).toISO()
    };
  }
  if (m.dateEdited) {
    return {
      update_event: "edited" as const,
      update_at   : DateTime.fromMillis(m.dateEdited).toISO()
    };
  }
  return {};
};

/* ────────────────────────── main ───────────────────────────── */

export async function buildWebhookPayload(
  m : MessageResponse,
  _db: DataSource            // kept for parity / future look-ups
): Promise<Record<string, any>> {

  const alert_type =
    m.associatedMessageType
      ? "message_reaction"
      : (m.isFromMe ? "message_sent" : "message_inbound");

  /* core flat structure */
  const payload: any = {
    _id          : randomUUID().replace(/-/g, "").slice(0, 24),
    timestamp    : DateTime.utc().toISO(),       // when we generated the webhook
    alert_type,
    event_type   : alert_type,                   // kept for backward-compat
    delivery_type: dlvType(m.handle?.service),
    language     : { code:"en", name:"English" },// 🛈 stub – plug detector if needed

    message_id   : m.guid,
    recipient    : m.handle?.address ?? "unknown",
    sender_name  : SENDER_NAME,
    text         : m.text ?? undefined,
    subject      : m.subject ?? undefined,
    webhook_id   : randomUUID(),

    message_type : msgType(m),

    /* conversation context flags */
    isGroup      : false,
    isReply      : false
  };

  /* group chat extra block */
  const grp = buildGroup(m.chats?.[0]);
  if (grp) {
    payload.group  = grp;
    payload.isGroup = true;
  }

  /* single-chat guid handy for DM threads */
  if (m.chats?.[0]?.guid) payload.chatGuid = m.chats[0].guid;

  /* ── reactions ────────────────────────────────────────────── */
  if (payload.message_type === "reaction") {
    const clean = m.associatedMessageType!.replace(/^-/, "") as keyof typeof REACTION_MAP;
    payload.reaction       = REACTION_MAP[clean] ?? "unknown";
    payload.reaction_event = m.associatedMessageType!.startsWith("-") ? "removed" : "placed";
    if (m.threadOriginatorGuid) payload.thread_id = m.threadOriginatorGuid;

    /* edits / unsends do not apply to tap-backs */
    return payload;
  }

  /* ── normal messages ──────────────────────────────────────── */
  if (m.attachments?.length) {
    payload.attachments = m.attachments.map(a => buildAttachmentURL(a.guid));
  }
  if (m.threadOriginatorGuid) {
    payload.thread_id = m.threadOriginatorGuid;
    payload.isReply   = true;
  }

  /* mark success for outbound messages (optional but handy) */
  if (alert_type === "message_sent") payload.success = true;

  /* add edited / unsent info if present */
  Object.assign(payload, updInfo(m));

  return payload;
}

/* very thin wrapper around `fetch` so caller can keep their code unchanged */
export function postWebhook(
  body: Record<string, any>,
  url : string
): void {
  fetch(url, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify(body)
  })
    .then(() => console.log("Webhook posted."))
    .catch(e => console.error("Webhook post failed:", e.message));
}