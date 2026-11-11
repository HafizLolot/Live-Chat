'use strict';

(() => {
  const BASE_TITLE = 'FF Support Admin';
  const SOUND_KEY = 'halodesk.sound';
  const TONE_CLASSES = ['tone-1', 'tone-2', 'tone-3', 'tone-4', 'tone-5', 'tone-6'];

  const el = {
    app: document.getElementById('adminApp'),
    conversationList: document.getElementById('conversationList'),
    listSkeleton: document.getElementById('listSkeleton'),
    listEmpty: document.getElementById('listEmpty'),
    listEmptyTitle: document.getElementById('listEmptyTitle'),
    listEmptyCopy: document.getElementById('listEmptyCopy'),
    searchInput: document.getElementById('searchInput'),
    statOnline: document.getElementById('statOnline'),
    statWaiting: document.getElementById('statWaiting'),
    statTotal: document.getElementById('statTotal'),
    countAll: document.getElementById('countAll'),
    countOpen: document.getElementById('countOpen'),
    countClosed: document.getElementById('countClosed'),
    connectionStatus: document.getElementById('connectionStatus'),
    connectionText: document.getElementById('connectionText'),
    soundToggle: document.getElementById('soundToggle'),
    soundLabel: document.getElementById('soundLabel'),
    emptyWorkspace: document.getElementById('emptyWorkspace'),
    chatView: document.getElementById('chatView'),
    backButton: document.getElementById('backButton'),
    personAvatar: document.getElementById('personAvatar'),
    personName: document.getElementById('personName'),
    personMeta: document.getElementById('personMeta'),
    chatStatusBadge: document.getElementById('chatStatusBadge'),
    statusButton: document.getElementById('statusButton'),
    deleteButton: document.getElementById('deleteButton'),
    chatScroll: document.getElementById('chatScroll'),
    adminMessages: document.getElementById('adminMessages'),
    adminTyping: document.getElementById('adminTyping'),
    typingName: document.getElementById('typingName'),
    quickReplies: document.getElementById('quickReplies'),
    adminMessageForm: document.getElementById('adminMessageForm'),
    adminMessageInput: document.getElementById('adminMessageInput'),
    adminAttachButton: document.getElementById('adminAttachButton'),
    adminFileInput: document.getElementById('adminFileInput'),
    adminSendButton: document.getElementById('adminSendButton'),
    messageCount: document.getElementById('messageCount'),
    toast: document.getElementById('toast'),
    deleteModal: document.getElementById('deleteModal'),
    confirmDeleteButton: document.getElementById('confirmDeleteButton'),
    loginScreen: document.getElementById('loginScreen'),
    loginForm: document.getElementById('loginForm'),
    loginPassword: document.getElementById('loginPassword'),
    togglePasswordButton: document.getElementById('togglePasswordButton'),
    loginButton: document.getElementById('loginButton'),
    loginError: document.getElementById('loginError'),
    changePasswordButton: document.getElementById('changePasswordButton'),
    logoutButton: document.getElementById('logoutButton'),
    passwordModal: document.getElementById('passwordModal'),
    passwordForm: document.getElementById('passwordForm'),
    currentPassword: document.getElementById('currentPassword'),
    newPassword: document.getElementById('newPassword'),
    confirmPassword: document.getElementById('confirmPassword'),
    passwordError: document.getElementById('passwordError'),
    savePasswordButton: document.getElementById('savePasswordButton'),
  };

  /** @type {Map<string, any>} */
  const chats = new Map();
  let selectedId = null;
  let activeFilter = 'all';
  let searchTerm = '';
  let eventSource = null;
  let toastTimer = null;
  let typingTimer = null;
  let typingStopTimer = null;
  let typingSent = false;
  let sending = false;
  let renderedChatId = null;
  let renderedMessageCount = 0;
  let deleting = false;
  const readingIds = new Set();

  let authenticated = false;
  let adminStarted = false;
  let loginBusy = false;
  let authMode = 'stored';
  let sessionCheckTimer = null;

  let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'off';
  let audioContext = null;

  // -------------------------------------------------------------------------
  // Utiliti
  // -------------------------------------------------------------------------

  function api(path, options = {}, config = {}) {
    return fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && !config.allowUnauthorized) {
          handleSessionLost();
        }
        const error = new Error(data.error || 'Berlaku ralat. Sila cuba lagi.');
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showToast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 3200);
  }

  // -------------------------------------------------------------------------
  // Pengesahan admin
  // -------------------------------------------------------------------------

  function setLoginError(message) {
    el.loginError.textContent = message || '';
    el.loginError.hidden = !message;
  }

  function setPasswordError(message) {
    el.passwordError.textContent = message || '';
    el.passwordError.hidden = !message;
  }

  function resetAdminState() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    clearTimeout(typingTimer);
    clearTimeout(typingStopTimer);
    typingSent = false;
    sending = false;
    chats.clear();
    selectedId = null;
    renderedChatId = null;
    renderedMessageCount = 0;
    searchTerm = '';
    if (el.searchInput) el.searchInput.value = '';
    if (el.adminMessageInput) {
      el.adminMessageInput.value = '';
      el.adminMessageInput.disabled = true;
      resizeAdminInput();
    }
    closeDeleteModal();
    closePasswordModal();
    showEmpty();
    renderConversationList();
    document.title = BASE_TITLE;
    setConnection('disconnected', 'Belum log masuk');
  }

  function showLogin(message) {
    authenticated = false;
    adminStarted = false;
    resetAdminState();
    el.app.hidden = true;
    el.loginScreen.hidden = false;
    el.loginPassword.value = '';
    setLoginError(message || '');
    setTimeout(() => el.loginPassword.focus({ preventScroll: true }), 80);
  }

  function showAdmin() {
    el.loginScreen.hidden = true;
    el.app.hidden = false;
  }

  function handleSessionLost() {
    if (!authenticated) return;
    showLogin('Sesi admin tamat. Sila log masuk semula.');
  }

  function applyAuthMode(data) {
    authMode = data?.authMode === 'env' ? 'env' : data?.authMode === 'disabled' ? 'disabled' : 'stored';
    el.changePasswordButton.hidden = authMode === 'env' || authMode === 'disabled';
    el.changePasswordButton.title =
      authMode === 'env'
        ? 'Kata laluan dikendalikan melalui ADMIN_PASSWORD di pelayan'
        : authMode === 'disabled'
        ? 'Perlindungan kata laluan dimatikan'
        : 'Tukar kata laluan admin';
  }

  async function startAdmin() {
    if (adminStarted) return;
    adminStarted = true;
    showAdmin();

    try {
      const data = await api('/api/admin/chats', {}, { allowUnauthorized: true });
      applySnapshot(data.chats || []);
    } catch (error) {
      if (error.status === 401) {
        showLogin('Sesi admin tamat. Sila log masuk semula.');
        return;
      }
      el.listSkeleton.hidden = true;
      el.listEmpty.hidden = false;
      el.listEmptyTitle.textContent = 'Gagal memuatkan perbualan';
      el.listEmptyCopy.textContent = 'Pastikan pelayan masih berjalan, kemudian muat semula halaman.';
      showToast(error.message || 'Gagal memuatkan perbualan.');
    }

    connect();
  }

  async function checkSession() {
    try {
      const response = await fetch('/api/admin/session', {
        headers: { Accept: 'application/json' },
      });
      const data = await response.json().catch(() => ({}));
      if (!data.authenticated) {
        showLogin();
        return;
      }
      authenticated = true;
      applyAuthMode(data);
      await startAdmin();
      if (data.temporary) {
        showToast('Anda menggunakan kata laluan automatik. Sila tukar kata laluan admin segera.');
      }
    } catch {
      showLogin('Tidak dapat menyambung ke pelayan. Pastikan pelayan masih berjalan.');
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    if (loginBusy) return;

    const password = el.loginPassword.value;
    if (!password) {
      setLoginError('Masukkan kata laluan admin.');
      el.loginPassword.focus();
      return;
    }

    loginBusy = true;
    el.loginButton.disabled = true;
    const label = el.loginButton.querySelector('span');
    const previousLabel = label.textContent;
    label.textContent = 'Memeriksa...';
    setLoginError('');

    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setLoginError(data.error || 'Gagal log masuk. Cuba lagi.');
        el.loginPassword.select();
        return;
      }

      authenticated = true;
      applyAuthMode(data);
      el.loginPassword.value = '';
      await startAdmin();
      showToast(
        data.temporary
          ? 'Berjaya log masuk. Anda menggunakan kata laluan automatik — sila tukar kata laluan segera.'
          : 'Berjaya log masuk.'
      );
    } catch {
      setLoginError('Tidak dapat menyambung ke pelayan. Pastikan pelayan masih berjalan.');
    } finally {
      loginBusy = false;
      el.loginButton.disabled = false;
      label.textContent = previousLabel;
    }
  }

  async function logout() {
    try {
      await fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Abaikan; sesi setempat tetap ditutup.
    }
    showLogin('Anda telah log keluar.');
  }

  function openPasswordModal() {
    if (authMode === 'env') {
      showToast('Kata laluan dikendalikan melalui ADMIN_PASSWORD di pelayan.');
      return;
    }
    setPasswordError('');
    el.passwordForm.reset();
    el.passwordModal.hidden = false;
    el.currentPassword.focus();
  }

  function closePasswordModal() {
    el.passwordModal.hidden = true;
  }

  async function submitPassword(event) {
    event.preventDefault();

    const currentPassword = el.currentPassword.value;
    const newPassword = el.newPassword.value;
    const confirmPassword = el.confirmPassword.value;

    if (newPassword.length < 8) {
      setPasswordError('Kata laluan baharu sekurang-kurangnya 8 aksara.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Pengesahan kata laluan tidak sepadan.');
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError('Kata laluan baharu mesti berbeza daripada kata laluan semasa.');
      return;
    }

    el.savePasswordButton.disabled = true;
    el.savePasswordButton.textContent = 'Menyimpan...';
    setPasswordError('');

    try {
      const response = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          showLogin('Sesi admin tamat. Sila log masuk semula.');
          return;
        }
        setPasswordError(data.error || 'Gagal menyimpan kata laluan.');
        return;
      }

      closePasswordModal();
      showLogin('Kata laluan berjaya ditukar. Sila log masuk dengan kata laluan baharu.');
      showToast('Kata laluan berjaya ditukar.');
    } catch {
      setPasswordError('Tidak dapat menyambung ke pelayan.');
    } finally {
      el.savePasswordButton.disabled = false;
      el.savePasswordButton.textContent = 'Simpan';
    }
  }

  function verifySessionSoon() {
    if (!authenticated) return;
    clearTimeout(sessionCheckTimer);
    sessionCheckTimer = setTimeout(async () => {
      try {
        const response = await fetch('/api/admin/session', {
          headers: { Accept: 'application/json' },
        });
        const data = await response.json().catch(() => ({}));
        if (!data.authenticated) handleSessionLost();
      } catch {
        // Biarkan EventSource mencoba menyambung semula.
      }
    }, 1500);
  }

  function initials(name) {
    const parts = String(name || 'Tamu')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length === 0) return 'T';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  function toneFor(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return TONE_CLASSES[hash % TONE_CLASSES.length];
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ms-MY', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  function formatFullDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ms-MY', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }

  function dayLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (dayKey(date) === dayKey(today)) return 'Hari ini';
    if (dayKey(date) === dayKey(yesterday)) return 'Semalam';

    return new Intl.DateTimeFormat('ms-MY', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(date);
  }

  function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diff = Math.max(0, now.getTime() - date.getTime());
    const minutes = Math.floor(diff / 60_000);

    if (minutes < 1) return 'baru sahaja';
    if (minutes < 60) return `${minutes} mnt`;

    if (dayKey(date) === dayKey(now)) return formatTime(date);

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (dayKey(date) === dayKey(yesterday)) return 'Semalam';

    return new Intl.DateTimeFormat('ms-MY', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  }

  function lastMessage(chat) {
    return chat.messages?.[chat.messages.length - 1] || null;
  }

  function previewText(chat) {
    const message = lastMessage(chat);
    if (!message) return 'Belum ada mesej';
    if (message.attachment) {
      const label = message.attachment.kind === 'video' ? '🎥 Video' : '📷 Gambar';
      if (message.sender === 'admin') return `Anda: ${label}`;
      return label;
    }
    if (message.sender === 'admin') return `Anda: ${message.text}`;
    return message.text;
  }

  function sortedChats() {
    return [...chats.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  function unreadTotal() {
    let total = 0;
    for (const chat of chats.values()) total += Math.max(0, chat.unreadAdmin || 0);
    return total;
  }

  function updateTitle() {
    const unread = unreadTotal();
    document.title = unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE;
  }

  // -------------------------------------------------------------------------
  // Bunyi notifikasi
  // -------------------------------------------------------------------------

  function updateSoundUI() {
    el.soundToggle.classList.toggle('muted', !soundEnabled);
    el.soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    el.soundLabel.textContent = soundEnabled ? 'Bunyi aktif' : 'Bunyi dimatikan';
  }

  function ensureAudio() {
    if (!soundEnabled) return null;
    try {
      if (!audioContext) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        audioContext = new AudioCtor();
      }
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return audioContext;
    } catch {
      return null;
    }
  }

  function playNotification() {
    if (!soundEnabled) return;
    const context = ensureAudio();
    if (!context) return;

    const start = context.currentTime;
    [0, 0.13].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(index === 0 ? 784 : 1046, start + offset);
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.075, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.2);
    });
  }

  // -------------------------------------------------------------------------
  // Senarai perbualan
  // -------------------------------------------------------------------------

  function filteredChats() {
    const query = searchTerm.trim().toLowerCase();
    return sortedChats().filter((chat) => {
      if (activeFilter === 'open' && chat.status !== 'open') return false;
      if (activeFilter === 'closed' && chat.status !== 'closed') return false;
      if (!query) return true;
      if (chat.name.toLowerCase().includes(query)) return true;
      return (chat.messages || []).some((message) =>
        (message.text || '').toLowerCase().includes(query) ||
        (message.attachment?.name || '').toLowerCase().includes(query)
      );
    });
  }

  function renderConversationList() {
    const list = el.conversationList;
    const oldScrollTop = list.scrollTop;
    const visible = filteredChats();

    const fragment = document.createDocumentFragment();
    for (const chat of visible) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'conversation-item';
      item.dataset.chatId = chat.id;
      item.setAttribute('aria-label', `Buka perbualan dengan ${chat.name}`);
      if (chat.id === selectedId) item.classList.add('active');
      if (chat.unreadAdmin > 0) item.classList.add('unread');

      const avatar = makeElement('span', `list-avatar ${toneFor(chat.id)}`, initials(chat.name));
      if (chat.online) {
        avatar.appendChild(makeElement('span', 'online-dot'));
      }

      const main = makeElement('span', 'list-main');
      const top = makeElement('span', 'list-top');
      top.appendChild(makeElement('strong', '', chat.name));

      const time = makeElement('time', '', relativeTime(chat.updatedAt));
      time.dateTime = chat.updatedAt;
      time.title = formatFullDate(chat.updatedAt);
      top.appendChild(time);

      const bottom = makeElement('span', 'list-bottom');
      bottom.appendChild(makeElement('span', 'preview', previewText(chat)));

      if (chat.unreadAdmin > 0) {
        bottom.appendChild(
          makeElement('span', 'unread-badge', chat.unreadAdmin > 99 ? '99+' : String(chat.unreadAdmin))
        );
      } else if (chat.status === 'closed') {
        bottom.appendChild(makeElement('span', 'closed-mark', 'Selesai'));
      }

      main.append(top, bottom);
      item.append(avatar, main);

      item.addEventListener('click', () => selectChat(chat.id));
      fragment.appendChild(item);
    }

    list.replaceChildren(fragment);
    list.appendChild(el.listSkeleton);
    list.appendChild(el.listEmpty);

    el.listSkeleton.hidden = true;
    el.listEmpty.hidden = visible.length > 0;
    el.listEmptyTitle.textContent = searchTerm.trim()
      ? 'Perbualan tidak ditemui'
      : chats.size === 0
        ? 'Belum ada perbualan'
        : 'Tiada perbualan di sini';
    el.listEmptyCopy.textContent = searchTerm.trim()
      ? 'Cuba kata kunci lain atau padam carian.'
      : chats.size === 0
        ? 'Mesej daripada pelanggan akan muncul di sini secara automatik.'
        : 'Cuba pilih penapis lain untuk melihat perbualan.';

    list.scrollTop = oldScrollTop;
    updateStats();
    updateTitle();
  }

  function updateStats() {
    const all = [...chats.values()];
    const online = all.filter((chat) => chat.online).length;
    const waiting = all.filter((chat) => chat.unreadAdmin > 0).length;
    const open = all.filter((chat) => chat.status === 'open').length;
    const closed = all.filter((chat) => chat.status === 'closed').length;

    el.statOnline.textContent = String(online);
    el.statWaiting.textContent = String(waiting);
    el.statTotal.textContent = String(all.length);
    el.countAll.textContent = String(all.length);
    el.countOpen.textContent = String(open);
    el.countClosed.textContent = String(closed);
  }

  // -------------------------------------------------------------------------
  // Paparan perbualan
  // -------------------------------------------------------------------------

  function applyChat(chat, options = {}) {
    const { notify = true } = options;
    const previous = chats.get(chat.id);
    const knownMessageIds = new Set((previous?.messages || []).map((m) => m.id));
    const hasNewVisitorMessage =
      Boolean(previous) &&
      (chat.messages || []).some(
        (message) => message.sender === 'visitor' && !knownMessageIds.has(message.id)
      );

    chats.set(chat.id, chat);

    if (
      notify &&
      hasNewVisitorMessage &&
      (selectedId !== chat.id ||
        !document.hasFocus() ||
        document.visibilityState !== 'visible' ||
        !isChatOnScreen())
    ) {
      playNotification();
    }

    renderConversationList();

    if (selectedId === chat.id) {
      renderChat(false);
      if (
        chat.unreadAdmin > 0 &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
      ) {
        markRead(chat.id);
      }
    }

    updateTitle();
  }

  function applySnapshot(nextChats) {
    chats.clear();
    for (const chat of nextChats) chats.set(chat.id, chat);

    if (selectedId && !chats.has(selectedId)) {
      clearSelection();
    }

    renderConversationList();
    if (selectedId) {
      renderChat(false);
      const chat = chats.get(selectedId);
      if (chat && chat.unreadAdmin > 0 && document.visibilityState === 'visible') {
        markRead(chat.id);
      }
    }
    el.listSkeleton.hidden = true;
    updateTitle();
  }

  function renderChat(forceBottom = false) {
    const chat = selectedId ? chats.get(selectedId) : null;
    if (!chat) {
      showEmpty();
      return;
    }

    el.emptyWorkspace.hidden = true;
    el.chatView.hidden = false;

    const changedChat = renderedChatId !== chat.id;
    const previousCount = changedChat ? 0 : renderedMessageCount;
    const scroller = el.chatScroll;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 110;

    el.personName.textContent = chat.name;
    el.personAvatar.textContent = initials(chat.name);
    el.personAvatar.className = `person-avatar ${toneFor(chat.id)}`;

    el.personMeta.replaceChildren();
    const dot = makeElement('span', 'presence-dot');
    if (chat.online) dot.classList.add('online');
    el.personMeta.append(
      dot,
      document.createTextNode(
        `${chat.gameId ? 'ID: ' + chat.gameId + ' • ' : ''}${chat.category ? chat.category + ' • ' : ''}${chat.online ? 'Online sekarang' : 'Tidak online'}`
      )
    );

    el.chatStatusBadge.textContent = chat.status === 'closed' ? 'Selesai' : 'Aktif';
    el.chatStatusBadge.className = `chat-status-badge ${chat.status === 'closed' ? 'closed' : 'open'}`;

    const isClosed = chat.status === 'closed';
    el.statusButton.classList.toggle('reopen', isClosed);
    const statusLabel = el.statusButton.querySelector('span');
    if (statusLabel) statusLabel.textContent = isClosed ? 'Buka semula' : 'Tanda selesai';
    el.statusButton.setAttribute(
      'aria-label',
      isClosed ? 'Buka semula perbualan' : 'Tanda perbualan selesai'
    );
    const statusIcon = el.statusButton.querySelector('svg');
    if (statusIcon) {
      statusIcon.innerHTML = isClosed
        ? '<path d="M20 11a8 8 0 1 0-2.3 6.3M20 4v7h-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path d="m5 12 5 5L20 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    el.adminMessageInput.placeholder = isClosed
      ? 'Perbualan ditutup — buka semula untuk membalas...'
      : 'Tulis balasan untuk pelanggan...';
    el.adminMessageInput.disabled = sending || isClosed;
    el.adminSendButton.disabled = isClosed || !el.adminMessageInput.value.trim() || sending;
    if (el.adminAttachButton) el.adminAttachButton.disabled = isClosed || sending;
    el.messageCount.textContent = `${chat.messages?.length || 0} mesej`;

    renderMessages(chat, previousCount);

    if (changedChat) {
      el.adminTyping.hidden = true;
      renderedChatId = chat.id;
      renderedMessageCount = chat.messages?.length || 0;
    } else {
      renderedMessageCount = chat.messages?.length || 0;
    }

    if (changedChat || forceBottom || nearBottom || (chat.messages?.length || 0) > previousCount) {
      scrollToBottom();
    }
  }

  function renderAttachment(attachment) {
    const wrap = makeElement('div', 'media-attachment');
    if (attachment.kind === 'video') {
      const video = document.createElement('video');
      video.src = attachment.url;
      video.controls = true;
      video.preload = 'metadata';
      video.className = 'media-video';
      wrap.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = attachment.url;
      img.alt = attachment.name || 'Gambar';
      img.loading = 'lazy';
      img.className = 'media-image';
      wrap.appendChild(img);
    }
    return wrap;
  }

  function renderMessages(chat, previousCount) {
    const oldScrollTop = el.chatScroll.scrollTop;
    const nearBottom =
      el.chatScroll.scrollHeight - el.chatScroll.scrollTop - el.chatScroll.clientHeight < 110;
    const fragment = document.createDocumentFragment();
    let lastDay = '';

    for (const message of chat.messages || []) {
      const date = new Date(message.createdAt);
      const key = Number.isNaN(date.getTime()) ? '' : dayKey(date);
      if (key && key !== lastDay) {
        lastDay = key;
        const separator = makeElement('div', 'day-separator');
        separator.appendChild(makeElement('span', '', dayLabel(message.createdAt)));
        fragment.appendChild(separator);
      }

      if (message.sender === 'system') {
        const system = makeElement('div', 'system-message');
        system.appendChild(makeElement('span', '', message.text));
        fragment.appendChild(system);
        continue;
      }

      const outgoing = message.sender === 'admin';
      const row = makeElement('div', `message ${outgoing ? 'out' : 'in'}`);
      if (!outgoing) {
        row.appendChild(makeElement('span', 'msg-avatar', initials(chat.name)));
      }

      const content = makeElement('div', 'message-content');
      if (message.attachment) {
        content.appendChild(renderAttachment(message.attachment));
      }
      if (message.text) {
        content.appendChild(makeElement('div', 'bubble', message.text));
      }
      const time = makeElement('div', 'message-time', formatTime(message.createdAt));
      time.title = formatFullDate(message.createdAt);
      content.appendChild(time);
      row.appendChild(content);
      fragment.appendChild(row);
    }

    el.adminMessages.replaceChildren(fragment);

    if ((chat.messages?.length || 0) > previousCount && !nearBottom) {
      el.chatScroll.scrollTop = oldScrollTop;
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
    });
  }

  function selectChat(id) {
    if (!chats.has(id)) return;
    if (selectedId && selectedId !== id) stopTyping();
    selectedId = id;
    el.app.classList.add('chat-open');
    renderConversationList();
    renderChat(true);
    markRead(id);
    el.adminTyping.hidden = true;

    if (window.matchMedia('(min-width: 901px)').matches) {
      el.adminMessageInput.focus({ preventScroll: true });
    }
  }

  function showEmpty() {
    selectedId = null;
    renderedChatId = null;
    renderedMessageCount = 0;
    el.chatView.hidden = true;
    el.emptyWorkspace.hidden = false;
    el.app.classList.remove('chat-open');
    el.adminTyping.hidden = true;
    el.adminMessageInput.value = '';
    el.messageCount.textContent = '0 mesej';
    resizeAdminInput();
  }

  function clearSelection() {
    showEmpty();
    renderConversationList();
  }

  function isChatOnScreen() {
    return (
      window.matchMedia('(min-width: 901px)').matches ||
      el.app.classList.contains('chat-open')
    );
  }

  async function markRead(id) {
    const chat = chats.get(id);
    if (!chat || !(chat.unreadAdmin > 0) || readingIds.has(id)) return;
    if (document.visibilityState !== 'visible') return;
    if (!isChatOnScreen()) return;

    readingIds.add(id);
    let succeeded = false;
    try {
      const data = await api(`/api/chat/${encodeURIComponent(id)}/read`, {
        method: 'POST',
        body: JSON.stringify({ role: 'admin' }),
      });
      succeeded = true;
      if (data.chat) {
        const previous = chats.get(id);
        chats.set(id, { ...data.chat, online: previous?.online ?? data.chat.online });
        renderConversationList();
        updateTitle();
      }
    } catch {
      // Tidak kritikal.
    } finally {
      readingIds.delete(id);
      if (
        succeeded &&
        chats.get(id)?.unreadAdmin > 0 &&
        document.visibilityState === 'visible' &&
        isChatOnScreen()
      ) {
        setTimeout(() => markRead(id), 100);
      }
    }
  }

  async function updateChatStatus() {
    const chat = selectedId ? chats.get(selectedId) : null;
    if (!chat) return;

    const nextStatus = chat.status === 'closed' ? 'open' : 'closed';
    el.statusButton.disabled = true;
    try {
      const data = await api(`/api/admin/chats/${encodeURIComponent(chat.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      applyChat(data.chat);
      showToast(
        nextStatus === 'closed'
          ? 'Perbualan ditandakan selesai.'
          : 'Perbualan dibuka semula.'
      );
    } catch (error) {
      showToast(error.message || 'Gagal menukar status.');
    } finally {
      el.statusButton.disabled = false;
    }
  }

  function openDeleteModal() {
    if (!selectedId) return;
    el.deleteModal.hidden = false;
    el.confirmDeleteButton.focus();
  }

  function closeDeleteModal() {
    el.deleteModal.hidden = true;
  }

  async function deleteSelectedChat() {
    const chat = selectedId ? chats.get(selectedId) : null;
    if (!chat || deleting) return;

    deleting = true;
    el.confirmDeleteButton.disabled = true;
    el.confirmDeleteButton.textContent = 'Memadam...';

    try {
      await api(`/api/admin/chats/${encodeURIComponent(chat.id)}`, { method: 'DELETE' });
      chats.delete(chat.id);
      closeDeleteModal();
      showEmpty();
      renderConversationList();
      showToast('Perbualan telah dipadam.');
    } catch (error) {
      showToast(error.message || 'Gagal memadam perbualan.');
    } finally {
      deleting = false;
      el.confirmDeleteButton.disabled = false;
      el.confirmDeleteButton.textContent = 'Ya, padam';
    }
  }

  // -------------------------------------------------------------------------
  // Input & realtime
  // -------------------------------------------------------------------------

  function resizeAdminInput() {
    const input = el.adminMessageInput;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    const chat = selectedId ? chats.get(selectedId) : null;
    const closed = chat?.status === 'closed';
    input.disabled = sending || closed;
    el.adminSendButton.disabled = closed || !input.value.trim() || sending;
    if (el.adminAttachButton) el.adminAttachButton.disabled = closed || sending;
  }

  function sendTyping(isTyping) {
    if (!selectedId) return;
    const chat = chats.get(selectedId);
    if (!chat || chat.status === 'closed') return;
    typingSent = isTyping;
    fetch(`/api/chat/${encodeURIComponent(selectedId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', isTyping }),
      keepalive: true,
    })
      .then((response) => response.text())
      .catch(() => {});
  }

  function stopTyping() {
    clearTimeout(typingStopTimer);
    if (typingSent) sendTyping(false);
  }

  function handleAdminTyping() {
    if (!selectedId) return;
    const chat = chats.get(selectedId);
    if (!chat || chat.status === 'closed') return;
    if (!typingSent) sendTyping(true);
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTyping, 1300);
  }

  async function sendAdminMessage(text) {
    if (!selectedId || sending) return;
    const id = selectedId;
    const chat = chats.get(id);
    if (chat?.status === 'closed') {
      showToast('Perbualan telah ditutup. Buka semula untuk membalas.');
      return;
    }
    sending = true;
    el.adminSendButton.disabled = true;
    el.adminMessageInput.disabled = true;

    try {
      const data = await api(`/api/chat/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ sender: 'admin', text }),
      });
      chats.set(data.chat.id, data.chat);
      el.adminMessageInput.value = '';
      resizeAdminInput();
      renderConversationList();
      renderChat(false);
      scrollToBottom();
    } catch (error) {
      showToast(error.message || 'Balasan gagal dihantar.');
      el.adminMessageInput.value = text;
      resizeAdminInput();
    } finally {
      sending = false;
      const current = selectedId ? chats.get(selectedId) : null;
      const closed = current?.status === 'closed';
      el.adminMessageInput.disabled = closed;
      el.adminSendButton.disabled = closed || !el.adminMessageInput.value.trim();
      if (!closed) el.adminMessageInput.focus();
      stopTyping();
    }
  }

  async function uploadAdminFile(file) {
    if (!selectedId || sending) return;
    const id = selectedId;
    const chat = chats.get(id);
    if (chat?.status === 'closed') {
      showToast('Perbualan telah ditutup. Buka semula untuk membalas.');
      return;
    }
    if (!file) return;

    sending = true;
    el.adminSendButton.disabled = true;
    el.adminMessageInput.disabled = true;
    el.adminAttachButton.disabled = true;

    try {
      const response = await fetch(
        `/api/chat/${encodeURIComponent(id)}/upload?sender=admin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name || 'Fail'),
          },
          body: file,
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Gagal memuat naik fail.');
      chats.set(data.chat.id, data.chat);
      renderConversationList();
      renderChat(false);
      scrollToBottom();
    } catch (error) {
      showToast(error.message || 'Gagal memuat naik fail.');
    } finally {
      sending = false;
      const current = selectedId ? chats.get(selectedId) : null;
      const closed = current?.status === 'closed';
      el.adminMessageInput.disabled = closed;
      el.adminSendButton.disabled = closed || !el.adminMessageInput.value.trim();
      el.adminAttachButton.disabled = closed;
      if (!closed) el.adminMessageInput.focus();
      stopTyping();
      el.adminFileInput.value = '';
    }
  }
  function setConnection(state, text) {
    el.connectionStatus.className = `connection-status ${state}`;
    el.connectionText.textContent = text;
  }

  function connect() {
    if (eventSource) eventSource.close();
    setConnection('connecting', 'Menyambungkan...');

    eventSource = new EventSource('/api/events?role=admin');

    eventSource.addEventListener('open', () => {
      setConnection('connected', 'Realtime aktif');
    });

    eventSource.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data);
        setConnection('connected', 'Realtime aktif');
        applySnapshot(payload.chats || []);
      } catch {
        // Abaikan payload tidak valid.
      }
    });

    eventSource.addEventListener('conversation', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.chat) applyChat(payload.chat);
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('presence', (event) => {
      try {
        const payload = JSON.parse(event.data);
        const chat = chats.get(payload.chatId);
        if (!chat) return;
        chat.online = Boolean(payload.online);
        renderConversationList();
        if (selectedId === payload.chatId) renderChat(false);
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('typing', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.role !== 'visitor' || payload.chatId !== selectedId) return;

        const chat = chats.get(selectedId);
        if (chat?.status === 'closed') {
          el.adminTyping.hidden = true;
          return;
        }
        el.adminTyping.hidden = !payload.isTyping;
        if (payload.isTyping && chat) {
          el.typingName.textContent = `${chat.name} sedang menaip...`;
          clearTimeout(typingTimer);
          typingTimer = setTimeout(() => {
            el.adminTyping.hidden = true;
          }, 4500);
          scrollToBottom();
        } else {
          clearTimeout(typingTimer);
        }
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('deleted', (event) => {
      try {
        const payload = JSON.parse(event.data);
        chats.delete(payload.chatId);
        if (selectedId === payload.chatId) showEmpty();
        renderConversationList();
        updateTitle();
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('error', () => {
      if (eventSource?.readyState === EventSource.CLOSED) {
        setConnection('disconnected', 'Koneksi terputus');
      } else {
        setConnection('connecting', 'Menyambung semula...');
      }
      verifySessionSoon();
    });
  }

  // -------------------------------------------------------------------------
  // Event listener
  // -------------------------------------------------------------------------

  function bindEvents() {
    el.loginForm.addEventListener('submit', submitLogin);

    el.togglePasswordButton.addEventListener('click', () => {
      const showing = el.loginPassword.type === 'text';
      el.loginPassword.type = showing ? 'password' : 'text';
      el.togglePasswordButton.textContent = showing ? 'Tunjuk' : 'Sembunyikan';
      el.togglePasswordButton.setAttribute(
        'aria-label',
        showing ? 'Tunjuk kata laluan' : 'Sembunyikan kata laluan'
      );
      el.loginPassword.focus();
    });

    el.changePasswordButton.addEventListener('click', openPasswordModal);
    el.logoutButton.addEventListener('click', logout);
    el.passwordForm.addEventListener('submit', submitPassword);
    el.passwordModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-password]')) closePasswordModal();
    });

    el.searchInput.addEventListener('input', () => {
      searchTerm = el.searchInput.value;
      renderConversationList();
    });

    document.querySelectorAll('.filter-button').forEach((button) => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.filter || 'all';
        document.querySelectorAll('.filter-button').forEach((item) => {
          const active = item === button;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
        renderConversationList();
      });
    });

    el.adminMessageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = el.adminMessageInput.value.trim();
      if (!text) return;
      sendAdminMessage(text);
    });

    if (el.adminAttachButton) {
      el.adminAttachButton.addEventListener('click', () => {
        if (sending) return;
        el.adminFileInput.click();
      });
      el.adminFileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (file) uploadAdminFile(file);
      });
    }

    el.adminMessageInput.addEventListener('input', () => {
      resizeAdminInput();
      if (el.adminMessageInput.value.trim()) handleAdminTyping();
      else stopTyping();
    });

    el.adminMessageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        el.adminMessageForm.requestSubmit();
      }
    });

    el.adminMessageInput.addEventListener('blur', stopTyping);

    el.quickReplies.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-reply]');
      if (!button) return;
      const chat = selectedId ? chats.get(selectedId) : null;
      if (!chat || chat.status === 'closed') return;
      el.adminMessageInput.value = button.dataset.reply || '';
      resizeAdminInput();
      el.adminMessageInput.focus();
      const length = el.adminMessageInput.value.length;
      el.adminMessageInput.setSelectionRange(length, length);
    });

    el.statusButton.addEventListener('click', updateChatStatus);
    el.deleteButton.addEventListener('click', openDeleteModal);
    el.backButton.addEventListener('click', () => {
      el.app.classList.remove('chat-open');
      stopTyping();
    });

    el.deleteModal.addEventListener('click', (event) => {
      if (event.target.closest('[data-close-modal]')) closeDeleteModal();
    });
    el.confirmDeleteButton.addEventListener('click', deleteSelectedChat);

    el.soundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, soundEnabled ? 'on' : 'off');
      updateSoundUI();
      if (soundEnabled) {
        ensureAudio();
        playNotification();
        showToast('Bunyi notifikasi diaktifkan.');
      } else {
        showToast('Bunyi notifikasi dimatikan.');
      }
    });

    document.addEventListener(
      'pointerdown',
      () => {
        ensureAudio();
      },
      { once: true }
    );

    document.addEventListener('visibilitychange', () => {
      if (!authenticated) return;
      updateTitle();
      if (
        document.visibilityState === 'visible' &&
        selectedId &&
        chats.get(selectedId)?.unreadAdmin > 0
      ) {
        markRead(selectedId);
      }
    });

    window.addEventListener('focus', () => {
      if (!authenticated) return;
      if (selectedId && chats.get(selectedId)?.unreadAdmin > 0) markRead(selectedId);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !el.passwordModal.hidden) {
        closePasswordModal();
        return;
      }

      if (!authenticated) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        el.searchInput.focus();
        el.searchInput.select();
        return;
      }

      if (event.key === 'Escape') {
        if (!el.deleteModal.hidden) {
          closeDeleteModal();
          return;
        }
        if (el.app.classList.contains('chat-open')) {
          el.app.classList.remove('chat-open');
          stopTyping();
        }
      }
    });
  }

  async function init() {
    bindEvents();
    updateSoundUI();
    resizeAdminInput();
    el.app.hidden = true;
    await checkSession();
  }

  init();
})();
