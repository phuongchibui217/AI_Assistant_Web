import { readFileSync, statSync } from "fs";

import bcrypt from "bcryptjs";
import { readDemoStore } from "./demo-store";

// Web Client credentials are separate from the Admin login. Accounts in
// .htpasswd take precedence over credentials configured in the demo panel.

const HTPASSWD_PATH = process.env.HTPASSWD_PATH || "/data/auth/.htpasswd";
const DEFAULT_USER = process.env.CLIENT_DEFAULT_USER || "admin";
const DEFAULT_PASS = process.env.CLIENT_DEFAULT_PASS || "admin";

let htpasswdCache: { mtime: number; users: Record<string, string> } = {
  mtime: -1,
  users: {},
};

/** Parse `.htpasswd` into {username: bcryptHash}, cached by file mtime. */
function loadHtpasswdUsers(): Record<string, string> {
  let mtime: number;
  try {
    mtime = statSync(HTPASSWD_PATH).mtimeMs;
  } catch {
    htpasswdCache = { mtime: -1, users: {} };
    return htpasswdCache.users;
  }
  if (mtime === htpasswdCache.mtime) return htpasswdCache.users;
  const users: Record<string, string> = {};
  try {
    for (const line of readFileSync(HTPASSWD_PATH, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf(":");
      if (i > 0) users[t.slice(0, i)] = t.slice(i + 1);
    }
  } catch {
    return htpasswdCache.users;
  }
  htpasswdCache = { mtime, users };
  return users;
}

/** True if user/pass match the .htpasswd, admin demo password, or the fallback when none exists yet. */
export function verifyCredential(user: string, pass: string): boolean {
  const users = loadHtpasswdUsers();
  const hash = users[user];
  if (hash) return bcrypt.compareSync(pass, hash);
  const { clientUsername, clientPasswordHash, clientPassword: demoPass } = readDemoStore();
  if (clientPasswordHash) {
    return user === clientUsername && Buffer.byteLength(pass, "utf8") <= 72 &&
      bcrypt.compareSync(pass, clientPasswordHash);
  }
  if (demoPass) {
    return pass === demoPass;
  }
  // No .htpasswd entry yet: allow the single hard-coded fallback so the demo
  // stays usable until an admin sets the client password.
  if (Object.keys(users).length === 0) {
    return user === DEFAULT_USER && pass === DEFAULT_PASS;
  }
  return false;
}
