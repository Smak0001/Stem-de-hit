const PREFIX = "enc:v1:";

function encryptionSecret() {
  const value = process.env.ADMIN_CODE;
  if (!value) throw new Error("De beveiliging van Spotify is niet ingesteld.");
  return value;
}

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function key() {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`stem-de-hit:${encryptionSecret()}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSetting(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  return `${PREFIX}${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptSetting(value: string | null) {
  if (!value || !value.startsWith(PREFIX)) return value;
  const [ivValue, encryptedValue] = value.slice(PREFIX.length).split(".");
  if (!ivValue || !encryptedValue) throw new Error("De Spotify-koppeling moet opnieuw worden ingesteld.");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivValue) }, await key(), decode(encryptedValue));
  return new TextDecoder().decode(decrypted);
}
