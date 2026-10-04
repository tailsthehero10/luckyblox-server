export function alignAvatarLayers(characterRoot, bodyRoot, accessoryRoot, bodyCenter) {
  characterRoot.add(bodyRoot, accessoryRoot);
  bodyRoot.position.set(-bodyCenter.x, -bodyCenter.y, -bodyCenter.z);
  accessoryRoot.position.copy(bodyRoot.position);
}
