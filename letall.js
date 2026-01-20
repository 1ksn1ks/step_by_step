
export let models = [];

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

export let defaultModelUrl = 'https://kiloscribe.com/api/inscription-cdn/0.0.9742046'; // Replace with your actual default model URL


export let accidTopicChatColor = '#800080';
export let usernameTopicChatColor = '#ff9933';
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
export let storedPolygons = [];
export function newStoredPolygons(a) {
  storedPolygons = a;
}
export let storedPolygonsFiltered = [];

// Not recommended for modern code, but solves the issue
export let globalLoadedTopicIdsWithNames = [];
export function newGlobalLoadedTopicIdsWithNames(a) {
  globalLoadedTopicIdsWithNames = a;
}

