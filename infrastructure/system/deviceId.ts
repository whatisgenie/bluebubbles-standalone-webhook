import os from "os";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

/** Stable “username@host-uuid” string, cached on disk. */
export function getDeviceId(): string {
  const cache = path.join(
    process.env.HOME!,
    "Library/Application Support/imsg-bot/device.id"
  );

  if (fs.existsSync(cache)) return fs.readFileSync(cache, "utf8").trim();

  const id = `${os.userInfo().username}@${os.hostname()}-${randomUUID()}`;
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, id);
  return id;
}