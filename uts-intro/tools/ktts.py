# Kokoro-82M: speak one text to a 24 kHz wav, and write word timings beside it.
# Usage: ktts.py <voice> <speed> <text> <out.wav>
import json, sys, numpy as np, soundfile as sf
from kokoro import KPipeline
voice, speed, text, out = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
pipe = KPipeline(lang_code=voice[0], repo_id='hexgrad/Kokoro-82M')
audio, words, t0 = [], [], 0.0
for r in pipe(text, voice=voice, speed=speed, split_pattern=r'\n+'):
    a = r.audio.numpy() if hasattr(r.audio, 'numpy') else np.asarray(r.audio)
    for tk in (r.tokens or []):
        if tk.start_ts is not None and any(c.isalnum() for c in tk.text):
            words.append({'t': t0 + tk.start_ts, 'd': (tk.end_ts or tk.start_ts) - tk.start_ts, 'w': tk.text})
    audio.append(a); t0 += len(a) / 24000
sf.write(out, np.concatenate(audio), 24000)
json.dump(words, open(out.rsplit('.', 1)[0] + '.words.json', 'w'), indent=1)
print(out, round(t0, 2), 's', len(words), 'words')
