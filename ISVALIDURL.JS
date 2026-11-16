// A link the app can show: http(s), a data: or blob: picture made on this
// device, or ipfs:// (read through a gateway, ipfsimage.js). Anything else
// (s3://, file:, javascript:, a word that only parses as a URL) is not, so
// the caller falls back to its default picture instead of a broken request.
const SHOWABLE = new Set(["http:", "https:", "data:", "blob:", "ipfs:"]);

export function isValidUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    try {
        return SHOWABLE.has(new URL(url.trim()).protocol);
    } catch {
        return false;
    }
}
