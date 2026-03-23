require('dotenv').config();
const http = require('http');
const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Client } = require('ssh2');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// API: list tmux sessions on a remote host
app.post('/api/sessions', (req, res) => {
  const { host, port, username, password, privateKey } = req.body;

  const conn = new Client();
  conn.on('ready', () => {
    conn.exec('tmux list-sessions -F "#{session_name}:#{session_windows}:#{session_attached}" 2>/dev/null || echo ""', (err, stream) => {
      if (err) {
        conn.end();
        return res.status(500).json({ error: err.message });
      }
      let data = '';
      stream.on('data', (chunk) => { data += chunk; });
      stream.stderr.on('data', () => {});
      stream.on('close', () => {
        conn.end();
        const sessions = data.trim().split('\n')
          .filter(line => line.length > 0)
          .map(line => {
            const [name, windows, attached] = line.split(':');
            return { name, windows: parseInt(windows) || 0, attached: attached === '1' };
          });
        res.json({ sessions });
      });
    });
  });
  conn.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  const connOpts = { host, port: port || 22, username };
  if (privateKey) connOpts.privateKey = privateKey;
  else if (password) connOpts.password = password;
  conn.connect(connOpts);
});

// WebSocket: SSH terminal connection
wss.on('connection', (ws) => {
  let sshConn = null;
  let sshStream = null;

  ws.on('message', (msg) => {
    const message = JSON.parse(msg);

    if (message.type === 'connect') {
      const { host, port, username, password, privateKey, tmuxSession, cols, rows } = message;

      sshConn = new Client();
      sshConn.on('ready', () => {
        // Build tmux command
        let tmuxCmd;
        if (tmuxSession) {
          // Attach to existing session or create it
          tmuxCmd = `tmux attach-session -t ${shellEscape(tmuxSession)} 2>/dev/null || tmux new-session -s ${shellEscape(tmuxSession)}`;
        } else {
          tmuxCmd = 'tmux new-session';
        }

        sshConn.shell({ cols: cols || 80, rows: rows || 24, term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
            return;
          }

          sshStream = stream;

          // Send tmux command
          stream.write(tmuxCmd + '\n');

          stream.on('data', (data) => {
            ws.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
          });

          stream.stderr.on('data', (data) => {
            ws.send(JSON.stringify({ type: 'data', data: data.toString('base64') }));
          });

          stream.on('close', () => {
            ws.send(JSON.stringify({ type: 'disconnected' }));
            sshConn.end();
          });

          ws.send(JSON.stringify({ type: 'connected' }));
        });
      });

      sshConn.on('error', (err) => {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      });

      const connOpts = { host, port: port || 22, username };
      if (privateKey) connOpts.privateKey = privateKey;
      else if (password) connOpts.password = password;
      sshConn.connect(connOpts);

    } else if (message.type === 'data') {
      // Terminal input from browser
      if (sshStream) {
        sshStream.write(Buffer.from(message.data, 'base64'));
      }

    } else if (message.type === 'resize') {
      if (sshStream) {
        sshStream.setWindow(message.rows, message.cols, 0, 0);
      }
    }
  });

  ws.on('close', () => {
    if (sshStream) sshStream.close();
    if (sshConn) sshConn.end();
  });
});

function shellEscape(str) {
  return str.replace(/[^a-zA-Z0-9_\-]/g, '');
}

server.listen(PORT, HOST, () => {
  console.log(`FastSSH running at http://${HOST}:${PORT}`);
});
