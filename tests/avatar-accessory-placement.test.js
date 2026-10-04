'use strict';

const assert = require('node:assert/strict');
const THREE = require('../Webserver/http-db-bridge/node_modules/three');
const { getRigGeometry } = require('../Webserver/http-db-bridge/avatarRig');

(async () => {
  const { alignAvatarLayers } = await import(
    '../Webserver/http-db-bridge/public/js/avatar-accessory-placement.mjs'
  );

  for (const rig of ['R6', 'R15']) {
    const parts = getRigGeometry(rig).parts;
    for (const attachmentName of ['HatAttachment', 'HairAttachment']) {
      const head = parts.find((part) => part.name === 'Head');
      assert.ok(
        head.attachments.some((attachment) => attachment.name === attachmentName),
        `${rig} Head must provide ${attachmentName} for matching accessory models`,
      );
    }
  }

  const characterRoot = new THREE.Group();
  characterRoot.scale.setScalar(2);
  const bodyRoot = new THREE.Group();
  const accessoryRoot = new THREE.Group();
  const bodyCenter = new THREE.Vector3(0, 2, 0);
  alignAvatarLayers(characterRoot, bodyRoot, accessoryRoot, bodyCenter);

  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  body.position.y = 3;
  bodyRoot.add(body);
  characterRoot.updateMatrixWorld(true);

  const bodyAttachment = new THREE.Vector3(0, 0.5, 0).applyMatrix4(body.matrixWorld);
  const handlePosition = bodyAttachment.clone()
    .applyMatrix4(accessoryRoot.matrixWorld.clone().invert());
  const accessory = new THREE.Object3D();
  accessory.position.copy(handlePosition);
  accessoryRoot.add(accessory);
  characterRoot.updateMatrixWorld(true);

  const placedHandlePosition = accessory.getWorldPosition(new THREE.Vector3());
  const placedAccessoryScale = accessory.getWorldScale(new THREE.Vector3());
  assert.ok(placedHandlePosition.distanceTo(bodyAttachment) < 1e-6,
    'the accessory handle attachment must coincide with the rig attachment');
  assert.deepEqual(placedAccessoryScale.toArray(), [2, 2, 2],
    'the accessory mesh must inherit the same fit scale as the avatar rig');

  console.log('ok: R6/R15 accessory attachments align in the fitted avatar coordinate space');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
