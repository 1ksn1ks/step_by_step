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
  try {
    const exists = await datastore.has({ key: PEER_KEY_NAME })
    if (exists) {
      const marshaled = await datastore.get({ key: PEER_KEY_NAME })
      // marshaled is Uint8Array → load PeerId from protobuf
      return await createFromProtobuf(marshaled.value)
    }
  } catch (err) {
    console.warn('Failed to load saved PeerId, generating new one', err)
  }

  // Generate new Ed25519 peer-id (modern & efficient)
  const peerId = await createEd25519PeerId()

  // Export to protobuf (libp2p format) and save
  const marshaled = exportToProtobuf(peerId)
  await datastore.put({ key: PEER_KEY_NAME, value: marshaled })

  console.log('Generated and saved new persistent Peer ID')
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