// Vitest setup: polyfill browser globals that jsdom lacks but that App.jsx's
// dependencies (e.g. @dnd-kit) touch at module load. Without these, importing
// any component out of App.jsx throws before a single test runs. All stubs are
// inert no-ops — they only need to exist, not behave.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof globalThis.matchMedia === "undefined") {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; }
  });
}

if (typeof globalThis.scrollTo === "undefined") {
  globalThis.scrollTo = () => {};
}
