'use strict';

(() => {
  const STORAGE_KEY = 'halodesk.chatId';
  const BASE_TITLE = 'FF Support — Laporkan Hacker & Masalah Game';

  const elements = {
    startScreen: document.getElementById('startScreen'),
    startForm: document.getElementById('startForm'),
    visitorName: document.getElementById('visitorName'),
    gameId: document.getElementById('gameId'),
    reportCategory: document.getElementById('reportCategory'),
    startButton: document.getElementById('startButton'),
    conversation: document.getElementById('conversation'),
    messages: document.getElementById('messages'),
    composerWrap: document.getElementById('composerWrap'),
    messageForm: document.getElementById('messageForm'),
    attachButton: document.getElementById('attachButton'),
    fileInput: document.getElementById('fileInput'),
    messageInput: document.getElementById('messageInput'),
    sendButton: document.getElementById('sendButton'),
    connectionBanner: document.getElementById('connectionBanner'),
    connectionBannerText: document.getElementById('connectionBannerText'),
    agentStatusDot: document.getElementById('agentStatusDot'),
    agentStatusText: document.getElementById('agentStatusText'),
    closedNote: document.getElementById('closedNote'),
    newChatButton: document.getElementById('newChatButton'),
    visitorTyping: document.getElementById('visitorTyping'),
    toast: document.getElementById('toast'),
  };

  let chatId = localStorage.getItem(STORAGE_KEY) || '';
  let chat = null;
  let eventSource = null;
  let typingTimer = null;
  let typingStopTimer = null;
  let typingSent = false;
  let toastTimer = null;
  let sending = false;
  let reading = false;

  function api(path, options = {}) {
    return fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || 'Berlaku ralat. Sila cuba lagi.');
        error.status = response.status;
        throw error;
      }
      return data;
    });
  }

  function updateTitle() {
    const unread = chat?.unreadVisitor || 0;
    document.title =
      unread > 0 && document.visibilityState !== 'visible'
        ? `(${unread}) ${BASE_TITLE}`
        : BASE_TITLE;
  }

  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 3200);
  }

  function showStartScreen() {
    elements.startScreen.hidden = false;
    elements.conversation.hidden = true;
    elements.composerWrap.hidden = true;
    elements.visitorTyping.hidden = true;
    elements.closedNote.hidden = true;
    elements.messageInput.value = '';
    elements.messageInput.style.height = '';
    elements.messageInput.disabled = true;
    elements.sendButton.disabled = true;
    document.title = BASE_TITLE;
    setTimeout(() => elements.visitorName.focus({ preventScroll: true }), 120);
  }

  function startNewChat() {
    stopTyping();
    localStorage.removeItem(STORAGE_KEY);
    chat = null;
    chatId = '';
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    elements.visitorTyping.hidden = true;
    elements.closedNote.hidden = true;
    showStartScreen();
  }

  function showConversation() {
    elements.startScreen.hidden = true;
    elements.conversation.hidden = false;
    elements.composerWrap.hidden = false;
  }

  function setChat(nextChat) {
    if (!nextChat) return;
    const previousCount = chat?.messages?.length || 0;
    const previousId = chat?.id;
    chat = nextChat;
    chatId = nextChat.id;
    localStorage.setItem(STORAGE_KEY, chatId);

    showConversation();
    updatePresence();
    renderMessages(previousId === chat.id ? previousCount : 0);
    updateTitle();

    if (chat.unreadVisitor > 0 && document.visibilityState === 'visible') {
      markRead();
    }
  }

  function updatePresence() {
    if (!chat) return;
    const online = Boolean(chat.adminOnline);

    elements.agentStatusDot.classList.toggle('offline', !online);
    const dot = elements.agentStatusText.querySelector('span');
    if (dot) dot.classList.toggle('offline', !online);
    elements.agentStatusText.lastChild.textContent = online
      ? ' Online — kami sedia membantu'
      : ' Pasukan sokongan akan segera menyertai';

    elements.connectionBanner.hidden = true;

    const closed = chat.status === 'closed';
    elements.closedNote.hidden = !closed;
    elements.messageInput.disabled = closed || sending;
    elements.sendButton.disabled = closed || sending || !elements.messageInput.value.trim();
    elements.attachButton.disabled = closed || sending;

    if (closed) {
      elements.messageInput.placeholder = 'Perbualan telah ditutup';
      elements.visitorTyping.hidden = true;
      stopTyping();
    } else {
      elements.messageInput.placeholder = 'Tulis mesej...';
    }
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

    const sameYear = date.getFullYear() === today.getFullYear();
    return new Intl.DateTimeFormat('ms-MY', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    }).format(date);
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
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
  function renderMessages(previousCount = 0) {
    if (!chat) return;

    const scroller = elements.messages;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100;
    const oldScrollTop = scroller.scrollTop;
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

      const outgoing = message.sender === 'visitor';
      const row = makeElement('div', `message ${outgoing ? 'out' : 'in'}`);
      if (!outgoing) {
        row.appendChild(makeElement('span', 'msg-avatar', 'H'));
      }

      const content = makeElement('div', 'message-content');
      if (message.attachment) {
        content.appendChild(renderAttachment(message.attachment));
      }
      if (message.text) {
        content.appendChild(makeElement('div', 'bubble', message.text));
      }
      content.appendChild(makeElement('div', 'message-time', formatTime(message.createdAt)));
      row.appendChild(content);
      fragment.appendChild(row);
    }

    scroller.replaceChildren(fragment);

    const hasNew = (chat.messages?.length || 0) > previousCount;
    if (nearBottom || hasNew) {
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      scroller.scrollTop = oldScrollTop;
    }
  }

  function connect() {
    if (!chatId) return;
    if (eventSource) eventSource.close();

    eventSource = new EventSource(
      `/api/events?role=visitor&chatId=${encodeURIComponent(chatId)}`
    );

    eventSource.addEventListener('open', () => {
      elements.connectionBanner.hidden = true;
    });

    eventSource.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.chat) setChat(payload.chat);
      } catch {
        // Abaikan payload yang tidak valid.
      }
    });

    eventSource.addEventListener('conversation', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.chat?.id === chatId) {
          setChat(payload.chat);
        }
      } catch {
        // Abaikan payload yang tidak valid.
      }
    });

    eventSource.addEventListener('presence', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (chat && typeof payload.adminOnline === 'boolean') {
          chat.adminOnline = payload.adminOnline;
          updatePresence();
        }
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('typing', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.chatId !== chatId || payload.role !== 'admin') return;
        if (chat?.status === 'closed') {
          elements.visitorTyping.hidden = true;
          return;
        }

        elements.visitorTyping.hidden = !payload.isTyping;
        clearTimeout(typingTimer);
        if (payload.isTyping) {
          typingTimer = setTimeout(() => {
            elements.visitorTyping.hidden = true;
          }, 4500);
          scrollToBottom();
        }
      } catch {
        // Abaikan.
      }
    });

    eventSource.addEventListener('deleted', () => {
      localStorage.removeItem(STORAGE_KEY);
      chat = null;
      chatId = '';
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      showStartScreen();
      showToast('Perbualan ini telah dipadam oleh admin.');
    });

    eventSource.addEventListener('error', () => {
      if (eventSource?.readyState === EventSource.CLOSED) {
        elements.connectionBannerText.textContent =
          'Sambungan terputus. Muat semula halaman untuk menyambung semula.';
      } else {
        elements.connectionBannerText.textContent = 'Menyambung semula...';
      }
      elements.connectionBanner.hidden = false;
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  async function markRead() {
    if (!chatId || reading || !(chat?.unreadVisitor > 0)) return;
    reading = true;
    let succeeded = false;
    try {
      await api(`/api/chat/${encodeURIComponent(chatId)}/read`, {
        method: 'POST',
        body: JSON.stringify({ role: 'visitor' }),
      });
      succeeded = true;
      if (chat) chat.unreadVisitor = 0;
      updateTitle();
    } catch {
      // Tidak kritikal.
    } finally {
      reading = false;
      if (succeeded && chat?.unreadVisitor > 0 && document.visibilityState === 'visible') {
        setTimeout(markRead, 80);
      }
    }
  }

  async function sendMessage(text) {
    if (!chatId || sending) return;
    if (chat?.status === 'closed') {
      showToast('Perbualan ini telah ditutup. Mulakan perbualan baharu untuk meneruskan.');
      return;
    }
    sending = true;
    elements.sendButton.disabled = true;
    elements.messageInput.disabled = true;

    try {
      const data = await api(`/api/chat/${encodeURIComponent(chatId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ sender: 'visitor', text }),
      });
      elements.messageInput.value = '';
      resizeInput();
      setChat(data.chat);
      scrollToBottom();
    } catch (error) {
      showToast(error.message || 'Mesej gagal dihantar.');
      elements.messageInput.value = text;
      resizeInput();
    } finally {
      sending = false;
      const closed = chat?.status === 'closed';
      elements.messageInput.disabled = closed;
      elements.sendButton.disabled = closed || !elements.messageInput.value.trim();
      if (!closed) elements.messageInput.focus();
      stopTyping();
    }
  }

  async function uploadFile(file) {
    if (!chatId || sending) return;
    if (chat?.status === 'closed') {
      showToast('Perbualan ini telah ditutup. Mulakan perbualan baharu untuk meneruskan.');
      return;
    }
    if (!file) return;

    sending = true;
    elements.sendButton.disabled = true;
    elements.messageInput.disabled = true;
    elements.attachButton.disabled = true;

    try {
      const response = await fetch(
        `/api/chat/${encodeURIComponent(chatId)}/upload?sender=visitor`,
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
      setChat(data.chat);
      scrollToBottom();
    } catch (error) {
      showToast(error.message || 'Gagal memuat naik fail.');
    } finally {
      sending = false;
      const closed = chat?.status === 'closed';
      elements.messageInput.disabled = closed;
      elements.sendButton.disabled = closed || !elements.messageInput.value.trim();
      elements.attachButton.disabled = closed;
      if (!closed) elements.messageInput.focus();
      stopTyping();
      elements.fileInput.value = '';
    }
  }
  function resizeInput() {
    const input = elements.messageInput;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 115)}px`;
    elements.sendButton.disabled =
      chat?.status === 'closed' || sending || !input.value.trim();
  }

  function sendTyping(isTyping) {
    if (!chatId || chat?.status === 'closed') return;
    typingSent = isTyping;
    fetch(`/api/chat/${encodeURIComponent(chatId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'visitor', isTyping }),
      keepalive: true,
    })
      .then((response) => response.text())
      .catch(() => {});
  }

  function stopTyping() {
    clearTimeout(typingStopTimer);
    if (typingSent) sendTyping(false);
  }

  function handleTyping() {
    if (chat?.status === 'closed') return;
    if (!typingSent) sendTyping(true);
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTyping, 1300);
  }

  function bindEvents() {
    elements.startForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = elements.visitorName.value.trim();
      const gameId = elements.gameId?.value.trim() || '';
      const category = elements.reportCategory?.value || '';
      if (!name) { elements.visitorName.focus(); return; }
      if (!gameId) { elements.gameId.focus(); return; }
      if (!category) { elements.reportCategory.focus(); return; }

      elements.startButton.disabled = true;
      const label = elements.startButton.querySelector('span');
      const previousLabel = label.textContent;
      label.textContent = 'Menyambungkan...';

      try {
        const data = await api('/api/chats', {
          method: 'POST',
          body: JSON.stringify({ name, gameId, category }),
        });
        chat = data.chat;
        chatId = data.chat.id;
        localStorage.setItem(STORAGE_KEY, chatId);
        elements.visitorName.blur();
        showConversation();
        renderMessages(0);
        updatePresence();
        connect();
        elements.messageInput.disabled = false;
        elements.messageInput.focus();
        scrollToBottom();
      } catch (error) {
        showToast(error.message || 'Tidak dapat memulakan perbualan.');
      } finally {
        elements.startButton.disabled = false;
        label.textContent = previousLabel;
      }
    });

    elements.newChatButton.addEventListener('click', startNewChat);

    elements.messageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = elements.messageInput.value.trim();
      if (!text) return;
      sendMessage(text);
    });

    elements.messageInput.addEventListener('input', () => {
      resizeInput();
      if (elements.messageInput.value.trim()) handleTyping();
      else stopTyping();
    });

    elements.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        elements.messageForm.requestSubmit();
      }
    });

    elements.attachButton.addEventListener('click', () => {
      if (chat?.status === 'closed' || sending) return;
      elements.fileInput.click();
    });
    elements.fileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) uploadFile(file);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        markRead();
      }
      updateTitle();
    });

    window.addEventListener('beforeunload', stopTyping);
  }

  async function init() {
    bindEvents();

    if (!chatId) {
      showStartScreen();
      return;
    }

    try {
      const data = await api(`/api/chat/${encodeURIComponent(chatId)}`);
      chat = data.chat;
      showConversation();
      renderMessages(0);
      updatePresence();
      connect();
      elements.messageInput.disabled = false;
      scrollToBottom();
    } catch (error) {
      if (error.status === 404) {
        localStorage.removeItem(STORAGE_KEY);
        chatId = '';
        showStartScreen();
      } else {
        showStartScreen();
        showToast('Tidak dapat menyambung ke pelayan. Sila muat semula.');
      }
    }
  }

  init();
})();
