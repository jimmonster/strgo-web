export const DURATION = 48;
export const BPM = 120;
export const SECTIONS = ['01 · GROOVE / 律动开场', '02 · RIPPLE / 交错呼应', '03 · TURN / 转身与重拍', '04 · TOGETHER / 齐舞终章'];
export const wrap = (t, period = DURATION) => ((t % period) + period) % period;
export const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const formations = [
  [[-4.5, .9], [-1.5, .9], [1.5, .9], [4.5, .9], [-4.5, -1.75], [-1.5, -1.75], [1.5, -1.75], [4.5, -1.75]],
  [[-4.8, .2], [-1.6, 1.25], [1.6, 1.25], [4.8, .2], [-4.8, -2.5], [-1.6, -1.5], [1.6, -1.5], [4.8, -2.5]],
  [[-4.5, 1.5], [-1.5, 1.5], [1.5, 1.5], [4.5, 1.5], [-4.5, -1.5], [-1.5, -1.5], [1.5, -1.5], [4.5, -1.5]],
  [[-4.9, .6], [-1.65, 1.2], [1.65, 1.2], [4.9, .6], [-4.6, -2.1], [-1.55, -1.65], [1.55, -1.65], [4.6, -2.1]]
];
export function formationAt(time, index) {
  const t = wrap(time), section = Math.floor(t / 12), local = t % 12;
  const previous = formations[(section + 3) % 4][index], next = formations[section][index];
  const blend = smooth(local / 3);
  return [mix(previous[0], next[0], blend), mix(previous[1], next[1], blend)];
}
function segmentPose(section, time, index) {
  const beat = time * 2, pulse = Math.sin(beat * TAU), half = Math.sin(beat * Math.PI);
  const ripple = Math.sin(beat * Math.PI - index * .43), leader = index === 1 || index === 2;
  const base = { lean: .07 * half, twist: .08 * half, pitch: .055 * pulse, yaw: .08 * half, bob: -.025 + .028 * Math.cos(beat * TAU), arms: [] };
  for (const side of [-1, 1]) {
    if (section === 0) base.arms.push([-.3 + .45 * half * side, side * (.3 + .22 * (1 + pulse)), -.65 - .4 * Math.cos(beat * Math.PI + side)]);
    if (section === 1) base.arms.push([-.5 - .5 * ripple * side, side * (1.1 + .72 * ripple * side), -.55 - .5 * Math.cos(beat * Math.PI - index * .43)]);
    if (section === 2) base.arms.push([-.6 + .52 * half * side, side * (.8 + .48 * Math.cos(beat * Math.PI)), -.9 - .5 * pulse * side]);
    if (section === 3) base.arms.push([-.7 + .42 * half * side, side * (1.55 + .6 * Math.sin(beat * Math.PI / 2)), -.45 - .4 * pulse]);
  }
  if (section === 1) { base.twist = ripple * .21; base.lean = ripple * .09; base.bob += leader ? .018 * pulse : 0; }
  if (section === 2) { base.yaw = .7 * Math.sin(beat * Math.PI / 4); base.twist = .25 * half; base.pitch = .12 + .11 * pulse; base.lean = .1 * half; }
  if (section === 3) { base.twist = .13 * half; base.lean = .09 * half; }
  return base;
}
export function poseAt(time, index) {
  const t = wrap(time), section = Math.floor(t / 12), local = t % 12;
  const current = segmentPose(section, t, index), previous = segmentPose((section + 3) % 4, t, index);
  const blend = smooth(local / .8), pose = {};
  for (const key of ['lean', 'twist', 'pitch', 'yaw', 'bob']) pose[key] = mix(previous[key], current[key], blend);
  pose.arms = current.arms.map((arm, i) => arm.map((value, j) => mix(previous.arms[i][j], value, blend)));
  const [x, z] = formationAt(time, index);
  pose.x = x + .085 * Math.sin(t * TAU); pose.z = z + .04 * Math.cos(t * TAU);
  pose.y = .99 + pose.bob; pose.section = section;
  return pose;
}
// A foot stays at its previous world-space landing throughout stance, then follows
// a smooth low arc to the next landing. Body movement therefore bends the knees.
export function footAt(time, index, side) {
  const cycle = wrap(time + (side > 0 ? .5 : 0), 1), landing = time - cycle;
  const point = t => {
    const pose = poseAt(t, index), localX = side * .215, localZ = .1 + .11 * Math.sin(t * Math.PI);
    return [pose.x + localX * Math.cos(pose.yaw) + localZ * Math.sin(pose.yaw), pose.z - localX * Math.sin(pose.yaw) + localZ * Math.cos(pose.yaw)];
  };
  const a = point(landing), b = point(landing + 1), u = Math.max(0, (cycle - .58) / .42), blend = smooth(u);
  return [mix(a[0], b[0], blend), .135 + Math.sin(u * Math.PI) * .16, mix(a[1], b[1], blend)];
}
