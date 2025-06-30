import { DateTime } from "luxon";
import type { MessageResponse, ChatResponse } from "../new/types";
import { DataSource } from "typeorm";
import { Message } from "../new/entities/Message";
import { convertDateTo2001Time } from "../new/helpers/dateUtils";

/*****************************************************************
 * buildWebhookPayload — returns one **flat** Loop webhook payload
 *****************************************************************/

const SENDER_NAME = "genie@ai.imsg.bot";

const REACTION_MAP = {
  love: "love",
  like: "like",
  dislike: "dislike",
  laugh: "laugh",
  emphasize: "exclaim",
  question: "question",
} as const;

/* ───────────── helpers ───────────── */

const dlvType = (svc?: string) =>
  svc?.toLowerCase() === "sms" ? "sms" : "imessage";

const buildGroup = (c?: ChatResponse) =>
  !c || c.style !== 43
    ? undefined
    : {
        group_id: c.guid,
        name: c.displayName ?? "",
        participants: (c.participants ?? []).map((p) => p.address),
      };

const buildAttachmentURL = (g: string) =>
  /* 🔧 swap for your CDN / Firebase signer if you have one */
  `file:///Attachments/${g}`;

const msgType = (m: MessageResponse): string => {
  if (m.associatedMessageType) return "reaction";
  if (m.isAudioMessage) return "audio";
  if (m.attachments?.length) return "attachments";
  if (m.balloonBundleId?.includes("Sticker")) return "sticker";
  return "text";
};

/* decide if this message was edited or unsent — “unsent” wins */
const updInfo = (m: MessageResponse) => {
  const isUnsent =
    !!m.dateRetracted ||
    (m.partCount === 0 && !!m.dateEdited); // Ventura / Monterey fallback

  if (isUnsent) {
    return {
      update_event: "unsent" as const,
      update_at: DateTime.fromMillis(
        (m.dateRetracted ?? m.dateEdited)!
      ).toISO(),
    };
  }

  if (m.dateEdited) {
    return {
      update_event: "edited" as const,
      update_at: DateTime.fromMillis(m.dateEdited).toISO(),
    };
  }

  return {};
};

/* ───────────── first-message detector ───────────── */

/** tiny in-memory cache so we don’t COUNT twice in the same poll */
const firstSeenChatCache = new Set<string>();

/**
 * True when `m` is the first stored message in its chat.
 * Works for DM or group (style 45 vs 43).
 */
export async function isFirstMessageInChat(
  m: MessageResponse,
  db: DataSource
): Promise<boolean> {
  const chat = m.chats?.[0];
  if (!chat) return false;

  if (firstSeenChatCache.has(chat.guid)) return false; // we’ve checked already

  const { cnt } = await db
    .getRepository(Message)
    .createQueryBuilder("msg")
    .innerJoin("msg.chats", "c", "c.guid = :gid", { gid: chat.guid })
    .andWhere("msg.ROWID <> :id", { id: m.originalROWID })
    .andWhere("msg.date < :ts", {
      ts: convertDateTo2001Time(new Date(m.dateCreated)),
    })
    .select("count(*)", "cnt")
    .getRawOne<{ cnt: string }>();

  const isFirst = Number(cnt ?? 0) === 0;
  if (isFirst) firstSeenChatCache.add(chat.guid);
  return isFirst;
}

/* ───────────── main ───────────── */

export async function buildWebhookPayload(
  m: MessageResponse,
  db: DataSource
): Promise<Record<string, any>> {
  /* ── choose alert_type ── */
  let alert_type:
    | "group_created"
    | "conversation_inited"
    | "message_inbound"
    | "message_sent"
    | "message_reaction";

  if (m.associatedMessageType) {
    alert_type = "message_reaction";
  } else if (await isFirstMessageInChat(m, db)) {
    const isGroup = m.chats?.[0]?.style === 43;
    alert_type = isGroup ? "group_created" : "conversation_inited";
  } else if (m.isFromMe) {
    alert_type = "message_sent";
  } else {
    alert_type = "message_inbound";
  }

  /* ── core flat structure ── */
  const payload: any = {
    timestamp: DateTime.utc().toISO(),
    alert_type,
    event_type: alert_type, // alias
    delivery_type: dlvType(m.handle?.service),
    language: { code: "en", name: "English" }, // stub

    message_id: m.guid,
    recipient: m.handle?.address ?? "unknown",
    sender_name: SENDER_NAME,
    text: m.text ?? undefined,
    subject: m.subject ?? undefined,

    message_type: msgType(m),

    /* conversation context flags */
    isGroup: false,
    isReply: false,
  };

  /* group chat extra block */
  const grp = buildGroup(m.chats?.[0]);
  if (grp) {
    payload.group = grp;
    payload.isGroup = true;
  }

  /* single-chat guid handy for DMs */
  if (m.chats?.[0]?.guid) payload.chatGuid = m.chats[0].guid;

  /* ── reactions ── */
  if (payload.message_type === "reaction") {
    const clean = m.associatedMessageType!.replace(
      /^-/,
      ""
    ) as keyof typeof REACTION_MAP;
    payload.reaction = REACTION_MAP[clean] ?? "unknown";
    payload.reaction_event = m.associatedMessageType!.startsWith("-")
      ? "removed"
      : "placed";
    if (m.threadOriginatorGuid) payload.thread_id = m.threadOriginatorGuid;
    return payload; // edits / unsends don’t apply to tap-backs
  }

  /* ── normal messages ── */
  if (m.attachments?.length) {
    payload.attachments = m.attachments.map((a) => buildAttachmentURL(a.guid));
  }
  if (m.threadOriginatorGuid) {
    payload.thread_id = m.threadOriginatorGuid;
    payload.isReply = true;
  }

  /* mark success for outbound messages */
  if (alert_type === "message_sent") payload.success = true;

  /* attach edited / unsent metadata */
  Object.assign(payload, updInfo(m));

  return payload;
}