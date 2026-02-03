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

export let helia = null
export let fs = null
export let orbitdb = null
export let sharedDb = null 

async function initHelia() {
  try {
    const blockstore = new IDBBlockstore('helia-blocks')
    await blockstore.open()

    const bootstrapList = [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
      // Add your own VPS bootstrap/relay if private: '/ip4/your-vps-ip/tcp/4001/p2p/your-peer-id'
    ];

    const libp2p = await createLibp2p({
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
          hop: { enabled: true }  // Enable relaying for others
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
          clientMode: false,  // Full DHT for peer/CID discovery
          kBucketSize: 20
        }),
        pubsub: gossipsub({ allowPublishToZeroPeers: true })  // Added: Essential for OrbitDB replication
      },
      connectionManager: {
        minConnections: 5,
        maxConnections: 100
      }
    });

    helia = await createHelia({ libp2p, blockstore });  // Pass blockstore if using persistence
    fs = unixfs(helia);

    if (!helia.libp2p.services.dht.isStarted()) {
      await helia.libp2p.services.dht.start();
    }

    orbitdb = await createOrbitDB({ ipfs: helia });

    sharedDb = await orbitdb.open('/my-app-shared-cids', { type: 'documents' });

    console.log('Helia Peer ID:', libp2p.peerId.toString());
    console.log('Shared DB Address:', sharedDb.address.toString());

    setInterval(() => {
      const peers = libp2p.getPeers();
      console.log('Connected peers:', peers.length);
      console.log('DHT routing table size:', helia.libp2p.services.dht.routingTable?.size || 'N/A');
    }, 5000);

  } catch (error) {
    console.error('Init failed:', error);
  }
}

initHelia();