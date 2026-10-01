import { getOrCreateSetting, getSetting, setSettings } from "@/db/repository";

const ACCESS_COOKIE = "stem-party-access";
const CODE_ROTATION_MS = 5 * 60 * 1000;
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const DIGITS = "0123456789";

function secret() {
  const value = process.env.ADMIN_CODE;
  if (!value) throw new Error("De toegangsbeveiliging is niet ingesteld.");
  return value;
}

function encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomSeed() {
  return encode(crypto.getRandomValues(new Uint8Array(24)));
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`stem-de-hit:party-access:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function seedId(seed: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  return encode(digest.slice(0, 9));
}

async function partySeed() {
  return getOrCreateSetting("party_access_seed", randomSeed());
}

function normalizeCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

async function codeFor(seed: string, period: number) {
  const digest = await hmac(`${seed}:join-code:${period}`);
  return Array.from(digest.slice(0, 6), (byte) => DIGITS[byte % DIGITS.length]).join("");
}

export async function getCurrentPartyCode(now = Date.now()) {
  const seed = await partySeed();
  const period = Math.floor(now / CODE_ROTATION_MS);
  const rotatesAt = (period + 1) * CODE_ROTATION_MS;
  return { code: await codeFor(seed, period), rotatesAt, expiresInSeconds: Math.max(1, Math.ceil((rotatesAt - now) / 1000)) };
}

export async function verifyPartyCode(value: string, now = Date.now()) {
  const submitted = normalizeCode(value);
  if (submitted.length !== 6) return false;
  const seed = await partySeed();
  const period = Math.floor(now / CODE_ROTATION_MS);
  const candidates = [await codeFor(seed, period)];
  if (now - period * CODE_ROTATION_MS < 30_000) candidates.push(await codeFor(seed, period - 1));
  return candidates.some((candidate) => timingSafeEqual(candidate, submitted));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export async function createPartyAccessCookie() {
  const seed = await partySeed();
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS;
  const id = await seedId(seed);
  const signature = encode((await hmac(`${id}.${expiresAt}`)).slice(0, 18));
  return `${ACCESS_COOKIE}=${encodeURIComponent(`${id}.${expiresAt}.${signature}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TOKEN_LIFETIME_SECONDS}`;
}

export async function hasPartyAccess(request: Request, adminCode?: string | null) {
  if (adminCode && timingSafeEqual(adminCode, secret())) return true;
  const token = cookieValue(request, ACCESS_COOKIE);
  if (!token) return false;
  const [id, expiresValue, signature] = token.split(".");
  const expiresAt = Number(expiresValue);
  if (!id || !signature || !Number.isFinite(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const seed = await getSetting("party_access_seed");
  if (!seed || !timingSafeEqual(id, await seedId(seed))) return false;
  const expected = encode((await hmac(`${id}.${expiresAt}`)).slice(0, 18));
  return timingSafeEqual(signature, expected);
}

export async function rotatePartyAccess() {
  await setSettings({ party_access_seed: randomSeed() });
}

export function partyAccessDenied() {
  return Response.json({ error: "Voer eerst de toegangscode van het scherm in." }, { status: 401, headers: { "Cache-Control": "no-store" } });
}
