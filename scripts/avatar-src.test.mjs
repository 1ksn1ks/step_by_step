// avatarSrc (avatarsrc.js): every profile picture is drawn from our small
// thumbnail, one per picture whatever link names it; a thumbnail that fails
// falls back to the original, then to the default avatar (loopmedia.js);
// post media, covers and full-screen views never use it; an avatar upload
// is shrunk first (uploadmedia.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { AVATAR_PATH, AVATAR_VERSION, avatarOriginal, avatarSource, avatarSrc, isAvatarThumb } from "../avatarsrc.js";
import { isGifUrl, needsGifCheck, resolveMediaUrl } from "../mediaurl.js";

globalThis.location = { origin: "https://app.test" };

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function readFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  let started = false;
  for (let end = start; end < source.length; end++) {
    const ch = source[end];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, end + 1);
    }
  }
  throw new Error(`no end for ${name}`);
}

const thumbOf = (source) => `https://app.test${AVATAR_PATH}?src=${encodeURIComponent(source)}&v=${AVATAR_VERSION}`;
const TOPIC = "0.0.4840719";
const CID = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

test("one thumbnail per picture, whatever link names it", () => {
  for (const link of [`hcs://1/${TOPIC}`, `https://kiloscribe.com/api/inscription-cdn/${TOPIC}`, `https://app.test/api/hcs1/${TOPIC}`, `/api/hcs1/${TOPIC}`]) {
    assert.equal(avatarSource(link), `hcs://1/${TOPIC}`, link);
    assert.equal(avatarSrc(link), thumbOf(`hcs://1/${TOPIC}`), link);
  }
  for (const link of [`ipfs://${CID}/me.png`, `https://ipfs.io/ipfs/${CID}/me.png`, `https://gateway.pinata.cloud/ipfs/${CID}/me.png`]) {
    assert.equal(avatarSource(link), `ipfs://${CID}/me.png`, link);
  }
  const r2 = "https://pub-243bb90aeefc464884cd212612165e5b.r2.dev/avatars/1763390000000-a1b2c3.jpg";
  assert.equal(avatarSrc(r2), thumbOf(r2));
  assert.equal(avatarSrc("https://pbs.twimg.com/profile_images/1/a_400x400.jpg#face"), thumbOf("https://pbs.twimg.com/profile_images/1/a_400x400.jpg"));
});

test("links that are not made into thumbnails are left as they are", () => {
  for (const link of [
    "", "   ", "data:image/png;base64,AAAA", "blob:https://app.test/5f0c", "https://cdn.example/loop.mp4",
    "https://pub-1.r2.dev/avatars/1-a.webm", "https://app.test/hashinal-placeholder.png", "/hashinal-placeholder.png",
    "javascript:alert(1)", "ftp://cdn.example/a.png", "https://user:pass@cdn.example/a.png", `https://cdn.example/${"a".repeat(2100)}.png`,
  ]) {
    assert.equal(avatarSrc(link), link, link);
  }
  assert.equal(avatarSrc(undefined), undefined);
  assert.equal(avatarSrc(null), null);
});

test("a thumbnail address reads as a still, and calling avatarSrc twice changes nothing", () => {
  for (const link of ["https://cdn.example/dance.gif", "https://cdn.example/a.png?size=big", `hcs://1/${TOPIC}`, `ipfs://${CID}/x.gif`]) {
    const thumb = avatarSrc(link);
    assert.equal(isAvatarThumb(thumb), true, link);
    assert.equal(avatarSrc(thumb), thumb, "twice");
    // mediaurl.js paints it at once: no GIF check, no skeleton, not a video.
    assert.equal(needsGifCheck(thumb), false, link);
    assert.equal(isGifUrl(thumb), false, link);
    assert.deepEqual(resolveMediaUrl(thumb), { kind: "image", src: thumb, poster: "" });
    assert.match(thumb, /\/api\/avatar\.webp\?src=[^&]+&v=\d+$/);
  }
});

test("a failed thumbnail falls back to the link it was drawn for", () => {
  const stored = `https://app.test/api/hcs1/${TOPIC}`;
  assert.equal(avatarOriginal(avatarSrc(stored)), stored);
  const twitter = "https://pbs.twimg.com/profile_images/2/b.jpg";
  assert.equal(avatarOriginal(avatarSrc(twitter)), twitter);
  // A thumbnail this page never made reads its source as a link to load.
  assert.equal(avatarOriginal(thumbOf("hcs://1/0.0.999")), "https://app.test/api/hcs1/0.0.999");
  assert.equal(avatarOriginal(thumbOf(`ipfs://${CID}/a.png`)), `ipfs://${CID}/a.png`);
  assert.equal(avatarOriginal("https://cdn.example/a.png"), "");
});

