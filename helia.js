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
import { Key } from 'interface-datastore/key'

// For persistent peer identity — these are the key imports
import { createEd25519PeerId, exportToProtobuf, createFromProtobuf } from '@libp2p/peer-id-factory'

export let helia = null
export let fs = null
export let orbitdb = null
export let sharedDb = null

const PEER_KEY_PATH = new Key('/helia/peer-id-proto')  // Use Key object for datastore ops

async function initHelia() {
  try {
    const blockstore = new IDBBlockstore('helia-blocks')
    await blockstore.open()
    console.log('[Init] Blockstore opened successfully')

    const datastore = new IDBDatastore('helia-data')
    await datastore.open()
    console.log('[Init] Datastore opened successfully')

    let peerId

    console.log('[PeerID] Checking if persistent key exists...')
    const exists = await datastore.has(PEER_KEY_PATH)
    console.log('[PeerID] Key exists in datastore?', exists)

    if (exists) {
      try {
        const res = await datastore.get(PEER_KEY_PATH)
        if (res?.value instanceof Uint8Array) {
          peerId = await createFromProtobuf(res.value)
          console.log('[PeerID] Successfully loaded persistent PeerId:', peerId.toString())
        } else {
          console.warn('[PeerID] Stored value invalid — will generate new')
        }
      } catch (err) {
        console.error('[PeerID] Failed to load PeerId:', err.message || err)
      }
    }

    if (!peerId) {
      console.log('[PeerID] Generating new Ed25519 PeerId...')
      peerId = await createEd25519PeerId()
      console.log('[PeerID] New PeerId:', peerId.toString())

      try {
        const marshaled = exportToProtobuf(peerId)
        console.log('[PeerID] Marshaled size:', marshaled.length, 'bytes')

        await datastore.put(PEER_KEY_PATH, marshaled)
        console.log('[PeerID] Successfully saved PeerId to datastore')

        // Quick verify
        const verify = await datastore.get(PEER_KEY_PATH)
        console.log('[PeerID] Save verified — exists?', !!verify?.value)
      } catch (saveErr) {
        console.error('[PeerID] Failed to save PeerId:', saveErr.message || saveErr)
      }
    }

    const bootstrapList = [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    ]

    const libp2p = await createLibp2p({
      peerId,  // ← This ensures reuse!
      datastore,

      addresses: {
        listen: ['/webrtc', '/ws', '/wss', '/p2p-circuit']
      },
      transports: [
        webRTC({ rtcConfiguration: { iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]}}),
        webSockets(),
        circuitRelayTransport({ discoverRelays: 10, reservationConcurrency: 5, hop: { enabled: true } })
      ],
      connectionEncryption: [noise()],
      streamMuxers: [yamux()],
      peerDiscovery: [
        bootstrap({ list: bootstrapList, interval: 2000, enabled: true })
      ],
      services: {
        identify: identify(),
        ping: ping(),
        dht: kadDHT({ clientMode: false, kBucketSize: 20 }),
        pubsub: gossipsub({ allowPublishToZeroPeers: true })
      },
      connectionManager: { minConnections: 5, maxConnections: 100 }
    })

    console.log('[Libp2p] Node created with PeerId:', libp2p.peerId.toString())

    helia = await createHelia({ libp2p, blockstore, datastore })
    console.log('[Helia] Created')

    fs = unixfs(helia)

    if (!helia.libp2p.services.dht.isStarted()) {
      await helia.libp2p.services.dht.start()
      console.log('[DHT] Started')
    }

    orbitdb = await createOrbitDB({ ipfs: helia })
    console.log('[OrbitDB] Initialized')

    sharedDb = await orbitdb.open('/my-app-shared-cids', { type: 'documents' })
    console.log('[SharedDB] Opened at:', sharedDb.address.toString())

    console.log('Helia Peer ID (persistent):', libp2p.peerId.toString())
    console.log('Shared DB Address:', sharedDb.address.toString())

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