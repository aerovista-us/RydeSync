(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const input = args[0];
    const rawUrl = typeof input === 'string' ? input : input?.url || '';

    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.pathname === '/v1/echoverse/catalog' && response.ok) {
        const clone = response.clone();
        setTimeout(async () => {
          try {
            const body = await clone.json();
            window.__rydesyncCatalog = body;
            window.dispatchEvent(new CustomEvent('rydesync:catalog', { detail: body }));
          } catch {
            // The canonical app remains authoritative if catalog decoration fails.
          }
        }, 0);
      }
    } catch {
      // Preserve native fetch behavior for any URL shape we do not recognize.
    }

    return response;
  };

  import('/pwa.js').catch((error) => console.warn('[rydesync] PWA bootstrap failed', error));
})();
