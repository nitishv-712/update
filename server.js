require('dotenv').config();
const express    = require('express');
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
// Returns a signed upload URL so the client can upload directly to Supabase Storage
app.post('/api/admin/upload-url', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });

    const ts       = Date.now();
    const safe     = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const filePath = `${ts}-${safe}`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUploadUrl(filePath);

    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);

    res.json({ signedUrl: data.signedUrl, publicUrl: urlData.publicUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Saves metadata after client has uploaded files directly to Supabase Storage
app.post('/api/admin/upload', async (req, res) => {
  try {
    const { androidUrl, windowsUrl, description, version } = req.body;

    if (!androidUrl && !windowsUrl) {
      return res.status(400).json({ error: 'Provide at least one of androidUrl or windowsUrl.' });
    }

    const meta = await readMeta();

    if (androidUrl) meta.androidUrl = androidUrl;
    if (windowsUrl) meta.windowsUrl = windowsUrl;
    meta.version     = version || meta.version || '1.0.0';
    meta.description = description?.trim() || meta.description || '';
    meta.updatedAt   = new Date().toISOString();

    await writeMeta(meta);

    res.json({ success: true, meta });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

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
