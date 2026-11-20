// installtarget.js — which community an installed app opens, the name
// under its icon, and the manifest URL that asks for them. Shared by the
// page (installapp.js, extracttopic.js) and the server
// (server/installmanifest.js), so both read a link, a start and a name the
// same way.
//
// A start is where the app opens: a topic id, or a registered name
// (domainregistry.js), as the first path segment of a link (/zagreb,
// /0.0.123) or, in older links, ?topic=. The default topic opens at /.
// Each community is its own app: its manifest's id and start_url are
// /<start>, so several can sit side by side. The default app keeps
// /manifest.webmanifest, id "/" and start_url "/".

export const DEFAULT_TOPIC = '0.0.9609912';
export const APP_NAME = 'Web3Globe';
export const LABEL_JOIN = ' · ';
// The name under the icon: what a person typed, cleaned, at most
// LABEL_MAX characters; short_name (an Android launcher's label) at most
// SHORT_MAX.
export const LABEL_MAX = 40;
export const SHORT_MAX = 12;
export const START_MAX = 64;
export const MANIFEST_PATH = '/manifest.webmanifest';
// icon=pic: the community's picture (the server finds it). Anything else
// is the app icon.
export const ICON_PIC = 'pic';
// A query value is cut to this before it is read.
const RAW_MAX = 512;

const TOPIC_ID = /^0\.0\.\d{1,12}$/;

export function isTopicId(value) {
  return typeof value === 'string' && TOPIC_ID.test(value);
}

// The start a link names, as typed: the first path segment, else ?topic=.
// '' at /. A malformed escape reads as no start.
export function startFromUrl(href) {
  let url;
  try {
    url = new URL(String(href));
  } catch {
    return '';
  }
  let fromPath = '';
  if (url.pathname && url.pathname !== '/') {
    try {
      fromPath = decodeURIComponent(url.pathname.slice(1).split('/')[0]).trim();
    } catch {
      fromPath = '';
    }
  }
  const fromQuery = (url.searchParams.get('topic') || '').trim();
  return fromPath || fromQuery;
}

// A start an install may name: a topic id, or a name's shape (lower case,
// at most START_MAX, no spaces, slashes, %, controls or "0.0."). '' for
// anything else. The server still checks the name is registered and the
// topic is known.
export function cleanStart(value) {
  const text = String(value ?? '').slice(0, RAW_MAX).trim();
  if (!text) return '';
  if (TOPIC_ID.test(text)) return text;
  const name = text.toLowerCase();
  if (Array.from(name).length > START_MAX) return '';
  if (/[\s/\\?#%\p{Cc}\p{Cf}]/u.test(name)) return '';
  if (name.includes('0.0.')) return '';
  return name;
}

export function isDefaultStart(start) {
  return !start || start === DEFAULT_TOPIC;
}

// Where the app opens for a start: / for the default, else /<start>.
export function startPath(start) {
  return isDefaultStart(start) ? '/' : `/${encodeURIComponent(start)}`;
}

function chars(text) {
  return Array.from(text);
}

// A name for the icon as a person typed it: no control, bidi or zero-width
// marks, spaces collapsed, at most LABEL_MAX characters. '' when nothing
// is left.
export function cleanLabel(value) {
  const text = String(value ?? '')
    .slice(0, RAW_MAX)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return chars(text).slice(0, LABEL_MAX).join('').trim();
}

// "Web3Globe · <name>", or just "Web3Globe" for the default topic.
export function defaultLabel(name = '') {
  const community = cleanLabel(name);
  return community ? cleanLabel(`${APP_NAME}${LABEL_JOIN}${community}`) : APP_NAME;
}

// short_name: the name when it fits, else the part after "Web3Globe · ",
// else cut at the last space that keeps a word (or at SHORT_MAX).
export function shortLabel(label) {
  const name = cleanLabel(label) || APP_NAME;
  if (chars(name).length <= SHORT_MAX) return name;
  const lead = APP_NAME + LABEL_JOIN;
  const rest = name.startsWith(lead) ? name.slice(lead.length).trim() : name;
  if (chars(rest).length <= SHORT_MAX) return rest;
  const cut = chars(rest).slice(0, SHORT_MAX).join('');
  const space = cut.lastIndexOf(' ');
  return (space >= 4 ? cut.slice(0, space) : cut).trim();
}

// The manifest for a choice. label: only a name the person changed (the
// server names a community itself); icon: ICON_PIC or not. The default
// topic with its own name and the app icon is /manifest.webmanifest.
export function manifestHref({ start = '', label = '', icon = '' } = {}) {
  const params = new URLSearchParams();
  const clean = cleanStart(start);
  if (clean && !isDefaultStart(clean)) params.set('start', clean);
  const name = cleanLabel(label);
  if (name) params.set('n', name);
  if (icon === ICON_PIC) params.set('icon', ICON_PIC);
  const query = params.toString();
  return query ? `${MANIFEST_PATH}?${query}` : MANIFEST_PATH;
}

const one = (value) => (Array.isArray(value) ? value[0] : value);

// True when a manifest request asks for anything but the default.
export function hasManifestQuery(query) {
  if (!query || typeof query !== 'object') return false;
  return ['start', 'n', 'icon'].some((key) => one(query[key]) != null);
}

// A manifest request's choice, every part cleaned (server side).
export function readManifestQuery(query = {}) {
  const raw = (key) => {
    const value = one(query[key]);
    return typeof value === 'string' ? value : '';
  };
  const start = cleanStart(raw('start'));
  return {
    start: isDefaultStart(start) ? '' : start,
    label: cleanLabel(raw('n')),
    icon: raw('icon') === ICON_PIC ? ICON_PIC : '',
  };
}
