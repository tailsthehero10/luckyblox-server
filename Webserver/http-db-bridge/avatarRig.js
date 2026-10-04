'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RobloxFile } = require('rbxm-parser');

const AVATAR_ASSET_DIR = path.join(__dirname, '..', '..', 'shared', 'content', 'avatar');
const SUPPORTED_RIGS = new Set(['R6', 'R15']);
const rigCache = new Map();

function vector3(value, label) {
  if (!value || ![value.X, value.Y, value.Z].every(Number.isFinite)) {
    throw new Error(`RBXM rig contains an invalid ${label}`);
  }
  return { x: value.X, y: value.Y, z: value.Z };
}

function multiplyRotations(left, right) {
  const result = new Array(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) {
        result[row * 3 + column] += left[row * 3 + index] * right[index * 3 + column];
      }
      if (Math.abs(result[row * 3 + column]) < 1e-7) result[row * 3 + column] = 0;
      else if (Math.abs(Math.abs(result[row * 3 + column]) - 1) < 1e-6) {
        result[row * 3 + column] = Math.sign(result[row * 3 + column]);
      }
    }
  }
  return result;
}

function rotationTranspose(rotation) {
  return [
    rotation[0], rotation[3], rotation[6],
    rotation[1], rotation[4], rotation[7],
    rotation[2], rotation[5], rotation[8],
  ];
}

function transformPosition(rotation, position) {
  return {
    x: rotation[0] * position.X + rotation[1] * position.Y + rotation[2] * position.Z,
    y: rotation[3] * position.X + rotation[4] * position.Y + rotation[5] * position.Z,
    z: rotation[6] * position.X + rotation[7] * position.Y + rotation[8] * position.Z,
  };
}

function getRigGeometry(rig) {
  const rigName = String(rig || '').toUpperCase();
  if (!SUPPORTED_RIGS.has(rigName)) {
    throw new RangeError(`Unsupported avatar rig: ${rigName || '(empty)'}`);
  }
  if (rigCache.has(rigName)) return rigCache.get(rigName);

  const filePath = path.join(AVATAR_ASSET_DIR, `${rigName}.rbxm`);
  const model = RobloxFile.ReadFromBuffer(fs.readFileSync(filePath));
  if (!model || !Array.isArray(model.Roots) || !model.Roots.length) {
    throw new Error(`Could not parse the bundled ${rigName} RBXM rig`);
  }

  const descendants = [];
  const visit = (instance) => {
    if (instance.IsA('BasePart')) descendants.push(instance);
    instance.Children.forEach(visit);
  };
  model.Roots.forEach(visit);

  const rootPart = descendants.find((part) => part.Name === 'HumanoidRootPart');
  if (!rootPart || !descendants.length) {
    throw new Error(`Bundled ${rigName} RBXM has no HumanoidRootPart or body parts`);
  }
  const origin = rootPart.CFrame.Position;
  const rootRotation = rootPart.CFrame.Orientation;
  if (!Array.isArray(rootRotation) || rootRotation.length !== 9 || !rootRotation.every(Number.isFinite)) {
    throw new Error(`Bundled ${rigName} RBXM has an invalid HumanoidRootPart transform`);
  }
  const inverseRootRotation = rotationTranspose(rootRotation);

  const parts = descendants
    .filter((part) => part.Name !== 'HumanoidRootPart')
    .map((part) => {
      const position = part.CFrame.Position;
      const size = part.Size;
      const mesh = part.Children.find((child) => child.ClassName === 'SpecialMesh');
      const faceDecal = part.Children.find((child) => (
        child.ClassName === 'Decal'
        && child.Name.toLowerCase() === 'face'
        && child.Texture === 'rbxasset://textures/face.png'
      ));
      const rotation = part.CFrame.Orientation;
      const specialMeshType = mesh && mesh.MeshType && mesh.MeshType.Name
        ? mesh.MeshType.Name : null;
      if (!Array.isArray(rotation) || rotation.length !== 9 || !rotation.every(Number.isFinite)) {
        throw new Error(`RBXM part "${part.Name}" has an invalid transform`);
      }
      if (![size.X, size.Y, size.Z].every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
        throw new Error(`RBXM part "${part.Name}" has an invalid size`);
      }
      const relativePosition = transformPosition(inverseRootRotation, {
        X: position.X - origin.X,
        Y: position.Y - origin.Y,
        Z: position.Z - origin.Z,
      });
      return {
        name: part.Name,
        className: part.ClassName,
        shape: part.Shape && part.Shape.Name ? part.Shape.Name : null,
        meshGeometryIncluded: part.ClassName !== 'MeshPart' && !specialMeshType,
        size: vector3(size, `size for ${part.Name}`),
        position: relativePosition,
        rotation: multiplyRotations(inverseRootRotation, rotation),
        mesh: mesh ? {
          type: mesh.MeshType && mesh.MeshType.Name ? mesh.MeshType.Name : 'FileMesh',
          scale: vector3(mesh.Scale, `mesh scale for ${part.Name}`),
          offset: vector3(mesh.Offset, `mesh offset for ${part.Name}`),
        } : null,
        faceTexture: faceDecal ? '/Content/textures/face.png' : null,
        meshId: part.ClassName === 'MeshPart' ? String(part.MeshId || '') : null,
        textureId: part.ClassName === 'MeshPart' ? String(part.TextureID || '') : null,
      };
    });

  if (!parts.length) throw new Error(`Bundled ${rigName} RBXM contains no visible body parts`);
  const geometry = { rig: rigName, parts };
  rigCache.set(rigName, geometry);
  return geometry;
}

module.exports = { getRigGeometry };
