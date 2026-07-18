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

const MERMAID_SELECTOR = 'pre[data-language="mermaid"]';

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

  const { default: mermaid } = await import('mermaid');

  const isDark = document.documentElement.dataset.theme === 'dark';
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default' });

  const containers: HTMLElement[] = [];

  blocks.forEach((pre, index) => {
    const code = pre.querySelector('code');
    if (!code) return;

    const source = extractMermaidSource(code);
    if (!source.trim()) return;

    const container = document.createElement('div');
    container.className = 'mermaid';
    container.dataset.mermaidIndex = String(index);
    container.textContent = source;

    // Replace the whole Expressive Code frame (chrome + copy button), not
    // just the <pre>, so the diagram fully takes over the block's spot.
    const wrapper = pre.closest<HTMLElement>('.expressive-code') ?? pre;
    wrapper.replaceWith(container);
    containers.push(container);
  });

  if (containers.length > 0) {
    await mermaid.run({ nodes: containers });
  }
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
