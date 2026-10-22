import { Component } from '../core/Component.js';
import { seededRandom, tiltAt } from '../core/math.js';
export class BentoGridSection extends Component {
  constructor(element, guard, config) {
    super(element, guard);
    const grid = element.querySelector('.bento-grid'), cards = [...grid.querySelectorAll('.bento-card')];
    let frame = 0, pointer = null;
    const update = () => {
      frame = 0;
      if (!pointer || guard.mobile || guard.paused) return;
      // Read every rectangle before writing styles to avoid layout thrashing.
      const measurements = cards.map(card => ({ card, box: card.getBoundingClientRect() }));
      for (const { card, box } of measurements) {
        const x = pointer.x - box.left, y = pointer.y - box.top;
        card.style.setProperty('--card-mouse-x', `${x}px`); card.style.setProperty('--card-mouse-y', `${y}px`);
        if (pointer.target.closest('.bento-card') === card) {
          const angle = tiltAt(x, y, box.width, box.height);
          card.classList.add('is-tilting'); card.style.transform = `rotateX(${angle.x}deg) rotateY(${angle.y}deg)`;
        }
      }
    };
    this.on(grid, 'pointermove', event => { pointer = { x: event.clientX, y: event.clientY, target: event.target }; if (!guard.mobile && !guard.paused && !frame) frame = requestAnimationFrame(update); }, { passive: true });
    const reset = card => { card.classList.remove('is-tilting'); card.style.transform = ''; };
    cards.forEach(card => this.on(card, 'pointerleave', () => reset(card)));
    this.on(grid, 'pointerleave', () => { pointer = null; cancelAnimationFrame(frame); frame = 0; cards.forEach(reset); });
    this.own(guard.subscribe(() => { if (guard.mobile || guard.paused || document.hidden) { pointer = null; cancelAnimationFrame(frame); frame = 0; cards.forEach(reset); } }));
    this.own(() => cancelAnimationFrame(frame));
    this.mountHeatmap(config); this.mountMarquees(); this.mountCounters();
    this.own(guard.observe(element, visible => element.classList.toggle('animation-sleeping', !visible)));
    const clock = element.querySelector('[data-clock]');
    const timezone = config.timezone || 'Asia/Shanghai';
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const updateClock = () => { clock.textContent = formatter.format(new Date()); };
    updateClock();
    let timer = 0, visible = false;
    const syncClock = () => { clearInterval(timer); if (visible && !document.hidden) { updateClock(); timer = setInterval(updateClock, 1000); } };
    this.own(guard.observe(element.querySelector('.status-card'), state => { visible = state; syncClock(); }));
    this.on(document, 'visibilitychange', syncClock); this.own(() => clearInterval(timer));
    element.querySelector('[data-city]').textContent = config.city || (timezone === 'Asia/Shanghai' ? 'UTC+8' : timezone);
    const coordinates = element.querySelector('[data-coordinates]');
    if (coordinates) { coordinates.textContent = config.coordinates || ''; coordinates.hidden = !config.coordinates; }
  }
  mountHeatmap(config) {
    const grid = this.element.querySelector('.contribution-grid'), random = seededRandom(43);
    const supplied = Array.isArray(config.contributions) && config.contributions.length === 196;
    const values = supplied ? config.contributions : Array.from({ length: 196 }, () => { const n = random(); return n < .3 ? 0 : Math.floor(random() * 4) + 1; });
    const fragment = document.createDocumentFragment();
    values.forEach(value => { const cell = document.createElement('i'); cell.dataset.level = String(Math.min(4, Math.max(0, value))); fragment.append(cell); });
    grid.append(fragment);
    this.element.querySelector('[data-contribution-label]').textContent = supplied ? 'GitHub / 已配置快照' : '示例矩阵 · 非 GitHub 数据';
    grid.setAttribute('aria-label', supplied ? 'GitHub 贡献数据快照' : '演示贡献矩阵，未连接 GitHub');
    if (supplied) this.element.querySelector('[data-contribution-caption]').textContent = 'GITHUB CONTRIBUTION SNAPSHOT';
    let accumulated = 0, lastCell;
    this.own(this.guard.animationLoop(grid, (time, delta) => {
      accumulated += delta;
      if (accumulated < 1100) return;
      accumulated = 0; lastCell?.classList.remove('is-lit');
      lastCell = grid.children[Math.floor(random() * 196)]; lastCell.classList.add('is-lit');
    }));
    this.own(() => lastCell?.classList.remove('is-lit'));
  }
  mountMarquees() {
    const technologies = [
      [['TS', 'TypeScript', '#63b3ff'], ['⚛', 'React', '#61dafb'], ['N', 'Next.js', '#fff'], ['◈', 'Three.js', '#ba99ff'], ['JS', 'JavaScript', '#f7df1e']],
      [['Py', 'Python', '#ffcf65'], ['⬡', 'Node.js', '#78ca66'], ['◧', 'Docker', '#52acfc'], ['⌘', 'Git', '#ff896e'], ['≈', 'Tailwind', '#38bdf8']]
    ];
    this.element.querySelectorAll('[data-tech-row]').forEach((track, row) => {
      for (let repetition = 0; repetition < 2; repetition++) for (const [symbol, name, color] of technologies[row]) {
        const chip = document.createElement('span'); chip.className = 'tech-chip'; chip.style.setProperty('--brand', color);
        const icon = document.createElement('b'); icon.textContent = symbol; icon.setAttribute('aria-hidden', 'true'); chip.append(icon, name);
        if (repetition) chip.setAttribute('aria-hidden', 'true'); track.append(chip);
      }
      let distance = row ? track.scrollWidth / 2 : 0;
      this.own(this.guard.animationLoop(track, (time, delta) => {
        const half = track.scrollWidth / 2;
        if (!half) return;
        const slowed = track.closest('.tech-card').matches(':hover');
        distance = (distance + delta * (slowed ? .008 : .032)) % half;
        track.style.setProperty('--marquee-x', `${row ? distance - half : -distance}px`);
      }));
    });
    this.own(this.guard.observe(this.element.querySelector('.status-card'), visible => this.element.querySelector('.status-card').classList.toggle('animation-sleeping', !visible)));
  }
  mountCounters() {
    const card = this.element.querySelector('.metric-card'), counters = [...card.querySelectorAll('[data-count]')];
    let elapsed = 0, complete = false;
    const finish = () => { counters.forEach(counter => { counter.textContent = Number(counter.dataset.count).toFixed(Number(counter.dataset.decimals)); }); complete = true; };
    let stop = () => {};
    stop = this.guard.animationLoop(card, (time, delta) => {
      if (complete) return;
      elapsed += delta;
      const progress = Math.min(1, elapsed / 1200), eased = 1 - (1 - progress) ** 4;
      counters.forEach(counter => { counter.textContent = (Number(counter.dataset.count) * eased).toFixed(Number(counter.dataset.decimals)); });
      if (progress === 1) { finish(); stop(); }
    }, { pauseCSS: true });
    this.own(stop);
    this.own(this.guard.subscribe(() => { if (this.guard.paused) { finish(); stop(); } }));
  }
}
