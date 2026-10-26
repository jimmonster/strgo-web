import './site-navigation.js';
if (!document.querySelector('strgo-navigation')) {
  const navigation = document.createElement('strgo-navigation');
  navigation.className = 'strgo-space-navigation';
  document.body.append(navigation);
}
