import * as T from '../vendor/three.module.js';
import { box, ball, cylinder, group, rod, ring, mesh, shape, material, label, mergeStatic, batchDancers } from './geometry.js';
import { poseAt, footAt, DURATION, BPM, SECTIONS } from './choreography.js';

const DOWN = new T.Vector3(0, -1, 0);
function makeDancer(parent, index) {
  const palettes = ['#b5d5c7', '#ce704e', '#e8d6aa', '#8a9cb9', '#d7b6ca', '#92ada6', '#c8a46a', '#a19ac8'];
  const skins = ['#c48b67', '#9d644c', '#dfb08a', '#b97e5e', '#e0af8b', '#b57853', '#85543f', '#d0a07e'];
  const coat = palettes[index], skin = skins[index], dark = '#1d2632';
  const root = group(parent); root.name = `dancer-${index + 1}`;
  const hips = group(root); const torso = group(hips, [0, .04, 0]);
  ball(hips, [.29, .18, .18], dark, [0, .02, 0]);
  ball(torso, [.325, .35, .195], coat, [0, .34, 0]);
  box(torso, [.15, .49, .05], '#ede8d5', [0, .35, .19]);
  for (const side of [-1, 1]) {
    const lapel = box(torso, [.09, .37, .04], coat, [side * .105, .42, .218]); lapel.rotation.z = side * -.12;
  }
  cylinder(torso, .095, .11, .13, skin, [0, .72, 0]);
  const head = group(torso, [0, .94, 0]);
  ball(head, [.205, .255, .19], skin, [0, 0, 0]);
  ball(head, [.215, .14, .2], index % 3 === 1 ? '#3b2927' : '#252427', [0, .18, -.025]);
  ball(head, [.2, .2, .095], '#2b2527', [0, .05, -.14]);
  if (index % 3 === 0) ball(head, [.12, .12, .13], '#292529', [0, .22, -.16]);
  if (index % 3 === 2) { cylinder(head, .22, .22, .07, dark, [0, .21, 0]); const brim = ball(head, [.24, .025, .18], dark, [0, .19, .16]); brim.rotation.x = -.15; }
  for (const side of [-1, 1]) {
    ball(head, [.045, .075, .04], skin, [side * .2, -.015, 0]);
    ball(head, [.035, .025, .014], '#eee9dc', [side * .077, .015, .177]);
    ball(head, [.016, .019, .012], '#272d2c', [side * .077, .013, .19]);
    const brow = box(head, [.06, .014, .018], '#41322c', [side * .077, .067, .177]); brow.rotation.z = side * -.07;
  }
  ball(head, [.032, .044, .042], skin, [0, -.035, .193]);
  box(head, [.065, .013, .015], '#875448', [0, -.115, .168]);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const upper = group(torso, [side * .31, .59, 0]);
    ball(upper, [.145, .16, .145], coat, [0, -.035, 0]);
    cylinder(upper, .12, .095, .34, coat, [0, -.2, 0]);
    const elbow = group(upper, [0, -.38, 0]);
    ball(elbow, [.095, .1, .095], coat, [0, 0, 0]);
    cylinder(elbow, .087, .065, .32, coat, [0, -.16, 0]);
    cylinder(elbow, .072, .072, .06, '#e7e3d6', [0, -.31, 0]);
    ball(elbow, [.075, .105, .065], skin, [0, -.405, .015]);
    ball(elbow, [.035, .064, .04], skin, [side * -.055, -.38, .04]);
    arms.push({ upper, elbow });
    const thigh = group(hips, [side * .17, 0, 0]);
    cylinder(thigh, .14, .106, .49, dark, [0, -.26, 0]);
    const knee = group(thigh, [0, -.52, 0]);
    ball(knee, [.108, .11, .105], dark, [0, 0, 0]);
    cylinder(knee, .103, .074, .47, dark, [0, -.255, 0]);
    const ankle = group(knee, [0, -.52, 0]);
    box(ankle, [.16, .065, .18], '#eae7d8', [0, -.005, .025]);
    ball(ankle, [.12, .095, .235], '#f0ecdf', [0, -.035, .085]);
    box(ankle, [.235, .045, .4], '#a8aaa3', [0, -.105, .08]);
    box(ankle, [.11, .015, .065], coat, [0, .037, .14]);
    legs.push({ thigh, knee, ankle, side });
  }
  // Two-bone inverse kinematics, solved in the pelvis coordinate system.
  const hip = new T.Vector3(), target = new T.Vector3(), direction = new T.Vector3(), bend = new T.Vector3(), joint = new T.Vector3(), end = new T.Vector3();
  const lowerRotation = new T.Quaternion();
  function update(time) {
    const pose = poseAt(time, index); root.position.set(pose.x, pose.y, pose.z); root.rotation.y = pose.yaw;
    torso.rotation.set(pose.pitch, pose.twist, pose.lean); head.rotation.set(-pose.pitch * .4, -pose.twist * .45, -pose.lean * .4);
    arms.forEach(({ upper, elbow }, i) => { const [x, z, flex] = pose.arms[i]; upper.rotation.set(x, 0, z); elbow.rotation.x = flex; });
    legs.forEach(({ thigh, knee, ankle, side }) => {
      const foot = footAt(time, index, side), dx = foot[0] - pose.x, dz = foot[2] - pose.z;
      hip.set(side * .17, 0, 0);
      target.set(dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw), foot[1] - pose.y, dx * Math.sin(pose.yaw) + dz * Math.cos(pose.yaw));
      direction.copy(target).sub(hip); const distance = Math.min(1.034, Math.max(.2, direction.length())); direction.normalize();
      bend.set(0, 0, 1).addScaledVector(direction, -direction.z).normalize();
      joint.copy(hip).addScaledVector(direction, distance / 2).addScaledVector(bend, Math.sqrt(.52 ** 2 - (distance / 2) ** 2));
      end.copy(hip).addScaledVector(direction, distance);
      thigh.quaternion.setFromUnitVectors(DOWN, direction.copy(joint).sub(hip).normalize());
      lowerRotation.setFromUnitVectors(DOWN, direction.copy(end).sub(joint).normalize());
      knee.quaternion.copy(thigh.quaternion).invert().multiply(lowerRotation);
      ankle.quaternion.copy(lowerRotation).invert();
    });
  }
  return { root, arms, legs, torso, update };
}

