// postgallery.js — up to four pictures on a marker or polygon post, in the
// draw form.
//
// The media picker takes several files at once. Pictures (PNG, JPEG,
// WebP) join this list; one video or one GIF still takes the post's single
// media slot through uploadmedia.js (a GIF becomes a video loop there), and
// a pick that mixes the two is refused. A video already in the slot gives
// way to pictures, as picking new media always replaced it.
//
// Each picture: an original over 10 MB is refused; the rest are shrunk on
// this device (imagecompress.js, one at a time) and refused if still over
// 2 MB, then uploaded two at a time (the server's per-IP limit). One pill
// shows the batch's combined percentage, with Cancel; Cancel drops the
// whole batch. A tile's × drops just that picture.
//
// Under the media card a strip shows the pictures in post order with
// "N/4". The first is the cover: the media card shows it with "+N", and
// when no cover was picked submit makes the marker dot / polygon fill from
// it (postCover in postimages.js, the 512 JPEG a picked cover gets). Drag
// a tile sideways, or focus it and use ← →, to reorder; Delete removes it;
// a tap opens the viewer there.
//
// The hidden Image field keeps the first picture's address, so the byte
// counter, the preview and the video thumbnail logic that read it stay as
// they were; the whole list reaches the post through postimages.js.

import { toast } from "./toast.js";
import {
  clearSingleMedia,
  progressPill,
  setUploadBusy,
  uploadBusy,
  uploadFace,
  uploadPostCover,
  uploadPostImage,
  uploadSingleMedia,
} from "./uploadmedia.js";
import { compressPostImage, shortName } from "./imagecompress.js";
import { openGallery } from "./fullscreenmedia.js";
import { mountMoreBadge } from "./mediagrid.js";
import { paintDrawField, setDrawAutoCover } from "./drawpreview.js";
import { resolveMediaUrl } from "./mediaurl.js";
import {
  POST_IMAGE_MAX,
  POST_IMAGE_ORIGINAL_MAX,
  POST_IMAGE_UPLOAD_MAX,
  POST_IMAGES_BUSY,
  POST_IMAGES_FULL,
  POST_MEDIA_MIX,
  pickKind,
  registerPostDraft,
} from "./postimages.js";

const FORMS = {
  marker: {
    field: "input-field-image-marker",
    cover: "input-field-coverimage-marker",
    picker: "upload-media-marker-file",
    card: "draw-marker-media",
    strip: "draw-marker-gallery",
  },
  polygon: {
    field: "input-field-image-polygon",
    cover: "input-field-coverimage-polygon",
    picker: "upload-media-polygon-file",
    card: "draw-polygon-media",
    strip: "draw-polygon-gallery",
  },
};

// server/index.js UPLOAD_MAX_CONCURRENT_PER_IP.
const UPLOADS_AT_ONCE = 2;
// A 503 "Too many uploads" (another upload from this network) waits and
// tries again, twice.
const BUSY_RETRY_MS = 1500;
const BAD_TYPE = "Only PNG, JPG, WebP, GIF, MP4, WebM";

let nextId = 0;
let compressQueue = Promise.resolve();

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One decode at a time across both forms.
function withCompressLock(fn) {
  const run = compressQueue.then(fn);
  compressQueue = run.catch(() => {});
  return run;
}

function dragStart() {
  return Math.min(window.innerWidth, window.innerHeight) * 0.015;
}

function live(s) {
  return s.items.filter((item) => !item.removed);
}

function viewerUrls(s) {
  return s.items.map((item) => item.preview || item.url).filter(Boolean);
}

// --- Field, card, cover --------------------------------------------------

function firstValue(s) {
  const first = s.items[0];
  return first ? first.url || first.preview : "";
}

function syncField(s) {
  const field = document.getElementById(s.cfg.field);
  if (field) {
    s.ownWrite = true;
    try {
      field.value = firstValue(s);
      field.dispatchEvent(new Event("input"));
    } finally {
      s.ownWrite = false;
    }
  }
  const first = s.items[0];
  // The card shows the copy already on this device, not a fresh download
  // of the uploaded address the field holds.
  if (first && first.preview) paintDrawField(s.cfg.field, first.preview, "image");
  paintCard(s);
  paintStrip(s);
  setDrawAutoCover(s.cfg.cover, first ? first.preview || first.url : "");
}

function paintCard(s) {
  const card = document.getElementById(s.cfg.card);
  if (!card) return;
  card.classList.toggle("has-gallery", s.items.length > 0);
  mountMoreBadge(card, s.items.length - 1, () => openGallery(viewerUrls(s), 1));
}