// The chain itself (thumbnail -> original -> default avatar, each failure
// remembered, one load per thumbnail) runs in avatar-failures.test.mjs.
test("every profile picture draw is watched before it is painted, ahead of the element's own handlers", () => {
  const loop = read("../loopmedia.js");
  const present = readFn(loop, "presentImage");
  assert.match(present, /const avatar = asked \? avatarDraw\(asked\) : null;/);
  assert.match(present, /if \(avatar\) armAvatarFallback\(img\);\s*if \(avatar && avatar\.dead\)/);
  assert.match(readFn(loop, "armAvatarFallback"), /\}, true\);\s*\}$/);
});

// Every place a profile picture is drawn goes through avatarSrc.
const AVATAR_SITES = [
  ["../processallmessages.js", /const profileImg = pictureElement\(avatarSrc\(profileUrl\), \{/, 1],
  // Every comment and reply row, and your picture in the composer
  // (commentFace).
  ["../processallmessages.js", /pictureElement\(avatarSrc\(validPayerImage\), \{/, 1],
  ["../processallmessages.js", /imageUrl: coverImageUrl\(parsedMessage\.marker\.data\.coverimage, avatarSrc\(profileUrl\)\)/g, 3],
  ["../processallmessages.js", /imageUrl: isValidUrl\(cover\) \? cover : avatarSrc\(profileUrl\),/, 1],
  ["../feedlayout.js", /pictureElement\(avatarSrc\(url\), \{ className: 'feed-new-face'/, 1],
  ["../feedlayout.js", /mountPicture\(profileBanner\.querySelector\('\.feed-profile-banner-pic'\), avatarSrc\(profilePicUrl\(payer\)\)/, 1],
  ["../feedlayout.js", /const img = pictureElement\(avatarSrc\(profilePicUrl\(payer\)\), \{/, 1],
  ["../feedlayout.js", /mapAvatar = pictureElement\(avatarSrc\(DEFAULT_PIC\)/, 1],
  ["../feedlayout.js", /mapAvatar = mountPicture\(mapAvatar, avatarSrc\(id \? profilePicUrl\(id\) : DEFAULT_PIC\)/, 1],
  ["../topicchat.js", /pictureElement\(avatarSrc\(validPayerImage\), \{/g, 2],
  ["../encryptedtopicchat.js", /pictureElement\(avatarSrc\(validPayerImage\), \{ alt: 'Profile photo' \}\)/g, 2],
  ["../followsuggest.js", /pictureElement\(avatarSrc\(item\.avatar\), \{/, 1],
  ["../picker.js", /pictureElement\(avatarSrc\(item\.avatar \|\| DEFAULT_AVATAR\), \{/, 1],
  ["../loadBio4PIC.js", /pictureElement\(avatarSrc\(validUrl\(rawPic\) \? rawPic : DEFAULT_PIC\), \{/, 1],
  ["../donations.js", /pictureElement\(avatarSrc\(DEFAULT_AVATAR\), \{/, 1],
  ["../donations.js", /mountPicture\(avatar, avatarSrc\(recipientAvatar\(account\)\), \{/, 1],
  ["../swapsheet.js", /const picture = avatarSrc\(profilePicUrl\(author\)\);/, 1],
  ["../swapsheet.js", /mountPicture\(pic, avatarSrc\(profilePicUrl\(author\)\), \{/, 1],
  ["../profilepreview.js", /return mountPicture\(el, avatarSrc\(url\), \{ className: el\.className, fallback: DEFAULT_PIC \}\);/, 1],
  ["../markerstack.js", /\|\| avatarSrc\(record\.profileUrl \|\| ''\);/, 1],
  // The files this phone keeps: the thumbnail address even while it fails
  // (avatar-failures.test.mjs).
  ["../picturecache.js", /urls\.push\(avatarThumbSrc\(row\.profilePic\)\)/, 1],
  ["../picturecache.js", /urls\.push\(avatarThumbSrc\(patch\.profilePic\)\)/, 1],
  ["../picturecache.js", /const list = \[DEFAULT_PROFILE_PIC, avatarThumbSrc\(DEFAULT_PROFILE_PIC\)\];/, 1],
];

test("every place a profile picture is drawn uses avatarSrc", () => {
  for (const [file, pattern, count] of AVATAR_SITES) {
    const found = (read(file).match(pattern.global ? pattern : new RegExp(pattern.source, "g")) || []).length;
    assert.equal(found, count, `${file} ${pattern}`);
  }
  // No profile picture call left without it: each pictureElement (its
  // first argument) or mountPicture (its second) that names a profile
  // picture is wrapped.
  const names = "(profileUrl|profilePicUrl|validPayerImage|payerImage|picUrl|rawPic|item\\.avatar|recipientAvatar|DEFAULT_PIC|DEFAULT_AVATAR|defaultProfilePic)";
  const unwrapped = [
    new RegExp(`pictureElement\\((?!avatarSrc\\()[^)]*\\b${names}\\b`),
    new RegExp(`mountPicture\\([^,]*,\\s*(?!\\s|avatarSrc\\()[^)]*\\b${names}\\b`),
  ];
  for (const file of ["../processallmessages.js", "../feedlayout.js", "../topicchat.js", "../encryptedtopicchat.js",
    "../followsuggest.js", "../picker.js", "../loadBio4PIC.js", "../donations.js", "../swapsheet.js", "../profilepreview.js"]) {
    const lines = read(file).split(/\r?\n/).filter((line) => unwrapped.some((pattern) => pattern.test(line)));
    assert.deepEqual(lines, [], file);
  }
});

test("post media, covers and full-screen views keep their own paths", () => {
  for (const file of ["../chatimage.js", "../polygons.js", "../fullscreenmedia.js", "../mediagrid.js", "../postimages.js", "../postgallery.js", "../mediaframe.js"]) {
    assert.doesNotMatch(read(file), /avatarSrc/, file);
  }
  const pam = read("../processallmessages.js");
  // A polygon's 512 fill keeps the author's full picture.
  assert.equal((pam.match(/imageUrl: coverImageUrl\(parsedMessage\.polygon\.data\.coverimage, profileUrl\)/g) || []).length, 3);
  assert.doesNotMatch(readFn(pam, "postMediaUrl"), /avatarSrc/);
  assert.doesNotMatch(readFn(read("../feedlayout.js"), "mediaOf"), /avatarSrc/);
});

test("an avatar upload is shrunk to 512, a GIF to its first frame, a transparent PNG never loses its transparency", async () => {
  const upload = read("../uploadmedia.js");
  assert.match(upload, /const AVATAR_SHRINK_TYPES = new Set\(\["image\/jpeg", "image\/png", "image\/webp", "image\/gif"\]\);/);
  assert.match(upload, /const AVATAR_MAX_EDGE = 512;/);
  assert.match(readFn(upload, "handleFile"), /if \(targetFieldId === AVATAR_FIELD_ID && AVATAR_SHRINK_TYPES\.has\(file\.type\)\) \{\s*file = await shrinkAvatarImage\(file\);/);
  assert.match(upload, /const AVATAR_FIELD_ID = "input-field-profile-picture";/);

  const calls = [];
  const make = (answer) => new Function(
    "compressPostImage", "AVATAR_MAX_EDGE",
    `async ${readFn(upload, "shrinkAvatarImage")}\nreturn shrinkAvatarImage;`,
  )(async (file, options) => {
    calls.push(options.maxEdge);
    if (answer instanceof Error) throw answer;
    return answer;
  }, 512);
  const file = (type, size) => ({ type, size, name: "me" });
  const webp = file("image/webp", 30_000);
  const jpeg = file("image/jpeg", 30_000);

  const photo = file("image/jpeg", 2_400_000);
  assert.equal(await make(webp)(photo), webp);
  const gif = file("image/gif", 400_000);
  assert.equal(await make(webp)(gif), webp, "a GIF becomes its first frame");
  const larger = file("image/webp", 900_000);
  assert.equal(await make(larger)(gif), larger, "a GIF is a still even when the still is larger");
  const png = file("image/png", 500_000);
  assert.equal(await make(jpeg)(png), png, "only JPEG can be written here: the PNG keeps its transparency");
  assert.equal(await make(webp)(png), webp);
  const tiny = file("image/jpeg", 20_000);
  assert.equal(await make(file("image/webp", 25_000))(tiny), tiny, "no bigger copy");
  assert.equal(await make(new Error("decode"))(photo), photo, "a file that cannot be decoded goes up as it is");
  assert.ok(calls.every((edge) => edge === 512));
});