export function createScene({ mobile = false } = {}) {
  const scene = new T.Scene(); scene.background = new T.Color('#0b101a'); scene.fog = new T.FogExp2('#0b101a', .018);
  scene.add(new T.HemisphereLight('#c8d6ec', '#1c172b', 1.5));
  const key = new T.DirectionalLight('#ffedd3', 2.9); key.position.set(0, 8, 6); key.castShadow = true;
  key.shadow.mapSize.setScalar(mobile ? 1024 : 2048); Object.assign(key.shadow.camera, { left: -8, right: 8, top: 6, bottom: -6, near: .5, far: 24 });
  key.shadow.normalBias = .025; key.shadow.bias = -.0003; scene.add(key);
  const rim = new T.DirectionalLight('#a5bfff', 2.4); rim.position.set(-4, 5, -5); scene.add(rim);
  const warm = new T.DirectionalLight('#e7ac94', 1.1); warm.position.set(7, 3, 2); scene.add(warm);
  box(scene, [14.8, .5, 8.2], '#1b2330', [0, -.25, -.25], { roughness: .38, metalness: .48 }).name = 'stage';
  box(scene, [14.95, .08, 8.35], '#444b52', [0, -.54, -.25]);
  box(scene, [13, .2, .72], '#202736', [0, -.47, 4.22]);
  box(scene, [11, .16, .67], '#252d39', [0, -.66, 4.88]);
  box(scene, [100, .2, 100], '#0a101b', [0, -.87, 0], { roughness: .68 });
  const led = material('#c8efdf', { emissive: '#9edac9', emissiveIntensity: 1.7 });
  for (const x of [-7.34, 7.34]) box(scene, [.035, .035, 8.1], led, [x, -.008, -.25]);
  for (const z of [-4.26, 3.81]) box(scene, [14.7, .035, .035], led, [0, -.008, z]);
  for (let i = 0; i < 9; i++) box(scene, [.018, .004, 7.7], '#353c4a', [-6.4 + i * 1.6, .003, -.25]);
  for (let i = 0; i < 5; i++) box(scene, [14.5, .004, .018], '#353c4a', [0, .003, -3.5 + i * 1.6]);
  const centerRing = ring(scene, 2.75, .015, '#92b5aa', [0, .003, -.4], { emissive: '#597b72', emissiveIntensity: .7 }); centerRing.rotation.x = -Math.PI / 2;
  // Architectural LED wall, framed by a visible stage truss.
  box(scene, [13.8, 4.9, .3], '#111b29', [0, 2.42, -4.18], { roughness: .5, metalness: .2 });
  const backBars = [];
  for (let i = 0; i < 33; i++) {
    const mat = material(['#719b97', '#7f86ac', '#af9e88'][i % 3], { emissive: ['#4d938c', '#5e669b', '#9c725b'][i % 3], emissiveIntensity: .65 });
    const bar = box(scene, [.07, 2.3, .03], mat, [-6.5 + i * .405, 2.35, -3.998]); backBars.push(bar);
  }
  const backdrop = group(scene, [0, 2.6, -3.94]);
  box(backdrop, [7.1, 1.63, .04], '#111b29', [0, 0, 0]);
  label(backdrop, 'AFTER HOURS', [0, .15, .027], 6.45, '#ebedde', '#111b29');
  label(backdrop, 'S T R G O   /   M O V E M E N T   0 1', [0, -.6, .03], 4.1, '#9cb9b1', '#111b29');
  for (const x of [-7.05, 7.05]) {
    for (const offset of [-.15, .15]) rod(scene, [x + offset, 0, -3.9], [x + offset, 6.3, -3.9], .04, '#495164');
    for (let i = 0; i < 9; i++) { rod(scene, [x - .15, i * .7, -3.9], [x + .15, (i + 1) * .7, -3.9], .025, '#495164'); rod(scene, [x + .15, i * .7, -3.9], [x - .15, (i + 1) * .7, -3.9], .025, '#495164'); }
  }
  for (const y of [6.0, 6.3]) rod(scene, [-7.2, y, -3.9], [7.2, y, -3.9], .04, '#495164');
  for (let i = 0; i < 20; i++) rod(scene, [-7 + i * .7, 6, -3.9], [-6.3 + i * .7, 6.3, -3.9], .025, '#495164');
  for (const x of [-6.55, 6.55]) for (let i = 0; i < 2; i++) {
    box(scene, [.66, .83, .61], '#111520', [x, .43 + i * .86, -3.15]);
    for (const y of [.31, .62]) { const cone = cylinder(scene, .2, .18, .03, '#29313c', [x, y + i * .86, -2.83]); cone.rotation.x = Math.PI / 2; }
  }
  const spots = [], beams = [];
  for (let i = 0; i < (mobile ? 4 : 6); i++) {
    const x = -5.9 + i * (mobile ? 3.93 : 2.36), color = ['#9ad9d2', '#aea9e5', '#e5bd93'][i % 3];
    const fixture = group(scene, [x, 5.85, -3.65]); fixture.rotation.x = .4;
    cylinder(fixture, .19, .25, .42, '#242c3a', [0, 0, 0]);
    const lens = cylinder(fixture, .18, .18, .02, color, [0, -.22, 0], { emissive: color, emissiveIntensity: 1.5 }); lens.castShadow = false;
    const spot = new T.SpotLight(color, 32, 18, .42, .8, 1.3); spot.position.set(x, 5.5, -3.4); spot.target.position.set(x * .65, 0, 1); scene.add(spot, spot.target); spots.push(spot);
    const beamMat = new T.MeshBasicMaterial({ color, transparent: true, opacity: .035, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide });
    const beam = mesh(scene, shape('ConeGeometry', [1.55, 6.8, 24, 1, true]), beamMat, [x, 2.65, -1.8]); beam.castShadow = beam.receiveShadow = false; beams.push(beam);
  }
  const dancers = Array.from({ length: 8 }, (_, i) => makeDancer(scene, i));
  mergeStatic(scene, new Set([...dancers.map(d => d.root), ...backBars, ...beams]));
  const updateInstances = batchDancers(scene, dancers);
  const v = new T.Vector3(), up = new T.Vector3(0, 1, 0);
  function update(time) {
    dancers.forEach(dancer => dancer.update(time));
    updateInstances();
    const pulse = .5 + .5 * Math.cos(time * Math.PI * 4);
    spots.forEach((spot, i) => {
      spot.target.position.set(Math.sin(time * .32 + i) * 3.9, .2, .3 + Math.cos(time * .23 + i) * 1.4);
      spot.intensity = 25 + pulse * 10;
      const beam = beams[i]; v.copy(spot.position).sub(spot.target.position); beam.position.copy(spot.target.position).addScaledVector(v, .5);
      beam.quaternion.setFromUnitVectors(up, v.normalize()); beam.material.opacity = .025 + pulse * .015;
    });
    backBars.forEach((bar, i) => { bar.scale.y = .55 + .3 * Math.sin(time * Math.PI + i * .3) + .15 * pulse; });
  }
  update(0);
  return {
    scene, title: '舞蹈舞台', duration: DURATION, bpm: BPM, sections: SECTIONS, dancers,
    target: [0, 1.45, -.6], camera: { theta: .13, phi: 1.18, radius: 20.6 },
    limits: { theta: [-.85, .85], phi: [.78, 1.38], radius: [15.5, 31] },
    update, inspect() { return { dancers: dancers.length, sectionCount: SECTIONS.length, duration: DURATION, bpm: BPM }; }
  };
}
