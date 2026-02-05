import * as THREE from 'three';

/**
 * Depth calculations and coordinate transformations
 */

// Depth scale factor for exaggerating vertical dimensions
export const depthScale = 15;

/**
 * Converts real-world depth in meters to world units
 * @param {number} meters - Depth in meters (negative = below ground)
 * @param {number} exaggeration - Vertical exaggeration factor
 * @returns {number} World Z coordinate
 */
export function metersToWorldUnits(meters, exaggeration = depthScale) {
    return meters * exaggeration;
}

/**
 * Converts world units back to meters
 * @param {number} worldUnits - World Z coordinate
 * @param {number} exaggeration - Vertical exaggeration factor
 * @returns {number} Depth in meters
 */
export function worldUnitsToMeters(worldUnits, exaggeration = depthScale) {
    return worldUnits / exaggeration;
}

/**
 * Calculates the apparent depth based on camera distance
 * Used for LOD or visibility calculations
 * @param {THREE.Vector3} position - World position
 * @param {THREE.Camera} camera - Camera reference
 * @returns {number} Apparent depth value
 */
export function calculateApparentDepth(position, camera) {
    const distance = position.distanceTo(camera.position);
    return distance;
}

/**
 * Checks if a point at depth should be visible based on camera angle
 * @param {THREE.Vector3} position - World position
 * @param {THREE.Camera} camera - Camera reference
 * @returns {boolean} Whether the point is likely visible
 */
export function isPointVisible(position, camera) {
    // Get camera direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Vector from camera to point
    const toPoint = position.clone().sub(camera.position);
    
    // Check if point is in front of camera
    const dotProduct = cameraDirection.dot(toPoint);
    return dotProduct > 0;
}

/**
 * Projects a 3D world position to 2D screen coordinates
 * @param {THREE.Vector3} worldPosition - Position in world space
 * @param {THREE.Camera} camera - Camera
 * @param {HTMLElement} canvas - The canvas element
 * @returns {Object|null} Screen coordinates {x, y} or null if behind camera
 */
export function worldToScreen(worldPosition, camera, canvas) {
    const tempVector = worldPosition.clone();
    tempVector.project(camera);

    // Check if behind camera
    if (tempVector.z > 1) {
        return null;
    }

    const rect = canvas.getBoundingClientRect();
    
    return {
        x: (tempVector.x * 0.5 + 0.5) * rect.width,
        y: (1 - (tempVector.y * 0.5 + 0.5)) * rect.height,
        z: tempVector.z // Depth for sorting/occlusion
    };
}

/**
 * Gets the visible depth range based on camera position
 * Useful for culling distant objects
 * @param {THREE.Camera} camera - Camera reference
 * @param {number} fov - Field of view
 * @returns {Object} Min and max visible depths
 */
export function getVisibleDepthRange(camera, fov = 45) {
    const near = camera.near;
    const far = camera.far;
    
    return {
        near: near,
        far: far,
        optimal: far * 0.8 // Suggest culling beyond this
    };
}
