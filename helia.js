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
import { delegatedPeerRouting } from '@libp2p/delegated-peer-routing'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'

export let helia = null
export let fs = null

async function initHelia() {
  try {
    const bootstrapList = [
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
      '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
      '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
    ];

    const delegatedRouter = delegatedPeerRouting({
      url: 'https://delegated-ipfs.dev/routing/v1/providers'
    });

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
          clientMode: true,
          kBucketSize: 20,
          routers: [delegatedRouter]
        })
      },
      connectionManager: {
        minConnections: 5,
        maxConnections: 100
      }
    });

    helia = await createHelia({ libp2p });
    fs = unixfs(helia);

    if (!helia.libp2p.services.dht.isStarted()) {
      await helia.libp2p.services.dht.start();
    }

    console.log('Helia Peer ID:', libp2p.peerId.toString());

    setInterval(() => {
      const peers = libp2p.getPeers();
      console.groupCollapsed('Number of connected peers:', peers.length);
      console.log('Peers:', peers);
      console.groupEnd();
      console.log('DHT routing table size:', libp2p.services.dht.routingTable?.size || 'N/A');
    }, 5000);

  } catch (error) {
    console.error('Helia init failed:', error);
    document.getElementById('cid-output').textContent = `Init failed: ${error.message}`;
  }
}

initHelia();