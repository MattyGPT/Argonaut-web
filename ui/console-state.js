// Presentation state lives in the DOM, outside the saved simulation. Reconcile
// controls instead of replacing them so native focus, pending edits, and details
// expansion survive the frequent live render (including a change of conn).
const controlKey = (node) => {
  if (node.nodeType !== 1) return null;
  const names = ['id', 'data-console-key', 'data-command', 'data-stance',
    'data-facing-turn', 'data-arc-focus', 'data-power-sink'];
  const name = names.find((attr) => node.hasAttribute(attr));
  return name ? `${name}:${node.getAttribute(name)}:${node.getAttribute('data-power-delta') ?? ''}` : null;
};

const wired = new WeakSet();
const preferenceKey = 'argonaut-web-console-sections';
const restoreSections = (root) => {
  let preferences = {};
  try { preferences = JSON.parse(localStorage.getItem(preferenceKey)) ?? {}; } catch { /* Private browsing may refuse storage. */ }
  for (const section of root.querySelectorAll('details[data-console-key]')) {
    if (!section.dataset.preferenceRestored) {
      section.open = preferences[section.dataset.consoleKey] === true;
      section.dataset.preferenceRestored = 'true';
    }
  }
  if (wired.has(root)) return;
  wired.add(root);
  root.addEventListener('toggle', (event) => {
    const section = event.target;
    if (!section.matches?.('details[data-console-key]')) return;
    preferences[section.dataset.consoleKey] = section.open;
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* The live DOM still retains expansion. */ }
  }, true);
};

const syncNode = (current, next) => {
  if (current.nodeType !== 1) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attr of [...current.attributes]) {
    if (current.tagName === 'DETAILS' && attr.name === 'open') continue;
    if (attr.name === 'data-preference-restored') continue;
    if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  }
  for (const attr of next.attributes) {
    if (current.tagName === 'DETAILS' && attr.name === 'open') continue;
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  syncChildren(current, next);
};

const syncChildren = (current, next) => {
  const available = [...current.childNodes];
  for (const wanted of [...next.childNodes]) {
    const key = controlKey(wanted);
    const match = available.find((node) => node.nodeType === wanted.nodeType
      && node.nodeName === wanted.nodeName && controlKey(node) === key);
    if (match) {
      available.splice(available.indexOf(match), 1);
      syncNode(match, wanted);
      // Avoid moving a node that is already in place: moving a focused control
      // through insertBefore can itself discard focus in some browsers.
      const at = current.childNodes[[...next.childNodes].indexOf(wanted)];
      if (at !== match) current.insertBefore(match, at ?? null);
    } else {
      const index = [...next.childNodes].indexOf(wanted);
      current.insertBefore(wanted.cloneNode(true), current.childNodes[index] ?? null);
    }
  }
  for (const node of available) node.remove();
};

export const updateConsole = (root, html) => {
  // Dependency-free renderer tests have only an innerHTML stub.
  if (!root?.childNodes || !document.createElement) { root.innerHTML = html; return; }
  const next = document.createElement('template');
  next.innerHTML = html;
  const scroll = [root, ...root.querySelectorAll('*')].filter((node) => node.scrollTop || node.scrollLeft)
    .map((node) => [node, node.scrollTop, node.scrollLeft]);
  syncChildren(root, next.content);
  restoreSections(root);
  for (const [node, top, left] of scroll) { node.scrollTop = top; node.scrollLeft = left; }
};

export const updateScrolledContent = (root, html) => {
  const top = root.scrollTop;
  const left = root.scrollLeft;
  if (root.innerHTML !== html) root.innerHTML = html;
  if (top != null) root.scrollTop = top;
  if (left != null) root.scrollLeft = left;
};
