import "reflect-metadata";

// SCRIPT START
// Necessary for TypeORM
import { DataSource, Brackets } from "typeorm";

// --- Assume these files are copied into your script's directory or paths are adjusted ---
// You would need to ensure all transitive dependencies of these files are also available.

// ENTITIES (FROM: packages/server/src/server/databases/imessage/entity/)
import { Message } from './new/entities/Message'; // Assume Message.ts is in the same directory or path adjusted
import { Handle } from './new/entities/Handle';   // Assume Handle.ts is in the same directory or path adjusted
import { Chat } from './new/entities/Chat';     // Assume Chat.ts is in the same directory or path adjusted
import { Attachment } from './new/entities/Attachment'; // Assume Attachment.ts is in the same directory or path adjusted

// HELPERS (FROM: packages/server/src/server/databases/imessage/helpers/)
import { convertDateTo2001Time } from './new/helpers/dateUtils'; // Assume dateUtil.ts is in the same directory or path adjusted

// SERIALIZERS (FROM: packages/server/src/server/api/serializers/)
import { MessageSerializer } from './new/serializers/MessageSerializer'; // Assume MessageSerializer.ts is in the same directory or path adjusted
// MessageSerializer itself depends on HandleSerializer, ChatSerializer, AttachmentSerializer.
// For this script to fully work, those would need to be present too.
// We will make serializer configs minimal to reduce deep dependencies for this example.
import { DEFAULT_ATTACHMENT_CONFIG, DEFAULT_MESSAGE_CONFIG } from './new/serializers/constants';
import { buildWebhookPayload } from "./webhook";
import type { MessageResponse } from "./new/types";

// --- END OF ASSUMED COPIED/IMPORTED FILES ---


// --- CORE LOGIC ---

const DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;
let dataSource: DataSource | null = null;

// Minimal configuration for MessageSerializer for this script's purpose
const SCRIPT_MESSAGE_SERIALIZER_CONFIG = {
    ...DEFAULT_MESSAGE_CONFIG,
    loadChatParticipants: false, // Avoids needing full participant loading logic for simplicity
    includeChats: true,          // We want to know which chat it belongs to
    enforceMaxSize: false,
    parseAttributedBody: true,   // For universalText
    parseMessageSummary: true,   // For edits/unsends
    parsePayloadData: false      // Usually not critical for basic display
};

const SCRIPT_ATTACHMENT_SERIALIZER_CONFIG = {
    ...DEFAULT_ATTACHMENT_CONFIG,
    loadData: false,             // Don't load attachment bytes
    loadMetadata: true
};



/**
 * Initializes a connection to the iMessage database.
 */
async function initializeDatabase(): Promise<boolean> {
    try {
        dataSource = new DataSource({
            name: "iMessageMinimalScript",
            type: "better-sqlite3",
            database: DB_PATH,
            entities: [Message, Handle, Chat, Attachment],
            // Transformers are part of the entities, so they'll be used automatically
            // logging: ["query", "error"] // Uncomment for debugging DB queries
        });
        await dataSource.initialize();
        console.log("Successfully connected to iMessage database.");
        return true;
    } catch (e: any) {
        console.error(`Failed to connect to iMessage database at ${DB_PATH}:`, e.message);
        console.error("Please ensure you have Full Disk Access for the terminal/application running this script.");
        dataSource = null;
        return false;
    }
}

/* ------------------------------------------------------------------ */
/* 1.  getNewIncomingMessages – make comparisons exclusive (>), keep
    everything else identical                                      */
/* ------------------------------------------------------------------ */

