import './site-navigation.js';

// Some standalone experiences re-render their body when their own settings
// change. Restore the shared navigation after that re-render without touching
// their scene state or form values.
function ensureNavigation() {
  if (document.querySelector('strgo-navigation')) return;
  const navigation = document.createElement('strgo-navigation');
  navigation.className = 'strgo-space-navigation';
  document.body.append(navigation);
}
ensureNavigation();
const observer = new MutationObserver(ensureNavigation);
observer.observe(document.body, { childList: true });
