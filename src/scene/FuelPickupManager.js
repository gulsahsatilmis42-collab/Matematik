import * as THREE from 'three';

/**
 * FuelPickupManager
 * Manages 3D miniature racing fuel canisters (jerrycans) along the coaster track.
 * As the player collects fuel:
 * - Grants instant turbo boost + permanent top speed increase (Hızlansın)
 * - Awards points + combo multipliers + high speed bonus (Puanı artsın)
 * - Triggers visual particle bursts, hovering glow, and minimap radar pings
 */
export function createFuelPickupManager(scene, splineData, options = {}) {
  const rootGroup = new THREE.Group();
  rootGroup.name = 'FuelPickupGroup';
  scene.add(rootGroup);

  const samples = splineData.samples || [];
  const totalLength = splineData.total_length_m || 3.6074;

  // Track state
  let currentScore = 0;
  let comboCount = 0;
  let comboTimer = 0.0;
  const COMBO_TIMEOUT = 5.5; // seconds to keep combo alive
  let fuelCollectedCount = 0;
  let speedBonusTimer = 0.0;

  // Strategic positions for fuel canisters along the 3.6m track
  // (Covering all 6 exciting sectors with varying lateral offsets for fun steering)
  const CANISTER_CONFIGS = [
    { s: 0.22, latOffset: 0.000, name: 'BoYata Ramp' },
    { s: 0.48, latOffset: -0.0035, name: 'BoYata Sky Crest' },
    { s: 0.78, latOffset: 0.0035, name: 'Cat Helix Entry' },
    { s: 1.05, latOffset: -0.0030, name: 'Cat Helix Apex' },
    { s: 1.34, latOffset: 0.000, name: 'Cat Exit Drop' },
    { s: 1.62, latOffset: 0.0035, name: 'Mic Underpass' },
    { s: 1.95, latOffset: -0.0035, name: 'Boom-Arm Ridge' },
    { s: 2.22, latOffset: 0.000, name: 'Lamp Corkscrew In' },
    { s: 2.48, latOffset: 0.0035, name: 'Lamp Corkscrew Apex' },
    { s: 2.78, latOffset: -0.0030, name: 'Lamp Exit Ramp' },
    { s: 3.08, latOffset: 0.000, name: 'Mousepad C-Curve' },
    { s: 3.38, latOffset: 0.0030, name: 'G915 Viaduct Straight' },
  ];

  // Helper to sample track position and orientation at arc-length s
  function sampleTrackAt(s) {
    const sWrapped = ((s % totalLength) + totalLength) % totalLength;
    const N = samples.length;
    const u = (sWrapped / totalLength) * N;
    const i0 = Math.floor(u) % N;
    const i1 = (i0 + 1) % N;
    const alpha = u - Math.floor(u);

    const s0 = samples[i0];
    const s1 = samples[i1];

    const p0 = new THREE.Vector3().fromArray(s0.position);
    const p1 = new THREE.Vector3().fromArray(s1.position);
    const position = new THREE.Vector3().lerpVectors(p0, p1, alpha);

    const t0 = new THREE.Vector3().fromArray(s0.tangent);
    const t1 = new THREE.Vector3().fromArray(s1.tangent);
    const tangent = new THREE.Vector3().lerpVectors(t0, t1, alpha).normalize();

    const n0 = new THREE.Vector3().fromArray(s0.normal);
    const n1 = new THREE.Vector3().fromArray(s1.normal);
    const normal = new THREE.Vector3().lerpVectors(n0, n1, alpha).normalize();

    const right = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    return { position, tangent, normal, right };
  }

  // Shared Materials & Geometries for high-performance rendering
  const canisterRedMat = new THREE.MeshStandardMaterial({
    color: 0xee2c1b,
    roughness: 0.28,
    metalness: 0.45,
    emissive: 0x550a00,
    emissiveIntensity: 0.6,
  });

  const canisterEmissiveBandMat = new THREE.MeshStandardMaterial({
    color: 0xffaa00,
    emissive: 0xff8800,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.1,
  });

  const metalCapMat = new THREE.MeshStandardMaterial({
    color: 0xdde6ed,
    roughness: 0.15,
    metalness: 0.88,
  });

  const auraMat = new THREE.MeshBasicMaterial({
    color: 0xff9900,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Reusable Geometries
  const bodyGeo = new THREE.BoxGeometry(0.0054, 0.0076, 0.0036);
  const handleBarGeo = new THREE.CylinderGeometry(0.00035, 0.00035, 0.0038, 8);
  const neckGeo = new THREE.CylinderGeometry(0.00065, 0.00075, 0.0016, 8);
  const bandGeo = new THREE.BoxGeometry(0.0055, 0.0012, 0.0037);
  const stampBarGeo = new THREE.CylinderGeometry(0.00022, 0.00022, 0.0058, 6);
  const auraGeo = new THREE.RingGeometry(0.0028, 0.0068, 24);

  // Build a single 3D Fuel Canister Model Group
  function createCanisterMesh() {
    const group = new THREE.Group();

    // Main red body
    const bodyMesh = new THREE.Mesh(bodyGeo, canisterRedMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Glowing neon fuel band across middle
    const bandMesh = new THREE.Mesh(bandGeo, canisterEmissiveBandMat);
    group.add(bandMesh);

    // Stamped X pattern on both sides
    const xAngle = Math.PI / 4;
    const xOffsets = [-0.0019, 0.0019];
    for (const zOff of xOffsets) {
      const b1 = new THREE.Mesh(stampBarGeo, canisterRedMat);
      b1.rotation.z = xAngle;
      b1.position.set(0, 0, zOff);
      group.add(b1);

      const b2 = new THREE.Mesh(stampBarGeo, canisterRedMat);
      b2.rotation.z = -xAngle;
      b2.position.set(0, 0, zOff);
      group.add(b2);
    }

    // Top Handle Bars (triple-bar vintage jerrycan handle)
    for (const zH of [-0.0009, 0.0, 0.0009]) {
      const handle = new THREE.Mesh(handleBarGeo, canisterRedMat);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0, 0.0044, zH);
      group.add(handle);
    }

    // Spout Neck & Cap
    const neck = new THREE.Mesh(neckGeo, metalCapMat);
    neck.position.set(0.0016, 0.0044, 0);
    neck.rotation.z = -0.32;
    group.add(neck);

    return group;
  }

  // Create Canister Entities
  const canisters = [];

  for (let i = 0; i < CANISTER_CONFIGS.length; i++) {
    const cfg = CANISTER_CONFIGS[i];
    const frame = sampleTrackAt(cfg.s);

    const anchorPos = frame.position
      .clone()
      .addScaledVector(frame.right, cfg.latOffset)
      .addScaledVector(frame.normal, 0.0004); // surface ground level

    // Ground aura ring lying flat on the road surface
    const auraMesh = new THREE.Mesh(auraGeo, auraMat.clone());
    auraMesh.position.copy(anchorPos).addScaledVector(frame.normal, 0.0003);
    // Align aura with roadbed normal
    auraMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), frame.normal);
    rootGroup.add(auraMesh);

    // Hovering Canister Container
    const canisterPivot = new THREE.Group();
    const hoverBaseY = anchorPos.clone().addScaledVector(frame.normal, 0.0052);
    canisterPivot.position.copy(hoverBaseY);
    canisterPivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), frame.normal);

    const modelGroup = createCanisterMesh();
    canisterPivot.add(modelGroup);
    rootGroup.add(canisterPivot);

    canisters.push({
      id: i,
      name: cfg.name,
      s: cfg.s,
      latOffset: cfg.latOffset,
      anchorPos,
      hoverBasePos: hoverBaseY,
      normal: frame.normal.clone(),
      canisterPivot,
      modelGroup,
      auraMesh,
      active: true,
      respawnTimer: 0.0,
      scalePopTimer: 0.0,
      baseScale: 1.0,
      worldPos: new THREE.Vector3(),
    });
  }

  // ---------------------------------------------------------------------------
  // PARTICLE SYSTEM FOR PICKUP SPARK BURSTS
  // ---------------------------------------------------------------------------
  const MAX_PARTICLES = 160;
  const pPositions = new Float32Array(MAX_PARTICLES * 3);
  const pColors = new Float32Array(MAX_PARTICLES * 3);
  const pSizes = new Float32Array(MAX_PARTICLES);
  const pVelocities = [];
  const pAges = new Float32Array(MAX_PARTICLES);
  const pMaxAges = new Float32Array(MAX_PARTICLES);

  for (let i = 0; i < MAX_PARTICLES; i++) {
    pPositions[i * 3 + 1] = -100.0;
    pVelocities.push(new THREE.Vector3());
    pAges[i] = 999.0;
    pMaxAges[i] = 1.0;
    pSizes[i] = 0.0;
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pColors, 3));

  // Circular spark texture
  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.width = 64;
  sparkCanvas.height = 64;
  const sCtx = sparkCanvas.getContext('2d');
  const grad = sCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.35, 'rgba(255, 180, 40, 0.95)');
  grad.addColorStop(0.70, 'rgba(255, 60, 10, 0.65)');
  grad.addColorStop(1.0, 'rgba(255, 40, 0, 0.0)');
  sCtx.fillStyle = grad;
  sCtx.fillRect(0, 0, 64, 64);
  const sparkTex = new THREE.CanvasTexture(sparkCanvas);

  const pMat = new THREE.PointsMaterial({
    size: 0.0042,
    map: sparkTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const particlePoints = new THREE.Points(pGeo, pMat);
  particlePoints.frustumCulled = false;
  rootGroup.add(particlePoints);

  let nextParticleIdx = 0;

  function spawnPickupSparks(centerPos, count = 24) {
    for (let c = 0; c < count; c++) {
      const idx = nextParticleIdx % MAX_PARTICLES;
      nextParticleIdx++;

      pPositions[idx * 3 + 0] = centerPos.x;
      pPositions[idx * 3 + 1] = centerPos.y;
      pPositions[idx * 3 + 2] = centerPos.z;

      // Spherical outward velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 0.045 + Math.random() * 0.075;

      pVelocities[idx].set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed + 0.035, // slight upward bias
        Math.sin(phi) * Math.sin(theta) * speed
      );

      pAges[idx] = 0.0;
      pMaxAges[idx] = 0.45 + Math.random() * 0.35;

      // High-octane nitro flame colors (white -> gold -> fiery ruby red)
      const isCore = Math.random() > 0.4;
      pColors[idx * 3 + 0] = 1.0;
      pColors[idx * 3 + 1] = isCore ? 0.85 + Math.random() * 0.15 : 0.45 + Math.random() * 0.3;
      pColors[idx * 3 + 2] = isCore ? 0.35 + Math.random() * 0.4 : 0.05;
    }
  }

  // Event Listeners
  let onFuelCollectCallback = null;
  let onScoreChangeCallback = null;

  function collectCanister(can, kartSpeed) {
    if (!can.active) return;
    can.active = false;
    can.scalePopTimer = 0.22;
    can.respawnTimer = 10.0; // Respawns after 10 seconds

    fuelCollectedCount++;

    // Update combo
    comboTimer = COMBO_TIMEOUT;
    comboCount = Math.min(5, comboCount + 1);

    // Score calculation
    const basePoints = 250;
    const comboBonus = (comboCount - 1) * 150;
    const speedBonus = Math.round(Math.max(0, kartSpeed * 800));
    const gained = basePoints + comboBonus + speedBonus;
    currentScore += gained;

    // Trigger visual particles
    spawnPickupSparks(can.worldPos, 26);

    if (onFuelCollectCallback) {
      onFuelCollectCallback({
        canister: can,
        pointsGained: gained,
        totalScore: currentScore,
        combo: comboCount,
        fuelCount: fuelCollectedCount,
      });
    }

    if (onScoreChangeCallback) {
      onScoreChangeCallback(currentScore, gained, comboCount);
    }
  }

  function resetAll() {
    currentScore = 0;
    comboCount = 0;
    comboTimer = 0.0;
    fuelCollectedCount = 0;
    speedBonusTimer = 0.0;

    for (const can of canisters) {
      can.active = true;
      can.respawnTimer = 0.0;
      can.scalePopTimer = 0.0;
      can.canisterPivot.visible = true;
      can.auraMesh.visible = true;
      can.modelGroup.scale.set(1, 1, 1);
    }

    if (onScoreChangeCallback) {
      onScoreChangeCallback(0, 0, 0);
    }
  }

  function respawnAllCanisters() {
    for (const can of canisters) {
      can.active = true;
      can.respawnTimer = 0.0;
      can.canisterPivot.visible = true;
      can.auraMesh.visible = true;
      can.modelGroup.scale.set(1, 1, 1);
    }
  }

  function addLapBonus(lapNum) {
    const lapBonus = 1000 * lapNum;
    currentScore += lapBonus;
    // Also respawn any collected canisters for the next exciting lap!
    respawnAllCanisters();

    if (onScoreChangeCallback) {
      onScoreChangeCallback(currentScore, lapBonus, comboCount);
    }
    return lapBonus;
  }

  // Update loop called every animation frame
  function update(dt, elapsedTime, kartPos, kartState) {
    const clampedDt = Math.min(dt, 0.05);

    // 1. Combo decay
    if (comboTimer > 0) {
      comboTimer -= clampedDt;
      if (comboTimer <= 0) {
        comboCount = 0;
      }
    }

    // 2. Continuous speed trickling score (rewards sustained high-velocity driving!)
    if (kartState && kartState.speed > 0.08 && !kartState.countdownLocked && !kartState.raceFinished) {
      speedBonusTimer += clampedDt;
      if (speedBonusTimer >= 0.25) {
        speedBonusTimer = 0.0;
        const tickPts = Math.round(kartState.speed * 12 * Math.max(1, comboCount));
        currentScore += tickPts;
        if (onScoreChangeCallback) {
          onScoreChangeCallback(currentScore, 0, comboCount);
        }
      }
    }

    // 3. Update canisters (hover, spin, collision, respawn)
    for (let i = 0; i < canisters.length; i++) {
      const can = canisters[i];

      // Handle Respawn
      if (!can.active) {
        if (can.scalePopTimer > 0) {
          can.scalePopTimer -= clampedDt;
          const popRatio = Math.max(0, can.scalePopTimer / 0.22);
          const s = (1.0 - popRatio) * 1.5;
          can.modelGroup.scale.setScalar(popRatio * 1.4);
          can.auraMesh.material.opacity = popRatio * 0.8;
          if (can.scalePopTimer <= 0) {
            can.canisterPivot.visible = false;
            can.auraMesh.visible = false;
          }
        }

        can.respawnTimer -= clampedDt;
        if (can.respawnTimer <= 0) {
          can.active = true;
          can.canisterPivot.visible = true;
          can.auraMesh.visible = true;
          can.modelGroup.scale.set(1, 1, 1);
          can.auraMesh.material.opacity = 0.72;
        }
        continue;
      }

      // Hover bobbing + 360° spin
      const bobOffset = Math.sin(elapsedTime * 3.6 + i * 0.65) * 0.0009;
      can.canisterPivot.position
        .copy(can.hoverBasePos)
        .addScaledVector(can.normal, bobOffset);

      can.modelGroup.rotation.y = elapsedTime * 2.4 + i * 1.1;

      // Pulsing aura ring on the roadbed
      const auraPulse = 1.0 + 0.16 * Math.sin(elapsedTime * 4.8 + i);
      can.auraMesh.scale.set(auraPulse, auraPulse, auraPulse);
      can.auraMesh.material.opacity = 0.55 + 0.25 * Math.sin(elapsedTime * 4.8 + i);

      // Cache world position
      can.canisterPivot.getWorldPosition(can.worldPos);

      // Collision Detection with kart
      if (kartPos) {
        const dist = can.worldPos.distanceTo(kartPos);
        // Collision threshold: 16mm (kart is ~18mm long, canister is ~7mm wide)
        if (dist < 0.0165) {
          collectCanister(can, kartState ? Math.abs(kartState.speed) : 0.2);
        }
      }
    }

    // 4. Update particle spark system
    let activeParticles = false;
    for (let p = 0; p < MAX_PARTICLES; p++) {
      if (pAges[p] < pMaxAges[p]) {
        activeParticles = true;
        pAges[p] += clampedDt;
        const life = 1.0 - pAges[p] / pMaxAges[p];

        pPositions[p * 3 + 0] += pVelocities[p].x * clampedDt;
        pPositions[p * 3 + 1] += pVelocities[p].y * clampedDt;
        pPositions[p * 3 + 2] += pVelocities[p].z * clampedDt;

        // Gravity + air friction
        pVelocities[p].multiplyScalar(Math.max(0.85, 1.0 - 2.8 * clampedDt));
        pVelocities[p].y -= 0.28 * clampedDt;
      } else {
        pPositions[p * 3 + 1] = -100.0;
      }
    }

    if (activeParticles) {
      pGeo.attributes.position.needsUpdate = true;
    }
  }

  return {
    rootGroup,
    canisters,
    update,
    resetAll,
    respawnAllCanisters,
    addLapBonus,
    getScore: () => currentScore,
    getCombo: () => comboCount,
    getFuelCount: () => fuelCollectedCount,
    onFuelCollect: (cb) => { onFuelCollectCallback = cb; },
    onScoreChange: (cb) => { onScoreChangeCallback = cb; },
    getActiveCanisterLocations: () =>
      canisters.filter((c) => c.active).map((c) => ({ x: c.worldPos.x, y: c.worldPos.y, z: c.worldPos.z })),
  };
}
