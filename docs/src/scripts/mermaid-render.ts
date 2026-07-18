// Client-side Mermaid rendering for fenced ```mermaid code blocks.
//
// Starlight (via Expressive Code) renders a fenced ```mermaid block as
//   <pre data-language="mermaid"><code>...</code></pre>
// with syntax-highlighting markup around it (see docs/README.md / issue #123).
// Each source line is wrapped in its own `.ec-line > .code` div rather than
// being left as plain text, so `code.textContent` alone loses the newlines
// that separate Mermaid statements. We reconstruct the original source by
// reading each `.ec-line` in order and joining with '\n', then hand that
// source to `mermaid.run()` to render an SVG in place of the code block.
//
// Wired via the `components.Head` override (src/components/Head.astro) so it
// runs on every page. This site does not enable Astro's ClientRouter / View
// Transitions (each nav is a normal full page load), so the render pass runs
// on DOMContentLoaded (or immediately if the DOM is already parsed). It also
// listens for `astro:page-load` defensively, in case view transitions are
// enabled later — that event fires after the initial load *and* after every
// transition, so it would keep the diagrams rendering across client-side nav
// (see https://docs.astro.build/en/guides/view-transitions/#astropage-load).
//
// Mermaid bakes theme colors into the SVG at render time, so a diagram won't
// follow Starlight's light/dark toggle — which flips `data-theme` on <html>
// without a page reload — on its own. To fix that we stash each diagram's
// original source on the rendered wrapper (`data-mermaid-src`) and watch
// `data-theme` with a MutationObserver, re-rendering from the stashed source
// under the newly-active theme (issue #123 follow-up).

const MERMAID_SELECTOR = 'pre[data-language="mermaid"]';
// Rendered diagrams, tagged with their stashed source for theme re-renders.
const RENDERED_SELECTOR = '.mermaid[data-mermaid-src]';

type MermaidTheme = 'dark' | 'default';
type MermaidModule = (typeof import('mermaid'))['default'];

// The dynamic import is cached by the module system, but keep our own handle so
// re-renders never re-await the import machinery.
let mermaidPromise: Promise<MermaidModule> | null = null;
// The theme the diagrams are currently drawn in; guards redundant re-renders.
let renderedTheme: MermaidTheme | null = null;
// One observer per page; created lazily only once diagrams actually exist.
let themeObserver: MutationObserver | null = null;
let rerenderTimer: ReturnType<typeof setTimeout> | undefined;

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => mod.default);
  }
  return mermaidPromise;
}

function activeTheme(): MermaidTheme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}

/**
 * Reconstructs the original Mermaid source from an Expressive Code
 * highlighted <code> block. Falls back to plain textContent if the
 * expected per-line markup isn't present (e.g. a renderer change upstream).
 */
function extractMermaidSource(codeEl: Element): string {
  const lines = codeEl.querySelectorAll(':scope > .ec-line');
  if (lines.length === 0) {
    return codeEl.textContent ?? '';
  }
  return Array.from(lines)
    .map((line) => line.textContent ?? '')
    .join('\n');
}

async function renderMermaidDiagrams(): Promise<void> {
  const blocks = document.querySelectorAll<HTMLPreElement>(MERMAID_SELECTOR);
  if (blocks.length === 0) return;

  const mermaid = await loadMermaid();
  const theme = activeTheme();
  mermaid.initialize({ startOnLoad: false, theme });
  renderedTheme = theme;

  const containers: HTMLElement[] = [];

  blocks.forEach((pre, index) => {
    const code = pre.querySelector('code');
    if (!code) return;

    const source = extractMermaidSource(code);
    if (!source.trim()) return;

    const container = document.createElement('div');
    container.className = 'mermaid';
    container.dataset.mermaidIndex = String(index);
    // Stash the source: mermaid.run() replaces the node's content with SVG, so
    // the original text is gone afterwards and a theme re-render needs it back.
    container.dataset.mermaidSrc = source;
    container.textContent = source;

    // Replace the whole Expressive Code frame (chrome + copy button), not
    // just the <pre>, so the diagram fully takes over the block's spot.
    const wrapper = pre.closest<HTMLElement>('.expressive-code') ?? pre;
    wrapper.replaceWith(container);
    containers.push(container);
  });

  if (containers.length > 0) {
    await mermaid.run({ nodes: containers });
    observeThemeChanges();
  }
}

/**
 * Re-renders every already-rendered diagram from its stashed source under the
 * currently-active theme. No-ops when the theme hasn't actually changed or
 * when there are no diagrams on the page.
 */
async function rerenderForTheme(): Promise<void> {
  const containers = document.querySelectorAll<HTMLElement>(RENDERED_SELECTOR);
  if (containers.length === 0) return;

  const theme = activeTheme();
  if (theme === renderedTheme) return;

  const mermaid = await loadMermaid();
  mermaid.initialize({ startOnLoad: false, theme });
  renderedTheme = theme;

  const nodes: HTMLElement[] = [];
  containers.forEach((container) => {
    const source = container.dataset.mermaidSrc;
    if (!source) return;
    // mermaid.run() skips nodes carrying `data-processed`; clear it and restore
    // the source text so the node is re-rendered rather than left as-is.
    container.removeAttribute('data-processed');
    container.textContent = source;
    nodes.push(container);
  });

  if (nodes.length > 0) {
    await mermaid.run({ nodes });
  }
}

function observeThemeChanges(): void {
  if (themeObserver) return;

  themeObserver = new MutationObserver(() => {
    // Cheap guard first: ignore attribute mutations that didn't change theme.
    if (activeTheme() === renderedTheme) return;
    // Debounce: the toggle can flip related attributes in the same tick.
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      void rerenderForTheme();
    }, 50);
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}

function scheduleRender(): void {
  void renderMermaidDiagrams();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleRender);
} else {
  scheduleRender();
}

// Defensive: re-run if the site ever adopts Astro's ClientRouter / View
// Transitions, so client-side nav keeps rendering newly-swapped-in diagrams.
document.addEventListener('astro:page-load', scheduleRender);
