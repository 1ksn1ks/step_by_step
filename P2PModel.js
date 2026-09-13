import {map} from './map';
import { models } from './letall';
import { generateModels } from './loadP2PModels';
import { toast } from './toast'

function requestPeerList() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'request_peer_list', peer_id: peerId }));
    }
}

let ws = null;
let peerId = null;
let knownPeers = new Map();
let dataChannels = new Map();
let receivedCoords = new Map();
let retryAttempts = new Map();
const maxRetries = 3;
let seenMessages = new Set();
let coordinates = null;
let heartbeatInterval = null;
let gossipInterval = null;
let peerListRequestInterval = null; // Interval for requesting peer list

const response = 
    await fetch("https://topicontopic.metered.live/api/v1/turn/credentials?apiKey=39dd49a26425c2cfbb2c3e92af8edcee930f");
    // Saving the response in the iceServers array
    const iceServers = await response.json();

export async function someFunction(accountId, topicId) {
    // Clean up any existing connections
    await cleanup();

    peerId = topicId + '-' + accountId;

    connectToBootstrapServer();
    generateModels();

    function generateMessageId() {
        return Math.random().toString(36).substr(2, 9) + '-' + Date.now();
    }

    function updateCoordinates() {
      let longitude = map.getCenter().lng; // Get current longitude from the map
      let latitude = map.getCenter().lat;   // Get current latitude from the map
      const zoomLevel = map.getZoom(); // Get the current zoom level
      let height;

      if (zoomLevel >= 10 && zoomLevel <= 19) {
          height = 50000;
      } else if (zoomLevel <= 9) {
          height = 50000 + (200000 * (10 - zoomLevel)); // Scale from 50000 at zoom 10 to 250000 at zoom 9
      } else if (zoomLevel <= 7) {
          height = 250000 + (450000 * (7 - zoomLevel)); // Scale down from 500000 to 5000000
      } else if (zoomLevel <= 3.5) {
          height = 5000000 + (65000000 * (3.5 - zoomLevel)); // Scale down from 5000000 to 70000000
      } else {
          height = 70000000; // Set height for zoom level 0
      }

        const xInput = longitude; // Set x from current longitude
        const yInput = latitude;  // Set y from current latitude
        const zInput = height;

        const x = parseFloat(xInput);
        const y = parseFloat(yInput);
        const z = parseFloat(zInput);

        // Validate input
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            console.error('Invalid coordinates: X, Y, Z must be numbers');
            toast.error('Please enter valid numbers for X, Y, Z');
            return;
        }

        coordinates = { x, y, z };
    }
        // Add this code to set up the interval for updating coordinates
        setInterval(() => {
        updateCoordinates(); // Call the function to update coordinates
    }, 5000); // 500 milliseconds interval



    function startHeartbeat() {
        setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'heartbeat', peer_id: peerId }));
            }
        }, 10000); // Send every 10 seconds
    }


    let globalPeers = [];

    function cleanUpModels() {

        for (let i = models.length - 1; i >= 0; i--) {
            if (!globalPeers.includes(models[i].peer_id)) {
                models.splice(i, 1);
            }
        }
    }


    function connectToBootstrapServer() {
        ws = new WebSocket('allinhbar.com');
        ws.onopen = () => {
            console.log('Connected to bootstrap server');
            ws.send(JSON.stringify({ action: 'register', peer_id: peerId }));
            startHeartbeat(); // Start sending heartbeats
        };

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);
            if (message.action === 'peer_list') {
                const peers = message.peers;
                globalPeers = peers; // Store the peers in the global array
                await setupWebRTCConnections(peers);
                startGossip();
            } else if (message.action === 'offer') {
                await handleOffer(message.peer_id, message.data);
            } else if (message.action === 'answer') {
                await handleAnswer(message.peer_id, message.data);
            } else if (message.action === 'candidate') {
                await handleCandidate(message.peer_id, message.data);
            }
        };
    }

    // Add peer list request interval (every 300 seconds)
    peerListRequestInterval = setInterval(() => {
        requestPeerList();
        cleanUpModels();
    }, 300000); // Request every 300 seconds

    async function setupWebRTCConnections(peerIds) {
    console.log('Setting up WebRTC connections');

        for (let remotePeerId of peerIds) {
            if (remotePeerId === peerId || knownPeers.has(remotePeerId)) continue;

            const pc = new RTCPeerConnection({ iceServers });
            knownPeers.set(remotePeerId, pc);
            monitorWebRTCConnection(remotePeerId, pc);

            const dc = pc.createDataChannel('gossip');
            dataChannels.set(remotePeerId, dc);
            dc.onopen = () => {
                setTimeout(() => sendGossipMessage(remotePeerId), 1000);
            };
            dc.onmessage = (event) => handleGossipMessage(remotePeerId, event.data);
            dc.onclose = () => {
                console.log(`Data channel closed with ${remotePeerId}`);
                dataChannels.delete(remotePeerId);
            };

            pc.ondatachannel = (event) => {
                const incomingDc = event.channel;
                dataChannels.set(remotePeerId, incomingDc);
                incomingDc.onmessage = (event) => handleGossipMessage(remotePeerId, event.data);
                incomingDc.onclose = () => {
                    dataChannels.delete(remotePeerId);
                };
            };

            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    ws.send(JSON.stringify({
                        action: 'candidate',
                        peer_id: peerId,
                        target_peer_id: remotePeerId,
                        data: event.candidate
                    }));
                }
            };

            try {
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                ws.send(JSON.stringify({
                    action: 'offer',
                    peer_id: peerId,
                    target_peer_id: remotePeerId,
                    data: pc.localDescription
                }));
            } catch (error) {
                console.error(`Failed to create offer for ${remotePeerId}:`, error);
            }
        }
    }

    function sendGossipMessage(peerId) {
        const dc = dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
            const message = { /* your message data */ };
            dc.send(JSON.stringify(message));
        } else {
            console.log(`Cannot send to ${peerId}: Data channel not open`);
        }
    }

    // Store pending ICE candidates
    const pendingCandidates = new Map();

    async function handleOffer(senderPeerId, offer) {
        if (knownPeers.has(senderPeerId)) return;

        const pc = new RTCPeerConnection({ iceServers });
        knownPeers.set(senderPeerId, pc);
        monitorWebRTCConnection(senderPeerId, pc);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({
                    action: 'candidate',
                    peer_id: peerId,
                    target_peer_id: senderPeerId,
                    data: event.candidate
                }));
            }
        };

        pc.ondatachannel = (event) => {
            const dc = event.channel;
            dataChannels.set(senderPeerId, dc);
            dc.onmessage = (event) => handleGossipMessage(senderPeerId, event.data);
            dc.onclose = () => {
                dataChannels.delete(senderPeerId);
            };
        };

        try {
                await pc.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                ws.send(JSON.stringify({
                    action: 'answer',
                    peer_id: peerId,
                    target_peer_id: senderPeerId,
                    data: pc.localDescription
                }));

                // Process any queued ICE candidates
                if (pendingCandidates.has(senderPeerId)) {
                    const candidates = pendingCandidates.get(senderPeerId);
                    candidates.forEach(candidate => pc.addIceCandidate(candidate));
                    pendingCandidates.delete(peerId);
                }
            } catch (error) {
                console.error(`Failed to handle offer from ${senderPeerId}:`, error);
            }
        }

        async function handleAnswer(senderPeerId, answer) {
            const pc = knownPeers.get(senderPeerId);
            if (!pc) return;

            try {
                await pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error(`Failed to handle answer from ${senderPeerId}:`, error);
            }
     }


    async function handleCandidate(peerId, candidate) {
        const pc = knownPeers.get(peerId);
        if (!pc) return;

        try {
            if (pc.remoteDescription && pc.remoteDescription.type) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                // Queue the candidate if the remote description is not set
                if (!pendingCandidates.has(peerId)) {
                    pendingCandidates.set(peerId, []);
                }
                pendingCandidates.get(peerId).push(candidate);
            }
        } catch (error) {
            console.error(`Failed to handle candidate from ${peerId}:`, error);
        }
    }

    function monitorWebRTCConnection(peerId, pc) {
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'connected') {
            } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                retryWebRTCConnection(peerId);
            }
        };
    }

    function retryWebRTCConnection(peerId) {
        const attempts = retryAttempts.get(peerId) || 0;
        if (attempts >= maxRetries) {
            knownPeers.delete(peerId);
            dataChannels.delete(peerId);
            retryAttempts.delete(peerId);
            return;
        }

        retryAttempts.set(peerId, attempts + 1);
        knownPeers.delete(peerId);
        dataChannels.delete(peerId);
        setupWebRTCConnections([peerId]);
    }

    async function handleGossipMessage(senderPeerId, data) {
        const message = JSON.parse(data);
        const { peer_id, coordinates, ttl, timestamp, messageId, metadata, scaleFactorNFT } = message;

        // Check for duplicates
        if (seenMessages.has(messageId)) {
            return;
        }
        seenMessages.add(messageId);


        const existing = receivedCoords.get(peer_id);
        if (!existing || new Date(timestamp) > new Date(existing.timestamp)) {
            receivedCoords.set(peer_id, { ...coordinates, timestamp });
        }

          // Load URL using the peer ID
  const url = await loadProfileObjectUrl(peer_id);

    // Check if a model from this peer_id already exists
    const modelIndex = models.findIndex(model => model.peer_id === peer_id);

    if (modelIndex !== -1) {
        // Update the existing model
        models[modelIndex] = {
            peer_id: peer_id,
            url: url || 'https://kiloscribe.com/api/inscription-cdn/0.0.9742046',
            origin: [coordinates.x, coordinates.y],
            altitude: coordinates.z,
            scaleFactorNFT: scaleFactorNFT
        };
    } else {
        // Append new message to models array
        models.push({
            peer_id: peer_id,
            url: url || 'https://kiloscribe.com/api/inscription-cdn/0.0.9742046',
            origin: [coordinates.x, coordinates.y],
            altitude: coordinates.z,
            scaleFactorNFT: scaleFactorNFT
        });
    }
        if (ttl > 0) {
            message.ttl -= 1;
            message.metadata.hopCount += 1; // Increment hop count
            forwardGossipMessage(message);
        }
    }

    function startGossip() {
        setTimeout(() => {
            setInterval(() => {
                if (knownPeers.size === 0) {
                    return;
                }
                const message = {
                    peer_id: peerId,
                    coordinates: coordinates,
                    scaleFactorNFT: finalScaleForModel,
                    ttl: 3,
                    timestamp: new Date().toISOString(),
                    messageId: generateMessageId(),
                    metadata: {
                        hopCount: 0,
                        lastUpdated: new Date().toISOString()
                    }
                };
                const fanout = Math.max(1, Math.floor(Math.sqrt(knownPeers.size))); // Dynamic fanout
                const targetPeers = Array.from(knownPeers.entries())
                    .sort(() => Math.random() - 0.5)
                    .slice(0, fanout);
                for (let [peerId, pc] of targetPeers) {
                    const dc = dataChannels.get(peerId);
                    if (dc && dc.readyState === 'open') {
                        dc.send(JSON.stringify(message));
                    } else {
                        retryWebRTCConnection(peerId);
                    }
                }
            }, 1000);
        }, 5000);
    }

    function forwardGossipMessage(message) {
        const fanout = Math.max(1, Math.floor(Math.sqrt(knownPeers.size))); // Dynamic fanout
        const targetPeers = Array.from(knownPeers.entries())
            .sort(() => Math.random() - 0.5)
            .slice(0, fanout);
        for (let [peerId, pc] of targetPeers) {
            const dc = dataChannels.get(peerId);
            if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify(message));
            } else {
                console.log(`Cannot forward to ${peerId}: Data channel not open`);
            }
        }
    }

    function loadProfileObjectUrl(payerId) {

    const payerParts = payerId.split('-');
    if (payerParts.length < 2) {
        console.warn("payerId format invalid (expected 'prefix-id'):", payerId);
        return null;
    }

    const cleanPayerId = payerParts[1]; // e.g., "abc123"

    // Step 2: Search accountUrlArray using cleanPayerId
    const messages = accountUrlArray.filter(message => message.payer === cleanPayerId);

    if (!messages || messages.length === 0) {
        console.log("No messages sent by user:", cleanPayerId);
        return null;
    }

    // Step 3: Find the FIRST message with a valid URL
    const firstValidMessage = messages.find(message => 
        message.data.urls &&
        Array.isArray(message.data.urls) &&
        message.data.urls.length > 0
    );

    if (!firstValidMessage) {
        console.log("No valid URL in any message from payer:", cleanPayerId);
        return null;
    }

    // Step 4: Return the first URL from the first valid message
    return firstValidMessage.data.urls[0];
    }
}

async function cleanup() {
        console.log('[Client] Cleaning up connections and state');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
            console.log('[Client] Closed WebSocket connection');
        }
        ws = null;
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
            console.log('[Client] Cleared heartbeat interval');
        }
        if (gossipInterval) {
            clearInterval(gossipInterval);
            gossipInterval = null;
            console.log('[Client] Cleared gossip interval');
        }
        if (peerListRequestInterval) {
            clearInterval(peerListRequestInterval);
            peerListRequestInterval = null;
            console.log('[Client] Cleared peer list request interval');
        }
        for (const [peerId, pc] of knownPeers.entries()) {
            pc.close();
            const dc = dataChannels.get(peerId);
            if (dc) {
                dc.close();
            }
            console.log(`[Client] Closed WebRTC connection with ${peerId}`);
        }
        knownPeers.clear();
        dataChannels.clear();
        receivedCoords.clear();
        retryAttempts.clear();
        seenMessages.clear();
        peerId = null;
        coordinates = null;
        models.length = 0;
        console.log('[Client] Cleared all state');
    }