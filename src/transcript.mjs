// The status line payload has no permission mode, but the transcript does. Tail the file
// and take the last `permissionMode` it recorded.

import { openSync, readSync, closeSync, statSync } from "node:fs";

const TAIL_BYTES = 64 * 1024;

export function tail(path, bytes = TAIL_BYTES) {
  if (!path) return "";
  let fd;
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const len = size - start;
    if (len <= 0) return "";
    const buf = Buffer.alloc(len);
    fd = openSync(path, "r");
    readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

const LABELS = {
  default: "default",
  acceptEdits: "accept-edits",
  bypassPermissions: "bypass",
  plan: "plan",
  auto: "auto",
};

export function permissionMode(transcriptPath) {
  const text = tail(transcriptPath);
  if (!text) return "";
  const matches = text.match(/"permissionMode":"([A-Za-z]+)"/g);
  if (!matches || !matches.length) return "";
  const last = /"permissionMode":"([A-Za-z]+)"/.exec(matches[matches.length - 1]);
  const raw = last ? last[1] : "";
  return LABELS[raw] || raw;
}
