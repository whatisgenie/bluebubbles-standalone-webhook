import * as path from "path";
import * as child_process from "child_process";

import {
    parseMetadataString,
    isNotEmpty,
    isEmpty,
} from "../helpers/utils";

import {
    type AudioMetadata,
    type MetadataKeyMap,
    type VideoMetadata,
    type ImageMetadata,
    AudioMetadataKeys,
    MetadataDataTypes,
    VideoMetadataKeys,
    ImageMetadataKeys
} from "./types";

/**
 * The class used to handle all communications to the App's "filesystem".
 * The filesystem is the directory dedicated to the app-specific files
 */
export class FileSystem {

/**
 * Asynchronously executes a shell command
 */
    static async execShellCommand(cmd: string): Promise<string> {
        const { exec } = child_process;
        return new Promise((resolve, reject) => {
            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    reject(error);
                }

                resolve(stdout || stderr);
            });
        });
    }


    static getRealPath(filePath: string) {
        let output = filePath;
        if (isEmpty(output)) return output;

        if (output[0] === "~") {
            output = path.join(process.env.HOME, output.slice(1));
        }

        return output;
    }

    static async convertCafToMp3(originalPath: string, outputPath: string): Promise<void> {
        const oldPath = FileSystem.getRealPath(originalPath);
        const output = await FileSystem.execShellCommand(
            `/usr/bin/afconvert -f m4af -d aac "${oldPath}" "${outputPath}"`
        );
        if (isNotEmpty(output) && output.includes("Error:")) {
            throw Error(`Failed to convert audio to MP3: ${output}`);
        }
    }

    static async convertMp3ToCaf(originalPath: string, outputPath: string): Promise<void> {
        const oldPath = FileSystem.getRealPath(originalPath);
        const output = await FileSystem.execShellCommand(
            `/usr/bin/afconvert -f caff -d LEI16@44100 -c 1 "${oldPath}" "${outputPath}"`
        );
        if (isNotEmpty(output) && output.includes("Error:")) {
            throw Error(`Failed to convert audio to CAF: ${output}`);
        }
    }

    static async convertToJpg(originalPath: string, outputPath: string): Promise<void> {
        const oldPath = FileSystem.getRealPath(originalPath);
        const output = await FileSystem.execShellCommand(
            `/usr/bin/sips --setProperty "format" "jpeg" "${oldPath}" --out "${outputPath}"`
        );
        if (isNotEmpty(output) && output.includes("Error:")) {
            throw Error(`Failed to convert image to JPEG: ${output}`);
        }
    }

    static async isSipDisabled(): Promise<boolean> {
        const res = ((await FileSystem.execShellCommand(`csrutil status`)) ?? "").trim();
        return !res.endsWith("enabled.");
    }

    static async hasFullDiskAccess(): Promise<boolean> {
        const res = (
            (await FileSystem.execShellCommand(
                `defaults read ~/Library/Preferences/com.apple.universalaccessAuthWarning.plist`
            )) ?? ""
        ).trim();
        return res.includes('BlueBubbles.app" = 1') || res.includes('BlueBubbles" = 1');
    }

    static async getFileMetadata(filePath: string): Promise<{ [key: string]: string }> {
        try {
            return parseMetadataString(await FileSystem.execShellCommand(`mdls "${FileSystem.getRealPath(filePath)}"`));
        } catch (ex: any) {
            return null;
        }
    }

    private static async parseMetadata(filePath: string, parserKeyDefinition: MetadataKeyMap): Promise<any> {
        const metadata: { [key: string]: string } = await FileSystem.getFileMetadata(filePath);
        if (!metadata) return null;

        const getNumber = (num: string) => {
            if (!num) return null;

            try {
                return Number.parseFloat(num);
            } catch (ex: any) {
                return null;
            }
        };

        const meta: { [key: string]: any } = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (!(key in parserKeyDefinition)) continue;

            // Get the types info for the field
            const { dataType, metaKey } = parserKeyDefinition[key];

            // Parse the item by type
            let itemValue: any;
            switch (dataType) {
                case MetadataDataTypes.Bool:
                    itemValue = value === "1";
                    break;
                case MetadataDataTypes.Float:
                    itemValue = getNumber(value);
                    break;
                case MetadataDataTypes.Int:
                    itemValue = Math.trunc(getNumber(value));
                    break;
                default:
                    itemValue = value;
                    break;
            }

            meta[metaKey] = itemValue;
        }

        return meta;
    }

    static async getAudioMetadata(audioPath: string): Promise<AudioMetadata> {
        const meta = await FileSystem.parseMetadata(audioPath, AudioMetadataKeys);
        return meta as AudioMetadata;
    }

    static async getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
        const meta = await FileSystem.parseMetadata(videoPath, VideoMetadataKeys);
        return meta as VideoMetadata;
    }

    static async getImageMetadata(imagePath: string): Promise<ImageMetadata> {
        const meta = await FileSystem.parseMetadata(imagePath, ImageMetadataKeys);
        return meta as ImageMetadata;
    }










}
