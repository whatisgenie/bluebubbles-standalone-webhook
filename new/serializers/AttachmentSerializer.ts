// import { Server } from "@server";
import * as fs from "fs";
import * as base64 from "byte-base64";
import type { Metadata } from "../fileSystem/types";
import { FileSystem } from "../fileSystem";
import {  getAttachmentMetadata } from "../helpers/attachmentUtils";
import type { AttachmentResponse } from "../types";
import { DEFAULT_ATTACHMENT_CONFIG } from "./constants";
import type { AttachmentSerializerMultiParams, AttachmentSerializerSingleParams } from "./types";
// import { AttachmentInterface } from "../interfaces/attachmentInterface";

export class AttachmentSerializer {
    
    static async serialize({
        attachment,
        config = DEFAULT_ATTACHMENT_CONFIG,
        isForNotification = false
    }: AttachmentSerializerSingleParams): Promise<AttachmentResponse> {
        return (
            await AttachmentSerializer.serializeList({
                attachments: [attachment],
                config: { ...DEFAULT_ATTACHMENT_CONFIG, ...config },
                isForNotification
            })
        )[0];
    }

    static async serializeList({
        attachments,
        config = DEFAULT_ATTACHMENT_CONFIG,
        isForNotification = false
    }: AttachmentSerializerMultiParams): Promise<AttachmentResponse[]> {
        return Promise.all(
            attachments.map(
                async attachment =>
                    await AttachmentSerializer.convert({
                        attachment,
                        config: { ...DEFAULT_ATTACHMENT_CONFIG, ...config },
                        isForNotification
                    })
            )
        );
    }

    private static async convert({
        attachment,
        config = DEFAULT_ATTACHMENT_CONFIG,
        isForNotification = false
    }: AttachmentSerializerSingleParams): Promise<AttachmentResponse> {

        // console.log('[AttachmentSerializer.convert] Pre-convert',{attachment: JSON.stringify(attachment, null, 2)});
        let data: Uint8Array | string | null = null;
        let metadata: Metadata | null = null;

        // Get the fully qualified path
        let fPath = FileSystem.getRealPath(attachment.filePath);
        const mimeType = attachment.getMimeType();

        // If the attachment isn't finished downloading, the path will be null
        if (fPath) {
            try {
                // If we want to convert the attachment, do so here.
                // So long as we haven't done it yet.

                //  // TODO - turn back on convert below

                // if (config.convert && !fPath.includes(FileSystem.convertDir)) {
                //     const converters = [convertImage, convertAudio];
                //     for (const conversion of converters) {
                //         // Try to convert the attachments using available converters
                //         const newPath = await conversion(attachment, { originalMimeType: mimeType });
                //         if (newPath) {
                //             fPath = newPath;
                //             break;
                //         }
                //     }
                // }

                // If the attachment exists, do some things
                const exists = fs.existsSync(fPath);
                if (exists) {
                    // If we want data, get the data
                    if (config.loadData) {
                        data = Uint8Array.from(fs.readFileSync(fPath));
                    }

                    // Fetch the attachment metadata if there is a mimeType
                    if (config.loadMetadata) {
                        metadata = await getAttachmentMetadata(attachment);
                    }

                    // If there is no data, return null for the data
                    // Otherwise, convert it to a base64 string
                    if (data) {
                        data = base64.bytesToBase64(data as Uint8Array);
                    }
                }
            } catch (ex: any) {
                // Server().log(`Could not read file [${fPath}]: ${ex?.message ?? String(ex)}`, "error");
            }
        } else {
            // Server().log("Attachment hasn't been downloaded yet!", "debug");
        }

        let output: AttachmentResponse = {
            originalROWID: attachment.ROWID,
            guid: attachment.guid,
            uti: attachment.uti,
            mimeType: mimeType,
            transferName: attachment.transferName,
            totalBytes: attachment.totalBytes
        };

        if (!isForNotification) {
            output = {
                ...output,
                ...{
                    transferState: attachment.transferState,
                    isOutgoing: attachment.isOutgoing,
                    hideAttachment: attachment.hideAttachment,
                    isSticker: attachment.isSticker,
                    originalGuid: attachment.originalGuid,
                    hasLivePhoto: false,
                    // hasLivePhoto: !!AttachmentInterface.getLivePhotoPath(attachment)
                }
            };
        }

        if (config.includeMessageGuids) {
            output.messages = attachment.messages ? attachment.messages.map(item => item.guid) : [];
        }

        if (config.loadMetadata) {
            output = {
                ...output,
                ...{
                    height: (metadata?.height ?? 0) as number,
                    width: (metadata?.width ?? 0) as number,
                    metadata
                }
            };
        }

        if (config.loadData) {
            output.data = data as string;
        }

        // console.log('[AttachmentSerializer.convert] Post-convert',{output: JSON.stringify(output, null, 2)});

        return output;
    }
}


