import { Component } from '../core/Component.js';

export class SpacesSection extends Component {
  constructor(element, guard) {
    super(element, guard);
    const buttons = [...element.querySelectorAll('[data-space-filter]')];
    const cards = [...element.querySelectorAll('[data-space-categories]')];
    const status = element.querySelector('[data-space-status]');
    const applyFilter = button => {
      const category = button.dataset.spaceFilter;
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      let count = 0;
      cards.forEach(card => {
        card.hidden = category !== 'all' && !card.dataset.spaceCategories.split(' ').includes(category);
        if (!card.hidden) count++;
      });
      status.textContent = `${button.textContent} · ${count} 个空间`;
      // Filtering changes the position of the existing pinned gallery.
      window.ScrollTrigger?.refresh();
      window.dispatchEvent(new window.Event('resize'));
    };
    buttons.forEach(button => this.on(button, 'click', () => applyFilter(button)));
    element.querySelector('[data-space-filter-bar]').hidden = false;
  }
}
