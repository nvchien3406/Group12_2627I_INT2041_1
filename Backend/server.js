const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const http = require('http');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const PORT = 3000;
const BASE_DIR = path.resolve(process.argv[2] || path.join(__dirname, 'file'));

// ------------------------------------------------------------------
// NATIVE WEBSOCKET SERVER FOR GESTURES
// ------------------------------------------------------------------
const wsClients = new Set();
let gestureSequence = 0;

function broadcastGesture(gesture, extra = {}) {
  gestureSequence++;
  const payload = JSON.stringify({
    gesture,
    sequence: gestureSequence,
    timestamp: Date.now(),
    ...extra
  });
  const dataBuffer = Buffer.from(payload);
  const len = dataBuffer.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  const frame = Buffer.concat([header, dataBuffer]);

  for (const client of wsClients) {
    if (client.writable) {
      try {
        client.write(frame);
      } catch (_) {
        wsClients.delete(client);
      }
    } else {
      wsClients.delete(client);
    }
  }
}

server.on('upgrade', (req, socket, head) => {
  // Support both /ws/gesture and /ws/gesture/:session
  if (!req.url.startsWith('/ws/gesture')) {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + accept
  ];
  socket.write(headers.join('\r\n') + '\r\n\r\n');
  wsClients.add(socket);

  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());

// Serve PDF.js assets from node_modules
const PDFJS_DIST_PATH = path.resolve(__dirname, '../../node_modules/pdfjs-dist');
app.use('/pdfjs', express.static(path.join(PDFJS_DIST_PATH, 'build')));
app.use('/pdfjs', express.static(PDFJS_DIST_PATH));
app.use('/node_modules/pdfjs-dist', express.static(PDFJS_DIST_PATH));

// Fallback aliases for pdf.js and pdf.worker.js requests
app.get(['/pdfjs/pdf.js', '/node_modules/pdfjs-dist/build/pdf.js'], (req, res) => {
  res.sendFile(path.join(PDFJS_DIST_PATH, 'build/pdf.mjs'));
});
app.get(['/pdfjs/pdf.worker.js', '/node_modules/pdfjs-dist/build/pdf.worker.js'], (req, res) => {
  res.sendFile(path.join(PDFJS_DIST_PATH, 'build/pdf.worker.mjs'));
});
// Serve static frontend UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Path validation helper (prevents directory traversal exploits)
const resolvePath = (reqPath) => {
  const targetPath = path.normalize(path.join(BASE_DIR, reqPath || ''));
  if (!targetPath.startsWith(BASE_DIR)) {
    throw new Error('Forbidden: Access outside root directory');
  }
  return targetPath;
};

// ------------------------------------------------------------------
// FILE VIEWING & PREVIEW (PDF.js Compatible)
// ------------------------------------------------------------------

// Stream file inline with proper MIME type and Range headers
app.get('/api/view', async (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is a directory.' });
    }

    // Force inline display in PDF.js / browser tab
    res.setHeader('Content-Disposition', 'inline');

    // Enable CORS if accessing PDF.js from a different origin/CDN
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Encoding, Content-Length, Content-Range');

    res.sendFile(filePath);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Download file as attachment
app.get('/api/download', (req, res) => {
  try {
    const filePath = resolvePath(req.query.path);
    res.download(filePath);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// List files in directory
app.get('/api/files', async (req, res) => {
  try {
    const dirPath = resolvePath(req.query.path);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fs.stat(fullPath);
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: stats.size,
          mtime: stats.mtime,
        };
      })
    );

    res.json({ currentPath: req.query.path || '/', files });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Upload files
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files provided.' });
    }

    const targetDirPath = resolvePath(req.body.path || '/');

    for (const file of req.files) {
      const destinationPath = path.join(targetDirPath, file.originalname);
      if (!destinationPath.startsWith(BASE_DIR)) throw new Error('Forbidden path.');
      await fs.writeFile(destinationPath, file.buffer);
    }

    res.json({ message: 'Files uploaded successfully.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create folder
app.post(['/api/create-folder', '/api/folder'], async (req, res) => {
  try {
    const folderName = (req.body.name || '').trim();
    if (!folderName) {
      return res.status(400).json({ error: 'Folder name is required.' });
    }

    if (folderName.includes('/') || folderName.includes('\\') || folderName === '.' || folderName === '..') {
      return res.status(400).json({ error: 'Invalid folder name.' });
    }

    const parentDir = resolvePath(req.body.path || '/');
    const newFolderPath = path.join(parentDir, folderName);
    if (!newFolderPath.startsWith(BASE_DIR)) {
      throw new Error('Forbidden path.');
    }

    await fs.mkdir(newFolderPath);
    res.json({ message: 'Folder created successfully.', name: folderName });
  } catch (err) {
    if (err.code === 'EEXIST') {
      return res.status(400).json({ error: 'A file or folder with this name already exists.' });
    }
    res.status(400).json({ error: err.message });
  }
});

// Delete file or folder
app.delete('/api/delete', async (req, res) => {
  try {
    const targetPath = resolvePath(req.query.path || req.body.path);
    if (targetPath === BASE_DIR) {
      return res.status(400).json({ error: 'Cannot delete root directory.' });
    }

    await fs.rm(targetPath, { recursive: true, force: true });
    res.json({ message: 'Item deleted.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Gesture trigger endpoint (for testing, external bridge, or manual triggers)
app.post('/api/gesture', (req, res) => {
  const gesture = req.body.gesture || req.query.gesture;
  if (!gesture || !['SWIPE_LEFT', 'SWIPE_RIGHT'].includes(gesture)) {
    return res.status(400).json({ error: 'Invalid gesture. Must be SWIPE_LEFT or SWIPE_RIGHT.' });
  }
  broadcastGesture(gesture, req.body);
  res.json({ ok: true, gesture, sequence: gestureSequence });
});

server.listen(PORT, () => {
  console.log(`File Manager running on http://localhost:${PORT}`);
});