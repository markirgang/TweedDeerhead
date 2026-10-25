// ============================================================================
// 3D TALKING MOOSE ANIMATION — 121 TWEED BLVD, NYACK, NY 10960
// Features binary ON/OFF solenoid jaw (not a continuous servo: snaps OPEN/CLOSED),
// real-time 3D eye tracking, broad palmated moose antlers, and hardware HUD.
// ============================================================================

window.Deerhead3D = (function () {
  let container, scene, camera, renderer;
  let plaqueGroup, deerGroup, headGroup, jawGroup, leftEar, rightEar;
  let pupilLeft, pupilRight, eyeLeftMesh, eyeRightMesh;
  let isOrbiting = false, previousMousePosition = { x: 0, y: 0 };
  let targetRotation = { x: 0, y: 0 };
  let currentRotation = { x: 0, y: 0 };
  let eyeTarget = { x: 0, y: 0 };
  let currentEye = { x: 0, y: 0 };

  // BINARY ON/OFF SOLENOID JAW (Not a servo! Snaps OPEN or CLOSED)
  let jawIsOpen = false;
  let currentJawRotation = 0;
  let earWiggle = 0;
  let animId = null;

  let hudYawPitchEl, hudJawAngleEl;

  function init(containerEl) {
    container = containerEl;
    if (!container) return;

    hudYawPitchEl = document.getElementById('hud3dYawPitch');
    hudJawAngleEl = document.getElementById('hud3dJawAngle');

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 340;

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x130e0a);
    scene.fog = new THREE.FogExp2(0x130e0a, 0.05);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 0.35, 4.2);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 4. Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xfff5ea, 0.9);
    scene.add(ambientLight);

    const wallSpot = new THREE.SpotLight(0xffdfa8, 2.0, 14, Math.PI / 4, 0.35, 1.2);
    wallSpot.position.set(0, 3.2, 3.5);
    wallSpot.castShadow = true;
    scene.add(wallSpot);

    const warmRimLeft = new THREE.DirectionalLight(0xe59a3c, 1.3);
    warmRimLeft.position.set(-3.5, 1.5, -0.5);
    scene.add(warmRimLeft);

    const emeraldRimRight = new THREE.DirectionalLight(0x38ef7d, 0.5);
    emeraldRimRight.position.set(3.5, 1.5, 1);
    scene.add(emeraldRimRight);

    // 5. Build 3D Trophy Plaque & Moose Model
    buildWallAndPlaque();
    buildMooseModel();

    // 6. Interactive Mouse Drag Orbit Controls
    setupOrbitControls();

    // 7. Resize Observer
    window.addEventListener('resize', onWindowResize);

    // 8. Animation Loop
    animate();
  }

  function onWindowResize() {
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth || 360;
    const height = container.clientHeight || 340;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  // --- BUILD SHIELD OAK WALL PLAQUE WITH BRASS NAMEPLATE ---
  function buildWallAndPlaque() {
    plaqueGroup = new THREE.Group();

    const wallGeo = new THREE.PlaneGeometry(8, 8);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1f140c,
      roughness: 0.92,
      metalness: 0.08
    });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.z = -0.32;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    const shieldShape = new THREE.Shape();
    shieldShape.moveTo(0, 1.55);
    shieldShape.bezierCurveTo(0.85, 1.55, 1.05, 0.75, 0.95, -0.1);
    shieldShape.bezierCurveTo(0.85, -0.9, 0.45, -1.35, 0, -1.6);
    shieldShape.bezierCurveTo(-0.45, -1.35, -0.85, -0.9, -0.95, -0.1);
    shieldShape.bezierCurveTo(-1.05, 0.75, -0.85, 1.55, 0, 1.55);

    const extrudeSettings = {
      depth: 0.15,
      bevelEnabled: true,
      bevelSegments: 4,
      steps: 1,
      bevelSize: 0.05,
      bevelThickness: 0.05
    };
    const plaqueGeo = new THREE.ExtrudeGeometry(shieldShape, extrudeSettings);
    const plaqueMat = new THREE.MeshStandardMaterial({
      color: 0x543114,
      roughness: 0.68,
      metalness: 0.06
    });
    const plaqueMesh = new THREE.Mesh(plaqueGeo, plaqueMat);
    plaqueMesh.position.z = -0.22;
    plaqueMesh.castShadow = true;
    plaqueMesh.receiveShadow = true;
    plaqueGroup.add(plaqueMesh);

    const brassGeo = new THREE.BoxGeometry(0.9, 0.24, 0.035);
    const brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4a046,
      roughness: 0.3,
      metalness: 0.88
    });
    const brassPlate = new THREE.Mesh(brassGeo, brassMat);
    brassPlate.position.set(0, -1.15, -0.01);
    plaqueGroup.add(brassPlate);

    scene.add(plaqueGroup);
  }

  // --- BUILD 3D ANIMATRONIC MOOSE WITH BINARY ON/OFF JAW ---
  function buildMooseModel() {
    deerGroup = new THREE.Group();

    const mooseFurMat = new THREE.MeshStandardMaterial({
      color: 0x764c26,
      roughness: 0.85,
      metalness: 0.04
    });
    const whiteThroatMat = new THREE.MeshStandardMaterial({
      color: 0xe8dcce,
      roughness: 0.9
    });
    const antlerMat = new THREE.MeshStandardMaterial({
      color: 0xd8caa8,
      roughness: 0.5,
      metalness: 0.12
    });
    const darkMuzzleMat = new THREE.MeshStandardMaterial({
      color: 0x22150b,
      roughness: 0.68
    });
    const noseLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x110a06,
      roughness: 0.35
    });

    // 1. Neck / Mount Collar (emerging from oak plaque)
    const neckGeo = new THREE.CylinderGeometry(0.44, 0.68, 1.15, 16);
    const neckMesh = new THREE.Mesh(neckGeo, mooseFurMat);
    neckMesh.rotation.x = Math.PI / 3.7;
    neckMesh.position.set(0, -0.16, 0.35);
    neckMesh.castShadow = true;
    deerGroup.add(neckMesh);

    // Moose Dewlap ("Bell" hanging under chin)
    const bellGeo = new THREE.ConeGeometry(0.12, 0.45, 8);
    const bellMesh = new THREE.Mesh(bellGeo, darkMuzzleMat);
    bellMesh.position.set(0, -0.68, 0.68);
    bellMesh.rotation.x = -0.25;
    deerGroup.add(bellMesh);

    // White throat patch
    const throatGeo = new THREE.SphereGeometry(0.36, 14, 14);
    const throatMesh = new THREE.Mesh(throatGeo, whiteThroatMat);
    throatMesh.scale.set(0.75, 1.1, 0.65);
    throatMesh.position.set(0, -0.3, 0.62);
    deerGroup.add(throatMesh);

    // 2. Head Group (Rotates for Pitch & Yaw tracking!)
    headGroup = new THREE.Group();
    headGroup.position.set(0, 0.35, 0.78);

    // Cranium
    const craniumGeo = new THREE.SphereGeometry(0.46, 16, 16);
    const cranium = new THREE.Mesh(craniumGeo, mooseFurMat);
    cranium.scale.set(1.0, 1.05, 1.15);
    cranium.castShadow = true;
    headGroup.add(cranium);

    // Upper Snout / Broad Moose Muzzle
    const snoutGeo = new THREE.BoxGeometry(0.38, 0.32, 0.68);
    const snout = new THREE.Mesh(snoutGeo, mooseFurMat);
    snout.position.set(0, -0.1, 0.58);
    snout.rotation.x = -0.12;
    headGroup.add(snout);

    // Overhanging Moose Upper Lip & Nose
    const noseGeo = new THREE.BoxGeometry(0.36, 0.16, 0.22);
    const nose = new THREE.Mesh(noseGeo, noseLeatherMat);
    nose.position.set(0, -0.16, 0.92);
    headGroup.add(nose);

    // Nostrils
    const nostrilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const nostrilL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.05), nostrilMat);
    nostrilL.position.set(-0.09, -0.19, 0.98);
    headGroup.add(nostrilL);
    const nostrilR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.05), nostrilMat);
    nostrilR.position.set(0.09, -0.19, 0.98);
    headGroup.add(nostrilR);

    // 3. Articulated Binary Solenoid Jaw (NOT a continuous servo: snaps ON/OFF)
    jawGroup = new THREE.Group();
    jawGroup.position.set(0, -0.22, 0.4); // Hinge pivot point

    const jawGeo = new THREE.BoxGeometry(0.3, 0.14, 0.5);
    const jawMesh = new THREE.Mesh(jawGeo, darkMuzzleMat);
    jawMesh.position.set(0, -0.04, 0.24);
    jawMesh.rotation.x = 0.05;
    jawGroup.add(jawMesh);

    // Tongue inside
    const tongueGeo = new THREE.BoxGeometry(0.12, 0.03, 0.25);
    const tongueMat = new THREE.MeshStandardMaterial({ color: 0xd46868 });
    const tongue = new THREE.Mesh(tongueGeo, tongueMat);
    tongue.position.set(0, 0.02, 0.24);
    jawGroup.add(tongue);

    headGroup.add(jawGroup);

    // 4. Glass Eyes with Responsive Pupils
    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.2
    });
    const pupilMat = new THREE.MeshStandardMaterial({
      color: 0x120c06,
      roughness: 0.15
    });

    eyeLeftMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), eyeWhiteMat);
    eyeLeftMesh.position.set(-0.36, 0.12, 0.35);
    eyeLeftMesh.rotation.y = -Math.PI / 4.5;
    pupilLeft = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 12), pupilMat);
    pupilLeft.position.set(0, 0, 0.065);
    eyeLeftMesh.add(pupilLeft);
    headGroup.add(eyeLeftMesh);

    eyeRightMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 14), eyeWhiteMat);
    eyeRightMesh.position.set(0.36, 0.12, 0.35);
    eyeRightMesh.rotation.y = Math.PI / 4.5;
    pupilRight = new THREE.Mesh(new THREE.SphereGeometry(0.048, 12, 12), pupilMat);
    pupilRight.position.set(0, 0, 0.065);
    eyeRightMesh.add(pupilRight);
    headGroup.add(eyeRightMesh);

    // 5. Ears
    const earGeo = new THREE.ConeGeometry(0.18, 0.65, 8);
    leftEar = new THREE.Mesh(earGeo, mooseFurMat);
    leftEar.position.set(-0.46, 0.42, 0.05);
    leftEar.rotation.set(-0.25, 0.35, 1.25);
    leftEar.scale.set(0.85, 1.0, 0.35);
    headGroup.add(leftEar);

    rightEar = new THREE.Mesh(earGeo, mooseFurMat);
    rightEar.position.set(0.46, 0.42, 0.05);
    rightEar.rotation.set(-0.25, -0.35, -1.25);
    rightEar.scale.set(0.85, 1.0, 0.35);
    headGroup.add(rightEar);

    // 6. Broad Palmated Moose Antlers (Left & Right Racks)
    buildMooseAntlerRack(headGroup, antlerMat, -1);
    buildMooseAntlerRack(headGroup, antlerMat, 1);

    deerGroup.add(headGroup);
    scene.add(deerGroup);
  }

  function buildMooseAntlerRack(parent, mat, side) {
    const rackGroup = new THREE.Group();
    rackGroup.position.set(side * 0.28, 0.44, 0.06);

    const beamGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.42, 8);
    const beam = new THREE.Mesh(beamGeo, mat);
    beam.rotation.z = side * Math.PI / 2.6;
    beam.position.set(side * 0.18, 0.1, 0);
    rackGroup.add(beam);

    const palmShape = new THREE.Shape();
    palmShape.moveTo(0, 0);
    palmShape.lineTo(side * 0.35, 0.3);
    palmShape.lineTo(side * 0.6, 0.85);
    palmShape.lineTo(side * 0.5, 1.1);
    palmShape.lineTo(side * 0.3, 1.25);
    palmShape.lineTo(side * 0.1, 1.2);
    palmShape.lineTo(0, 0.95);
    palmShape.lineTo(-side * 0.1, 0.45);
    palmShape.lineTo(0, 0);

    const palmGeo = new THREE.ExtrudeGeometry(palmShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelSegments: 2,
      bevelSize: 0.02,
      bevelThickness: 0.02
    });
    const palmMesh = new THREE.Mesh(palmGeo, mat);
    palmMesh.position.set(side * 0.3, 0.2, 0);
    palmMesh.rotation.set(-0.25, side * 0.18, side * 0.15);
    palmMesh.castShadow = true;
    rackGroup.add(palmMesh);

    addTine(rackGroup, mat, new THREE.Vector3(side * 0.45, 0.55, 0.1), new THREE.Vector3(side * 0.65, 0.72, 0.25));
    addTine(rackGroup, mat, new THREE.Vector3(side * 0.7, 0.95, 0.05), new THREE.Vector3(side * 0.95, 1.15, 0.22));
    addTine(rackGroup, mat, new THREE.Vector3(side * 0.58, 1.25, 0.0), new THREE.Vector3(side * 0.75, 1.5, 0.15));
    addTine(rackGroup, mat, new THREE.Vector3(side * 0.32, 1.35, -0.05), new THREE.Vector3(side * 0.4, 1.62, 0.05));

    parent.add(rackGroup);
  }

  function addTine(parent, mat, start, end) {
    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    const tineGeo = new THREE.CylinderGeometry(0.018, 0.045, len, 8);
    const tine = new THREE.Mesh(tineGeo, mat);
    tine.position.copy(start).addScaledVector(dir, 0.5);
    tine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    tine.castShadow = true;
    parent.add(tine);
  }

  function setupOrbitControls() {
    container.addEventListener('mousedown', (e) => {
      isOrbiting = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!isOrbiting) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;
      targetRotation.y += deltaX * 0.007;
      targetRotation.x += deltaY * 0.007;
      targetRotation.x = Math.max(-0.4, Math.min(0.4, targetRotation.x));
      targetRotation.y = Math.max(-0.9, Math.min(0.9, targetRotation.y));
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => { isOrbiting = false; });

    container.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isOrbiting = true;
        previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    });
    window.addEventListener('touchmove', (e) => {
      if (!isOrbiting || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - previousMousePosition.x;
      const deltaY = e.touches[0].clientY - previousMousePosition.y;
      targetRotation.y += deltaX * 0.007;
      targetRotation.x += deltaY * 0.007;
      previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    });
    window.addEventListener('touchend', () => { isOrbiting = false; });
  }

  function resetView() {
    targetRotation = { x: 0, y: 0 };
    if (camera) camera.position.set(0, 0.35, 4.2);
  }

  function setTargetTracking(normX, normY) {
    eyeTarget.x = Math.max(-1, Math.min(1, normX));
    eyeTarget.y = Math.max(-1, Math.min(1, normY));
  }

  // --- BINARY ON/OFF SOLENOID JAW CONTROLLER ---
  // The jaw is NOT a proportional servo: it snaps immediately OPEN [ON] or SHUT [OFF]!
  function setJawSolenoidState(isOpen) {
    jawIsOpen = !!isOpen;
  }

  function setJawAmplitude(amp) {
    // If audio amplitude > threshold, snap jaw OPEN (ON); otherwise snap CLOSED (OFF)
    jawIsOpen = Number(amp) > 0.08;
  }

  function animate() {
    animId = requestAnimationFrame(animate);

    currentRotation.x += (targetRotation.x - currentRotation.x) * 0.08;
    currentRotation.y += (targetRotation.y - currentRotation.y) * 0.08;
    if (deerGroup && !isOrbiting) {
      deerGroup.rotation.y = currentRotation.y;
      deerGroup.rotation.x = currentRotation.x;
    }

    currentEye.x += (eyeTarget.x - currentEye.x) * 0.06;
    currentEye.y += (eyeTarget.y - currentEye.y) * 0.06;

    if (headGroup) {
      headGroup.rotation.y = currentEye.x * 0.32;
      headGroup.rotation.x = -currentEye.y * 0.18;

      if (hudYawPitchEl) {
        const yawDeg = (headGroup.rotation.y * (180 / Math.PI)).toFixed(1);
        const pitchDeg = (headGroup.rotation.x * (180 / Math.PI)).toFixed(1);
        hudYawPitchEl.textContent = `Yaw: ${yawDeg > 0 ? '+' : ''}${yawDeg}° | Pitch: ${pitchDeg > 0 ? '+' : ''}${pitchDeg}°`;
      }
    }

    if (pupilLeft && pupilRight) {
      pupilLeft.position.x = currentEye.x * 0.025;
      pupilLeft.position.y = -currentEye.y * 0.025;
      pupilRight.position.x = currentEye.x * 0.025;
      pupilRight.position.y = -currentEye.y * 0.025;
    }

    // SNAP ON / OFF BINARY SOLENOID ACTION (Fast click snap open or shut)
    const targetAngle = jawIsOpen ? 0.38 : 0.0; // 0.38 rad = ~22 degrees wide open
    // Very fast snappy transition (like an electrical solenoid click)
    currentJawRotation += (targetAngle - currentJawRotation) * 0.65;
    if (Math.abs(targetAngle - currentJawRotation) < 0.02) {
      currentJawRotation = targetAngle;
    }

    if (jawGroup) {
      jawGroup.rotation.x = currentJawRotation;
      if (hudJawAngleEl) {
        hudJawAngleEl.textContent = jawIsOpen ? '[OPEN - ON]' : '[SHUT - OFF]';
        hudJawAngleEl.style.color = jawIsOpen ? '#38ef7d' : '#e59a3c';
      }
    }

    if (leftEar && rightEar) {
      earWiggle = Math.sin(Date.now() * 0.003) * 0.05 + (jawIsOpen ? 0.12 : 0);
      leftEar.rotation.z = 1.25 + earWiggle;
      rightEar.rotation.z = -1.25 - earWiggle;
    }

    renderer.render(scene, camera);
  }

  return {
    init,
    resetView,
    setTargetTracking,
    setJawSolenoidState,
    setJawAmplitude
  };
})();
