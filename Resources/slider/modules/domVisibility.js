export function isVisible(el) {
  if (!el) return false;
  if (el.classList?.contains("hide")) return false;
  const rect = el.getBoundingClientRect?.();
  return !!rect && rect.width >= 1 && rect.height >= 1;
}

export function waitForAnyVisible(selectors, { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const check = () => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          cleanup();
          resolve(el);
          return true;
        }
      }
      return false;
    };

    const observer = new MutationObserver(() => {
      check();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);

    function cleanup() {
      clearTimeout(timeoutId);
      observer.disconnect();
    }

    if (check()) return;
  });
}
