require('dotenv').config();
const express    = require('express');
const multer     = require('multer');
const path       = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ── Supabase ──────────────────────────────────────────────────────────────────
// Set these in Vercel environment variables:
//   SUPABASE_URL          → https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  → service_role key (not anon key)
//   SUPABASE_BUCKET       → bucket name, e.g. "releases"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const BUCKET = process.env.SUPABASE_BUCKET || 'releases';

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseVersion(filename) {
  const match = filename.match(/[v_\-]?(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/i);
  return match ? match[1] : null;
}

async function readMeta() {
  const { data, error } = await supabase
    .from('update_meta')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    return { version: null, description: '', androidUrl: null, windowsUrl: null, updatedAt: null };
  }
  return {
    version:     data.version,
    description: data.description,
    androidUrl:  data.android_url,
    windowsUrl:  data.windows_url,
    updatedAt:   data.updated_at,
  };
}

async function writeMeta({ version, description, androidUrl, windowsUrl, updatedAt }) {
  await supabase.from('update_meta').upsert({
    id:          1,
    version,
    description,
    android_url: androidUrl,
    windows_url: windowsUrl,
    updated_at:  updatedAt,
  });
}

// Upload buffer to Supabase Storage, return public URL
async function uploadToSupabase(buffer, originalName) {
  const ts       = Date.now();
  const safe     = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const filePath = `${ts}-${safe}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType:  'application/octet-stream',
      upsert:       true,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

// ── Multer (memory — stream straight to Supabase) ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.apk', '.exe'].includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type: ${ext}. Only .apk and .exe allowed.`));
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

app.get('/', (req, res) => res.json({ msg: 'Update Server Running!' }));

// ── Public API ────────────────────────────────────────────────────────────────
app.get('/api/updates/latest', async (req, res) => {
  try {
    const meta = await readMeta();
    if (!meta.version) return res.status(404).json({ error: 'No release uploaded yet.' });
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.post(
  '/api/admin/upload',
  upload.fields([
    { name: 'android', maxCount: 1 },
    { name: 'windows', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const androidFile = req.files?.android?.[0];
      const windowsFile = req.files?.windows?.[0];

      if (!androidFile && !windowsFile) {
        return res.status(400).json({ error: 'Upload at least one file (APK or EXE).' });
      }

      const meta        = await readMeta();
      const sourceFile  = androidFile || windowsFile;
      const detectedVersion = parseVersion(sourceFile.originalname);

      if (androidFile) {
        meta.androidUrl = await uploadToSupabase(androidFile.buffer, androidFile.originalname);
      }
      if (windowsFile) {
        meta.windowsUrl = await uploadToSupabase(windowsFile.buffer, windowsFile.originalname);
      }

      meta.version     = detectedVersion || meta.version || '1.0.0';
      meta.description = req.body.description?.trim() || meta.description || '';
      meta.updatedAt   = new Date().toISOString();

      await writeMeta(meta);

      res.json({ success: true, meta, detected: { version: detectedVersion } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  }
);

app.get('/api/admin/meta', async (req, res) => {
  try {
    res.json(await readMeta());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/reset', async (req, res) => {
  try {
    await writeMeta({ version: null, description: '', androidUrl: null, windowsUrl: null, updatedAt: null });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Pages ─────────────────────────────────────────────────────────────────────
app.get('/updates', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

module.exports = app;
