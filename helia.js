import { createHelia } from 'helia'
import { unixfs } from '@helia/unixfs'
import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { webRTC } from '@libp2p/webrtc'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { bootstrap } from '@libp2p/bootstrap'
import { kadDHT } from '@libp2p/kad-dht'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { createOrbitDB } from '@orbitdb/core'
import { IDBBlockstore } from 'blockstore-idb'
import { IDBDatastore } from 'datastore-idb'

// For persistent peer identity
import { createEd25519PeerId, exportToProtobuf, createFromProtobuf } from '@libp2p/peer-id-factory'

export let helia = null
export let fs = null
export let orbitdb = null
export let sharedDb = null

const PEER_KEY_NAME = '/helia/peer-private-key'  // key in datastore

async function getOrCreatePersistentPeerId(datastore) {
  const key = PEER_KEY_NAME

  try {
    const has = await datastore.has({ key })
    console.log('[PeerID] Key exists in datastore?', has)

    if (has) {
      const res = await datastore.get({ key })

      console.log('[PeerID] Loadeaaaaaaaaaaangth:', res.value.length)

      if (!res?.value) {
        throw new Error('Stored value is empty')
      }
      console.log('[PeerID] Loaded marshaled key, length:', res.value.length)
      const peerId = await createFromProtobuf(res.value)
      console.log('[PeerID] Successfully restored PeerId:', peerId.toString())
      return peerId
    }
  } catch (err) {
    console.error('[PeerID] Failed to load/restore PeerId:', err.message || err)
  }

  console.log('[PeerID] Generating new Ed25519 PeerId...')
  const peerId = await createEd25519PeerId()

  try {
    const marshaled = exportToProtobuf(peerId)
    console.log('[PeerID] Marshaled new key, length:', marshaled.length)
    await datastore.put({ key, value: marshaled })
    console.log('[PeerID] Successfully saved new PeerId to datastore')
  } catch (saveErr) {
    console.error('[PeerID] Failed to SAVE new PeerId:', saveErr)
  }

  return peerId
}

async function initHelia() {
  try {
    const blockstore = new IDBBlockstore('helia-blocks')
    await blockstore.open()

    const datastore = new IDBDatastore('helia-data')
    await datastore.open()

    // Get persistent peer identity
    const peerId = await getOrCreatePersistentPeerId(datastore)

    const bootstrapList = [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
      // Add your own if needed
    ]

    const libp2p = await createLibp2p({
      peerId,  // ← This is the key change: reuse the same identity

      addresses: {
        listen: [
          '/webrtc',
          '/ws',
          '/wss',
          '/p2p-circuit'
        ]
      },
      transports: [
        webRTC({
          rtcConfiguration: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' }
            ]
          }
        }),
        webSockets(),
        circuitRelayTransport({
          discoverRelays: 10,
          reservationConcurrency: 5,
          hop: { enabled: true }
        })
      ],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({
          list: bootstrapList,
          interval: 2000,
          enabled: true
        })
      ],
      services: {
        identify: identify(),
        ping: ping(),
        dht: kadDHT({
          clientMode: false,
          kBucketSize: 20
        }),
        pubsub: gossipsub({ allowPublishToZeroPeers: true })
      },
      connectionManager: {
        minConnections: 5,
        maxConnections: 100
      }
    })

    helia = await createHelia({
      libp2p,
      blockstore,
      datastore   // pass it so Helia can use it too
    })

    fs = unixfs(helia)

    if (!helia.libp2p.services.dht.isStarted()) {
      await helia.libp2p.services.dht.start()
    }

    orbitdb = await createOrbitDB({ ipfs: helia })

    sharedDb = await orbitdb.open('/my-app-shared-cids', { type: 'documents' })

    console.log('Helia Peer ID (persistent):', libp2p.peerId.toString())
    console.log('Shared DB Address:', sharedDb.address.toString())

    // Optional: periodic status
    setInterval(() => {
      const peers = libp2p.getPeers()
      console.log('Connected peers:', peers.length)
      console.log('DHT routing table size:', helia.libp2p.services.dht.routingTable?.size || 'N/A')
    }, 5000)

  } catch (error) {
    console.error('Init failed:', error)
  }
}

initHelia()