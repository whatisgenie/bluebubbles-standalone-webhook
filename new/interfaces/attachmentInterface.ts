import { isNotEmpty } from "../helpers/utils";
import type { Attachment } from "../entities/Attachment";
import { isEmpty } from "../helpers/utils";
import { FileSystem } from "../fileSystem";
import * as fs from "fs";

export class AttachmentInterface {
    static livePhotoExts = ["png", "jpeg", "jpg", "heic", "tiff"];


    static getLivePhotoPath(attachment: Attachment): string | null {
        // If we don't have a path, return null
        const fPath = attachment?.filePath;
        if (isEmpty(fPath)) return null;

        // Get the existing extension (if any).
        // If it's been converted, it'll have a double-extension.
        let ext = fPath.includes('.heic.jpeg') ? 'heic.jpeg' : fPath.split(".").pop() ?? "";

        // If the extension is not an image extension, return null
        if (!AttachmentInterface.livePhotoExts.includes(ext.toLowerCase())) return null;

        // Escape periods in the extension for the regex
        ext = ext.replace(/\./g, "\\.");
    
        // Get the path to the live photo
        // Replace the extension with .mov, or add it if there is no extension
        const livePath = isNotEmpty(ext) ? fPath.replace(new RegExp(`\\.${ext}$`), ".mov") : `${fPath}.mov`;
        const realPath = FileSystem.getRealPath(livePath);

        // If the live photo doesn't exist, return null
        if (!fs.existsSync(realPath)) return null;

        // If the .mov file exists, return the path
        return realPath;
    }
}

