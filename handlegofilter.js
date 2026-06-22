import { 
  storedMarkers,
  storedMarkersFiltered,
  storedPolygons,
  storedPolygonsFiltered,
  existingMarkers,
  newStoredMarkers,
  newStoredPolygons,
  newStoredPolygonsFiltered,
  newStoredMarkersFiltered
  } from "./letall";
import { map } from './map.js';
import {debouncedUpdateClusters, index} from './marker'
import {addPolygonWithImageFill} from './polygons.js'



async function handleGeoFilter() {
    // Get values from all input fields
    const loadIds = document.getElementById("load-msgs-from-ids").value.toLowerCase();
    const blockIds = document.getElementById("load-blocks-from-ids").value.toLowerCase();
    const fromDateValue = document.getElementById("from-mmddyyyy-users-load-column").value;
    const toDateValue = document.getElementById("to-mmddyyyy-users-load-column").value;
    const fromTimeValue = document.getElementById("from-hhmmss-users-load-column").value;
    const toTimeValue = document.getElementById("to-hhmmss-users-load-column").value;
  
    // Process loadIds into idsArray
    let idsArray = loadIds ? loadIds.split(",").map(id => id.trim()).filter(id => id.length > 0) : [];
  
    // Process blockIds into blockIdsArray
    let blockIdsArray = blockIds ? blockIds.split(",").map(id => id.trim()).filter(id => id.length > 0) : [];

    // Convert domain names to topic IDs for loadIds
    if (idsArray.length > 0) {
      idsArray = idsArray.map(id => {
        if (!id.startsWith("0.0.")) {
          const domainEntry = loadedDomains.find(domain => domain.domain === id);
          return domainEntry ? domainEntry.lastMessage.topic : id;
        }
        return id;
      }).filter(id => id);
    }
  
    // Convert domain names to topic IDs for blockIds
    if (blockIdsArray.length > 0) {
      blockIdsArray = blockIdsArray.map(id => {
        if (!id.startsWith("0.0.")) {
          const domainEntry = loadedDomains.find(domain => domain.domain === id);
          return domainEntry ? domainEntry.lastMessage.topic : id;
        }
        return id;
      }).filter(id => id);
    }
  
    // Parse date and time
    let fromDate;
    let toDate;
  
    if (fromTimeValue && toTimeValue && fromDateValue && toDateValue) {
      fromDate = new Date(
        fromDateValue.slice(4, 8),
        fromDateValue.slice(0, 2) - 1,
        fromDateValue.slice(2, 4),
        fromTimeValue.slice(0, 2), // Hours
        fromTimeValue.slice(2, 4), // Minutes
        fromTimeValue.slice(4, 6)  // Seconds
      );
      toDate = new Date(
        toDateValue.slice(4, 8),
        toDateValue.slice(0, 2) - 1,
        toDateValue.slice(2, 4),
        toTimeValue.slice(0, 2), // Hours
        toTimeValue.slice(2, 4), // Minutes
        toTimeValue.slice(4, 6)  // Seconds
      );
    } else if (fromDateValue && toDateValue) {
      fromDate = new Date(fromDateValue.slice(4, 8), fromDateValue.slice(0, 2) - 1, fromDateValue.slice(2, 4));
      toDate = new Date(toDateValue.slice(4, 8), toDateValue.slice(0, 2) - 1, toDateValue.slice(2, 4));
    }

    // Filter storedMarkers
    const filteredFeatures = storedMarkers.flat().filter(feature => {
      const conditions = [];
      const featureDate = new Date(feature.created); // Assuming 'created' property exists
  
      // Date range filter (apply only if both fromDate and toDate are defined)
      if (fromDate && toDate) {
        conditions.push(featureDate >= fromDate && featureDate <= toDate);
      }
  
      // Load users filter (apply only if idsArray has values)
      if (idsArray.length > 0) {
        conditions.push(idsArray.includes(feature.payer));
      }
  
      // Block users filter (apply only if blockIdsArray has values)
      if (blockIdsArray.length > 0) {
        conditions.push(!blockIdsArray.includes(feature.payer));
      }
  
      // If no conditions, include all features
      if (conditions.length === 0) {
        return true;
      }
  
      // Include feature if all conditions are true
      return conditions.every(condition => condition);
    });
  
    // Filter storedPolygons
    const filteredPolygons = storedPolygons.flat().filter(polygon => {
      const conditions = [];
      const polygonDate = new Date(polygon.created); // Assuming 'created' property exists
  
      // Date range filter (apply only if both fromDate and toDate are defined)
      if (fromDate && toDate) {
        conditions.push(polygonDate >= fromDate && polygonDate <= toDate);
      }
  
      // Load users filter (apply only if idsArray has values)
      if (idsArray.length > 0) {
        conditions.push(idsArray.includes(polygon.payer));
      }
  
      // Block users filter (apply only if blockIdsArray has values)
      if (blockIdsArray.length > 0) {
        conditions.push(!blockIdsArray.includes(polygon.payer));
      }
  
      // If no conditions, include all polygons
      if (conditions.length === 0) {
        return true;
      }
  
      // Include polygon if all conditions are true
      return conditions.every(condition => condition);
    });
  
    // Update storedMarkers and storedPolygons
    newStoredMarkersFiltered(filteredFeatures);
    newStoredPolygonsFiltered(filteredPolygons);
  
    // Clear existing markers and layers
    setTimeout(() => {
      existingMarkers.forEach(marker => marker.remove());
      existingMarkers.length = 0;
    }, 250);
  
    map.getStyle().layers.forEach(layer => {
      if (layer.id.includes('-layer')) {
        map.removeLayer(layer.id);
      }
    });
  
    const sourceIds = Object.keys(map.getStyle().sources);
    sourceIds.forEach(sourceId => {
      if (sourceId.includes('-source')) {
        map.removeSource(sourceId);
      }
    });
  
    if (storedMarkersFiltered.length > 0) {
      index.load(storedMarkersFiltered);
      debouncedUpdateClusters();
    }
  
    if (storedPolygonsFiltered.length > 0) {
      storedPolygonsFiltered.forEach(polygon => {
        addPolygonWithImageFill(map, polygon);
      });
    }
  
  
    if (storedMarkersFiltered.length === 0 && storedPolygonsFiltered.length === 0) {
      const mapContainer = document.getElementById('loaded-topics');
      if (mapContainer) {
        mapContainer.innerHTML = `<div style="text-align: center; color: gray;">No markers or polygons found</div>`;
      }
    }
  }
  
  document.getElementById("load-msgs-from-ids-button").addEventListener("click", handleGeoFilter);
  document.getElementById("load-block-from-users-button").addEventListener("click", handleGeoFilter);
  document.getElementById("users-load-column-filter").addEventListener("click", handleGeoFilter);