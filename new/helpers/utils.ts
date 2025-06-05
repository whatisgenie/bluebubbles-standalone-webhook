import { NSAttributedString, Unarchiver } from "node-typedstream";

export const MessagesBasePath = `${process.env.HOME}/Library/Messages`;
export const invisibleMediaChar = String.fromCharCode(65532);



export const isEmpty = (value: string | Array<any> | NodeJS.Dict<any> | number | null | undefined, trim = true): boolean => {
    return !isNotEmpty(value, trim);
};


export const isNotEmpty = (value: string | Array<any> | NodeJS.Dict<any> | number | null | undefined, trimEmpty = true ): boolean => {
    if (!value) return false;

    // Handle if the input is a string
    if (typeof value === "string" && (trimEmpty ? (value as string).trim() : value).length > 0) return true;

    // Handle if the input is a list
    if (typeof value === "object" && Array.isArray(value)) {
        if (trimEmpty) return value.filter(i => isNotEmpty(i)).length > 0;
        return value.length > 0;
    }

    // Handle if the input is a dictionary
    if (typeof value === "object" && !Array.isArray(value)) return Object.keys(value).length > 0;

    // If all fails, it's not empty
    return true;
};

export const convertAttributedBody = (value: Buffer): any[] => {
    if (isEmpty(value)) return null;

        try {
            const attributedBody = Unarchiver.open(value, Unarchiver.BinaryDecoding.decodable).decodeAll();
            if (isEmpty(attributedBody)) return null;

            let body = null;
            if (Array.isArray(attributedBody)) {
                body = attributedBody.map(i => {
                    if (i.values) {
                        return i.values.filter((e: any) => {
                            return e && e instanceof NSAttributedString;
                        });
                    } else {
                        return i;
                    }
                });
            } else {
                body = attributedBody;
            }

            // Make sure we don't have nested arrays
            if (Array.isArray(body)) {
                body = body.flat();
            }

            // Make sure all outputs are arrays
            if (!Array.isArray(body)) {
                body = [body];
            }

            return body;
        } catch (e: any) {
            console.log(`Failed to deserialize archive: ${e.message}`);
        }

        return null;
    }




export const sanitizeStr = (val: string) => {
    if (!val) return val;

    // Recursively replace all "obj" hidden characters
    let output = val;
    while (output.includes(invisibleMediaChar)) {
        output = output.replace(invisibleMediaChar, "");
    }

    return safeTrim(output);
};

export const safeTrim = (value: string) => {
    return (value ?? "").trim();
};

export class AttributedBodyUtils {
    static extractText(attributedBody: NodeJS.Dict<any> | NodeJS.Dict<any>[]): string | null {
        if (attributedBody == null) return null;
        if (!Array.isArray(attributedBody)) {
            attributedBody = [attributedBody];
        }

        for (const i of (attributedBody as NodeJS.Dict<any>[])) {
            if (isNotEmpty(i?.string)) {
                return i.string;
            }
        }
        
        return null;
    }
}






export const resultAwaiter = async ({
    maxWaitMs = 30000,
    initialWaitMs = 250,
    waitMultiplier = 1.5,
    getData,
    extraLoopCondition = null,
    dataLoopCondition = null
}: {
    maxWaitMs?: number;
    initialWaitMs?: number;
    waitMultiplier?: number;
    getData: (previousData: any | null) => any;
    extraLoopCondition?: (data: any | null) => boolean;
    dataLoopCondition?: (data: any | null) => boolean;
}): Promise<any | null> => {
    let waitTime = initialWaitMs;
    let totalTime = 0;

    // Defaults to false because true means keep looping.
    // This condition is OR'd with the data loop condition.
    // If this was true, it would keep looping indefinitely.
    if (!extraLoopCondition) {
        extraLoopCondition = _ => false;
    }

    // Set the default check for the loop condition to be if the data is null.
    // If it's null, keep looping.
    if (!dataLoopCondition) {
        dataLoopCondition = _ => !data;
    }

    let data = await getData(null);
    while ((dataLoopCondition(data) || extraLoopCondition(data)) && totalTime < maxWaitMs) {
        // Give it a bit to execute
        await waitMs(waitTime);
        totalTime += waitTime;

        // Re-fetch the message with the updated information
        data = await getData(data);
        waitTime = waitTime * waitMultiplier;
    }

    return data;
};


export const waitMs = async (ms: number) => {
    return new Promise((resolve, _) => setTimeout(resolve, ms));
};


// MORE FILESYSTEM STUFF
export const parseMetadataString = (metadata: string): { [key: string]: string } => {
    if (!metadata) return {};

    const output: { [key: string]: string } = {};
    for (const line of metadata.split("\n")) {
        if (!line.includes("=")) continue;

        const items = line.split(" = ");
        if (items.length < 2) continue;

        const value = safeTrim(items[1].replace(/"/g, ""));
        if (isEmpty(value) || value === "(") continue;

        // If all conditions to parse pass, save the key/value pair
        output[safeTrim(items[0])] = value;
    }

    return output;
};
