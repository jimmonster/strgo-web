import * as T from '../vendor/three.module.js';
import { box, ball, cylinder, group, rod, plant, material, random, label, mergeStatic } from './geometry.js';

export function createScene({ mobile = false } = {}) {
  const scene = new T.Scene(); scene.background = new T.Color('#e5e8dc');
  scene.fog = new T.Fog('#e5e8dc', 36, 70);
  scene.add(new T.HemisphereLight('#fff5df', '#989e7e', 2.0));
  const sun = new T.DirectionalLight('#fff0ce', 3.2); sun.position.set(-3, 11, -8); sun.target.position.set(0, 0, 2);
  sun.castShadow = true; sun.shadow.mapSize.setScalar(mobile ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 13, bottom: -13, near: .5, far: 38 });
  sun.shadow.normalBias = .035; sun.shadow.bias = -.0004; sun.shadow.radius = 3; scene.add(sun, sun.target);
  const fill = new T.DirectionalLight('#fff4e5', .85); fill.position.set(6, 7, 10); scene.add(fill);
  const room = group(scene); room.name = 'bedroom';
  box(room, [9.2, .28, 7.4], '#b79b7a', [0, -.19, 0]);
  const wood = ['#d7b994', '#dfc4a0', '#d6b38d', '#e1c8a6'];
  for (let row = 0; row < 18; row++) for (let col = 0; col < 5; col++) {
    const x = -4.36 + row * .51, z = -2.96 + col * 1.48;
    box(room, [.497, .055, 1.462], wood[(row + col * 3) % 4], [x, -.022, z]);
    for (let k = 0; k < 2; k++) box(room, [.009, .002, 1.22], '#b69a78', [x + .12 - k * .21, .007, z]);
  }
  // Open front and low right side make a readable architectural cutaway.
  box(room, [.18, 3.8, 7.4], '#e9e2d3', [-4.6, 1.86, 0]);
  box(room, [.2, .42, 7.4], '#efe6d8', [4.6, .17, 0]);
  box(room, [9.2, .14, .09], '#faf2e4', [0, .12, -3.56]);
  box(room, [.1, .14, 7.2], '#faf2e4', [-4.47, .12, 0]);
  // North wall is constructed around a real window and balcony opening.
  box(room, [9.2, .58, .18], '#efe8dc', [0, 3.49, -3.65]);
  box(room, [1.25, 3.22, .18], '#efe8dc', [-3.975, 1.6, -3.65]);
  box(room, [.7, 3.22, .18], '#efe8dc', [-.25, 1.6, -3.65]);
  box(room, [.7, 3.22, .18], '#efe8dc', [4.25, 1.6, -3.65]);
  box(room, [2.75, .92, .18], '#efe8dc', [-1.98, .45, -3.65]);
  const frame = '#a58a67';
  for (const x of [-3.36, -.6]) box(room, [.09, 2.35, .2], frame, [x, 2.05, -3.61]);
  for (const y of [.93, 3.2]) box(room, [2.86, .09, .23], frame, [-1.98, y, -3.61]);
  box(room, [.06, 2.2, .08], frame, [-1.98, 2.06, -3.62]);
  box(room, [2.95, .08, .4], '#f7f2e8', [-1.98, .91, -3.5]);
  for (const x of [.1, 3.9]) box(room, [.1, 3.2, .24], frame, [x, 1.6, -3.65]);
  box(room, [3.8, .09, .24], frame, [2, 3.17, -3.65]);
  // One open sliding panel leaves a clear route to the balcony.
  box(room, [.05, 3.08, .1], '#b7aa92', [3.17, 1.55, -3.71]);
  const glass = material('#d1ece4', { transparent: true, opacity: .10, roughness: .15, depthWrite: false });
  box(room, [.7, 3.02, .025], glass, [3.52, 1.55, -3.71]).castShadow = false;
  const curtain = material('#fff7e5', { roughness: 1, side: T.DoubleSide });
  for (const [start, count] of [[-.02, 5], [3.66, 5], [-3.42, 3]]) for (let i = 0; i < count; i++) {
    const drape = cylinder(room, .1, .13, 2.96, curtain, [start + i * .105, 1.72, -3.43]); drape.scale.z = .65; drape.castShadow = false;
  }
  rod(room, [-3.55, 3.27, -3.4], [4.03, 3.27, -3.4], .035, '#76674e');

  const bed = group(room, [-2.85, 0, .75]); bed.name = 'bed';
  box(bed, [2.62, .3, 3.5], '#aa7957', [0, .34, 0]);
  for (const x of [-1.08, 1.08]) for (const z of [-1.45, 1.45]) cylinder(bed, .065, .055, .35, '#805d40', [x, .17, z]);
  box(bed, [2.72, 1.14, .16], '#b08d6c', [0, .73, -1.79]);
  for (let i = 0; i < 13; i++) box(bed, [.055, .97, .025], '#c8aa84', [-1.2 + i * .2, .76, -1.69]);
  box(bed, [2.5, .31, 3.35], '#fff8e8', [0, .64, .02]);
  const duvet = box(bed, [2.57, .23, 2.38], '#eae5d2', [0, .88, .53]);
  for (let i = 0; i < 11; i++) box(bed, [.018, .015, 2.3], '#d9d3bd', [-1.12 + i * .22, 1.005, .53]);
  box(bed, [2.61, .075, .62], '#8d9d83', [0, 1.03, 1.12]);
  for (const x of [-.64, .64]) { const pillow = ball(bed, [.54, .13, .39], '#fffdf3', [x, .92, -1.06]); pillow.rotation.y = x * .1; }
  box(room, [.61, .61, .65], '#c5a780', [-4.02, .3, -1.18]);
  cylinder(room, .17, .2, .22, '#b5a184', [-4.02, .74, -1.18]);
  cylinder(room, .3, .19, .32, '#fff4d5', [-4.02, 1.03, -1.18]);
  box(room, [.4, .045, .28], '#758b80', [-4.02, .64, -.93]);

  const desk = group(room, [-1.42, 0, -2.84]); desk.name = 'computer-area';
  box(desk, [2.62, .12, 1.02], '#b5916b', [0, 1.19, 0]);
  for (const x of [-1.12, 1.12]) for (const z of [-.35, .35]) box(desk, [.065, 1.15, .065], '#d6c9b4', [x, .58, z]);
  box(desk, [.64, .07, .39], '#626a63', [0, 1.29, -.12]);
  box(desk, [.075, .35, .08], '#636960', [0, 1.48, -.23]);
  const monitor = box(desk, [1.23, .74, .07], '#343d39', [0, 1.86, -.22]); monitor.name = 'computer';
  box(desk, [1.12, .63, .012], '#213d3b', [0, 1.87, -.177], { emissive: '#2c5650', emissiveIntensity: .35 });
  box(desk, [.6, .035, .015], '#a8c4b7', [-.17, 2.04, -.167]);
  for (let i = 0; i < 5; i++) box(desk, [.35 + (i % 3) * .17, .014, .015], ['#b6bc8d', '#81aaa2', '#779c9b'][i % 3], [-.19, 1.93 - i * .065, -.166]);
  box(desk, [.82, .038, .28], '#e2e0cd', [-.05, 1.281, .28]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) box(desk, [.047, .012, .05], '#b8bbaa', [-.4 + c * .063, 1.305, .21 + r * .066]);
  ball(desk, [.08, .026, .12], '#d6d7c5', [.65, 1.28, .28]);
  cylinder(desk, .1, .09, .18, '#ede5cd', [.96, 1.34, .05]);
  plant(desk, [-1.02, 1.26, -.1], .57, '#d3c6ad');
  const chair = group(room, [-1.35, 0, -1.8]);
  cylinder(chair, .37, .37, .13, '#8b9b86', [0, .69, 0]);
  box(chair, [.73, .6, .12], '#8b9b86', [0, 1.01, .3]);
  for (const x of [-.25, .25]) for (const z of [-.23, .23]) rod(chair, [x, .62, z], [x * 1.4, .03, z * 1.4], .03, '#a78561');
  // Woven rug, a quiet reading corner and small domestic details.
  box(room, [3.5, .035, 3.05], '#dfd5ba', [1.12, .033, .72]);
  for (let i = 0; i < 28; i++) box(room, [.025, .004, 2.9], '#cabc99', [-.52 + i * .12, .054, .72]);
  const armchair = group(room, [3.13, 0, .05]); armchair.rotation.y = -.35;
  box(armchair, [1.02, .3, 1.0], '#b88c61', [0, .49, 0]);
  box(armchair, [1.05, .77, .25], '#d2b48a', [0, .93, -.42]);
  box(armchair, [.22, .54, 1.1], '#d2b48a', [-.54, .71, 0]); box(armchair, [.22, .54, 1.1], '#d2b48a', [.54, .71, 0]);
  box(armchair, [.84, .16, .85], '#e5d4b7', [0, .71, .05]);
  for (const x of [-.4, .4]) for (const z of [-.4, .4]) rod(armchair, [x, .4, z], [x * 1.15, .05, z], .04, '#826344');
  const table = group(room, [1.65, 0, 1.63]); cylinder(table, .63, .63, .08, '#a77e55', [0, .64, 0]);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; rod(table, [Math.sin(a) * .26, .6, Math.cos(a) * .26], [Math.sin(a) * .43, .03, Math.cos(a) * .43], .035, '#8a6645'); }
  box(table, [.43, .065, .32], '#8b9c8d', [.06, .71, 0]); cylinder(table, .09, .08, .15, '#f6ecd7', [-.3, .76, .1]);
  plant(room, [3.57, 0, -2.82], 1.35); plant(room, [3.95, 0, 2.63], .9, '#dfcdb0');
  box(room, [.08, .9, 1.2], '#a5845e', [-4.43, 2.42, .2]);
  box(room, [.02, .72, 1.02], '#e2d9ba', [-4.377, 2.42, .2]);
  for (let i = 0; i < 4; i++) ball(room, [.018, .11 + i * .04, .15], ['#819174', '#a99474', '#b9b596', '#929f86'][i], [-4.36, 2.21 + i * .12, -.1 + i * .17]);

  const balcony = group(scene, [2, 0, -4.8]); balcony.name = 'balcony';
  box(balcony, [4.4, .19, 2.3], '#c8bc9f', [0, -.12, 0]);
  for (let i = 0; i < 20; i++) box(balcony, [4.28, .035, .09], '#d6c5a5', [0, .002, -1.07 + i * .112]);
  for (let i = 0; i < 13; i++) rod(balcony, [-2.12 + i * .353, .06, -1.1], [-2.12 + i * .353, 1.05, -1.1], .019, '#667466');
  rod(balcony, [-2.17, 1.05, -1.1], [2.17, 1.05, -1.1], .042, '#7d876f');
  for (const x of [-2.16, 2.16]) { rod(balcony, [x, 1.05, -1.1], [x, 1.05, 1.1], .035, '#7d876f'); for (let i = 0; i < 6; i++) rod(balcony, [x, .02, -.9 + i * .4], [x, 1.05, -.9 + i * .4], .018, '#667466'); }
  plant(balcony, [-1.7, .04, -.68], .87, '#e0c79b'); plant(balcony, [1.75, .04, -.65], 1.0, '#b88b65');
  cylinder(balcony, .36, .36, .05, '#efe4cf', [.55, .72, 0]); rod(balcony, [.55, .02, 0], [.55, .7, 0], .035, '#6f7562');

  const garden = group(scene); garden.name = 'garden';
  box(garden, [19, .25, 8.5], '#9eae78', [0, -.42, -10.3]);
  box(garden, [19.2, .15, 8.7], '#bcb79b', [0, -.62, -10.3]);
  for (let i = 0; i < 7; i++) { const stone = cylinder(garden, .43, .44, .06, '#ded8c2', [1 + Math.sin(i * .7) * .6, -.25, -6.6 - i * 1.05]); stone.scale.z = .65; }
  const rand = random(56);
  for (let i = 0; i < 76; i++) {
    const x = (rand() - .5) * 17.8, z = -7.2 - rand() * 6.8;
    if (Math.abs(x - 1) < .9) continue;
    const height = .16 + rand() * .33;
    rod(garden, [x, -.25, z], [x, height, z], .012, '#5b7845');
    const color = ['#f5e5ad', '#d9907f', '#b1a0bc', '#f6efd7'][i % 4];
    for (let p = 0; p < 5; p++) ball(garden, [.07, .045, .07], color, [x + Math.sin(p * 1.257) * .065, height, z + Math.cos(p * 1.257) * .065]);
    ball(garden, [.04, .035, .04], '#d5a95e', [x, height + .025, z]);
  }
  for (const [x, z, s] of [[-6.6, -9, 1.4], [-4.8, -12.5, 1.1], [5.8, -11.2, 1.4], [8, -8, 1.0]]) {
    cylinder(garden, .1 * s, .17 * s, 2.6 * s, '#897353', [x, 1.05 * s, z]);
    for (let i = 0; i < 4; i++) ball(garden, [1.3 * s, 1.1 * s, 1.25 * s], ['#78955d', '#8da46b', '#9aad76'][i % 3], [x + Math.sin(i * 2) * .65, 2.6 * s + (i % 2) * .55, z + Math.cos(i * 2) * .5]);
  }
  for (let i = 0; i < 20; i++) { box(garden, [.1, .88, .12], '#e1dbc3', [-9 + i * .95, .02, -14.5]); }
  for (const y of [-.1, .36]) box(garden, [18.5, .09, .08], '#e1dbc3', [0, y, -14.5]);
  const ground = box(scene, [200, .1, 200], '#dce1ce', [0, -.79, 0]); ground.receiveShadow = true;
  label(desk, 'STAY CURIOUS _', [0, 1.88, -.155], .9, '#a8c8b2', '#213d3b');
  mergeStatic(scene);
  return {
    scene, title: '日光卧室', target: [0, .8, -2.1], camera: { theta: .54, phi: .94, radius: 20.4 },
    limits: { theta: [-.15, 1.12], phi: [.62, 1.22], radius: [14, 28] },
    views: { room: { target: [0, .8, -2.1], theta: .54, phi: .94, radius: 20.4 }, garden: { target: [.7, .8, -7], theta: .1, phi: 1.2, radius: 13.5 } },
    update() {}, inspect() { return { objects: ['bedroom', 'computer-area', 'computer', 'bed', 'balcony', 'garden'], sunlight: sun.position.toArray() }; }
  };
}
