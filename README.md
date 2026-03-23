# FastSSH

Fast SSH on the web for managing remote sessions. Works with tmux to keep sessions alive — rejoin anytime.

## About

FastSSH is a Node.js web application that provides a browser-based SSH client with tmux integration. It allows you to connect to remote servers, create persistent terminal sessions, and reconnect to them from any device.

## Features

- **Web-based SSH terminal** — connect to remote servers from your browser
- **tmux session management** — sessions stay alive even after disconnecting
- **Session rejoin** — reconnect to existing tmux sessions at any time
- **Multi-session support** — manage multiple SSH connections simultaneously

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- npm or yarn
- tmux installed on the remote server(s)

## Installation

```bash
# Clone the repository
git clone https://github.com/innocomvn/fastssh.git
cd fastssh

# Install dependencies
npm install
```

## Usage

```bash
# Start the server
npm start

# Start in development mode
npm run dev
```

Then open your browser and navigate to `http://localhost:3000`.

## Configuration

Configure the application using environment variables or a `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HOST` | Server host | `0.0.0.0` |

## Project Structure

```
fastssh/
├── src/
│   └── server.js        # Express + WebSocket + SSH2 server
├── public/
│   ├── index.html       # Main HTML page
│   ├── style.css        # UI styles (dark theme)
│   └── app.js           # Frontend terminal logic
├── .env.example         # Environment variable template
├── package.json
└── README.md
```

## Tech Stack

- **Runtime:** Node.js + Express
- **Protocol:** SSH2 + WebSocket (ws)
- **Terminal:** xterm.js with fit & web-links addons
- **Session management:** tmux

## License

[MIT](LICENSE) — Copyright (c) 2026 Innocom
