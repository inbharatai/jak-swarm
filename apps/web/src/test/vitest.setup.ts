import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView. Several components (e.g. the JARVIS
// EventFeed "follow latest" effect) call it on mount; polyfill it so the
// effect doesn't throw under test.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (!('matchMedia' in window)) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}