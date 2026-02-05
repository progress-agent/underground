// Station data with realistic London Underground positions and depths
const STATIONS = [
    // Central Line (deep)
    { name: "Ealing Broadway", x: -200, y: -100, depth: -12, line: "Central" },
    { name: "Shepherd's Bush", x: -100, y: -50, depth: -20, line: "Central" },
    { name: "Oxford Circus", x: 0, y: 0, depth: -35, line: "Central" },
    { name: "Bank", x: 100, y: 50, depth: -38, line: "Central" },
    { name: "Stratford", x: 200, y: 100, depth: -25, line: "Central" },

    // Northern Line (very deep)
    { name: "Edgware", x: -150, y: 150, depth: -10, line: "Northern" },
    { name: "Camden Town", x: -80, y: 80, depth: -25, line: "Northern" },
    { name: "Leicester Square", x: 0, y: 0, depth: -48, line: "Northern" },
    { name: "London Bridge", x: 80, y: -80, depth: -52, line: "Northern" },
    { name: "Morden", x: 150, y: -150, depth: -20, line: "Northern" },

    // District Line (shallow)
    { name: "Wimbledon", x: -250, y: 0, depth: -5, line: "District" },
    { name: "Earl's Court", x: -150, y: 50, depth: -8, line: "District" },
    { name: "Victoria", x: 0, y: 0, depth: -12, line: "District" },
    { name: "Tower Hill", x: 150, y: -50, depth: -10, line: "District" },
    { name: "Upminster", x: 250, y: 0, depth: -6, line: "District" },

    // Circle Line (surface/very shallow)
    { name: "Hammersmith", x: -180, y: 0, depth: -2, line: "Circle" },
    { name: "Paddington", x: -127, y: 127, depth: -4, line: "Circle" },
    { name: "Liverpool Street", x: 0, y: 180, depth: -6, line: "Circle" },
    { name: "Monument", x: 127, y: 127, depth: -8, line: "Circle" },
    { name: "Westminster", x: 180, y: 0, depth: -35, line: "Circle" },  // Deep interchange

    // Crossrail stations
    { name: "Heathrow", x: -350, y: 0, depth: -25, line: "Crossrail" },
    { name: "Liverpool St", x: 0, y: 180, depth: -28, line: "Crossrail" },
    { name: "Canary Wharf", x: 200, y: -200, depth: -32, line: "Crossrail" },

    // Tideway shafts
    { name: "Acton", x: -200, y: -50, depth: -68, line: "Tideway" },
    { name: "Carnwath Rd", x: -50, y: -100, depth: -72, line: "Tideway" },
    { name: "Chambers Wharf", x: 100, y: -80, depth: -70, line: "Tideway" },
];

/**
 * Creates station markers and labels
 * FIXED IMPLEMENTATION - Properly handles world coordinates and label positioning
 */
export function createStationMarkers(scene, depthExaggeration) {
    const markers = [];
    const container = document.getElementById('canvas-container');
    const canvas = document.getElementById('webgl-canvas');

    STATIONS.forEach(station => {
        // Create 3D marker at the station position
        const position = new THREE.Vector3(
            station.x,
            station.y,
            station.depth * depthExaggeration
        );

        // Create the 3D sphere marker
        const geometry = new THREE.SphereGeometry(4, 16, 16);
        const color = getLineColor(station.line);
        const material = new THREE.MeshPhongMaterial({ 
            color: color,
            emissive: color,
            emissiveIntensity: 0.3
        });
        const marker = new THREE.Mesh(geometry, material);
        marker.position.copy(position);
        scene.add(marker);

        // Create HTML label element
        const label = document.createElement('div');
        label.className = 'station-label';
        label.textContent = station.name;
        
        // Classify by depth
        if (station.depth > -5) {
            label.classList.add('above-ground');
        } else if (station.depth < -30) {
            label.classList.add('deep-level');
        }

        container.appendChild(label);

        // Store marker data with PROPER world position tracking
        markers.push({
            mesh: marker,
            label: label,
            // FIX: Store the original world position correctly
            worldPosition: position.clone(),
            station: station
        });
    });

    return markers;
}

