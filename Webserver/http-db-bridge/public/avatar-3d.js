import * as THREE from '/vendor/three/three.module.js';

const viewers = document.querySelectorAll('[data-avatar-3d]');

function colorForPart(name, colors) {
  const lower = name.toLowerCase();
  let key = 'torso';
  if (lower.includes('head')) key = 'head';
  else if (lower.includes('arm') || lower.includes('hand')) key = lower.startsWith('left') ? 'leftArm' : 'rightArm';
  else if (lower.includes('leg') || lower.includes('foot')) key = lower.startsWith('left') ? 'leftLeg' : 'rightLeg';
  return new THREE.Color(`rgb(${colors[key] || '163,162,165'})`);
}

function createViewer(element) {
  const canvas = element.querySelector('.lb-avatar-3d-canvas');
  const status = element.querySelector('.lb-avatar-3d-status');
  const controls = Array.from(element.querySelectorAll('[data-rig]'));
  const savedColors = JSON.parse(element.dataset.colors || '{}');
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(32, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  const target = new THREE.Vector3(0, 2.2, 0);
  let orbitYaw = 0.45;
  let orbitPitch = 0.12;
  let distance = 10;
  let character = null;
  let currentRequest = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x727987, 2.2));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
  keyLight.position.set(-4, 8, 6);
  keyLight.castShadow = true;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xd4e5ff, 1.0);
  fillLight.position.set(4, 3, -5);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 48),
    new THREE.MeshBasicMaterial({ color: 0x596273, transparent: true, opacity: 0.12 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  scene.add(floor);

  function updateCamera() {
    const horizontal = Math.cos(orbitPitch) * distance;
    camera.position.set(
      target.x + Math.sin(orbitYaw) * horizontal,
      target.y + Math.sin(orbitPitch) * distance,
      target.z + Math.cos(orbitYaw) * horizontal,
    );
    camera.lookAt(target);
  }
  updateCamera();

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);

  async function loadRig(rig) {
    const requestId = ++currentRequest;
    status.textContent = `Loading bundled ${rig} RBXM rig…`;
    try {
      const response = await fetch(`/api/avatar/rig/${encodeURIComponent(rig)}`, {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || `Server returned ${response.status}`);
      }
      if (requestId !== currentRequest) return;

      const nextCharacter = new THREE.Group();
      nextCharacter.rotation.y = Math.PI;
      let lowestPoint = 0;
      data.parts.forEach((part) => {
        const geometry = part.mesh && part.mesh.type === 'Head'
          ? new THREE.SphereGeometry(0.5, 28, 20)
          : new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z);
        if (part.mesh && part.mesh.type === 'Head') {
          geometry.scale(
            part.size.x * part.mesh.scale.x,
            part.size.y * part.mesh.scale.y,
            part.size.z * part.mesh.scale.z,
          );
        }

        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: colorForPart(part.name, savedColors),
            roughness: 0.78,
            metalness: 0,
          }),
        );
        mesh.name = part.name;
        mesh.position.set(part.position.x, part.position.y, part.position.z);
        const matrix = new THREE.Matrix4().set(
          part.rotation[0], part.rotation[1], part.rotation[2], 0,
          part.rotation[3], part.rotation[4], part.rotation[5], 0,
          part.rotation[6], part.rotation[7], part.rotation[8], 0,
          0, 0, 0, 1,
        );
        matrix.decompose(new THREE.Vector3(), mesh.quaternion, new THREE.Vector3());
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        nextCharacter.add(mesh);
        lowestPoint = Math.min(lowestPoint, part.position.y - part.size.y / 2);
      });

      nextCharacter.position.y = -lowestPoint;
      if (character) {
        scene.remove(character);
        character.traverse((object) => {
          if (object.isMesh) {
            object.geometry.dispose();
            object.material.dispose();
          }
        });
      }
      character = nextCharacter;
      scene.add(character);
      target.set(0, (character.position.y + 2.4) / 2, 0);
      distance = rig === 'R6' ? 9 : 10;
      updateCamera();
      element.classList.add('is-ready');
      element.dataset.rig = rig;
      controls.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.rig === rig));
      });
      status.textContent = `${rig} rig loaded from shared/content/avatar/${rig}.rbxm`;
    } catch (error) {
      if (requestId !== currentRequest) return;
      status.textContent = `3D preview unavailable: ${error.message}`;
    }
  }

  controls.forEach((button) => {
    button.addEventListener('click', () => loadRig(button.dataset.rig));
  });

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    orbitYaw -= (event.clientX - lastX) * 0.008;
    orbitPitch = THREE.MathUtils.clamp(orbitPitch + (event.clientY - lastY) * 0.006, -0.55, 0.6);
    lastX = event.clientX;
    lastY = event.clientY;
    updateCamera();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.012, 6, 16);
    updateCamera();
  }, { passive: false });

  function render() {
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  render();
  loadRig(element.dataset.rig === 'R6' ? 'R6' : 'R15');
}

viewers.forEach((viewer) => {
  try {
    createViewer(viewer);
  } catch (error) {
    const status = viewer.querySelector('.lb-avatar-3d-status');
    if (status) status.textContent = `3D preview unavailable: ${error.message}`;
  }
});
