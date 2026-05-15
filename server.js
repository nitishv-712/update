const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Directories ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join('/tmp', 'uploads');
const META_FILE   = path.join('/tmp', 'update-meta.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Parse version from filename.
 * Supports patterns like:
 *   myapp-1.2.3.apk  →  1.2.3
 *   app_v2.0.1.exe   →  2.0.1
 *   release-3.apk    →  3
 */
function parseVersion(filename) {
  const match = filename.match(/[v_\-]?(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/i);
  return match ? match[1] : null;
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch {
    return { version: null, description: '', androidUrl: null, windowsUrl: null, updatedAt: null };
  }
}

function writeMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

// ── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Keep original name, but prefix with timestamp to avoid collisions
    const ts   = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${ts}-${safe}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (['.apk', '.exe'].includes(ext)) return cb(null, true);
  cb(new Error(`Unsupported file type: ${ext}. Only .apk and .exe allowed.`));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB cap
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
// app.use(express.static(path.join(__dirname, 'public'))); // Removed for Vercel

// Serve uploaded files at /downloads/<filename>
app.use('/downloads', express.static(UPLOADS_DIR));
app.get('/', (req, res) => { res.json({ msg: 'Update Server Running!' }); });
// ── Public API ────────────────────────────────────────────────────────────────
// GET /api/updates/latest  — consumed by your apps
app.get('/api/updates/latest', (req, res) => {
  const meta = readMeta();
  if (!meta.version) return res.status(404).json({ error: 'No release uploaded yet.' });
  res.json(meta);
});

// ── Admin API ─────────────────────────────────────────────────────────────────
// POST /api/admin/upload  — called by the admin UI
app.post(
  '/api/admin/upload',
  upload.fields([
    { name: 'android', maxCount: 1 },
    { name: 'windows', maxCount: 1 }
  ]),
  (req, res) => {
    const androidFile = req.files?.android?.[0];
    const windowsFile = req.files?.windows?.[0];

    if (!androidFile && !windowsFile) {
      return res.status(400).json({ error: 'Upload at least one file (APK or EXE).' });
    }

    const meta = readMeta();

    // Parse version from whichever file was uploaded (prefer android)
    const sourceFile = androidFile || windowsFile;
    const detectedVersion = parseVersion(sourceFile.originalname);

    if (androidFile) {
      meta.androidUrl = `/downloads/${androidFile.filename}`;
    }
    if (windowsFile) {
      meta.windowsUrl = `/downloads/${windowsFile.filename}`;
    }

    meta.version     = detectedVersion || meta.version || '1.0.0';
    meta.description = req.body.description?.trim() || meta.description || '';
    meta.updatedAt   = new Date().toISOString();

    writeMeta(meta);

    res.json({
      success: true,
      meta,
      detected: { version: detectedVersion }
    });
  }
);

// GET /api/admin/meta  — lets the UI show current state on load
app.get('/api/admin/meta', (req, res) => res.json(readMeta()));

// DELETE /api/admin/reset  — wipe meta (files stay on disk)
app.delete('/api/admin/reset', (req, res) => {
  writeMeta({ version: null, description: '', androidUrl: null, windowsUrl: null, updatedAt: null });
  res.json({ success: true });
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/updates', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin.html'))
);
app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'admin.html'))
);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

// For Vercel serverless
module.exports = app;

// For local development (comment out for Vercel)
// app.listen(PORT, () => console.log(`Server running → http://localhost:${PORT}`));