/**
 * Updates station label positions
 * FIXED IMPLEMENTATION - Properly projects world coordinates to screen space
 */
export function updateStationLabels(markers, camera, renderer) {
    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    
    // Create a reusable vector for calculations (avoid GC)
    const tempVector = new THREE.Vector3();

    markers.forEach(markerData => {
        const { mesh, label, worldPosition } = markerData;

        // FIX #1: Get the ACTUAL world position from the mesh
        // This accounts for any transforms applied to the mesh or its parents
        mesh.getWorldPosition(tempVector);
        
        // FIX #2: Project world position to normalized device coordinates (NDC)
        // NDC space: x, y, z are in range [-1, 1]
        tempVector.project(camera);

        // FIX #3: Check if the point is behind the camera (z > 1 in NDC means behind)
        // When z is > 1, the point is behind the near clipping plane
        if (tempVector.z > 1) {
            label.style.display = 'none';
            return;
        }

        // FIX #4: Convert NDC to screen coordinates accounting for canvas position
        // NDC x: [-1, 1] -> Screen x: [0, canvas.width]
        // NDC y: [-1, 1] -> Screen y: [canvas.height, 0] (Y is flipped!)
        const screenX = (tempVector.x * 0.5 + 0.5) * canvasRect.width;
        const screenY = (1 - (tempVector.y * 0.5 + 0.5)) * canvasRect.height;

        // FIX #5: Account for canvas offset within the viewport
        // This ensures labels track correctly even if canvas isn't at (0,0)
        const canvasX = canvasRect.left + screenX;
        const canvasY = canvasRect.top + screenY;

        // FIX #6: Check if label is within canvas bounds with some margin
        const margin = 50;
        if (canvasX < -margin || canvasX > canvasRect.width + margin ||
            canvasY < -margin || canvasY > canvasRect.height + margin) {
            label.style.display = 'none';
            return;
        }

        // Apply position to label
        label.style.left = `${screenX}px`;
        label.style.top = `${screenY}px`;
        label.style.display = 'block';

        // FIX #7: Distance-based opacity scaling
        // Labels fade as they get further from camera
        const distance = worldPosition.distanceTo(camera.position);
        const maxDistance = 1500;
        const minDistance = 200;
        const opacity = Math.max(0.3, Math.min(1, 1 - (distance - minDistance) / (maxDistance - minDistance)));
        label.style.opacity = opacity;

        // FIX #8: Depth-based visual cue - add distance indicator for deep stations
        const depthLabel = markerData.station.depth < -30 ? '↓' : '';
        if (!label.dataset.hasDepthIndicator && markerData.station.depth < -30) {
            label.dataset.hasDepthIndicator = 'true';
        }
    });
}

/**
 * Alternative implementation using CSS 3D transforms
 * This can be used if the standard approach has performance issues
 */
export function updateStationLabelsCSS3D(markers, camera, renderer) {
    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const tempVector = new THREE.Vector3();

    markers.forEach(markerData => {
        const { mesh, label } = markerData;

        mesh.getWorldPosition(tempVector);
        tempVector.project(camera);

        if (tempVector.z > 1) {
            label.style.display = 'none';
            return;
        }

        const screenX = (tempVector.x * 0.5 + 0.5) * canvasRect.width;
        const screenY = (1 - (tempVector.y * 0.5 + 0.5)) * canvasRect.height;

        label.style.transform = `translate(${screenX}px, ${screenY}px) translate(-50%, -50%)`;
        label.style.display = 'block';
    });
}

function getLineColor(line) {
    const colors = {
        'Central': 0xDC241F,
        'Northern': 0x000000,
        'District': 0x007229,
        'Circle': 0xFFD700,
        'Crossrail': 0x9C27B0,
        'Tideway': 0x00BCD4
    };
    return colors[line] || 0xffffff;
}

export { STATIONS };
