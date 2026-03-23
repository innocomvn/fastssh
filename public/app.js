(() => {
  const $ = (sel) => document.querySelector(sel);
  const connectPanel = $('#connect-panel');
  const terminalContainer = $('#terminal-container');
  const connectForm = $('#connect-form');
  const btnConnect = $('#btn-connect');
  const btnDisconnect = $('#btn-disconnect');
  const btnListSessions = $('#btn-list-sessions');
  const btnSave = $('#btn-save');
  const sessionsList = $('#sessions-list');
  const savedConnectionsEl = $('#saved-connections');

  let term = null;
  let fitAddon = null;
  let ws = null;

  const STORAGE_KEY = 'fastssh_connections';
  const LAST_USED_KEY = 'fastssh_last_used';

  // --- Saved Connections (localStorage) ---

  function getSavedConnections() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
  }

  function saveConnections(list) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function saveConnection(params) {
    const list = getSavedConnections();
    const key = `${params.username}@${params.host}:${params.port}`;
    const existing = list.findIndex(c => `${c.username}@${c.host}:${c.port}` === key);
    const entry = { ...params, savedAt: Date.now() };
    if (existing >= 0) {
      list[existing] = entry;
    } else {
      list.unshift(entry);
    }
    saveConnections(list);
    renderSavedConnections();
  }

  function deleteConnection(index) {
    const list = getSavedConnections();
    list.splice(index, 1);
    saveConnections(list);
    renderSavedConnections();
  }

  function fillForm(conn) {
    $('#host').value = conn.host || '';
    $('#port').value = conn.port || 22;
    $('#username').value = conn.username || '';
    $('#password').value = conn.password || '';
    $('#privateKey').value = conn.privateKey || '';
    $('#tmux-session').value = conn.tmuxSession || '';

    // Switch auth tab
    const authMethod = conn.privateKey ? 'key' : 'password';
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.auth === authMethod);
    });
    $('#password-group').classList.toggle('hidden', authMethod !== 'password');
    $('#key-group').classList.toggle('hidden', authMethod !== 'key');
  }

  function setLastUsed(params) {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(params));
  }

  function renderSavedConnections() {
    const list = getSavedConnections();
    if (list.length === 0) {
      savedConnectionsEl.innerHTML = '';
      return;
    }
    savedConnectionsEl.innerHTML = `
      <div class="saved-label">Saved Connections</div>
      ${list.map((c, i) => `
        <div class="saved-item" data-index="${i}">
          <div class="saved-item-info">
            <div class="saved-item-name">${escapeHtml(c.username)}@${escapeHtml(c.host)}</div>
            <div class="saved-item-detail">:${c.port}${c.tmuxSession ? ' / tmux: ' + escapeHtml(c.tmuxSession) : ''}</div>
          </div>
          <button class="saved-item-delete" data-index="${i}" title="Delete">&times;</button>
        </div>
      `).join('')}
    `;

    // Click to fill form
    savedConnectionsEl.querySelectorAll('.saved-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('saved-item-delete')) return;
        fillForm(list[parseInt(el.dataset.index)]);
      });
    });

    // Delete button
    savedConnectionsEl.querySelectorAll('.saved-item-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConnection(parseInt(btn.dataset.index));
      });
    });
  }

  // Save button
  btnSave.addEventListener('click', () => {
    const params = getConnParams();
    if (!params.host || !params.username) return;
    saveConnection(params);
  });

  // Load saved connections and auto-fill last used on startup
  renderSavedConnections();
  try {
    const last = JSON.parse(localStorage.getItem(LAST_USED_KEY));
    if (last) fillForm(last);
  } catch {}

  // Auth tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const method = tab.dataset.auth;
      $('#password-group').classList.toggle('hidden', method !== 'password');
      $('#key-group').classList.toggle('hidden', method !== 'key');
    });
  });

  // Get connection params from form
  function getConnParams() {
    return {
      host: $('#host').value.trim(),
      port: parseInt($('#port').value) || 22,
      username: $('#username').value.trim(),
      password: $('#password').value,
      privateKey: $('#privateKey').value,
      tmuxSession: $('#tmux-session').value.trim(),
    };
  }

  // List tmux sessions
  btnListSessions.addEventListener('click', async () => {
    const params = getConnParams();
    if (!params.host || !params.username) return;

    btnListSessions.textContent = '...';
    btnListSessions.disabled = true;

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();

      if (data.error) {
        sessionsList.innerHTML = `<div class="status-msg error">${escapeHtml(data.error)}</div>`;
      } else if (data.sessions.length === 0) {
        sessionsList.innerHTML = '<div class="status-msg">No tmux sessions found</div>';
      } else {
        sessionsList.innerHTML = data.sessions.map(s => `
          <div class="session-item" data-name="${escapeHtml(s.name)}">
            <span class="session-name">${escapeHtml(s.name)}</span>
            <span class="session-badge ${s.attached ? 'attached' : ''}">${s.attached ? 'attached' : s.windows + ' windows'}</span>
          </div>
        `).join('');

        sessionsList.querySelectorAll('.session-item').forEach(item => {
          item.addEventListener('click', () => {
            $('#tmux-session').value = item.dataset.name;
          });
        });
      }
      sessionsList.classList.remove('hidden');
    } catch (err) {
      sessionsList.innerHTML = `<div class="status-msg error">Connection failed</div>`;
      sessionsList.classList.remove('hidden');
    } finally {
      btnListSessions.textContent = 'List';
      btnListSessions.disabled = false;
    }
  });

  // Connect
  connectForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const params = getConnParams();
    if (!params.host || !params.username) return;
    connect(params);
  });

  function connect(params) {
    btnConnect.textContent = 'Connecting...';
    btnConnect.disabled = true;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'connect',
        ...params,
        cols: 80,
        rows: 24,
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'connected') {
        setLastUsed(params);
        showTerminal(params);
      } else if (msg.type === 'data') {
        const bytes = atob(msg.data);
        term.write(bytes);
      } else if (msg.type === 'error') {
        alert('SSH Error: ' + msg.message);
        resetConnect();
      } else if (msg.type === 'disconnected') {
        disconnect();
      }
    };

    ws.onerror = () => {
      alert('WebSocket connection failed');
      resetConnect();
    };

    ws.onclose = () => {
      if (term) disconnect();
    };
  }

  function showTerminal(params) {
    connectPanel.classList.add('hidden');
    terminalContainer.classList.remove('hidden');
    $('#connection-info').textContent = `${params.username}@${params.host}:${params.port}${params.tmuxSession ? ' [tmux: ' + params.tmuxSession + ']' : ''}`;

    term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc',
      },
    });

    fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open($('#terminal'));
    fitAddon.fit();

    // Send resize to server
    const dims = fitAddon.proposeDimensions();
    if (dims) {
      ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }

    // Handle user input
    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data: btoa(data) }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon && term) {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      }
    });
    resizeObserver.observe($('#terminal'));

    term.focus();
  }

  // Disconnect
  btnDisconnect.addEventListener('click', disconnect);

  function disconnect() {
    if (ws) {
      ws.close();
      ws = null;
    }
    if (term) {
      term.dispose();
      term = null;
      fitAddon = null;
    }
    terminalContainer.classList.add('hidden');
    connectPanel.classList.remove('hidden');
    resetConnect();
  }

  function resetConnect() {
    btnConnect.textContent = 'Connect';
    btnConnect.disabled = false;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
