import { decryptSyncPayload, encryptSyncPayload } from "../src/sync-crypto.js";

const payload = { hello: "world", events: [1, 2, 3] };
const secret = "test-sync-secret-at-least-16-chars";
const encrypted = encryptSyncPayload(payload, secret);
const decrypted = decryptSyncPayload(encrypted, secret);
if (JSON.stringify(decrypted) !== JSON.stringify(payload)) throw new Error("sync roundtrip failed");
let tampered = false;
try {
  decryptSyncPayload(encrypted.slice(0, -2) + "AA", secret);
} catch {
  tampered = true;
}
if (!tampered) throw new Error("tampered payload was accepted");
console.log("sync crypto ok");
