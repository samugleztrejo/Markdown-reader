(function () {
  'use strict';

  const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'app']);
  const SESSION_PROJECT_KEY = 'rrss-docs-session-project';
  const SESSION_DOCUMENT_KEY = 'rrss-docs-session-document';
  const HANDLE_DATABASE = 'rrss-docs-local';
  const HANDLE_STORE = 'directory-handles';
  const HANDLE_KEY = 'active-project';
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const state = {
    documents: new Map(),
    resources: new Map(),
    resourceUrls: new Map(),
    activePath: '',
    projectName: '',
    expandedFolders: new Set(),
    headings: [],
    searchIndex: 0,
    renderVersion: 0,
    pendingDirectoryHandle: null,
    restoringProject: false
  };

  const $ = (selector) => document.querySelector(selector);
  const appShell = $('#appShell');
  const sidebar = $('#sidebar');
  const fileTree = $('#fileTree');
  const fileFilter = $('#fileFilter');
  const fileCount = $('#fileCount');
  const projectName = $('#projectName');
  const directoryInput = $('#directoryInput');
  const welcome = $('#welcome');
  const emptyState = $('#emptyState');
  const markdownBody = $('#markdownBody');
  const reader = $('#reader');
  const documentTitle = $('#documentTitle');
  const documentPath = $('#documentPath');
  const contentSearch = $('#contentSearch');
  const searchCount = $('#searchCount');
  const tocNav = $('#tocNav');
  const toggleTocButton = $('#toggleTocButton');
  const toast = $('#toast');
  const openFolderButton = $('#openFolderButton');
  const openFolderLabel = $('#openFolderLabel');
  const compatibilityNote = $('#compatibilityNote');
  let toastTimer;
  let searchTimer;

  function readPreference(name, fallback) {
    try { return localStorage.getItem(name) || fallback; } catch (_) { return fallback; }
  }

  function savePreference(name, value) {
    try { localStorage.setItem(name, value); } catch (_) { /* file:// privacy modes may block storage */ }
  }

  function readSession(name) {
    try { return sessionStorage.getItem(name) || ''; } catch (_) { return ''; }
  }

  function saveSession(name, value) {
    try { sessionStorage.setItem(name, value); } catch (_) { /* Storage may be blocked in private mode */ }
  }

  function removeSession(name) {
    try { sessionStorage.removeItem(name); } catch (_) { /* Storage may be blocked in private mode */ }
  }

  function openHandleDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      const request = indexedDB.open(HANDLE_DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeStoredDirectory(record) {
    const database = await openHandleDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(HANDLE_STORE, 'readwrite');
      transaction.objectStore(HANDLE_STORE).put(record, HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  async function readStoredDirectory() {
    const database = await openHandleDatabase();
    const record = await new Promise((resolve, reject) => {
      const request = database.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record;
  }

  async function deleteStoredDirectory() {
    try {
      const database = await openHandleDatabase();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(HANDLE_STORE, 'readwrite');
        transaction.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
      database.close();
    } catch (_) { /* No persisted handle to remove */ }
  }

  async function rememberDirectory(handle) {
    try {
      await writeStoredDirectory({ handle, name: handle.name });
      saveSession(SESSION_PROJECT_KEY, 'active');
    } catch (_) {
      removeSession(SESSION_PROJECT_KEY);
      showToast('El proyecto está abierto, pero este navegador no puede recuperarlo al recargar.');
    }
  }

  function forgetRememberedDirectory() {
    state.pendingDirectoryHandle = null;
    removeSession(SESSION_PROJECT_KEY);
    removeSession(SESSION_DOCUMENT_KEY);
    deleteStoredDirectory();
  }

  function applyPreferences() {
    const storedTheme = readPreference('rrss-docs-theme', 'system');
    const dark = storedTheme === 'dark' || (storedTheme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';

    const tocHidden = readPreference('rrss-docs-toc', 'shown') === 'hidden';
    appShell.classList.toggle('toc-hidden', tocHidden);
    toggleTocButton.setAttribute('aria-pressed', String(!tocHidden));

    const sidebarHidden = readPreference('rrss-docs-sidebar', 'shown') === 'hidden' || innerWidth <= 760;
    appShell.classList.toggle('sidebar-hidden', sidebarHidden);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
  }

  function normalizePath(path) {
    const output = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') output.pop();
      else output.push(part);
    }
    return output.join('/');
  }

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }

  function dirname(path) {
    const index = path.lastIndexOf('/');
    return index < 0 ? '' : path.slice(0, index);
  }

  function resolveRelativePath(fromPath, relativePath) {
    const clean = safeDecode(relativePath).replace(/[?#].*$/, '');
    return clean.startsWith('/')
      ? normalizePath(clean.slice(1))
      : normalizePath(`${dirname(fromPath)}/${clean}`);
  }

  function isExternalUrl(value) {
    return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value);
  }

  function isIgnoredPath(path) {
    return normalizePath(path).split('/').some((part) => IGNORED_DIRECTORIES.has(part));
  }

  async function openProject() {
    if (typeof window.showDirectoryPicker !== 'function') {
      directoryInput.click();
      return;
    }

    try {
      if (state.pendingDirectoryHandle) {
        const pending = state.pendingDirectoryHandle;
        const permission = typeof pending.requestPermission === 'function'
          ? await pending.requestPermission({ mode: 'read' })
          : 'denied';
        if (permission === 'granted') {
          state.pendingDirectoryHandle = null;
          await loadFromDirectoryHandle(pending, { restoreSession: true });
          return;
        }
        forgetRememberedDirectory();
      }

      const root = await window.showDirectoryPicker({ mode: 'read' });
      removeSession(SESSION_DOCUMENT_KEY);
      await loadFromDirectoryHandle(root);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      showToast('No se pudo abrir con el selector principal. Prueba el selector compatible.');
    }
  }

  async function loadFromDirectoryHandle(root, options = {}) {
    resetProject();
    state.projectName = root.name;
    const markdownJobs = [];

    async function walk(handle, prefix) {
      for await (const [name, child] of handle.entries()) {
        const path = normalizePath(`${prefix}/${name}`);
        if (child.kind === 'directory') {
          if (!IGNORED_DIRECTORIES.has(name)) await walk(child, path);
          continue;
        }
        if (isIgnoredPath(path)) continue;
        state.resources.set(path, { handle: child });
        if (/\.md$/i.test(name)) {
          markdownJobs.push(child.getFile().then(async (file) => {
            state.documents.set(path, { path, name, text: await file.text() });
          }));
        }
      }
    }

    await walk(root, '');
    await Promise.all(markdownJobs);
    finishProjectLoad(options.restoreSession ? readSession(SESSION_DOCUMENT_KEY) : '');
    await rememberDirectory(root);
  }

  async function loadFromFileList(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    forgetRememberedDirectory();
    resetProject();

    const firstPath = files[0].webkitRelativePath || files[0].name;
    const rootPrefix = firstPath.includes('/') ? firstPath.split('/')[0] : '';
    state.projectName = rootPrefix || 'Proyecto';
    const markdownJobs = [];

    for (const file of files) {
      let path = file.webkitRelativePath || file.name;
      if (rootPrefix && path.startsWith(`${rootPrefix}/`)) path = path.slice(rootPrefix.length + 1);
      path = normalizePath(path);
      if (!path || isIgnoredPath(path)) continue;
      state.resources.set(path, { file });
      if (/\.md$/i.test(file.name)) {
        markdownJobs.push(file.text().then((text) => {
          state.documents.set(path, { path, name: file.name, text });
        }));
      }
    }

    await Promise.all(markdownJobs);
    directoryInput.value = '';
    finishProjectLoad();
  }

  function resetProject() {
    state.renderVersion += 1;
    state.documents.clear();
    state.resources.clear();
    state.activePath = '';
    state.expandedFolders.clear();
    for (const url of state.resourceUrls.values()) URL.revokeObjectURL(url);
    state.resourceUrls.clear();
    contentSearch.value = '';
    searchCount.textContent = '';
  }

  function finishProjectLoad(previousDocument = '') {
    projectName.textContent = state.projectName;
    fileCount.textContent = state.documents.size;
    welcome.hidden = true;
    renderTree();

    const paths = sortedDocumentPaths();
    if (!paths.length) {
      emptyState.hidden = false;
      markdownBody.hidden = true;
      documentTitle.textContent = 'Sin documentos';
      documentPath.textContent = state.projectName;
      tocNav.replaceChildren();
      return;
    }

    emptyState.hidden = true;
    const preferred = state.documents.has(previousDocument)
      ? previousDocument
      : paths.find((path) => path.toLowerCase() === 'readme.md') || paths[0];
    openDocument(preferred);
    if (innerWidth <= 760) setSidebarHidden(true);
  }

  function sortedDocumentPaths() {
    return Array.from(state.documents.keys()).sort((a, b) => collator.compare(a, b));
  }

  function buildTree(paths) {
    const root = { folders: new Map(), files: [] };
    for (const path of paths) {
      const parts = path.split('/');
      const filename = parts.pop();
      let node = root;
      let currentPath = '';
      for (const part of parts) {
        currentPath = normalizePath(`${currentPath}/${part}`);
        if (!node.folders.has(part)) node.folders.set(part, { path: currentPath, folders: new Map(), files: [] });
        node = node.folders.get(part);
      }
      node.files.push({ name: filename, path });
    }
    return root;
  }

  function renderTree() {
    const query = fileFilter.value.trim().toLocaleLowerCase('es');
    const allPaths = sortedDocumentPaths();
    const visiblePaths = query
      ? allPaths.filter((path) => path.toLocaleLowerCase('es').includes(query))
      : allPaths;
    fileCount.textContent = query ? `${visiblePaths.length}/${allPaths.length}` : allPaths.length;
    fileTree.replaceChildren();

    if (!visiblePaths.length) {
      const message = document.createElement('p');
      message.className = 'tree-empty';
      message.textContent = query ? 'No hay documentos que coincidan.' : 'No hay documentos Markdown.';
      fileTree.append(message);
      return;
    }

    fileTree.append(renderTreeNode(buildTree(visiblePaths), query));
  }

  function renderTreeNode(node, query) {
    const list = document.createElement('ul');
    list.className = 'tree-list';

    const folders = Array.from(node.folders.entries()).sort(([a], [b]) => collator.compare(a, b));
    for (const [name, folder] of folders) {
      const item = document.createElement('li');
      const details = document.createElement('details');
      details.className = 'tree-folder';
      details.open = query ? true : state.expandedFolders.has(folder.path);
      details.addEventListener('toggle', () => {
        if (details.open) state.expandedFolders.add(folder.path);
        else state.expandedFolders.delete(folder.path);
      });

      const summary = document.createElement('summary');
      summary.innerHTML = '<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5h7l2 2h9v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 9.5v-3a2 2 0 0 1 2-2h4l2 3"/></svg>';
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = name;
      summary.append(label);
      details.append(summary, renderTreeNode(folder, query));
      item.append(details);
      list.append(item);
    }

    const files = node.files.sort((a, b) => collator.compare(a.name, b.name));
    for (const file of files) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tree-file${file.path === state.activePath ? ' active' : ''}`;
      button.dataset.path = file.path;
      button.title = file.path;
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2.5h8l4 4V21H6Z"/><path d="M14 2.5v4h4"/></svg>';
      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = file.name.replace(/\.md$/i, '');
      button.append(label);
      button.addEventListener('click', () => openDocument(file.path));
      item.append(button);
      list.append(item);
    }
    return list;
  }

  async function openDocument(path, hash) {
    const documentData = state.documents.get(path);
    if (!documentData) return;
    state.activePath = path;
    saveSession(SESSION_DOCUMENT_KEY, path);
    expandParentFolders(path);
    state.searchIndex = 0;
    contentSearch.value = '';
    searchCount.textContent = '';
    documentTitle.textContent = documentData.name.replace(/\.md$/i, '');
    documentPath.textContent = path;
    markdownBody.hidden = false;
    emptyState.hidden = true;
    welcome.hidden = true;
    renderTree();
    await renderActiveDocument();

    if (hash) {
      const target = document.getElementById(safeDecode(hash.replace(/^#/, '')));
      if (target) target.scrollIntoView({ block: 'start' });
    } else {
      reader.scrollTop = 0;
    }
    if (innerWidth <= 760) setSidebarHidden(true);
  }

  function expandParentFolders(path) {
    const parts = path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = normalizePath(`${current}/${part}`);
      state.expandedFolders.add(current);
    }
  }

  async function renderActiveDocument() {
    const documentData = state.documents.get(state.activePath);
    if (!documentData) return;
    const version = ++state.renderVersion;
    let rendered;
    try {
      rendered = marked.parse(documentData.text, { gfm: true, breaks: false, mangle: false, headerIds: false });
    } catch (_) {
      rendered = '<p>No se ha podido interpretar este documento.</p>';
    }

    const clean = DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'option'],
      FORBID_ATTR: ['style', 'srcdoc', 'autofocus']
    });
    if (version !== state.renderVersion) return;
    markdownBody.innerHTML = clean;
    decorateHeadings();
    decorateTables();
    decorateCodeBlocks();
    decorateLinks();
    await decorateImages(version);
    if (version !== state.renderVersion) return;
    applyContentSearch();
  }

  function slugify(text, used) {
    const base = text.toLocaleLowerCase('es')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .trim().replace(/\s+/g, '-') || 'seccion';
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) slug = `${base}-${suffix++}`;
    used.add(slug);
    return slug;
  }

  function decorateHeadings() {
    const used = new Set();
    state.headings = Array.from(markdownBody.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((heading) => {
      const id = slugify(heading.textContent, used);
      heading.id = id;
      return { id, text: heading.textContent, level: Number(heading.tagName.slice(1)) };
    });
    renderToc();
  }

  function renderToc() {
    tocNav.replaceChildren();
    const useful = state.headings.filter((item) => item.level >= 2);
    for (const heading of (useful.length ? useful : state.headings)) {
      const link = document.createElement('a');
      link.href = `#${heading.id}`;
      link.dataset.level = heading.level;
      link.textContent = heading.text;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        document.getElementById(heading.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      tocNav.append(link);
    }
  }

  function decorateTables() {
    for (const table of markdownBody.querySelectorAll('table')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      table.replaceWith(wrapper);
      wrapper.append(table);
    }
  }

  function decorateCodeBlocks() {
    for (const pre of markdownBody.querySelectorAll('pre')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-button';
      button.textContent = 'Copiar';
      button.addEventListener('click', async () => {
        const text = pre.querySelector('code')?.textContent || pre.textContent;
        const copied = await copyText(text);
        button.textContent = copied ? 'Copiado' : 'No disponible';
        setTimeout(() => { button.textContent = 'Copiar'; }, 1500);
      });
      pre.append(button);
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      return copied;
    }
  }

  function decorateLinks() {
    for (const link of markdownBody.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href') || '';
      if (!href) continue;
      if (href.startsWith('#')) continue;

      if (!isExternalUrl(href)) {
        const [relative, hash = ''] = href.split('#');
        const resolved = resolveRelativePath(state.activePath, relative);
        const markdownPath = state.documents.has(resolved)
          ? resolved
          : state.documents.has(`${resolved}.md`) ? `${resolved}.md` : '';
        if (markdownPath) {
          link.href = '#';
          link.dataset.documentPath = markdownPath;
          link.addEventListener('click', (event) => {
            event.preventDefault();
            openDocument(markdownPath, hash ? `#${hash}` : '');
          });
          continue;
        }
      }

      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }

  async function getResourceUrl(path) {
    if (state.resourceUrls.has(path)) return state.resourceUrls.get(path);
    const resource = state.resources.get(path);
    if (!resource) return '';
    try {
      const file = resource.file || await resource.handle.getFile();
      const url = URL.createObjectURL(file);
      state.resourceUrls.set(path, url);
      return url;
    } catch (_) {
      return '';
    }
  }

  function replaceImageWithMessage(image, source) {
    const message = document.createElement('div');
    message.className = 'resource-missing';
    const title = document.createElement('strong');
    title.textContent = 'No se pudo mostrar esta imagen';
    const detail = document.createElement('span');
    detail.textContent = source || 'Recurso no disponible';
    message.append(title, detail);
    image.replaceWith(message);
  }

  async function decorateImages(version) {
    const images = Array.from(markdownBody.querySelectorAll('img[src]'));
    await Promise.all(images.map(async (image) => {
      const source = image.getAttribute('src') || '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => replaceImageWithMessage(image, source), { once: true });
      if (isExternalUrl(source) || source.startsWith('data:') || source.startsWith('blob:')) return;
      const path = resolveRelativePath(state.activePath, source);
      const url = await getResourceUrl(path);
      if (version !== state.renderVersion) return;
      if (url) image.src = url;
      else replaceImageWithMessage(image, source);
    }));
  }

  function applyContentSearch() {
    const query = contentSearch.value.trim();
    searchCount.textContent = '';
    if (!query) return;

    const walker = document.createTreeWalker(markdownBody, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.closest('pre, code, button, .resource-missing')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'giu');

    for (const node of nodes) {
      const text = node.nodeValue;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        fragment.append(text.slice(lastIndex, match.index));
        const mark = document.createElement('mark');
        mark.textContent = match[0];
        fragment.append(mark);
        lastIndex = match.index + match[0].length;
      }
      fragment.append(text.slice(lastIndex));
      node.replaceWith(fragment);
    }

    const marks = markdownBody.querySelectorAll('mark');
    state.searchIndex = Math.min(state.searchIndex, Math.max(0, marks.length - 1));
    searchCount.textContent = marks.length ? `${state.searchIndex + 1}/${marks.length}` : '0';
    if (marks.length) {
      marks[state.searchIndex].classList.add('current');
      marks[state.searchIndex].scrollIntoView({ block: 'center' });
    }
  }

  async function refreshSearch() {
    state.searchIndex = 0;
    await renderActiveDocument();
  }

  function moveSearch(step) {
    const marks = markdownBody.querySelectorAll('mark');
    if (!marks.length) return;
    marks[state.searchIndex]?.classList.remove('current');
    state.searchIndex = (state.searchIndex + step + marks.length) % marks.length;
    marks[state.searchIndex].classList.add('current');
    marks[state.searchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
    searchCount.textContent = `${state.searchIndex + 1}/${marks.length}`;
  }

  function setSidebarHidden(hidden) {
    appShell.classList.toggle('sidebar-hidden', hidden);
    sidebar.setAttribute('aria-hidden', String(hidden));
    savePreference('rrss-docs-sidebar', hidden ? 'hidden' : 'shown');
  }

  async function restoreSessionProject() {
    if (readSession(SESSION_PROJECT_KEY) !== 'active' || typeof window.showDirectoryPicker !== 'function') return;
    state.restoringProject = true;
    openFolderButton.disabled = true;
    openFolderLabel.textContent = 'Recuperando proyecto…';
    documentTitle.textContent = 'Recuperando proyecto…';
    documentPath.textContent = 'Leyendo los archivos locales de nuevo';

    try {
      const record = await readStoredDirectory();
      if (!record?.handle) throw new Error('No hay una carpeta guardada');
      const permission = typeof record.handle.queryPermission === 'function'
        ? await record.handle.queryPermission({ mode: 'read' })
        : 'denied';

      if (permission === 'granted') {
        await loadFromDirectoryHandle(record.handle, { restoreSession: true });
        return;
      }

      state.pendingDirectoryHandle = record.handle;
      projectName.textContent = record.name || 'Proyecto anterior';
      openFolderLabel.textContent = 'Reabrir proyecto';
      compatibilityNote.textContent = `Pulsa para recuperar ${record.name || 'el proyecto anterior'} y renovar el permiso de lectura.`;
      documentTitle.textContent = 'RRSS Docs';
      documentPath.textContent = 'El navegador necesita renovar el permiso';
    } catch (_) {
      forgetRememberedDirectory();
      openFolderLabel.textContent = 'Abrir proyecto';
      documentTitle.textContent = 'RRSS Docs';
      documentPath.textContent = 'Lector Markdown local';
    } finally {
      state.restoringProject = false;
      openFolderButton.disabled = false;
    }
  }

  openFolderButton.addEventListener('click', openProject);
  $('#changeFolderButton').addEventListener('click', openProject);
  $('#fallbackButton').addEventListener('click', () => directoryInput.click());
  directoryInput.addEventListener('change', () => loadFromFileList(directoryInput.files));

  fileFilter.addEventListener('input', renderTree);
  $('#toggleSidebarButton').addEventListener('click', () => setSidebarHidden(!appShell.classList.contains('sidebar-hidden')));
  $('#closeSidebarButton').addEventListener('click', () => setSidebarHidden(true));
  $('#sidebarBackdrop').addEventListener('click', () => setSidebarHidden(true));

  $('#toggleThemeButton').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    savePreference('rrss-docs-theme', dark ? 'light' : 'dark');
  });

  toggleTocButton.addEventListener('click', () => {
    const hidden = !appShell.classList.contains('toc-hidden');
    appShell.classList.toggle('toc-hidden', hidden);
    toggleTocButton.setAttribute('aria-pressed', String(!hidden));
    savePreference('rrss-docs-toc', hidden ? 'hidden' : 'shown');
  });

  contentSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshSearch, 160);
  });
  contentSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveSearch(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      contentSearch.value = '';
      refreshSearch();
      contentSearch.blur();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && state.activePath) {
      event.preventDefault();
      contentSearch.focus();
      contentSearch.select();
    }
  });

  window.addEventListener('beforeunload', () => {
    for (const url of state.resourceUrls.values()) URL.revokeObjectURL(url);
  });

  if (typeof window.showDirectoryPicker !== 'function') {
    compatibilityNote.textContent = 'Tu navegador usará el selector compatible. Tendrás que volver a elegir la carpeta después de recargar.';
  }
  applyPreferences();
  sidebar.setAttribute('aria-hidden', String(appShell.classList.contains('sidebar-hidden')));
  restoreSessionProject();
})();
