if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Online chat remains usable if offline shell support is unavailable.
    });
  });
}
