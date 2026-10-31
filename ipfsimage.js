// Profile pictures and NFT images are often IPFS. gateway.lighthouse.storage
// answers 402, so it is not a candidate. A failed gateway is not the last
// try. Plain <img> tags do not need CORS; crossOrigin stays only on images
// that draw into a canvas (those set data-canvas-image).

const GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://4everland.io/ipfs/',
];

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[a-z2-7][a-z2-7]{50,})$/;

function cidFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  const ipfsAt = parts.indexOf('ipfs');
  const start = ipfsAt >= 0 ? ipfsAt + 1 : 0;
  const cid = parts[start] || '';
  if (!CID.test(cid)) return null;
  return { cid, path: parts.slice(start + 1).join('/') };
}

function ipfsParts(url) {
  const text = String(url || '').trim();
  if (!text) return null;
  if (text.startsWith('ipfs://')) {
    return cidFromPath(text.slice('ipfs://'.length));
  }
  try {
    return cidFromPath(new URL(text).pathname);
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function gatewayUrl(parts, index) {
  const base = GATEWAYS[index];
  return base + parts.cid + (parts.path ? '/' + parts.path : '');
}

function preferGateway(url) {
  const parts = ipfsParts(url);
  if (!parts) return '';
  const text = String(url || '');
  if (text.startsWith('ipfs://') || /lighthouse\.storage/i.test(text)) {
    return gatewayUrl(parts, 0);
  }
  return '';
}

export function advanceIpfsImage(img) {
  if (!img) return false;
  const current = img.currentSrc || img.src || img.getAttribute('src') || '';
  const parts = ipfsParts(current);
  if (!parts) return false;
  const key = parts.cid + '/' + parts.path;
  if (img.dataset.ipfsCid !== key) {
    img.dataset.ipfsCid = key;
    img.dataset.ipfsTried = '';
  }
  const host = hostOf(current);
  const tried = new Set((img.dataset.ipfsTried || '').split(' ').filter(Boolean));
  tried.add(host);
  const start = GATEWAYS.findIndex((base) => hostOf(base) === host);
  for (let step = 1; step <= GATEWAYS.length; step += 1) {
    const index = (start < 0 ? step - 1 : start + step) % GATEWAYS.length;
    const nextHost = hostOf(GATEWAYS[index]);
    if (!nextHost || tried.has(nextHost)) continue;
    tried.add(nextHost);
    img.dataset.ipfsTried = [...tried].join(' ');
    img.src = gatewayUrl(parts, index);
    return true;
  }
  img.dataset.ipfsTried = [...tried].join(' ');
  return false;
}

function rewriteImage(img) {
  if (!img || img.tagName !== 'IMG' || img.dataset.canvasImage === '1') return;
  const raw = img.getAttribute('src') || '';
  const next = preferGateway(raw);
  const stripCors = img.hasAttribute('crossorigin');
  if (stripCors) img.removeAttribute('crossorigin');
  if (next && next !== raw) {
    delete img.dataset.ipfsTried;
    delete img.dataset.ipfsCid;
    img.src = next;
    return;
  }
  if (stripCors && raw) img.src = raw;
}

function watchNode(node) {
  if (!node || node.nodeType !== 1) return;
  if (node.tagName === 'IMG') rewriteImage(node);
  if (node.querySelectorAll) node.querySelectorAll('img').forEach(rewriteImage);
}

function install() {
  if (typeof document === 'undefined') return;
  document.addEventListener('error', (event) => {
    const img = event.target;
    if (!img || img.tagName !== 'IMG' || img.dataset.canvasImage === '1') return;
    if (advanceIpfsImage(img)) event.stopImmediatePropagation();
  }, true);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) watchNode(node);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchNode(document.documentElement);
}

install();
