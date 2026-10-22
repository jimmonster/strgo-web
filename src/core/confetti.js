import { seededRandom } from './math.js';
export function emitConfetti(button, guard) {
  if (guard.paused || document.hidden) return () => {};
  const box = button.getBoundingClientRect();
  const origin = { x: (box.left + box.width / 2) / innerWidth, y: (box.top + box.height / 2) / innerHeight };
  if (window.confetti) {
    window.confetti({ particleCount: guard.mobile ? 55 : 110, spread: 100, startVelocity: 34, gravity: .85, origin, colors: ['#7928ca', '#00dfd8', '#ffffff'], disableForReducedMotion: true, zIndex: 105 });
    return () => window.confetti.reset();
  }
  const canvas = document.createElement('canvas'); canvas.className = 'confetti-canvas'; canvas.setAttribute('aria-hidden', 'true'); document.body.append(canvas);
  const context = canvas.getContext('2d');
  if (!context) { canvas.remove(); return () => {}; }
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; context.scale(dpr, dpr);
  const random = seededRandom(Date.now());
  const particles = Array.from({ length: guard.mobile ? 50 : 100 }, () => {
    const angle = -Math.PI / 2 + (random() - .5) * Math.PI * .9, speed = 4 + random() * 9;
    return { x: origin.x * innerWidth, y: origin.y * innerHeight, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color: ['#7928ca', '#00dfd8', '#ffffff'][Math.floor(random() * 3)], size: 2 + random() * 3 };
  });
  let frame = 0, start = 0, previous = 0;
  const dispose = () => { cancelAnimationFrame(frame); canvas.remove(); document.removeEventListener('visibilitychange', visibility); };
  const visibility = () => { if (document.hidden) dispose(); };
  document.addEventListener('visibilitychange', visibility);
  const animate = time => {
    if (!start) start = previous = time;
    if (time - start > 1800 || guard.paused) { dispose(); return; }
    const delta = Math.min(2, (time - previous) / 16.67); previous = time;
    context.clearRect(0, 0, innerWidth, innerHeight);
    context.globalAlpha = Math.max(0, 1 - (time - start) / 1800);
    for (const particle of particles) {
      particle.x += particle.vx * delta; particle.y += particle.vy * delta; particle.vy += .22 * delta; particle.vx *= .99;
      context.fillStyle = context.shadowColor = particle.color; context.shadowBlur = guard.mobile ? 0 : 8;
      context.beginPath(); context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); context.fill();
    }
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  return dispose;
}