// --- The strip -------------------------------------------------------------

function tileFor(s, item) {
  let tile = s.tiles.get(item.id);
  if (tile) return tile;
  const el = document.createElement("div");
  el.className = "draw-gallery-tile";
  el.setAttribute("role", "listitem");
  el.tabIndex = 0;
  el.dataset.id = item.id;
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  const tag = document.createElement("span");
  tag.className = "draw-gallery-tag";
  tag.textContent = "Cover";
  const progress = document.createElement("span");
  progress.className = "draw-gallery-progress";
  const bar = document.createElement("span");
  bar.className = "draw-gallery-bar";
  const pct = document.createElement("span");
  pct.className = "draw-gallery-pct";
  progress.append(bar, pct);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "draw-gallery-remove";
  remove.textContent = "×";
  remove.addEventListener("pointerdown", (event) => event.stopPropagation());
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    removeByUser(s, item);
  });
  el.append(img, tag, progress, remove);
  bindTile(s, el, item);
  tile = { el, img, tag, progress, bar, pct, remove, src: "" };
  s.tiles.set(item.id, tile);
  return tile;
}

function paintTile(s, item) {
  const tile = s.tiles.get(item.id);
  if (!tile) return;
  const index = s.items.indexOf(item);
  const total = s.items.length;
  const src = item.preview || item.url || "";
  if (tile.src !== src) {
    tile.src = src;
    if (src) tile.img.src = src;
    else tile.img.removeAttribute("src");
  }
  const cover = index === 0;
  tile.el.classList.toggle("is-cover", cover);
  tile.tag.hidden = !cover;
  const busy = item.phase !== "done";
  tile.el.classList.toggle("is-uploading", busy);
  tile.progress.hidden = !busy;
  if (busy) {
    const ratio = item.phase === "up" ? item.ratio : 0;
    tile.bar.style.setProperty("--p", String(Math.max(0, Math.min(1, ratio))));
    tile.pct.textContent = item.phase === "up" ? `${Math.round(ratio * 100)}%` : "…";
  }
  const state = busy ? (item.phase === "up" ? ", uploading" : ", preparing") : "";
  tile.el.setAttribute(
    "aria-label",
    `Image ${index + 1} of ${total}${cover ? ", cover" : ""}${state}. Arrow keys move it, Delete removes it.`,
  );
  tile.remove.setAttribute("aria-label", `Remove image ${index + 1}`);
}

function paintStrip(s) {
  const strip = document.getElementById(s.cfg.strip);
  if (!strip) return;
  if (!s.list) {
    const head = document.createElement("div");
    head.className = "draw-gallery-head";
    s.count = document.createElement("span");
    s.count.className = "draw-gallery-count";
    const hint = document.createElement("span");
    hint.className = "draw-gallery-hint";
    hint.textContent = "Drag to reorder · the first is the cover";
    head.append(s.count, hint);
    s.list = document.createElement("div");
    s.list.className = "draw-gallery-list";
    s.list.setAttribute("role", "list");
    s.list.setAttribute("aria-label", "Images in this post");
    s.add = document.createElement("button");
    s.add.type = "button";
    s.add.className = "draw-gallery-add";
    s.add.setAttribute("aria-label", "Add images");
    s.add.textContent = "+";
    s.add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPicker(s);
    });
    strip.append(head, s.list);
  }
  const total = s.items.length;
  strip.hidden = total === 0;
  s.count.textContent = `${total}/${POST_IMAGE_MAX}`;
  s.count.setAttribute("aria-label", `${total} of ${POST_IMAGE_MAX} images`);
  const keep = new Set(s.items.map((item) => item.id));
  for (const [id, tile] of s.tiles) {
    if (keep.has(id)) continue;
    tile.el.remove();
    s.tiles.delete(id);
  }
  // Only a tile out of place moves, so a finished upload never moves the
  // one under a finger.
  let prev = null;
  for (const item of s.items) {
    const tile = tileFor(s, item);
    const want = prev ? prev.nextSibling : s.list.firstChild;
    if (tile.el !== want) s.list.insertBefore(tile.el, want);
    prev = tile.el;
    paintTile(s, item);
  }
  s.add.hidden = total >= POST_IMAGE_MAX;
  s.add.disabled = uploadBusy();
  if (s.add.parentNode !== s.list || s.add.nextSibling) s.list.appendChild(s.add);
}

