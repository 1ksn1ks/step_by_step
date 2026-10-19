// Video length is stored in the R2 object name (-d37.mp4) so the popup can
// filter without downloading the file. Old uploads and outside links have
// no token, and those stay unknown.

const DURATION_IN_NAME = /-d(\d+)\.(mp4|webm)(\?|#|$)/i;

// An array is the first entry, the same way a stored Image field is [url].
export function videoSeconds(url) {
  const text = Array.isArray(url) ? url[0] : url;
  if (typeof text !== 'string') return null;
  const match = DURATION_IN_NAME.exec(text);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isInteger(seconds) ? seconds : null;
}

// Client header "X-Media-Duration". Only a whole number of seconds from
// 1 through 10 hours is accepted. Anything else is treated as missing.
export function headerDuration(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const seconds = Number(text);
  if (seconds < 1 || seconds > 36000) return null;
  return seconds;
}

const MP4_CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'moof', 'traf', 'mvex']);

function readU32(bytes, offset) {
  return bytes[offset] * 16777216 + bytes[offset + 1] * 65536 + bytes[offset + 2] * 256 + bytes[offset + 3];
}

// Movie header (mvhd), after the box header. Version 0 stores timescale
// and duration as 32-bit; version 1 stores the times as 64-bit and the
// duration as 64-bit. Seconds are duration / timescale.
function parseMvhd(bytes, start, end) {
  if (start >= end) return null;
  const version = bytes[start];
  let timescale = 0;
  let duration = 0;
  if (version === 0) {
    if (start + 20 > end) return null;
    timescale = readU32(bytes, start + 12);
    duration = readU32(bytes, start + 16);
    // All-ones means the file does not know its length.
    if (duration === 0xFFFFFFFF) return null;
  } else if (version === 1) {
    if (start + 32 > end) return null;
    timescale = readU32(bytes, start + 20);
    const hi = readU32(bytes, start + 24);
    const lo = readU32(bytes, start + 28);
    if (hi === 0xFFFFFFFF && lo === 0xFFFFFFFF) return null;
    duration = hi * 0x100000000 + lo;
  } else {
    return null;
  }
  if (!timescale) return null;
  const seconds = duration / timescale;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.round(seconds);
  if (rounded < 1 || rounded > 36000) return null;
  return rounded;
}

function boxAt(bytes, offset, end) {
  if (offset + 8 > end) return null;
  let size = readU32(bytes, offset);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > end) return null;
    const hi = readU32(bytes, offset + 8);
    const lo = readU32(bytes, offset + 12);
    if (hi !== 0) return null;
    size = lo;
    header = 16;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < header || offset + size > end) return null;
  const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
  return { size, header, type };
}

// Walks container boxes only, so a media payload that happens to contain
// the letters "mvhd" is not treated as the movie header.
export function mp4DurationSeconds(bytes) {
  if (!bytes || bytes.length < 16) return null;
  function walk(start, end) {
    let offset = start;
    while (offset + 8 <= end) {
      const box = boxAt(bytes, offset, end);
      if (!box) return null;
      const body = offset + box.header;
      if (box.type === 'mvhd') return parseMvhd(bytes, body, offset + box.size);
      if (MP4_CONTAINERS.has(box.type)) {
        const found = walk(body, offset + box.size);
        if (found != null) return found;
      }
      offset += box.size;
    }
    return null;
  }
  try {
    return walk(0, bytes.length);
  } catch {
    return null;
  }
}

// Header wins unless the mp4 movie header disagrees by more than 2 seconds.
// A failed parse keeps the header. Other types are not inspected.
export function resolvedUploadSeconds(ext, headerValue, bytes) {
  const header = headerDuration(headerValue);
  if (!header) return null;
  if (ext !== '.mp4') return header;
  const parsed = mp4DurationSeconds(bytes);
  if (parsed == null) return header;
  if (Math.abs(parsed - header) > 2) return parsed;
  return header;
}

export function uploadObjectKey(ext, seconds, now, nonce) {
  const base = `markers/${now}-${nonce}`;
  if (seconds) return `${base}-d${seconds}${ext}`;
  return `${base}${ext}`;
}
