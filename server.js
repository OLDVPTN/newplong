const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

const PORT = process.env.PORT || 3000;
const OLLAMA_URL = 'https://desktop-bh6k0ih.taildd515d.ts.net';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function normalizeLanguage(language) {
  const map = {
    id: 'Bahasa Indonesia santai',
    'id-formal': 'Bahasa Indonesia formal',
    en: 'English',
    'jv-ngoko': 'Bahasa Jawa ngoko',
    'jv-krama': 'Bahasa Jawa krama',
    su: 'Bahasa Sunda',
    ms: 'Bahasa Melayu'
  };

  return map[language] || language || 'Bahasa Indonesia santai';
}

function getSystemPrompt(language) {
  const selectedLanguage = normalizeLanguage(language);

  return `
Kamu adalah Plong, teman curhat virtual di aplikasi VokaMon.

Cara ngobrol kamu:
- Jawab seperti teman dekat yang hangat, bukan seperti chatbot formal.
- Pakai bahasa sehari-hari yang natural, santai, dan manusiawi.
- Jangan terlalu rapi seperti artikel.
- Jangan kebanyakan poin kecuali user minta.
- Jangan terlalu panjang. Cukup 2 sampai 4 kalimat.
- Validasi perasaan user dulu sebelum kasih saran.
- Boleh pakai kata seperti "aku ngerti", "wajar kok", "pelan-pelan ya", "nggak apa-apa".
- Boleh pakai emoji secukupnya, maksimal 1 emoji.
- Jangan terdengar menggurui.
- Jangan terlalu sering bilang "saya sebagai AI".

Aturan penting:
- Jangan memberi diagnosis medis atau psikologis.
- Jangan mengaku sebagai dokter, psikolog, atau psikiater.
- Kalau user terlihat ingin menyakiti diri sendiri atau dalam bahaya, arahkan untuk segera menghubungi orang terdekat, keluarga, layanan darurat, atau profesional.

Gaya jawaban:
- Gunakan ${selectedLanguage}.
- Kalau user sedih, jawab lembut.
- Kalau user marah, tenangkan dulu.
- Kalau user bingung, bantu pecah masalahnya pelan-pelan.
- Kalau user cuma curhat, jangan langsung kasih solusi panjang.

Contoh gaya:
User: "aku capek banget"
Plong: "Aku ngerti, pasti berat banget rasanya kalau semuanya numpuk. Kamu nggak harus kuat terus kok, pelan-pelan dulu ya."

User: "semuanya bikin kesel"
Plong: "Wajar banget kalau kamu kesel, apalagi kalau rasanya banyak hal nggak jalan sesuai harapan. Tarik napas dulu bentar, aku dengerin kok."

User: "aku bingung harus gimana"
Plong: "Oke, kita urai pelan-pelan ya. Ceritain dulu bagian yang paling bikin kamu kepikiran sekarang."
`.trim();
}

function convertHistory(history = []) {
  return history
    .map((item) => {
      let role = 'user';

      if (item.role === 'model' || item.role === 'assistant') {
        role = 'assistant';
      }

      const content = Array.isArray(item.parts)
        ? item.parts.map((p) => p.text || '').join('\n').trim()
        : String(item.content || item.text || '').trim();

      if (!content) return null;

      return {
        role,
        content: content.slice(0, 2000)
      };
    })
    .filter(Boolean);
}

app.get('/api/health', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();

    res.json({
      ok: true,
      ollama: OLLAMA_URL,
      models: data.models?.map((m) => m.name) || []
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Ollama belum bisa dihubungi. Pastikan aplikasi Ollama sedang berjalan.'
    });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await r.json();

    res.json({
      ok: true,
      models: data.models?.map((m) => m.name) || []
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      models: [],
      error: 'Gagal mengambil daftar model dari Ollama.'
    });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const model = req.body.model || 'qwen3.5:0.8b';
    const language = req.body.language || 'id';

    const system = getSystemPrompt(language);

    const history = convertHistory(req.body.history || []).slice(-12);
    const directMessage = String(req.body.message || '').trim();

    if (directMessage) {
      const lastMessage = history[history.length - 1];

      if (!lastMessage || lastMessage.content !== directMessage) {
        history.push({
          role: 'user',
          content: directMessage.slice(0, 2000)
        });
      }
    }

    if (history.length === 0) {
      return res.status(400).json({
        reply: 'Pesannya masih kosong nih.'
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: '5m',
        messages: [
          {
            role: 'system',
            content: system
          },
          ...history
        ],
        options: {
          temperature: 0.9,
          top_p: 0.9,
          repeat_penalty: 1.08,

          // Aman untuk RAM 8GB. Jangan pakai 4096 dulu.
          num_ctx: 1024,

          // Biar jawaban nggak kepanjangan dan nggak makan RAM berlebihan.
          num_predict: 180,

          // i7-2600K punya 4 core / 8 thread.
          num_thread: 4
        }
      })
    });

    clearTimeout(timeout);

    const text = await ollamaRes.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }

    if (!ollamaRes.ok) {
      return res.status(ollamaRes.status).json({
        reply: `Model AI lokal belum siap. Coba jalankan di CMD: ollama pull ${model}`,
        error: data.error || 'Ollama request failed'
      });
    }

    res.json({
      reply: data.message?.content || 'Aku belum bisa jawab sekarang.'
    });
  } catch (error) {
    console.error(error);

    if (error.name === 'AbortError') {
      return res.status(504).json({
        reply: 'Model AI lokal kelamaan merespons. Coba pakai model yang lebih ringan atau tutup aplikasi lain dulu.',
        error: 'Request timeout'
      });
    }

    res.status(500).json({
      reply: 'Server AI lokal lagi bermasalah. Pastikan Ollama dan server Node.js aktif.',
      error: error.message
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VokaMon jalan di http://localhost:${PORT}`);
  console.log(`Backend tersambung ke Ollama: ${OLLAMA_URL}`);
});
