import * as THREE from '/vendor/three/three.module.js';
import { parseRobloxMesh } from './roblox-mesh.mjs';

const viewers = document.querySelectorAll('[data-avatar-viewer]');
if (viewers.length) {
  viewers.forEach((viewer) => {
    initializeViewer(viewer).catch((error) => {
      showStatus(viewer, `Could not render this RBXM avatar: ${error.message}`, true);
      clearLoading(viewer);
    });
  });
}

async function initializeViewer(viewer) {
  const portraitImage = viewer.querySelector('[data-avatar-portrait-image]');
  const canvas = viewer.querySelector('canvas') || document.createElement('canvas');
  const status = viewer.querySelector('[data-avatar-viewer-status]');
  const config = JSON.parse(viewer.dataset.avatarConfig || '{}');
  const rig = config.rig === 'R6' ? 'R6' : 'R15';
  const portrait = viewer.dataset.avatarMode === 'portrait';
  const savePortrait = portrait && viewer.dataset.savePortrait === 'true';
  showStatus(viewer, `Loading actual ${rig}.rbxm geometry…`, false);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x73717a, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-4, 7, -5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb5d8ff, 1.3);
  fillLight.position.set(5, 3, 5);
  scene.add(fillLight);

  const rotationPivot = new THREE.Group();
  const scaleRoot = new THREE.Group();
  const modelRoot = new THREE.Group();
  rotationPivot.add(scaleRoot);
  scaleRoot.add(modelRoot);
  scene.add(rotationPivot);

  const response = await fetch(`/api/avatar/rig/${rig}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`RBXM geometry request returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (!payload.ok || !Array.isArray(payload.parts) || payload.parts.length === 0) {
    throw new Error(payload.message || `The ${rig}.rbxm contains no renderable parts.`);
  }

  const missing = [];
  const results = await Promise.all(payload.parts.map(async (part) => {
    try {
      const geometry = await geometryForPart(part);
      const material = new THREE.MeshStandardMaterial({
        color: colorForPart(part.name, config.colors),
        roughness: 0.84,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.name;
      mesh.position.set(part.position.x, part.position.y, part.position.z);
      mesh.quaternion.setFromRotationMatrix(rotationMatrix(part.rotation));
      modelRoot.add(mesh);
      if (part.faceTexture) {
        const texture = await loadTexture(part.faceTexture);
        const faceMaterial = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          side: THREE.DoubleSide,
        });
        const face = new THREE.Mesh(geometry, faceMaterial);
        face.name = `${part.name} face decal`;
        face.position.copy(mesh.position);
        face.quaternion.copy(mesh.quaternion);
        modelRoot.add(face);
      }
      return true;
    } catch (error) {
      missing.push(`${part.name}: ${error.message}`);
      return false;
    }
  }));

  const renderedParts = results.filter(Boolean).length;
  if (!renderedParts) throw new Error(`No parts from ${rig}.rbxm could be rendered.`);

  const bounds = new THREE.Box3().setFromObject(modelRoot);
  const center = bounds.getCenter(new THREE.Vector3());
  const height = Math.max(0.1, bounds.max.y - bounds.min.y);
  modelRoot.position.set(-center.x, -center.y, -center.z);
  const scales = config.scales || {};
  scaleRoot.scale.set(clampScale(scales.width), clampScale(scales.height), clampScale(scales.depth));

  const headPart = payload.parts.find((part) => part.name === 'Head');
  const torsoPart = payload.parts.find((part) => part.name === 'UpperTorso')
    || payload.parts.find((part) => part.name === 'Torso');
  const portraitFrameHeight = headPart
    ? headPart.size.y * 1.19 + (torsoPart ? torsoPart.size.y * 0.9 : 0)
    : height * 0.5;
  const frameHeight = portrait ? portraitFrameHeight : height;
  const distance = (frameHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))))
    * (portrait ? 1.08 : 1.3);
  // View the supplied R15 face UV from its authored front without rotating its rig.
  const frontAzimuth = rig === 'R15' ? 0.8 : 0;
  const target = portrait && headPart
    ? new THREE.Vector3(0, headPart.position.y - center.y - headPart.size.y * 0.3, 0)
    : new THREE.Vector3(0, 0, 0);
  camera.position.set(
    target.x - distance * Math.sin(frontAzimuth),
    target.y + height * 0.08,
    target.z - distance * Math.cos(frontAzimuth),
  );
  camera.lookAt(target);
  const orbit = new THREE.Spherical().setFromVector3(camera.position);
  const updateOrbitCamera = () => {
    camera.position.setFromSpherical(orbit);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };

  const resize = () => {
    const width = Math.max(1, viewer.clientWidth);
    const size = Math.max(1, viewer.clientHeight);
    renderer.setSize(width, size, false);
    camera.aspect = width / size;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const resizeObserver = new ResizeObserver(resize);
  if (!portrait) resizeObserver.observe(viewer);

  if (!portrait) {
    let dragging = false;
    let activePointerId = null;
    let lastX = 0;
    let lastY = 0;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || dragging) return;
      event.preventDefault();
      dragging = true;
      activePointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!dragging || event.pointerId !== activePointerId) return;
      orbit.theta -= (event.clientX - lastX) * 0.01;
      orbit.phi = THREE.MathUtils.clamp(
        orbit.phi + (event.clientY - lastY) * 0.01,
        0.12,
        Math.PI - 0.12,
      );
      lastX = event.clientX;
      lastY = event.clientY;
      updateOrbitCamera();
    });
    const stopDragging = (event) => {
      if (event.pointerId !== activePointerId) return;
      dragging = false;
      activePointerId = null;
    };
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
    canvas.addEventListener('lostpointercapture', stopDragging);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      orbit.radius *= event.deltaY > 0 ? 1.08 : 0.92;
      updateOrbitCamera();
    }, { passive: false });
  }

  resize();
  if (portraitImage) {
    const imageData = canvas.toDataURL('image/png');
    portraitImage.src = imageData;
    if (savePortrait) {
      const response = await fetch('/api/avatar/thumbnail', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ image: imageData }),
      });
      if (!response.ok) {
        throw new Error(`Could not save the profile avatar image (HTTP ${response.status}).`);
      }
    }
  }
  viewer.classList.add('is-rendered');
  clearLoading(viewer);
  if (missing.length) {
    showStatus(viewer, `Rendered ${renderedParts}/${payload.parts.length} real ${rig}.rbxm parts. Missing mesh data: ${missing.join('; ')}`, true);
  } else {
    showStatus(viewer, portrait
      ? `Rendered ${renderedParts} real ${rig}.rbxm parts.`
      : `Rendered ${renderedParts} real ${rig}.rbxm parts. Drag to rotate; scroll to zoom.`, false);
  }
}

