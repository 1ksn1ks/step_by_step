import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { loadProfileSettings } from './loadprofilesettings'
import { currentUfoModel, defaultModelUrl, setCurrentUfoModel } from "./letall";
import { scene } from "./threejs";
import * as THREE from 'three';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');  // Adjust this path based on where you place the decoder files

const ufoLoader = new GLTFLoader();
ufoLoader.setDRACOLoader(dracoLoader);

export async function loadUfoModel(modelUrl) {

    // Check if the model URL is defined and valid
    if (!modelUrl || typeof modelUrl !== 'string' || modelUrl.trim() === '') {
        modelUrl = defaultModelUrl; // Use the default model URL
        console.log('Using default model URL:', modelUrl);

    }

    // Load the GLTF model
    try {
        // // Remove the previous model if it exists
        if (currentUfoModel !== null) {
            scene.remove(currentUfoModel);
            setCurrentUfoModel (null); // Clear the reference to the removed model
        }

        const gltf = await new Promise((resolve, reject) => {
            ufoLoader.load(modelUrl, resolve, undefined, (error) => {
                console.error("Error loading GLTF model:", error);
                reject(error);
            });
        });

        setCurrentUfoModel(gltf.scene); // Get the loaded model

        // Step 1: Calculate the model's bounding box
        const box = new THREE.Box3().setFromObject(currentUfoModel);
        const modelSize = new THREE.Vector3();
        box.getSize(modelSize); // Get the size of the model

        // Step 2: Define the bounding box dimensions
        const boundingBoxSize = new THREE.Vector3(10, 10, 10); // Width, Height, Depth

        // Step 3: Calculate the scale factor
        const scaleFactor = Math.min(
            boundingBoxSize.x / modelSize.x,
            boundingBoxSize.y / modelSize.y,
            boundingBoxSize.z / modelSize.z
        );

        // Step 4: Apply the scale to the model
        currentUfoModel.scale.set(scaleFactor, scaleFactor, scaleFactor); // Scale the model uniformly

        // Check if the user has loaded their profile object
        if (modelUrl !== defaultModelUrl) {
            // Load user-specific settings if available
            const profileSettings = await loadProfileSettings(); // Load profile settings
            if (profileSettings.length === 0 || !profileSettings[0].position) {
                // If no settings loaded, use bounding box for position
                currentUfoModel.position.set(box.min.x, box.min.y, box.min.z); // Use bounding box min for position
                currentUfoModel.scale.set(scaleFactor, scaleFactor, scaleFactor); // Use calculated scale factor
                // Step 5: Position the model within the bounding box
                currentUfoModel.position.set(0, -5, -30); // Adjust as needed
            } else {
                // Apply user-specific settings
                currentUfoModel.position.set(
                    parseFloat(document.getElementById("position-x").value),
                    parseFloat(document.getElementById("position-y").value),
                    parseFloat(document.getElementById("position-z").value)
                );
                currentUfoModel.rotation.set(
                    THREE.MathUtils.degToRad(document.getElementById("rotation-x").value),
                    THREE.MathUtils.degToRad(document.getElementById("rotation-y").value),
                    THREE.MathUtils.degToRad(document.getElementById("rotation-z").value)
                );
                const userScaleFactor = parseFloat(document.getElementById("scale-factor").value);
                currentUfoModel.scale.set(userScaleFactor, userScaleFactor, userScaleFactor); // Scale the model uniformly
            }
        } else {
            // Default settings for new users
            currentUfoModel.position.set(0, -3, -8); // Default position
            currentUfoModel.rotation.set(
                THREE.MathUtils.degToRad(0),
                THREE.MathUtils.degToRad(0),
                THREE.MathUtils.degToRad(0)
            ); // Default rotation
            const defaultScaleFactor = 1; // Default scale factor
            currentUfoModel.scale.set(defaultScaleFactor, defaultScaleFactor, defaultScaleFactor); // Scale the model uniformly
        }

        scene.add(currentUfoModel);

        document.getElementById("rotation-x").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-x-value").value = value; // Update number input
            currentUfoModel.rotation.x = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("rotation-y").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-y-value").value = value; // Update number input
            currentUfoModel.rotation.y = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("rotation-z").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-z-value").value = value; // Update number input
            currentUfoModel.rotation.z = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("position-x").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-x-value").value = value; // Update number input
            currentUfoModel.position.x = parseFloat(value); // Update the x position of the model
        });

        document.getElementById("position-y").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-y-value").value = value; // Update number input
            currentUfoModel.position.y = parseFloat(value); // Update the y position of the model
        });

        document.getElementById("position-z").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-z-value").value = value; // Update number input
            currentUfoModel.position.z = parseFloat(value); // Update the z position of the model
        });

        document.getElementById("scale-factor").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("scale-factor-value").value = value; // Update number input
            const scaleFactor = parseFloat(value); // Get the scale factor
            currentUfoModel.scale.set(scaleFactor, scaleFactor, scaleFactor); // Scale the model uniformly
        });

        document.getElementById("rotation-x-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-x").value = value; // Update range input
            currentUfoModel.rotation.x = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("rotation-y-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-y").value = value; // Update range input
            currentUfoModel.rotation.y = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("rotation-z-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("rotation-z").value = value; // Update range input
            currentUfoModel.rotation.z = THREE.MathUtils.degToRad(value); // Convert degrees to radians
        });

        document.getElementById("position-x-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-x").value = value; // Update range input
            currentUfoModel.position.x = parseFloat(value); // Update the x position of the model
        });

        document.getElementById("position-y-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-y").value = value; // Update range input
            currentUfoModel.position.y = parseFloat(value); // Update the y position of the model
        });

        document.getElementById("position-z-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("position-z").value = value; // Update range input
            currentUfoModel.position.z = parseFloat(value); // Update the z position of the model
        });

        document.getElementById("scale-factor-value").addEventListener("input", (event) => {
            const value = event.target.value;
            document.getElementById("scale-factor").value = value; // Update range input
            const scaleFactor = parseFloat(value); // Get the scale factor
            currentUfoModel.scale.set(scaleFactor, scaleFactor, scaleFactor); // Scale the model uniformly
        });

        document.getElementById("position-x").value = currentUfoModel.position.x;
        document.getElementById("position-y").value = currentUfoModel.position.y;
        document.getElementById("position-z").value = currentUfoModel.position.z;
        document.getElementById("scale-factor").value = currentUfoModel.scale.x;
        document.getElementById("position-x-value").value = currentUfoModel.position.x;
        document.getElementById("position-y-value").value = currentUfoModel.position.y;
        document.getElementById("position-z-value").value = currentUfoModel.position.z;

        const rotationXInDegrees = THREE.MathUtils.radToDeg(currentUfoModel.rotation.x);
        const rotationYInDegrees = THREE.MathUtils.radToDeg(currentUfoModel.rotation.y);
        const rotationZInDegrees = THREE.MathUtils.radToDeg(currentUfoModel.rotation.z);

        document.getElementById("rotation-x").value = Math.round(rotationXInDegrees);
        document.getElementById("rotation-y").value = Math.round(rotationYInDegrees);
        document.getElementById("rotation-z").value = Math.round(rotationZInDegrees);

        document.getElementById("rotation-x-value").value = Math.round(rotationXInDegrees);
        document.getElementById("rotation-y-value").value = Math.round(rotationYInDegrees);
        document.getElementById("rotation-z-value").value = Math.round(rotationZInDegrees);
        document.getElementById("scale-factor-value").value = currentUfoModel.scale.x;

    } catch (error) {
        console.error('An error occurred while loading the GLTF model:', error);
    }
}

await loadUfoModel(defaultModelUrl);
