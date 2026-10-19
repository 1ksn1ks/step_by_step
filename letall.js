export let models = [];
export let shadeMode = 'daynight'; // 'light' | 'dark' | 'daynight' — drives the 3D day/night shade
export function setShadeMode(m) { shadeMode = m; }

export let existingMarkers = [];
export function newExistingMarkers(a) {
  existingMarkers = a;
}

export let geojson = {
    type: "FeatureCollection",
    features: []
  };

export let polygons = [
];

export let currentUfoModel = null;
export function setCurrentUfoModel(newModel) {
  currentUfoModel = newModel;
}

export let currentUfoModelInGLTF = null;
export function setCurrentUfoModellInGLTF(newModel) {
  currentUfoModelInGLTF = newModel;
}

export let defaultModelUrl = 'https://kiloscribe.com/api/inscription-cdn/0.0.9742046'; // Replace with your actual default model URL


export let accidTopicChatColor = '#ffffff';
export let usernameTopicChatColor = '#ffffff';

// A saved copy of the previous shipped default is "not set".
const LEGACY_ACCID_COLOR = '#800080';
const LEGACY_USERNAME_COLOR = '#ff9933';

function droppedLegacyColor(value, legacy) {
  if (typeof value !== 'string') return '#ffffff';
  const hex = value.trim().toLowerCase();
  if (!hex || hex === legacy) return '#ffffff';
  return value.trim();
}

export function accidColorOrDefault(value) {
  return droppedLegacyColor(value, LEGACY_ACCID_COLOR);
}

export function usernameColorOrDefault(value) {
  return droppedLegacyColor(value, LEGACY_USERNAME_COLOR);
}

export let textTopicChatColor = '#ffffff';
export let innerContainerTopicChatColor = '#ffc107';
export let topicChatHeaderColor = '#ffffff';
export let textFontSizeTopicChat = 2;
export let timestampFontSizeTopicChat = 1.25;
export let headerFontSizeTopicChat = 2;

export function setTopicChatAccidColor(color) {
  accidTopicChatColor = color;
}
export function setTopicChatUsernameColor(color) {
  usernameTopicChatColor = color;
}
export function setTopicChatTextColor(color) {
  textTopicChatColor = color;
}
export function setTopicChatInnerContainerColor(color) {
  innerContainerTopicChatColor = color;
}
export function setTopicChatHeaderColor(color) {
  topicChatHeaderColor = color;
}
export function setTopicChatTextFontSize(size) {
  textFontSizeTopicChat = size;
}
export function setTopicChatTimestampFontSize(size) {
  timestampFontSizeTopicChat = size;
}
export function setTopicChatHeaderFontSize(size) {
  headerFontSizeTopicChat = size;
}

export let storedMarkers = [];
export function newStoredMarkers(a) {
  storedMarkers = a;
}
export let storedMarkersFiltered = [];
export function newStoredMarkersFiltered(a) {
  storedMarkersFiltered = a;
}
export let storedPolygons = [];
export function newStoredPolygons(a) {
  storedPolygons = a;
}
export let storedPolygonsFiltered = [];
export function newStoredPolygonsFiltered(a) {
  storedPolygonsFiltered = a;
}

// Not recommended for modern code, but solves the issue
export let globalLoadedTopicIdsWithNames = [];
export function newGlobalLoadedTopicIdsWithNames(a) {
  globalLoadedTopicIdsWithNames = a;
}

// topic id -> topic bio (newest valid topic_bio message per topic)
export let globalTopicBios = {};
export function newGlobalTopicBios(a) {
  globalTopicBios = a;
}