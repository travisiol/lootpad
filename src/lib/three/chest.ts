import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GOLD_RGB, VIOLET, VIOLET_RGB, beamTexture, gem, glowPlane, gold, lacquer, radialGlowTexture, satin } from "@/lib/three/studio";

/*
  The chest, built from primitives: a lacquered body with gold bands and
  feet, a domed lid on a hinge at the back, a lock plate with a hasp that
  lifts with the lid, and inside — coins, a gem, and the light. `setOpen(t)`
  drives everything from one number: the lid angle, the interior light, the
  beam, and the gem that rises out.
*/

export const BODY = { w: 2.6, h: 1.28, d: 1.6 };
const LID_R = 0.78;
const LID_OPEN = -1.72; // radians, about the back hinge: just past upright, so the dome still shows

export type ChestRig = {
  group: THREE.Group;
  setOpen: (t: number) => void;
  tick: (time: number) => void;
};

function band(w: number, h: number, d: number, r: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), material);
}

export function buildChest(): ChestRig {
  const group = new THREE.Group();
  const goldMat = gold();
  const lacquerMat = lacquer();
  const satinMat = satin();

  // ── Body ──────────────────────────────────────────────────────────
  const body = new THREE.Mesh(new RoundedBoxGeometry(BODY.w, BODY.h, BODY.d, 6, 0.07), lacquerMat);
  body.position.y = BODY.h / 2;
  group.add(body);

  // Interior: a dark box seen through the opening, so the chest is not hollow.
  const inner = new THREE.Mesh(new THREE.BoxGeometry(BODY.w - 0.16, BODY.h - 0.1, BODY.d - 0.16), new THREE.MeshStandardMaterial({ color: 0x120c22, roughness: 0.9, side: THREE.BackSide }));
  inner.position.y = BODY.h / 2 + 0.06;
  group.add(inner);

  // Gold bands: two vertical straps, the bottom and top rims, four feet.
  for (const x of [-0.78, 0.78]) {
    const strap = band(0.15, BODY.h + 0.04, BODY.d + 0.05, 0.03, goldMat);
    strap.position.set(x, BODY.h / 2, 0);
    group.add(strap);
  }
  const bottomRim = band(BODY.w + 0.06, 0.11, BODY.d + 0.06, 0.03, goldMat);
  bottomRim.position.y = 0.055;
  group.add(bottomRim);
  const topRim = band(BODY.w + 0.06, 0.09, BODY.d + 0.06, 0.03, goldMat);
  topRim.position.y = BODY.h - 0.045;
  group.add(topRim);
  for (const x of [-1.15, 1.15]) {
    for (const z of [-0.62, 0.62]) {
      const foot = band(0.26, 0.14, 0.26, 0.04, goldMat);
      foot.position.set(x, -0.06, z);
      group.add(foot);
    }
  }

  // Lock plate on the front, keyhole cut as a dark disc and slot.
  const frontZ = BODY.d / 2;
  const plate = band(0.46, 0.5, 0.09, 0.04, goldMat);
  plate.position.set(0, BODY.h * 0.66, frontZ + 0.03);
  group.add(plate);
  const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 24), satinMat);
  hole.rotation.x = Math.PI / 2;
  hole.position.set(0, BODY.h * 0.66 + 0.06, frontZ + 0.085);
  group.add(hole);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.04), satinMat);
  slot.position.set(0, BODY.h * 0.66 - 0.05, frontZ + 0.085);
  group.add(slot);

  // ── Lid ───────────────────────────────────────────────────────────
  // Hinged at the back-top edge; everything inside is offset to the front.
  const lid = new THREE.Group();
  lid.position.set(0, BODY.h, -BODY.d / 2);
  group.add(lid);
  const zc = BODY.d / 2; // lid centre, in hinge space

  // The dome: a half cylinder along x, flat side down.
  const dome = new THREE.Mesh(new THREE.CylinderGeometry(LID_R, LID_R, BODY.w, 48, 1, false, 0, Math.PI), lacquerMat);
  dome.rotation.z = Math.PI / 2;
  dome.position.set(0, 0.02, zc);
  lid.add(dome);
  // Its underside, and a satin inner face that catches the interior light when open.
  const underside = new THREE.Mesh(new THREE.BoxGeometry(BODY.w, 0.08, BODY.d), lacquerMat);
  underside.position.set(0, 0.02, zc);
  lid.add(underside);
  const innerFace = new THREE.Mesh(new THREE.PlaneGeometry(BODY.w - 0.1, BODY.d - 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.7, metalness: 0.05 }));
  innerFace.rotation.x = Math.PI / 2;
  innerFace.position.set(0, -0.025, zc);
  lid.add(innerFace);

  // Gold straps over the dome, matching the body's, plus the two end caps' rims.
  for (const x of [-0.78, 0.78]) {
    const arc = new THREE.Mesh(new THREE.TorusGeometry(LID_R + 0.02, 0.05, 12, 48, Math.PI), goldMat);
    arc.rotation.y = Math.PI / 2;
    arc.position.set(x, 0.02, zc);
    lid.add(arc);
  }
  // Rims on the two end caps, so the dome reads as framed like the body.
  for (const x of [-BODY.w / 2 - 0.01, BODY.w / 2 + 0.01]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(LID_R + 0.01, 0.045, 12, 48, Math.PI), goldMat);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(x, 0.02, zc);
    lid.add(rim);
  }
  const lipFront = band(BODY.w + 0.06, 0.09, 0.09, 0.03, goldMat);
  lipFront.position.set(0, 0.02, zc * 2 - 0.02);
  lid.add(lipFront);
  const lipBack = band(BODY.w + 0.06, 0.09, 0.09, 0.03, goldMat);
  lipBack.position.set(0, 0.02, 0.03);
  lid.add(lipBack);
  const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, BODY.w - 0.4, 20), goldMat);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, 0.02, 0);
  lid.add(hinge);

  // The hasp: a small gold tongue hanging over the lock plate, part of the lid.
  const hasp = band(0.2, 0.26, 0.07, 0.03, goldMat);
  hasp.position.set(0, -0.12, zc * 2 + 0.06);
  lid.add(hasp);

  // ── Inside: coins, a gem, the light ───────────────────────────────
  const coinGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.035, 28);
  const coins = new THREE.Group();
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  // A mound: higher in the middle, spilling to the rim, so the pile shows
  // over the front wall from the camera's height.
  for (let i = 0; i < 34; i++) {
    const coin = new THREE.Mesh(coinGeo, goldMat);
    const x = (rand() - 0.5) * (BODY.w - 0.6);
    const z = (rand() - 0.5) * (BODY.d - 0.5);
    const mound = 1 - Math.min(1, Math.hypot(x / 1.1, z / 0.6));
    coin.position.set(x, BODY.h - 0.22 + mound * 0.34 + rand() * 0.06, z);
    coin.rotation.set((rand() - 0.5) * 0.6, rand() * Math.PI, (rand() - 0.5) * 0.6);
    coins.add(coin);
  }
  // A few standing on edge, the way a pile catches light.
  for (let i = 0; i < 6; i++) {
    const coin = new THREE.Mesh(coinGeo, goldMat);
    coin.position.set((rand() - 0.5) * 1.5, BODY.h - 0.02 + rand() * 0.08, (rand() - 0.5) * 0.8);
    coin.rotation.set(Math.PI / 2 + (rand() - 0.5) * 0.4, 0, rand() * Math.PI);
    coins.add(coin);
  }
  group.add(coins);

  const stone = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), gem());
  stone.position.set(0.1, BODY.h + 0.05, 0.05);
  group.add(stone);

  // The light inside: a violet point light and an additive pool on the coins.
  const inside = new THREE.PointLight(VIOLET, 0, 6, 2);
  inside.position.set(0, BODY.h + 0.35, 0);
  group.add(inside);
  const pool = glowPlane(radialGlowTexture(VIOLET_RGB, 0.5), 2.0);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, BODY.h + 0.02, 0);
  group.add(pool);
  const beam = glowPlane(beamTexture(VIOLET_RGB, 0.42), 1.7, 3.2);
  beam.position.set(0, BODY.h + 1.5, 0);
  group.add(beam);
  const gemHalo = glowPlane(radialGlowTexture("201, 178, 255", 0.8), 1.3);
  group.add(gemHalo);

  // Light spill on the floor: gold under the chest, always on.
  const floor = glowPlane(radialGlowTexture(GOLD_RGB, 0.32), 4.6);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.12, 0.2);
  group.add(floor);

  let openness = 0;
  const setOpen = (t: number) => {
    openness = Math.min(1, Math.max(0, t));
    lid.rotation.x = LID_OPEN * openness;
    inside.intensity = 16 * openness;
    (pool.material as THREE.MeshBasicMaterial).opacity = openness;
    (beam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, openness - 0.25) / 0.75;
    (gemHalo.material as THREE.MeshBasicMaterial).opacity = Math.max(0, openness - 0.4) / 0.6;
    const lift = Math.max(0, openness - 0.35) / 0.65;
    stone.position.y = BODY.h + 0.05 + lift * 1.1;
    stone.scale.setScalar(0.85 + 0.35 * lift);
  };
  setOpen(0);

  const tick = (time: number) => {
    stone.rotation.y = time * 0.9;
    stone.rotation.x = Math.sin(time * 0.7) * 0.25;
    const bob = Math.sin(time * 1.4) * 0.05 * openness;
    stone.position.y += bob - (stone.userData.bob ?? 0);
    stone.userData.bob = bob;
    gemHalo.position.copy(stone.position);
    gemHalo.position.z += 0.02;
    // Billboards: the beam and the gem halo face the camera on y.
    beam.quaternion.copy(group.getWorldQuaternion(new THREE.Quaternion()).invert());
    gemHalo.quaternion.copy(beam.quaternion);
  };

  return { group, setOpen, tick };
}
