import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SyncEnvelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

export function deriveSyncKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSyncPayload(value: unknown, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveSyncKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const envelope: SyncEnvelope = {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

export function decryptSyncPayload(payload: string, secret: string): unknown {
  const envelope = JSON.parse(
    Buffer.from(payload, "base64").toString("utf8"),
  ) as Partial<SyncEnvelope>;
  if (envelope.v !== 1 || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error("Unsupported sync payload");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveSyncKey(secret),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
