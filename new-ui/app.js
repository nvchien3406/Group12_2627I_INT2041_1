import { PdfViewerController } from './pdf_viewer.js';

const CATEGORIES = {
  documents: ['pdf', 'doc', 'docx', 'txt', 'md', 'csv', 'rtf', 'xlsx', 'pptx'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'],
  media: ['mp4', 'webm', 'ogg', 'mp3', 'wav', 'm4a', 'flac', 'mkv', 'avi'],
};

const ACTIVE_VIEW_CLASS =
  'p-1.5 rounded-lg text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-800 shadow-sm transition';
const INACTIVE_VIEW_CLASS =
  'p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition';

const state = {
  currentPath: '/',
  files: [],
  filteredFiles: [],
  activeCategory: 'all',
  viewMode: 'grid',
  searchQuery: '',
  sortBy: 'name-asc',
  selectedFile: null,
  deleteTargetPath: null,
};

function boot() {
  const $ = (id) => document.getElementById(id);

  // Explicit DOM element bindings
  const fileContainer = $('fileContainer');
  const breadcrumbNav = $('breadcrumbNav');
  const searchInput = $('searchInput');
  const clearSearchBtn = $('clearSearchBtn');
  const sortSelect = $('sortSelect');
  const viewGridBtn = $('viewGridBtn');
  const viewListBtn = $('viewListBtn');
  const btnParentDir = $('btnParentDir');
  const btnRefresh = $('btnRefresh');
  const summaryText = $('summaryText');
  const currentPathDisplay = $('currentPathDisplay');
  const hiddenFileInput = $('hiddenFileInput');
  const uploadBtn = $('uploadBtn');
  const newFolderBtn = $('newFolderBtn');
  const dropOverlay = $('dropOverlay');
  const dropTargetFolderText = $('dropTargetFolderText');

  const previewModal = $('previewModal');
  const closeModalBtn = $('closeModalBtn');
  const modalTitle = $('modalTitle');
  const modalPath = $('modalPath');
  const modalCategory = $('modalCategory');
  const modalSize = $('modalSize');
  const modalDate = $('modalDate');
  const modalPreviewBox = $('modalPreviewBox');
  const downloadModalBtn = $('downloadModalBtn');

  const deleteModal = $('deleteModal');
  const deleteTargetName = $('deleteTargetName');
  const cancelDeleteBtn = $('cancelDeleteBtn');
  const confirmDeleteBtn = $('confirmDeleteBtn');

  const newFolderModal = $('newFolderModal');
  const newFolderNameInput = $('newFolderNameInput');
  const cancelNewFolderBtn = $('cancelNewFolderBtn');
  const confirmNewFolderBtn = $('confirmNewFolderBtn');
  const toastContainer = $('toastContainer');

  function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    const borderClass =
      type === 'warning' || type === 'error'
        ? 'border-amber-500/60 text-amber-200'
        : 'border-slate-700 text-white';
    toast.className = `pointer-events-auto px-4 py-2 bg-slate-900 border ${borderClass} text-xs rounded-xl shadow-xl transition-all opacity-0 translate-y-2`;
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('opacity-0', 'translate-y-2'));
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  const pdfController = new PdfViewerController({ onNotify: showToast });

  function getFileExtension(filename) {
    return filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  }

  function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function buildFullPath(current, name) {
    return current === '/' ? `/${name}` : `${current}/${name}`;
  }

  function normalizePath(p) {
    let clean = (p || '/').replace(/\/+/g, '/');
    if (!clean.startsWith('/')) clean = `/${clean}`;
    if (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
    return clean;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getFileTypeMeta(file) {
    if (file.isDirectory) {
      return {
        icon: 'folder',
        bgColor: 'bg-amber-500/10 border border-amber-500/20',
        textColor: 'text-amber-500',
        label: 'Folder',
      };
    }
    const ext = getFileExtension(file.name);
    if (CATEGORIES.documents.includes(ext)) {
      return {
        icon: 'file-text',
        bgColor: 'bg-blue-500/10 border border-blue-500/20',
        textColor: 'text-blue-500',
        label: 'Document',
      };
    }
    if (CATEGORIES.images.includes(ext)) {
      return {
        icon: 'image',
        bgColor: 'bg-purple-500/10 border border-purple-500/20',
        textColor: 'text-purple-500',
        label: 'Image',
      };
    }
    if (CATEGORIES.media.includes(ext)) {
      return {
        icon: 'film',
        bgColor: 'bg-rose-500/10 border border-rose-500/20',
        textColor: 'text-rose-500',
        label: 'Media',
      };
    }
    return {
      icon: 'file',
      bgColor: 'bg-slate-800 border border-slate-700',
      textColor: 'text-slate-400',
      label: 'File',
    };
  }

  function updateCategoryCounts() {
    const counts = { all: state.files.length, documents: 0, images: 0, media: 0 };
    state.files.forEach((f) => {
      if (!f.isDirectory) {
        const ext = getFileExtension(f.name);
        for (const [cat, exts] of Object.entries(CATEGORIES)) {
          if (exts.includes(ext)) counts[cat]++;
        }
      }
    });
    for (const [cat, count] of Object.entries(counts)) {
      const el = $(`count-${cat}`);
      if (el) el.textContent = count;
    }
  }

  function updateSummary() {
    summaryText.textContent = `${state.filteredFiles.length} items listed`;
  }

  function renderEmptyState() {
    fileContainer.innerHTML = `
      <div class="h-full min-h-[300px] flex flex-col items-center justify-center text-center p-6 text-slate-400">
        <div class="p-4 bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 mb-3 text-slate-400">
          <i data-lucide="folder-open" class="w-8 h-8"></i>
        </div>
        <p class="font-bold text-slate-700 dark:text-slate-300">No items found</p>
        <p class="text-xs text-slate-500 mt-1">Directory is empty or no files match the current category.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
  }

  function attachCardClickEvents() {
    document.querySelectorAll('.file-card').forEach((element) => {
      element.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-action]');
        const fileName = element.getAttribute('data-filename');
        const isDir = element.getAttribute('data-isdir') === 'true';

        if (actionBtn) {
          e.stopPropagation();
          if (actionBtn.getAttribute('data-action') === 'delete') promptDelete(fileName);
          return;
        }

        if (isDir) {
          fetchDirectory(buildFullPath(state.currentPath, fileName));
        } else if (getFileExtension(fileName) === 'pdf') {
          pdfController.open(fileName, buildFullPath(state.currentPath, fileName));
        } else {
          openInspectorModal(fileName);
        }
      });
    });
  }

  function renderGridView() {
    fileContainer.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        ${state.filteredFiles
          .map((file) => {
            const meta = getFileTypeMeta(file);
            const isDir = file.isDirectory;
            const isPdf = !isDir && getFileExtension(file.name) === 'pdf';
            return `
              <div data-filename="${escapeHtml(file.name)}" data-isdir="${isDir}"
                   class="file-card group relative bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex flex-col items-center text-center transition duration-200 cursor-pointer shadow-sm hover:shadow-md hover:-translate-y-0.5">
                ${isPdf ? '<span class="absolute top-2 left-2 px-1.5 py-0.5 text-[9px] font-bold font-mono bg-rose-500/20 text-rose-500 rounded border border-rose-500/30">PDF</span>' : ''}
                <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-1 z-10">
                  <button data-action="delete" data-filename="${escapeHtml(file.name)}" title="Delete" class="p-1.5 text-slate-400 hover:text-white bg-slate-100 dark:bg-slate-950 hover:bg-rose-600 rounded-lg transition">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                </div>
                <div class="w-12 h-12 my-2 rounded-2xl flex items-center justify-center ${meta.bgColor} ${meta.textColor} transition-transform group-hover:scale-105">
                  <i data-lucide="${meta.icon}" class="w-6 h-6"></i>
                </div>
                <div class="w-full mt-1">
                  <h4 class="text-xs font-medium text-slate-800 dark:text-slate-200 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400" title="${escapeHtml(file.name)}">
                    ${escapeHtml(file.name)}
                  </h4>
                  <p class="text-[10px] text-slate-400 font-mono mt-0.5">${isDir ? 'Folder' : formatFileSize(file.size)}</p>
                </div>
              </div>
            `;
          })
          .join('')}
      </div>
    `;
    attachCardClickEvents();
  }

  function renderListView() {
    fileContainer.innerHTML = `
      <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
        <table class="w-full text-left text-xs text-slate-700 dark:text-slate-300">
          <thead class="bg-slate-50 dark:bg-slate-900 text-slate-400 border-b border-slate-200 dark:border-slate-800 font-medium">
            <tr>
              <th scope="col" class="py-3 px-4">Name</th>
              <th scope="col" class="py-3 px-4">Category</th>
              <th scope="col" class="py-3 px-4">Size</th>
              <th scope="col" class="py-3 px-4 hidden md:table-cell">Date</th>
              <th scope="col" class="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-800/60">
            ${state.filteredFiles
              .map((file) => {
                const meta = getFileTypeMeta(file);
                const isDir = file.isDirectory;
                return `
                  <tr data-filename="${escapeHtml(file.name)}" data-isdir="${isDir}" class="file-card hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer group">
                    <td class="py-2.5 px-4 flex items-center space-x-3">
                      <div class="p-1.5 rounded-lg ${meta.bgColor} ${meta.textColor} shrink-0">
                        <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
                      </div>
                      <span class="font-medium text-slate-800 dark:text-slate-200 group-hover:text-blue-500 truncate max-w-xs sm:max-w-md">${escapeHtml(file.name)}</span>
                    </td>
                    <td class="py-2.5 px-4 text-slate-400 font-mono text-[11px]">${isDir ? 'Folder' : meta.label}</td>
                    <td class="py-2.5 px-4 font-mono text-slate-400 text-[11px]">${isDir ? '--' : formatFileSize(file.size)}</td>
                    <td class="py-2.5 px-4 hidden md:table-cell text-slate-400 text-[11px]">${formatDate(file.mtime)}</td>
                    <td class="py-2.5 px-4 text-right">
                      <button data-action="delete" data-filename="${escapeHtml(file.name)}" class="p-1.5 text-slate-400 hover:text-white hover:bg-rose-600 rounded-lg transition">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                      </button>
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    attachCardClickEvents();
  }

  function renderFiles() {
    if (!state.filteredFiles || state.filteredFiles.length === 0) {
      renderEmptyState();
      return;
    }
    if (state.viewMode === 'grid') {
      renderGridView();
    } else {
      renderListView();
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function filterAndRenderFiles() {
    let result = [...state.files];

    if (state.activeCategory !== 'all') {
      const allowedExts = CATEGORIES[state.activeCategory] || [];
      result = result.filter(
        (f) => f.isDirectory || allowedExts.includes(getFileExtension(f.name))
      );
    }

    if (state.searchQuery) {
      result = result.filter((f) => f.name.toLowerCase().includes(state.searchQuery));
    }

    const [key, dir] = state.sortBy.split('-');
    const mult = dir === 'asc' ? 1 : -1;

    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      if (key === 'name') return mult * a.name.localeCompare(b.name, undefined, { numeric: true });
      if (key === 'size') return mult * ((a.size || 0) - (b.size || 0));
      if (key === 'mtime') return mult * (new Date(a.mtime || 0) - new Date(b.mtime || 0));
      return 0;
    });

    state.filteredFiles = result;
    renderFiles();
    updateSummary();
  }

  function renderBreadcrumbs() {
    const parts = state.currentPath.split('/').filter(Boolean);
    let cumulativePath = '';
    let html = `<button data-path="/" class="px-2 py-0.5 rounded text-slate-400 hover:text-white transition">Home</button>`;

    parts.forEach((part) => {
      cumulativePath += `/${part}`;
      html += `
        <span class="text-slate-500">/</span>
        <button data-path="${escapeHtml(cumulativePath)}" class="px-2 py-0.5 rounded text-slate-300 font-medium hover:text-white">${escapeHtml(part)}</button>
      `;
    });

    breadcrumbNav.innerHTML = html;
    breadcrumbNav.querySelectorAll('[data-path]').forEach((btn) => {
      btn.addEventListener('click', (e) =>
        fetchDirectory(e.currentTarget.getAttribute('data-path'))
      );
    });

    btnParentDir.disabled = state.currentPath === '/';
    currentPathDisplay.textContent = state.currentPath;
  }

  async function fetchDirectory(targetPath) {
    const safePath = normalizePath(targetPath);
    const endpoint = `/api/files?path=${encodeURIComponent(safePath)}`;

    try {
      const res = await fetch(endpoint, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      const data = await res.json();
      state.currentPath = data.currentPath || safePath;
      state.files = data.files || [];
      updateCategoryCounts();
      filterAndRenderFiles();
      renderBreadcrumbs();
    } catch (err) {
      console.error('Fetch error:', err);
      showToast(`Failed to load directory: ${err.message}`, 'warning');
    }
  }

  function setCategoryFilter(category) {
    state.activeCategory = category;
    document.querySelectorAll('.category-btn').forEach((btn) => {
      const cat = btn.getAttribute('data-category');
      btn.classList.toggle('category-active', cat === category);
    });
    filterAndRenderFiles();
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    viewGridBtn.className = mode === 'grid' ? ACTIVE_VIEW_CLASS : INACTIVE_VIEW_CLASS;
    viewListBtn.className = mode === 'list' ? ACTIVE_VIEW_CLASS : INACTIVE_VIEW_CLASS;
    renderFiles();
  }

  function navigateToParent() {
    if (state.currentPath === '/') return;
    const parts = state.currentPath.split('/').filter(Boolean);
    parts.pop();
    fetchDirectory(`/${parts.join('/')}`);
  }

  function openInspectorModal(fileName) {
    const file = state.files.find((f) => f.name === fileName);
    if (!file) return;

    state.selectedFile = file;
    const meta = getFileTypeMeta(file);
    const fullPath = buildFullPath(state.currentPath, file.name);

    modalTitle.textContent = file.name;
    modalPath.textContent = fullPath;
    modalCategory.textContent = meta.label;
    modalSize.textContent = formatFileSize(file.size);
    modalDate.textContent = formatDate(file.mtime);

    const ext = getFileExtension(file.name);
    if (['jpg', 'jpeg', 'png', 'svg', 'webp', 'gif'].includes(ext)) {
      modalPreviewBox.innerHTML = `<img src="/api/view?path=${encodeURIComponent(fullPath)}" class="max-h-48 rounded-lg object-contain" alt="Preview">`;
    } else {
      modalPreviewBox.innerHTML = `<div class="p-4 text-xs text-slate-400 font-mono">Preview unavailable for .${escapeHtml(ext)} files. Use download link below.</div>`;
    }

    downloadModalBtn.href = `/api/download?path=${encodeURIComponent(fullPath)}`;
    previewModal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  async function uploadFiles(filesList) {
    showToast(`Uploading ${filesList.length} file(s)...`);

    const formData = new FormData();
    formData.append('path', state.currentPath);
    filesList.forEach((f) => formData.append('files', f));

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      if (res.ok) {
        showToast('Uploaded successfully');
        fetchDirectory(state.currentPath);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Upload failed', 'warning');
      }
    } catch (_) {
      showToast('Upload failed', 'warning');
    }
  }

  function promptDelete(fileName) {
    state.deleteTargetPath = buildFullPath(state.currentPath, fileName);
    deleteTargetName.textContent = fileName;
    deleteModal.classList.remove('hidden');
  }

  async function executeDelete() {
    deleteModal.classList.add('hidden');
    if (!state.deleteTargetPath) return;

    try {
      const res = await fetch(
        `/api/delete?path=${encodeURIComponent(state.deleteTargetPath)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        showToast('Deleted successfully');
        fetchDirectory(state.currentPath);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Delete failed', 'warning');
      }
    } catch (_) {
      showToast('Delete failed', 'warning');
    }
  }

  async function createFolder() {
    const name = newFolderNameInput.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/create-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: state.currentPath, name }),
      });

      if (res.ok) {
        newFolderModal.classList.add('hidden');
        newFolderNameInput.value = '';
        showToast(`Folder "${name}" created successfully`);
        fetchDirectory(state.currentPath);
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Failed to create folder', 'warning');
      }
    } catch (_) {
      showToast('Failed to create folder', 'warning');
    }
  }

  function initEventListeners() {
    document.querySelectorAll('.category-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        setCategoryFilter(e.currentTarget.getAttribute('data-category'));
      });
    });

    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
      filterAndRenderFiles();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.classList.add('hidden');
      filterAndRenderFiles();
    });

    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      filterAndRenderFiles();
    });

    viewGridBtn.addEventListener('click', () => setViewMode('grid'));
    viewListBtn.addEventListener('click', () => setViewMode('list'));

    btnParentDir.addEventListener('click', navigateToParent);
    btnRefresh.addEventListener('click', () => {
      showToast('Refreshing...');
      fetchDirectory(state.currentPath);
    });

    uploadBtn.addEventListener('click', () => hiddenFileInput.click());
    hiddenFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        uploadFiles(Array.from(e.target.files));
        hiddenFileInput.value = '';
      }
    });

    newFolderBtn.addEventListener('click', () => {
      newFolderNameInput.value = '';
      newFolderModal.classList.remove('hidden');
      setTimeout(() => newFolderNameInput.focus(), 50);
    });
    cancelNewFolderBtn.addEventListener('click', () => newFolderModal.classList.add('hidden'));
    confirmNewFolderBtn.addEventListener('click', createFolder);
    newFolderNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createFolder();
      } else if (e.key === 'Escape') {
        newFolderModal.classList.add('hidden');
      }
    });

    cancelDeleteBtn.addEventListener('click', () => deleteModal.classList.add('hidden'));
    confirmDeleteBtn.addEventListener('click', executeDelete);
    closeModalBtn.addEventListener('click', () => previewModal.classList.add('hidden'));

    document.querySelectorAll('[data-quick-path]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        fetchDirectory(e.currentTarget.getAttribute('data-quick-path'));
      });
    });
  }

  function initDragAndDrop() {
    ['dragenter', 'dragover'].forEach((name) => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropTargetFolderText.textContent = `Target: ${state.currentPath}`;
        dropOverlay.classList.remove('opacity-0', 'pointer-events-none');
      });
    });

    ['dragleave', 'drop'].forEach((name) => {
      window.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (
          e.type === 'dragleave' &&
          e.clientX > 0 &&
          e.clientY > 0 &&
          e.clientX < window.innerWidth &&
          e.clientY < window.innerHeight
        ) {
          return;
        }
        dropOverlay.classList.add('opacity-0', 'pointer-events-none');
      });
    });

    window.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) uploadFiles(Array.from(files));
    });
  }

  initEventListeners();
  initDragAndDrop();
  fetchDirectory(state.currentPath);
  if (window.lucide) window.lucide.createIcons();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