async function geometryForPart(part) {
  if (part.className === 'MeshPart') {
    const match = /[?&]id=(\d+)/i.exec(String(part.meshId || ''));
    if (!match) throw new Error('RBXM MeshId is missing.');
    const meshData = await fetchMesh(`/v1/assets/${match[1]}`);
    const geometry = geometryFromData(meshData);
    fitGeometryToPart(geometry, part.size);
    return geometry;
  }

  if (part.mesh && part.mesh.type === 'Head') {
    const meshData = await fetchMesh('/Content/avatar/heads/head.mesh');
    const geometry = geometryFromData(meshData);
    const scale = part.mesh.scale || { x: 1, y: 1, z: 1 };
    geometry.scale(scale.x, scale.y, scale.z);
    fitAvatarHead(geometry, part.size.y * 1.19);
    return geometry;
  }

  const { x, y, z } = part.size;
  if (part.shape === 'Ball') return new THREE.SphereGeometry(0.5, 32, 24).scale(x, y, z);
  if (part.shape === 'Cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 32).scale(x, y, z);
  if (part.shape && part.shape !== 'Block') throw new Error(`Unsupported RBXM Part shape "${part.shape}".`);
  return new THREE.BoxGeometry(x, y, z);
}

async function fetchMesh(url) {
  const response = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  if (!response.ok) {
    throw new Error(`Mesh source returned HTTP ${response.status}.`);
  }
  return parseRobloxMesh(await response.arrayBuffer());
}

async function loadTexture(url) {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function geometryFromData(data) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingBox();
  return geometry;
}

function fitGeometryToPart(geometry, size) {
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error('Mesh has no measurable bounds.');
  const center = bounds.getCenter(new THREE.Vector3());
  const dimensions = bounds.getSize(new THREE.Vector3());
  if (dimensions.x <= 0 || dimensions.y <= 0 || dimensions.z <= 0) {
    throw new Error('Mesh has zero-sized geometry.');
  }
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(size.x / dimensions.x, size.y / dimensions.y, size.z / dimensions.z);
  geometry.computeBoundingBox();
}

function fitAvatarHead(geometry, targetWidthAndHeight) {
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error('Mesh has no measurable bounds.');
  const center = bounds.getCenter(new THREE.Vector3());
  const dimensions = bounds.getSize(new THREE.Vector3());
  if (dimensions.x <= 0 || dimensions.y <= 0 || dimensions.z <= 0) {
    throw new Error('Mesh has zero-sized geometry.');
  }
  const uniformScale = targetWidthAndHeight / Math.max(dimensions.x, dimensions.y);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(uniformScale, uniformScale, uniformScale);
  geometry.computeBoundingBox();
}

function rotationMatrix(rotation) {
  if (!Array.isArray(rotation) || rotation.length !== 9 || !rotation.every(Number.isFinite)) {
    throw new Error('RBXM part has an invalid CFrame rotation.');
  }
  return new THREE.Matrix4().set(
    rotation[0], rotation[1], rotation[2], 0,
    rotation[3], rotation[4], rotation[5], 0,
    rotation[6], rotation[7], rotation[8], 0,
    0, 0, 0, 1,
  );
}

function colorForPart(name, colors) {
  const lower = String(name || '').toLowerCase();
  let key = 'torso';
  if (lower === 'head') key = 'head';
  else if (lower.includes('arm') || lower.includes('hand')) key = lower.startsWith('left') ? 'leftArm' : 'rightArm';
  else if (lower.includes('leg') || lower.includes('foot')) key = lower.startsWith('left') ? 'leftLeg' : 'rightLeg';
  const rgb = String((colors && colors[key]) || '163,162,165').split(',').map(Number);
  return new THREE.Color(`rgb(${rgb.join(',')})`);
}

function clampScale(value) {
  const number = Number(value);
  return Number.isFinite(number) ? THREE.MathUtils.clamp(number, 0.5, 1.5) : 1;
}

function showStatus(viewer, message, isError) {
  const status = viewer.querySelector('[data-avatar-viewer-status]');
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function clearLoading(viewer) {
  const loadingBlock = viewer.closest('.lb-loading-block');
  if (loadingBlock) loadingBlock.classList.remove('is-loading');
}
