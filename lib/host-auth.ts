const HOST_COOKIE = "__Host-stem-de-hit-host";
const SESSION_SECONDS = 12 * 60 * 60;

function adminSecret() {
  const value = process.env.ADMIN_CODE;
  if (!value) throw new Error("De hostbeveiliging is niet ingesteld.");
  return value;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signature(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(adminSecret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${HOST_COOKIE}=`))?.slice(HOST_COOKIE.length + 1) || null;
}

export async function verifyAdminCode(code: unknown) {
  if (typeof code !== "string" || !code) return false;
  const [expected, received] = await Promise.all([signature(`code:${adminSecret()}`), signature(`code:${code}`)]);
  return safeEqual(expected, received);
}

export async function createHostCookie(code: unknown) {
  if (!(await verifyAdminCode(code))) throw new Error("De beheercode klopt niet.");
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  const signed = `${payload}.${await signature(payload)}`;
  return `${HOST_COOKIE}=${signed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearHostCookie() {
  return `${HOST_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function isHostRequest(request: Request) {
  const value = cookieValue(request);
  if (!value) return false;
  const [expires, received] = value.split(".");
  if (!expires || !received || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  return safeEqual(await signature(expires), received);
}

export async function assertHostRequest(request: Request) {
  if (!(await isHostRequest(request))) throw new Error("Ontgrendel eerst de hostinstellingen.");
}
