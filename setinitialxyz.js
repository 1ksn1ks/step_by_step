import { sendMessage } from './hedera';
import { signer } from './web3';
import { toast } from './toast';
import { loadedDomains } from './loaddomains';
import { map } from './map.js';

document.getElementById("submit-button-Set_Initial_XYZ").addEventListener("click", async () => {
  try {
    if (!signer) {
      toast.error("Connect wallet first");
      return;
    }
    let userInput = document.getElementById("input-field-topic-id-for-initial-xyz").value.toLowerCase();
    let domainEntry = loadedDomains.find(entry => entry.domain === userInput);
    let topicId;

    if (domainEntry && domainEntry.lastMessage) {
      topicId = domainEntry.lastMessage.topic;
    } else {
      topicId = userInput;
    }
    if (!topicId) {
      toast.error("Please enter a Topic ID or domain.");
      return;
    }

    const coordsRaw = document.getElementById("input-field-lng-lat-for-initial-xyz").value.trim();
    const zoomRaw = document.getElementById("input-field-zoom-for-initial-xyz").value.trim();

    const parts = coordsRaw.split(',');
    if (parts.length !== 2) {
      toast.error("Coordinates must be lng,lat");
      return;
    }
    const lng = Number(parts[0].trim());
    const lat = Number(parts[1].trim());
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      toast.error("Invalid coordinates (lng -180..180, lat -90..90)");
      return;
    }
    const zoom = Number(zoomRaw);
    if (!Number.isFinite(zoom) || zoom < 0 || zoom > 19) {
      toast.error("Invalid zoom level (0..19)");
      return;
    }

    const messageobject = {
      setInitialXYZ: { lng, lat, zoom }
    };
    const message = JSON.stringify(messageobject);

    toast.info("Confirm in wallet 👛");
    const receipt = await sendMessage(topicId, message);
    console.log("Initial XYZ set:", receipt);
  } catch (error) {
    console.error("Error setting initial XYZ:", error);
  }
});

// Last setInitialXYZ message wins; if the topic has admins (memo entries
// starting with 0.0.), only admin messages count, otherwise any payer's
// message counts. Animates the globe to the stored lng/lat/zoom.
export function applyInitialXYZ(messages, topicAdmin) {
  let target = null;
  for (const message of messages || []) {
    try {
      const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message;
      if (!parsedMessage.setInitialXYZ) continue;
      if (topicAdmin.length > 0 && !topicAdmin.includes(message.payer)) continue;
      const { lng, lat, zoom } = parsedMessage.setInitialXYZ;
      if (!Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(zoom))) continue;
      target = { lng: Number(lng), lat: Number(lat), zoom: Number(zoom) };
    } catch (messageError) {
      console.error("Error parsing initial XYZ message:", messageError);
    }
  }
  if (target) {
    map.flyTo({ center: [target.lng, target.lat], zoom: target.zoom, essential: true });
  }
}