// Drag sideways to reorder. Nothing moves in the DOM until the finger
// lifts (a move would drop the pointer capture); the other tiles slide
// aside to show where it will land.
function bindTile(s, el, item) {
  let press = null;
  let drag = null;
  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    press = { x: event.clientX, y: event.clientY, id: event.pointerId };
  });
  el.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.id) return;
    const dx = event.clientX - press.x;
    if (!drag) {
      if (Math.abs(dx) < dragStart() || Math.abs(dx) < Math.abs(event.clientY - press.y)) return;
      const tiles = s.items.map((it) => s.tiles.get(it.id)).filter(Boolean).map((t) => t.el);
      const from = tiles.indexOf(el);
      if (from < 0 || tiles.length < 2) return;
      drag = { tiles, from, to: from, centers: tiles.map((t) => {
        const box = t.getBoundingClientRect();
        return box.left + box.width / 2;
      }) };
      try { el.setPointerCapture(event.pointerId); } catch { /* released */ }
      el.classList.add("is-dragging");
      s.list.classList.add("is-sorting");
    }
    el.style.transform = `translateX(${dx}px)`;
    const at = drag.centers[drag.from] + dx;
    let to = 0;
    let best = Infinity;
    drag.centers.forEach((c, i) => {
      const d = Math.abs(c - at);
      if (d < best) {
        best = d;
        to = i;
      }
    });
    drag.to = to;
    drag.tiles.forEach((tile, i) => {
      if (tile === el) return;
      let shift = 0;
      if (drag.from < to && i > drag.from && i <= to) shift = drag.centers[i - 1] - drag.centers[i];
      if (to < drag.from && i >= to && i < drag.from) shift = drag.centers[i + 1] - drag.centers[i];
      tile.style.transform = shift ? `translateX(${shift}px)` : "";
    });
  });
  const end = (event) => {
    if (!press || event.pointerId !== press.id) return;
    const was = drag;
    press = null;
    drag = null;
    if (!was) return;
    el.classList.remove("is-dragging");
    s.list.classList.remove("is-sorting");
    for (const tile of was.tiles) tile.style.transform = "";
    // The click after a drag must not open the viewer.
    el.dataset.dragged = "1";
    setTimeout(() => { delete el.dataset.dragged; }, 0);
    if (event.type === "pointerup" && was.to !== was.from) moveItem(s, item, was.to);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    if (el.dataset.dragged) return;
    const index = s.items.indexOf(item);
    if (index >= 0) openGallery(viewerUrls(s), index);
  });
  el.addEventListener("keydown", (event) => {
    const index = s.items.indexOf(item);
    if (index < 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      moveItem(s, item, index + (event.key === "ArrowLeft" ? -1 : 1));
      el.focus();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      const after = s.items[index + 1] || s.items[index - 1];
      removeByUser(s, item);
      const next = after && s.tiles.get(after.id);
      if (next) next.el.focus();
      else if (s.add && !s.add.hidden) s.add.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openGallery(viewerUrls(s), index);
    }
  });
}

function moveItem(s, item, to) {
  const from = s.items.indexOf(item);
  const target = Math.max(0, Math.min(s.items.length - 1, to));
  if (from < 0 || target === from) return;
  s.items.splice(from, 1);
  s.items.splice(target, 0, item);
  syncField(s);
}

// --- Batches ---------------------------------------------------------------

function batchRatio(batch) {
  const items = batch.items.filter((item) => !item.removed);
  if (!items.length) return 1;
  let sum = 0;
  for (const item of items) {
    if (item.phase === "done") sum += 1;
    else if (item.phase === "up") sum += 0.1 + 0.9 * item.ratio;
    else if (item.phase === "prep") sum += 0.05;
  }
  return sum / items.length;
}

function batchLabel(batch) {
  const n = batch.items.filter((item) => !item.removed).length;
  const what = n === 1 ? "image" : `${n} images`;
  return `Uploading ${what} ${Math.round(batchRatio(batch) * 100)}%`;
}

function paintBatch(batch) {
  if (batch && batch.pill && !batch.finished) batch.pill.set(batchLabel(batch));
}

function dropItem(s, item) {
  item.removed = true;
  item.abort.abort();
  if (item.preview) URL.revokeObjectURL(item.preview);
  s.items = s.items.filter((it) => it !== item);
  if (s.cover && s.cover.id === item.id) s.cover = null;
}

function removeByUser(s, item) {
  if (item.removed) return;
  dropItem(s, item);
  paintBatch(item.batch);
  syncField(s);
}

function clearAll(s) {
  if (s.batch) cancelBatch(s, s.batch, true);
  for (const item of s.items.slice()) dropItem(s, item);
  syncField(s);
}

