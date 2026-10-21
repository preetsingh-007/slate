const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random lowercase base-36 id (~62 bits at the default length). Safe in file names. */
export function uid(len = 12): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** 64-bit-ish deterministic hash (two FNV passes with different seeds). Not cryptographic. */
export function hash64(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x100001b3);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** SHA-256 of bytes as lowercase hex. Assets and book files are named by this. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | Blob): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lowercase, hyphen-separated slug (gym naming rules), at most `max` characters. */
export function slugify(text: string, max = 60): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = s.slice(0, max).replace(/-+$/, '');
  return cut || 'untitled';
}

let deviceId: string | null = null;

/** Stable id of this device (browser profile), kept in localStorage. */
export function getDeviceId(): string {
  if (deviceId) return deviceId;
  try {
    deviceId = localStorage.getItem('slate-device');
    if (!deviceId) {
      deviceId = uid(8);
      localStorage.setItem('slate-device', deviceId);
    }
  } catch {
    deviceId = uid(8);
  }
  return deviceId;
}
