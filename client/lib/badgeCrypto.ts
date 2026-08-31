/**
 * Shared badge encryption module -- IDENTICAL COPY lives in both the
 * members portal (which calls encryptBadgePayload) and the chefs
 * portal (which calls decryptBadgePayload, for both the attendance
 * scan and the emergency-access page). There is only ONE crypto
 * system: this file. Do not fork the logic between the two apps --
 * if you need to change the format, change it here, bump
 * FORMAT_VERSION, and copy the updated file to both repos together.
 *
 * Algorithm: AES-256-GCM via the Web Crypto API (crypto.subtle),
 * available natively in any modern browser/WebView -- no external
 * crypto dependency needed on either side.
 *   - AES-GCM is authenticated: a tampered badge fails to decrypt
 *     rather than silently producing wrong-but-plausible data.
 *   - Works fully offline on both ends once the key is baked into
 *     the build (see VITE_BADGE_ENCRYPTION_KEY below) -- no network
 *     call is ever made to encrypt or decrypt a badge.
 *
 * Key handling:
 *   - A single 256-bit key, generated once, base64-encoded, and
 *     stored as the VITE_BADGE_ENCRYPTION_KEY secret in BOTH repos'
 *     GitHub Actions secrets (never committed in plaintext).
 *   - Same key on both sides -- this is symmetric encryption, not
 *     public/private key. Rotating the key means updating it in both
 *     repos at the same time, or old badges stop decrypting.
 *
 * Wire format (what ends up inside the QR):
 *   data:text/html;base64,<...styled HTML card for stock camera apps...>
 *   containing a <script type="application/json" id="d"> tag whose
 *   body is: { "v": "S2", "e": "<encrypted-payload-base64url>" }
 *
 *   <encrypted-payload-base64url> decodes to:
 *     [12 bytes random IV] + [AES-GCM ciphertext, tag included]
 *
 * The decrypted plaintext (UTF-8) is itself JSON -- see
 * BadgeMemberPayload below for the field list.
 */

const FORMAT_VERSION = "S2";

export interface BadgeMemberPayload {
  id: string; // generated_id (human-facing scout ID)
  uuid: string; // internal member UUID (primary key)
  firstName: string;
  lastName: string;
  birthDate: string | null;
  phone: string | null;
  patrol: string | null;
  role: string | null;
  gender: string | null;
  isHighPatrol: boolean | null;
}

export interface EncryptedBadgeEnvelope {
  v: typeof FORMAT_VERSION;
  e: string; // base64url(iv + ciphertext)
}

// ---- key handling -----------------------------------------------------

let cachedKeyPromise: Promise<CryptoKey> | null = null;

function getRawKeyBase64(): string {
  const key = import.meta.env.VITE_BADGE_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "VITE_BADGE_ENCRYPTION_KEY is not set. Badge encryption/decryption cannot work without it -- check your .env / GitHub secrets.",
    );
  }
  return key;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// base64url (QR-safe, no +/= characters) <-> bytes
function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "===".slice((base64.length + 3) % 4);
  return base64ToBytes(padded);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getKey(): Promise<CryptoKey> {
  if (!cachedKeyPromise) {
    // Cast needed because recent TS DOM lib versions distinguish
    // Uint8Array<ArrayBufferLike> from BufferSource strictly (a
    // Uint8Array's backing buffer is typed as ArrayBuffer |
    // SharedArrayBuffer, but BufferSource wants exactly
    // ArrayBuffer) -- this is a type-only mismatch, not a runtime
    // one; a plain Uint8Array from base64ToBytes always has a real
    // ArrayBuffer backing it.
    cachedKeyPromise = crypto.subtle.importKey(
      "raw",
      base64ToBytes(getRawKeyBase64()) as BufferSource,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return cachedKeyPromise;
}

// ---- encrypt (members portal side) -------------------------------------

/**
 * Encrypts a member's badge payload. Call this from the members
 * portal when generating a badge (registration, badge reprint, etc).
 * Returns the full `data:text/html;base64,...` string ready to feed
 * to a QR-code generator.
 */
export async function encryptBadgePayload(
  payload: BadgeMemberPayload,
): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  const envelope: EncryptedBadgeEnvelope = {
    v: FORMAT_VERSION,
    e: bytesToBase64Url(combined),
  };

  const html = buildBadgeHtml(payload, envelope);
  return `data:text/html;base64,${btoa(unescape(encodeURIComponent(html)))}`;
}

/**
 * The visual card shown when someone scans the badge with a stock
 * camera app (no decryption available to them). Keep this
 * intentionally sparse -- it must NOT leak the same personal details
 * the encryption is meant to protect. Adjust styling freely; just
 * don't put firstName/lastName/phone/etc. in here in the clear.
 */
function buildBadgeHtml(
  payload: BadgeMemberPayload,
  envelope: EncryptedBadgeEnvelope,
): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Badge SHM</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f3f4f6}.card{background:#fff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,.1);padding:32px;text-align:center;max-width:320px}.badge{font-size:14px;color:#6b7280;margin-top:12px}</style></head><body><div class="card"><strong>Badge Scout SHM</strong><p class="badge">Identifiant : ${escapeHtml(payload.id)}</p><p class="badge">À scanner avec l'application officielle.</p></div><script type="application/json" id="d">${JSON.stringify(envelope)}</script></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- decrypt (chefs portal side) ---------------------------------------

export interface DecodedBadge {
  valid: boolean;
  payload?: BadgeMemberPayload;
}

/**
 * Decrypts a scanned badge. Call this from the chefs portal (both
 * the attendance scan and the emergency-access page share this same
 * function -- see memberBadge.ts).
 */
export async function decryptBadgePayload(raw: string): Promise<DecodedBadge> {
  const prefix = "data:text/html;base64,";
  if (!raw.startsWith(prefix)) return { valid: false };

  try {
    const base64 = raw.slice(prefix.length);
    const html = decodeURIComponent(escape(atob(base64)));
    const match = html.match(/<script type="application\/json" id="d">(.*?)<\/script>/s);
    if (!match) return { valid: false };

    const envelope = JSON.parse(match[1]) as EncryptedBadgeEnvelope;
    if (envelope.v !== FORMAT_VERSION || !envelope.e) return { valid: false };

    const combined = base64UrlToBytes(envelope.e);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const key = await getKey();
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );

    const payload = JSON.parse(
      new TextDecoder().decode(plaintextBuffer),
    ) as BadgeMemberPayload;

    if (!payload.id || !payload.uuid) return { valid: false };

    return { valid: true, payload };
  } catch {
    // Wrong key, tampered payload, malformed QR, or an unrelated QR
    // entirely -- all collapse to "not a valid badge" on purpose, so
    // the scanner can keep trying silently on every camera frame.
    return { valid: false };
  }
}
