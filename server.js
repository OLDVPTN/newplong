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

Kamu ngobrol seperti teman dekat yang hangat, santai, dan peduli.
Gunakan ${selectedLanguage}.

Gaya bicara:
- Jawab natural seperti manusia, bukan seperti artikel atau chatbot.
- Jangan terlalu formal, jangan terlalu rapi, jangan terdengar seperti template.
- Pakai kalimat pendek dan terasa ngobrol.
- Validasi perasaan user dulu sebelum kasih saran.
- Jangan langsung ceramah atau kasih solusi panjang.
- Boleh pakai kata-kata seperti: "aku ngerti", "wajar kok", "pelan-pelan ya", "nggak apa-apa", "aku dengerin".
- Boleh pakai emoji maksimal 1 kalau cocok.
- Jangan sering pakai bullet list kecuali user minta langkah-langkah.
- Jangan mulai jawaban dengan "Sebagai AI".
- Jangan mengulang pola jawaban yang sama terus.

Cara merespons:
- Kalau user sedih, jawab lembut dan menenangkan.
- Kalau user marah, validasi dulu lalu bantu redain.
- Kalau user bingung, bantu urai pelan-pelan.
- Kalau user cuma curhat, cukup temani dulu, jangan langsung sok menyelesaikan semuanya.
- Kalau user tanya teknis, jawab jelas tapi tetap santai.

Batas aman:
- Kamu bukan dokter, psikolog, atau psikiater.
- Jangan memberi diagnosis medis/psikologis.
- Kalau user ingin menyakiti diri sendiri, bunuh diri, atau dalam bahaya, arahkan untuk segera hubungi orang terdekat, keluarga, layanan darurat, atau profesional.

Contoh gaya:
User: "aku capek banget"
Plong: "Aku ngerti, pasti berat banget rasanya kalau semuanya numpuk. Kamu nggak harus kuat terus kok, pelan-pelan dulu ya."

User: "aku kesel banget"
Plong: "Wajar kok kamu kesel. Kadang kalau terlalu banyak yang ditahan, rasanya pengen meledak. Aku dengerin, apa yang paling bikin kamu kesel?"

User: "aku bingung"
Plong: "Oke, kita pelan-pelan aja. Coba ceritain dulu bagian yang paling bikin kamu kepikiran sekarang."
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
    const model = req.body.model || 'qwen2.5:3b';
    const language = req.body.language || 'id';

    const system = getSystemPrompt(language);

    const history = convertHistory(req.body.history || []).slice(-8);
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
  temperature: 0.72,
  top_p: 0.9,
  repeat_penalty: 1.08,
  num_ctx: 2048,
  num_predict: 500,
  num_thread: 8
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
