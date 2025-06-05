// Ugly stuff
import { Attachment } from "../entities/Attachment";
import { FileSystem } from "../fileSystem";
import type { Metadata } from "../fileSystem/types";
import * as fs from "fs";
import { basename } from "path";
import { isEmpty, isNotEmpty } from "./utils";

export const MAX_FILE_SIZE = 157286400;
export const handledImageMimes = ["image/jpeg", "image/jpg", "image/png", "image/bmp", "image/tiff", "image/gif"];

export const getConversionPath = (attachment: Attachment, extension: string): string => {
    const guid = attachment.originalGuid ?? attachment.guid;
    const newDir = `${FileSystem.convertDir}/${guid}`;
    if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
    const newName = isEmpty(attachment.transferName) ? guid : attachment.transferName;

    // If the path already has the extension, return it
    let newPath = `${newDir}/${newName}`;
    if (newPath.endsWith(`.${extension}`)) return newPath;

    // Otherwise, return the path with the extension
    return `${newDir}/${newName}.${extension}`;
}

export const convertAudio = async (
    attachment: Attachment,
    {
        originalMimeType = null,
        dryRun = false
    }: {
        originalMimeType?: string,
        dryRun?: boolean
    } = {}
): Promise<string | null> => {
    if (!attachment) return null;
    const newPath = getConversionPath(attachment, "mp3");
    const mType = originalMimeType ?? attachment.getMimeType();
    let failed = false;
    let ext = null;

    if (attachment.uti === "com.apple.coreaudio-format" || mType == "audio/x-caf") {
        ext = "caf";
    }

    if (!fs.existsSync(newPath) && !dryRun) {
        try {
            if (isNotEmpty(ext)) {
                console.log(`Converting attachment, ${attachment.transferName}, to an MP3...`);
                await FileSystem.convertCafToMp3(attachment.filePath, newPath);
            }
        } catch (ex: any) {
            failed = true;
            console.log(`Failed to convert CAF to MP3 for attachment, ${attachment.transferName}`, "debug");
            console.log(ex?.message ?? ex, "error");
        }
    } else {
        console.log("Attachment has already been converted! Skipping...", "debug");
    }

    if (!failed && ext && (fs.existsSync(newPath) || dryRun)) {
        // If conversion is successful, we need to modify the attachment a bit
        attachment.mimeType = "audio/mp3";
        attachment.filePath = newPath;
        attachment.transferName = basename(newPath).replace(`.${ext}`, ".mp3");

        // Set the fPath to the newly converted path
        return newPath;
    }

    return null;
};

export const convertImage = async (
    attachment: Attachment,
    {
        originalMimeType = null,
        dryRun = false
    }: {
        originalMimeType?: string
        dryRun?: boolean
    } = {}
): Promise<string> => {
    if (!attachment) return null;
    const newPath = getConversionPath(attachment, "jpeg");
    const mType = originalMimeType ?? attachment.getMimeType();
    let failed = false;
    let ext: string = null;

    // Only convert certain types
    if (attachment.uti === "public.heic" || mType.startsWith("image/heic")) {
        ext = "heic";
    } else if (attachment.uti === "public.heif" || mType.startsWith("image/heif")) {
        ext = "heif";
    } else if (attachment.uti === "public.tiff" || mType.startsWith("image/tiff") || mType.endsWith("tif")) {
        ext = "tiff";
    }

    if (!fs.existsSync(newPath) && !dryRun) {
        try {
            if (isNotEmpty(ext)) {
                console.log(`Converting image attachment, ${attachment.transferName}, to an JPEG...`);
                await FileSystem.convertToJpg(attachment.filePath, newPath);
            }
        } catch (ex: any) {
            failed = true;
            console.log(`Failed to convert image to JPEG for attachment, ${attachment.transferName}`, "debug");
            console.log(ex?.message ?? ex, "error");
        }
    } else {
        console.log("Attachment has already been converted! Skipping...", "debug");
    }

    if (!failed && ext && (fs.existsSync(newPath) || dryRun)) {
        // If conversion is successful, we need to modify the attachment a bit
        attachment.mimeType = "image/jpeg";
        attachment.filePath = newPath;
        attachment.transferName = basename(newPath).replace(new RegExp(`\\.${ext}$`), ".jpeg");

        // Set the fPath to the newly converted path
        return newPath;
    }

    return null;
};

export const getAttachmentMetadata = async (attachment: Attachment): Promise<Metadata> => {
    let metadata: Metadata = {};
    if (attachment.uti !== "com.apple.coreaudio-format" && !attachment.mimeType) return metadata;

    if (attachment.uti === "com.apple.coreaudio-format" || attachment.mimeType.startsWith("audio")) {
        metadata = await FileSystem.getAudioMetadata(attachment.filePath);
    } else if (attachment.mimeType.startsWith("image")) {
        metadata = await FileSystem.getImageMetadata(attachment.filePath);

        // Try to get the dimentions from the attachment object iself (attribution info)
        const dimensions = attachment.getDimensions();
        if (dimensions) {
            metadata.height = dimensions.height;
            metadata.width = dimensions.width;
        }

        try {
            // If we got no height/width data, let's try to fallback to other code to fetch it
            if (handledImageMimes.includes(attachment.mimeType) && (!metadata?.height || !metadata?.width)) {
                console.log("Image metadata empty, getting size from NativeImage...", "debug");

                // Load the image data
                // TODO - remove the NativeImage and do it without electron
                const image = nativeImage.createFromPath(FileSystem.getRealPath(attachment.filePath));

                // If we were able to load the image, get the size
                if (image) {
                    const size = image.getSize();

                    // If the size if available, set the metadata for it
                    if (size?.height && size?.width) {
                        // If the metadata is null, let's give it some data
                        if (metadata === null) metadata = {};
                        metadata.height = size.height;
                        metadata.width = size.width;
                    }
                }
            }
        } catch (ex: any) {
            console.log("Failed to load size data from NativeImage!", "debug");
        }
    } else if (attachment.mimeType.startsWith("video")) {
        metadata = await FileSystem.getVideoMetadata(attachment.filePath);
    }

    return metadata;
};