async function getNewIncomingMessages(afterTimestamp: Date): Promise<Message[]> {
    if (!dataSource || !dataSource.isInitialized) {
        console.error("Database not initialized. Call initializeDatabase() first.");
        return [];
    }

    // const lookbackBufferMs = 15 * 60 * 1000;
    // const queryStartDate = new Date(afterTimestamp.getTime() - lookbackBufferMs);

    const query = dataSource
        .getRepository(Message)
        .createQueryBuilder("message")
        .leftJoinAndSelect("message.handle", "handle")
        .leftJoinAndSelect("message.attachments", "attachment")
        .innerJoinAndSelect("message.chats", "chat")
        .where("message.is_from_me = :isFromMe", { isFromMe: 0 })
        .andWhere(
            new Brackets(qb => {
                qb.where("message.date        > :cut", { cut: convertDateTo2001Time(afterTimestamp) })
                    .orWhere("message.date_edited > :cut", { cut: convertDateTo2001Time(afterTimestamp) });
            })
        )
        .limit(500)
        .orderBy("message.date", "ASC");

    const dbMessages = await query.getMany();
    const actualAfterTime = afterTimestamp.getTime();

    return dbMessages;

    // return dbMessages.filter(msg => {
    //     const createdTime = msg.dateCreated?.getTime() ?? 0;
    //     const editedTime = msg.dateEdited?.getTime() ?? 0;

    //     const isNew = createdTime > actualAfterTime;
    //     const isRecentUpdate = editedTime > actualAfterTime ||
    //         (msg.hasUnsentParts && createdTime >= queryStartDate.getTime());

    //     return isNew || isRecentUpdate;
    // });
}


/* ------------------------------------------------------------------ */
/* 2.  getAllMessages – same change: >=  ->  >                       */
/* ------------------------------------------------------------------ */

async function getAllMessages(afterTimestamp: Date): Promise<Message[]> {
    if (!dataSource || !dataSource.isInitialized) {
        console.error("Database not initialized. Call initializeDatabase() first.");
        return [];
    }

    const lookbackBufferMs = 15 * 60 * 1000;
    const queryStartDate = new Date(afterTimestamp.getTime() - lookbackBufferMs);

    const query = dataSource
        .getRepository(Message)
        .createQueryBuilder("message")
        .leftJoinAndSelect("message.handle", "handle")
        .leftJoinAndSelect("message.attachments", "attachment")
        .innerJoinAndSelect("message.chats", "chat")
        .leftJoinAndSelect("chat.participants", "chatParticipants")
        .andWhere(
            new Brackets(qb => {
                qb.where("message.date        > :afterDate", { afterDate: convertDateTo2001Time(queryStartDate) })
                    .orWhere("message.date_edited > :afterDateEdited", { afterDateEdited: convertDateTo2001Time(queryStartDate) });
            })
        )
        .orderBy("message.date", "ASC");

    const dbMessages = await query.getMany();
    const actualAfterTime = afterTimestamp.getTime();

    return dbMessages.filter(msg => {
        const createdTime = msg.dateCreated?.getTime() ?? 0;
        const editedTime = msg.dateEdited?.getTime() ?? 0;

        const isNew = createdTime > actualAfterTime;
        const isRecentUpdate = editedTime > actualAfterTime ||
            (msg.hasUnsentParts && createdTime >= queryStartDate.getTime());

        return isNew || isRecentUpdate;
    });
}


/* ------------------------------------------------------------------ */
/* 3.  pollForNewMessages – advance the cursor and return it          */
/* ------------------------------------------------------------------ */

async function pollForNewMessages(lastSeen: Date): Promise<Date> {
    if (!dataSource) return lastSeen;

    console.log(`[${new Date().toISOString()}] Checking for new messages since ${lastSeen.toISOString()}`);
    const newMessages = await getAllMessages(lastSeen);

    if (newMessages.length) {
        console.log(`Found ${newMessages.length} new/updated incoming message(s):`);
        for (const msg of newMessages) {
            try {
                const serializedMsg = await MessageSerializer.serialize({
                    message: msg,
                    config: SCRIPT_MESSAGE_SERIALIZER_CONFIG,
                    attachmentConfig: SCRIPT_ATTACHMENT_SERIALIZER_CONFIG,
                    isForNotification: false
                });

                const payload = await buildWebhookPayload(serializedMsg, dataSource);
                console.log({ payload });
            } catch (err: any) {
                console.error(`Error transforming message ${msg.guid}: ${err.message}`);
            }
        }
        console.log("  ----------------------------------------");
    } else {
        console.log("No new messages found.");
    }

    // pick the newest lastUpdateTime we saw, then move it forward by 1 ms
    const newestSeen = newMessages.reduce<Date>(
        (max, m) => new Date(Math.max(max.getTime(), m.lastUpdateTime.getTime())),
        lastSeen
    );

    return new Date(newestSeen.getTime() + 1);   // exclusive cursor ⇒ no duplicates
}

