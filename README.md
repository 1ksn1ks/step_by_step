# 🌍 Hedera Globe

A fully decentralized, open-source social platform on the Hedera network — with a 3D globe where people write data on-chain and everyone else can read it back.

Users, markers, and polygons live on an interactive globe, with public and end-to-end encrypted topic chat, on-chain profiles and settings, and a lightweight backend that keeps phones off the Hedera mirror node.

**Live:** [onlyonhbar.com](https://onlyonhbar.com)

---

## ✨ Features

- **🌐 3D globe** — MapLibre GL JS in globe projection with day/night shading. Users render as 3D models (THREE.js, instanced) that scale with zoom, shared peer-to-peer so others can see your model.
- **🪪 On-chain identity** — username, profile picture, bio, and linked URLs live as messages on Hedera topics. Topic IDs can be tied to profile pictures. Every UI setting (crosshair, marker size, colors, fonts, popup style) is stored the same way. No server-side user database.
- **📍 Geospatial posts** — markers and polygons on the globe, with profile-picture avatars, clustering (supercluster), low-quality image preloading, and coordinate tools (search, geolocate, copy coordinates).
- **💬 Topic chat** — public chat per topic, plus group chat and an E2EE variant (sodium-native, ED25519 keys, pin/password modes, admin-pinned public key).
- **🛡️ Community rules** — create a topic, set its rules, and let admins decide which messages show by default. Load topic data, filter by date or user, and block messages you do not want to see.
- **🏷️ Domains** — buy and renew domains bound to topics (28-day windows, with lapse/takeover rules), resolvable in chat and the UI.
- **⚡ Instant fan-out** — a send appears to every viewer the moment the wallet confirms (pending state), then gets confirmed by the mirror node a few seconds later.
- **📱 Mobile-first** — built to run on phones, with the heavy mirror reads pushed to an optional cache backend.

---

## 🏗️ Architecture

```
phone app (Vite, ES modules)
        │  reads: topicdata.js (60s cache → backend → mirror fallback)
        │  sends: wallet → Hedera → backend /api/submit (pending)
        ▼
backend (Express + SQLite)          ← disposable cache, not source of truth
        │  poller: one sync loop for all tracked topics
        │  adaptive polling: 3s active → 60s quiet, 429-aware mirror spacing
        ▼
Hedera mirror node                  ← source of truth
```

- The backend tracks the handful of topics people are actually viewing, mirrors their messages into SQLite, and serves them locally. Deleting the database re-backfills everything from the mirror.
- Each wallet-confirmed send is reported to the backend as **pending** (visible instantly, flagged in the UI). When the mirror poller sees the same message on-chain, it is **confirmed** with the canonical sequence number, consensus timestamp, and payer. Unconfirmed pendings expire after 10 minutes.
- The backend is optional: with it offline, the app falls back to talking to the mirror directly, exactly as before.

---

## 🧰 Tech stack

| Layer | Stack |
| --- | --- |
| **App** | Vite, vanilla ES-module JavaScript, plain CSS, MapLibre GL JS, THREE.js, `@hashgraph/sdk`, sodium-native |
| **Wallet** | [hashinal-wc](https://github.com/hashgraph-online/hashinal-wc) — `script.js` by [kantorcodes](https://github.com/kantorcodes), a simple HTML wallet-connect hook |
| **Backend** | Node.js, Express, better-sqlite3 (WAL mode, single file) |

---

## 🚀 Getting started

### App

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

### Backend

```bash
cd server
npm install
npm start   # listens on :8787
```

Point the app at the backend in `msgbackend.js` (`BACKEND_URL`) if it is not on the same host.

---

## 📁 Project structure

```
index.html              app shell
main.js                 bootstrap
map.js                  MapLibre globe setup
loadP2PModels.js        3D user models + day/night layer
topicchat.js            public topic chat
encryptedtopicchat.js   E2EE topic chat
topicdata.js            single data layer (cache → backend → mirror)
msgbackend.js           bridge to the backend (send + live tail)
hedera.js               mirror + on-chain transactions
web3.js                 wallet connection
server/index.js         backend: poller, pending/confirm, API
```

---

## 🔭 Where this can go

The globe is already a place to pin data to real coordinates and drop 3D models on real locations. Longer term that is a shared, game-like layer over the actual world — economic interactions included, with funds tracked on Hedera instead of a private ledger.

Institutions can treat topic IDs as NFT-style credentials: filter who may post, run votes, and keep the record public.

A truth / false rating on messages (closer to a public agree / disagree than a like) is planned, not shipped.

---

## 📦 IPFS — planned, not shipped

Decentralized file sharing (images, video, files) over IPFS is the next storage layer, and it is still under development. The intended shape:

- Users pin content locally; others can replicate those pins, so popular files spread without a central host.
- An Android phone can run as a personal always-on node.
- Node operators set a price per GB. Users pick which nodes hold their pins.
- An automated check confirms the pin is actually being served before payment.
- Operators get a public uptime rating, so reliable nodes earn the work.

None of that is live in the app yet. Hedera remains the source of truth for messages, profiles, and settings.

---

## 📝 Notes

- The mirror node is the source of truth; the SQLite database is a disposable cache.
- The poller paces itself globally (~10 mirror requests/s baseline) and backs off automatically on rate limits; quiet topics drop to one request per minute.
- Wallet connect comes from [hashinal-wc](https://github.com/hashgraph-online/hashinal-wc). Open-source work from that group lives at [hashgraphonline.com](https://hashgraphonline.com/).

Thanks to Kantor, Patches, and everyone else pushing this kind of tooling forward.

---

## 💡 Side note — Pi Network

Worth exploring, not part of the product: Pi has several million registered users. A path that has been floated is a Pi token issued on Hedera, a mainnet move onto that network, and a “Validation NFT” for each verified Pi member so bots can be filtered out of topics and votes. That is a proposal, not a commitment or an integration.
