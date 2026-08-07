import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';


const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY ?? '';

function hasNonLatinChars(text: string): boolean {
  return /[\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u3040-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\u1100-\u11FF]/.test(text);
}

function isLikelyIndonesian(text: string): boolean {
  const idWords = /\b(dan|yang|di|ke|dari|untuk|dengan|ini|itu|adalah|tidak|akan|ada|bisa|sudah|saya|kamu|aku|kau|dia|kami|mereka|satu|apa|juga|hanya|pada|dalam|seperti|karena|agar|mau|punya|kalau|tapi|atau|jadi|kalau|bukan|belum|masih|sangat|sekali|lebih|lagi|semua|banyak|cinta|hati|mata|jiwa|rindu|sayang|dunia|hidup|malam|pagi|hujan)\b/i;
  return idWords.test(text);
}

export const postRomanize = async (req: Request, res: Response) => {
  try {
    const lines = req.body.lines || [];
    
    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: 'Lines must be an array' });
    }

    if (lines.length > 100) {
      return res.status(400).json({ error: 'Too many lines' });
    }

    const totalChars = lines.reduce((sum, line) => sum + (line?.length || 0), 0);
    if (totalChars > 10000) {
      return res.status(400).json({ error: 'Payload too large' });
    }

    const indicesToRomanize: number[] = [];
    const textsToRomanize: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const text = lines[i].trim();
      if (!text || text === '●●●' || text === '...' || /^[●·.…♪]+$/.test(text)) continue;
      if (hasNonLatinChars(text) && !isLikelyIndonesian(text)) {
        indicesToRomanize.push(i);
        textsToRomanize.push(text);
      }
    }

    if (textsToRomanize.length === 0) {
      return res.json({ romanizations: {} });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-3.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const numberedLines = textsToRomanize
      .map((t, i) => `${i + 1}. ${t}`)
      .join('\n');

    const prompt = `You are a strict transliteration bot. Convert the following text from their original script to Latin/Roman alphabet (romanization).

CRITICAL RULES:
1. ONLY romanize the exact text provided. DO NOT try to guess the song or fetch lyrics from memory. Provide a direct, literal transliteration.
2. UNIVERSAL SPACING RULE (For ALL languages): Separate EVERY single syllable/character with a single space. BUT separate original words (if there are spaces in the original text) with a DOUBLE SPACE.
3. For Korean: use Revised Romanization. Example: '이정도면 알아줄' -> 'i jeong do myeon  a ra jul'.
4. For Japanese: use Romaji. Example: '君の 虜に' -> 'ki mi no  to ri ko ni'.
5. For Chinese: use Pinyin without tones. Example: '你好 吗' -> 'ni hao  ma'.
6. Keep any existing Latin characters and punctuation as-is.
7. Return a valid JSON object. The keys MUST be the exact line numbers provided (e.g. "1", "2") and the values must be the romanized strings.
Example output:
{
  "1": "konnichiwa",
  "2": "ni hao"
}

Text to romanize:
${numberedLines}`;

    let responseText = '';
    const result = await model.generateContent(prompt);
    responseText = result.response.text();

    const romanizationMap: Record<number, string> = {};

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```json')) {
       cleanedText = cleanedText.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanedText.startsWith('```')) {
       cleanedText = cleanedText.replace(/^```/, '').replace(/```$/, '').trim();
    }
    
    let parsed = JSON.parse(cleanedText);
    if (parsed.romanizations && typeof parsed.romanizations === 'object') {
      parsed = parsed.romanizations;
    }
    
    for (const [key, value] of Object.entries(parsed)) {
      const responseIdx = parseInt(key) - 1; 
      if (!isNaN(responseIdx) && responseIdx >= 0 && responseIdx < indicesToRomanize.length) {
        const originalIdx = indicesToRomanize[responseIdx];
        romanizationMap[originalIdx] = (value as string).trim();
      }
    }
    
    return res.json({ romanizations: romanizationMap });
  } catch (err) {
    console.error('Romanization error:', err);
    return res.status(500).json({ error: 'Failed to romanize lyrics' });
  }
};