async function prepareItem(item) {
  const file = await withCompressLock(() => {
    if (item.removed) return null;
    return compressPostImage(item.original);
  });
  if (!file || item.removed) return;
  if (file.size > POST_IMAGE_UPLOAD_MAX) {
    throw userError(`${shortName(item.name)} is still over 2 MB after compression`);
  }
  item.file = file;
  item.original = null;
  const before = item.preview;
  item.preview = URL.createObjectURL(file);
  if (before) URL.revokeObjectURL(before);
}

async function sendItem(s, item) {
  const anchor = document.getElementById(s.cfg.card);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await uploadPostImage(item.file, {
        anchor,
        signal: item.abort.signal,
        onProgress(ratio) {
          item.ratio = ratio;
          paintTile(s, item);
          paintBatch(item.batch);
        },
      });
    } catch (err) {
      if (err && err.status === 503 && attempt < 2 && !item.abort.signal.aborted) {
        await wait(BUSY_RETRY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

async function runBatch(s, batch) {
  const worker = async () => {
    for (;;) {
      if (batch.cancelled) return;
      const item = batch.items.find((it) => it.phase === "queued" && !it.removed);
      if (!item) return;
      item.phase = "prep";
      paintTile(s, item);
      paintBatch(batch);
      try {
        await prepareItem(item);
        if (item.removed || batch.cancelled) continue;
        // The tile and the card swap to the smaller copy.
        syncField(s);
        item.phase = "up";
        item.ratio = 0;
        paintTile(s, item);
        const url = await sendItem(s, item);
        if (item.removed || batch.cancelled) continue;
        item.url = url;
        item.phase = "done";
        item.ratio = 1;
        syncField(s);
      } catch (err) {
        if (batch.cancelled || item.removed) continue;
        batch.errors.push(err);
        dropItem(s, item);
        syncField(s);
      }
      paintBatch(batch);
    }
  };
  await Promise.all(Array.from({ length: UPLOADS_AT_ONCE }, worker));
  finishBatch(s, batch);
}

function finishBatch(s, batch) {
  if (batch.finished) return;
  batch.finished = true;
  if (batch.pill) batch.pill.done();
  if (s.batch === batch) s.batch = null;
  setUploadBusy(false);
  if (batch.cancelled) {
    paintStrip(s);
    return;
  }
  const ok = batch.items.filter((item) => item.phase === "done" && !item.removed).length;
  if (batch.errors.length) {
    const more = batch.errors.length - 1;
    toast.error(`${uploadFace(batch.errors[0])}${more > 0 ? ` (+${more} more)` : ""}`, { hold: true });
  } else if (ok) {
    toast.success(ok === 1 ? "Uploaded" : `${ok} images uploaded`);
  }
  syncField(s);
}

// Cancel drops every picture of this batch, done or not, as if it had
// never been picked.
function cancelBatch(s, batch, quiet) {
  if (batch.finished || batch.cancelled) return;
  batch.cancelled = true;
  for (const item of batch.items) {
    if (!item.removed) dropItem(s, item);
  }
  finishBatch(s, batch);
  syncField(s);
  if (!quiet) toast.info("Upload cancelled");
}

function startBatch(s, files) {
  const batch = { items: [], errors: [], finished: false, cancelled: false, pill: null };
  for (const file of files) {
    const item = {
      id: `g${(nextId += 1)}`,
      name: file.name || "image",
      original: file,
      file: null,
      preview: URL.createObjectURL(file),
      url: "",
      ratio: 0,
      phase: "queued",
      removed: false,
      abort: new AbortController(),
      batch,
    };
    s.items.push(item);
    batch.items.push(item);
  }
  s.batch = batch;
  setUploadBusy(true);
  batch.pill = progressPill(batchLabel(batch), () => cancelBatch(s, batch));
  syncField(s);
  runBatch(s, batch);
}

// --- Picking ---------------------------------------------------------------

function openPicker(s) {
  if (uploadBusy()) {
    toast.error(POST_IMAGES_BUSY);
    return;
  }
  if (s.items.length >= POST_IMAGE_MAX) {
    toast.error(POST_IMAGES_FULL);
    return;
  }
  const picker = document.getElementById(s.cfg.picker);
  if (picker) picker.click();
}

// What the single slot holds before any picture was added: a video (it
// gives way), a picture (a one-frame GIF became a JPEG; it joins the list),
// or nothing.
function adoptSingle(s) {
  if (s.items.length) return;
  const field = document.getElementById(s.cfg.field);
  const value = field ? field.value.trim() : "";
  if (!value) return;
  if (resolveMediaUrl(value).kind === "video" || !/^https?:\/\//i.test(value)) {
    clearSingleMedia(s.cfg.field);
    return;
  }
  s.items.push({
    id: `g${(nextId += 1)}`,
    name: "image",
    original: null,
    file: null,
    preview: "",
    url: value,
    ratio: 1,
    phase: "done",
    removed: false,
    abort: new AbortController(),
    batch: null,
  });
}

function onPick(s, files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (uploadBusy()) {
    toast.error(POST_IMAGES_BUSY);
    return;
  }
  const motion = list.filter((file) => pickKind(file) === "motion");
  const stills = list.filter((file) => pickKind(file) === "still");
  if (motion.length) {
    if (list.length === 1 && !s.items.length) {
      uploadSingleMedia(s.cfg.field, motion[0]);
      return;
    }
    toast.error(POST_MEDIA_MIX);
    return;
  }
  if (stills.length < list.length) toast.error(BAD_TYPE);
  if (!stills.length) return;
  const tooBig = stills.filter((file) => file.size > POST_IMAGE_ORIGINAL_MAX);
  let fits = stills.filter((file) => file.size <= POST_IMAGE_ORIGINAL_MAX);
  if (tooBig.length) {
    toast.error(tooBig.length === 1
      ? `${shortName(tooBig[0].name)} is over 10 MB`
      : `${tooBig.length} images are over 10 MB`, { hold: true });
  }
  if (!fits.length) return;
  adoptSingle(s);
  const room = POST_IMAGE_MAX - s.items.length;
  if (room <= 0) {
    toast.error(POST_IMAGES_FULL);
    syncField(s);
    return;
  }
  if (fits.length > room) {
    toast.info(`Up to ${POST_IMAGE_MAX} images per post. Added ${room}.`);
    fits = fits.slice(0, room);
  }
  startBatch(s, fits);
}

// --- Draft cover for submit ------------------------------------------------

async function makeCover(s, anchor) {
  const first = s.items[0];
  if (!first || first.phase !== "done") return "";
  if (s.cover && s.cover.id === first.id) return s.cover.job;
  const job = (async () => {
    if (!first.file) return first.url;
    try {
      return await uploadPostCover(first.file, s.kind, anchor || document.getElementById(s.cfg.card));
    } catch (err) {
      // The post still gets a cover: the picture itself, at full size.
      console.warn("Cover upload failed; the first image stands in", err);
      return first.url;
    }
  })();
  s.cover = { id: first.id, job };
  const url = await job;
  if (url === first.url && s.cover && s.cover.id === first.id) s.cover = null;
  return url;
}

// --- Wiring ----------------------------------------------------------------

function mount(kind, cfg) {
  const field = document.getElementById(cfg.field);
  const picker = document.getElementById(cfg.picker);
  const card = document.getElementById(cfg.card);
  if (!field || !picker || !card) return;
  const s = {
    kind,
    cfg,
    items: [],
    tiles: new Map(),
    batch: null,
    cover: null,
    ownWrite: false,
    list: null,
    count: null,
    add: null,
  };
  picker.multiple = true;
  picker.addEventListener("change", () => {
    const files = picker.files ? Array.from(picker.files) : [];
    picker.value = "";
    onPick(s, files);
  });
  // Something else emptied the Image field (the slot was cleared): the
  // pictures go with it.
  field.addEventListener("input", () => {
    if (s.ownWrite) return;
    if (!field.value.trim() && s.items.length) clearAll(s);
  });
  // A tap on the media card adds pictures. Full or busy, it says why
  // instead of opening a picker that cannot take more. The card's own
  // listener (drawpreview.js) is below this one.
  const host = card.parentElement || card;
  const guard = (event) => {
    if (!s.items.length || !card.contains(event.target)) return;
    if (event.target.closest(".post-more-badge, .draw-popup-clear, .video-thumb-bar")) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const why = uploadBusy() ? POST_IMAGES_BUSY : s.items.length >= POST_IMAGE_MAX ? POST_IMAGES_FULL : "";
    if (!why) return;
    event.preventDefault();
    event.stopPropagation();
    toast.error(why);
  };
  host.addEventListener("click", guard, true);
  host.addEventListener("keydown", guard, true);
  registerPostDraft(kind, {
    count: () => s.items.length,
    pending: () => s.items.filter((item) => item.phase !== "done").length,
    images: () => s.items.filter((item) => item.phase === "done").map((item) => item.url),
    cover: (anchor) => makeCover(s, anchor),
  });
}

for (const [kind, cfg] of Object.entries(FORMS)) mount(kind, cfg);