/**
 * Entry point.
 */
async function run() {
    if (!await initializeDatabase()) {
        return;
    }

    // Set initial poll time (e.g., 5 minutes ago, or from a saved state)
    let lastTimestamp = new Date(Date.now() - (5 * 60 * 1000)); // 5 minutes ago

    // Poll immediately, then set an interval
    // lastTimestamp = await pollForNewMessages(lastTimestamp);
    let inFlight = false;
    async function safePoll() {
        if (inFlight) return;
        inFlight = true;
        lastTimestamp = await pollForNewMessages(lastTimestamp);
        inFlight = false;
    }
    setInterval(safePoll, 2_000);


    // Keep the script alive. In a real app, you'd have a proper shutdown.
    // process.stdin.resume();
    process.on('SIGINT', async () => {
        console.log("SIGINT received, closing database connection...");
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
        process.exit(0);
    });
}


run().catch(console.error);
// SCRIPT END


function prettyPrintMessage(m: MessageResponse, db: DataSource) {
    // ---------- helpers ----------
    const deliveryType = m.handle?.service?.toLowerCase() === "sms" ? "SMS" : "iMessage";
    const direction = m.isFromMe ? "SENT" : "INBOUND";

    const getMessageType = () => {
        if (m.associatedMessageType) return "reaction";
        if (m.isAudioMessage) return "audio";
        if (m.attachments?.length) return "attachments";
        if (m.balloonBundleId?.includes("Sticker")) return "sticker";
        return "text";
    };

    const msgType = getMessageType();

    // ---------- header line ----------
    console.log("  ----------------------------------------");
    console.log(
        `[${direction}] (${deliveryType}) <${msgType}>  GUID:${m.guid}`
    );

    // ---------- basic fields ----------
    console.log(`  From       : ${m.handle?.address ?? "Unknown"}`);
    console.log(`  Date       : ${new Date(m.dateCreated).toLocaleString()}`);
    if (m.text) console.log(`  Text       : "${m.text}"`);
    if (m.subject) console.log(`  Subject    : "${m.subject}"`);
    if (m.attachments?.length)
        console.log(`  Attachments: ${m.attachments.length}`);

    // ---------- reactions ----------
    if (msgType === "reaction") {
        const reactedTo = m.associatedMessageGuid?.replace(/^p:\d+\//, "");
        console.log(`  Reaction   : ${m.associatedMessageType}`);
        console.log(`  On message : ${reactedTo}`);

        // (optional) fetch original text for context
        if (reactedTo) {
            db.getRepository(Message)
                .findOneBy({ guid: reactedTo })
                .then(orig =>
                    console.log(
                        `               "${orig?.universalText?.() ?? "<No Text>"}"`
                    )
                )
                .catch(() => { });
        }
    }

    // ---------- replies ----------
    // Apple sets replyToGuid even for some reactions, so rely on threadOriginatorGuid
    const threadId = m.threadOriginatorGuid ?? m.replyToGuid;
    if (threadId && msgType !== "reaction") {
        console.log(`  Reply-to   : ${threadId}`);
        db.getRepository(Message)
            .findOneBy({ guid: threadId })
            .then(orig =>
                console.log(
                    `               "${orig?.universalText?.() ?? "<No Text>"}"`
                )
            )
            .catch(() => { });
    }

    // ---------- status flags ----------
    if (m.dateEdited) console.log(`  ✎ Edited   : ${new Date(m.dateEdited).toLocaleString()}`);
    if (m.dateRetracted) console.log(`  ✂ Unsent   : ${new Date(m.dateRetracted).toLocaleString()}`);
    if (m.isArchived) console.log(`  ☰ Archived`);
    if (!m.isFromMe && m.wasDeliveredQuietly) console.log("  🔕 Delivered Quietly");

    console.log("  ----------------------------------------\n");
}