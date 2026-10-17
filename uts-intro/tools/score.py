# Score speech two ways: UTMOS (predicted listener naturalness, 1-5) and Whisper (did every word come out right).
# Usage: score.py <expected-text-file-or-"-"> <wav> [<wav> ...]   (expected text applies to all wavs)
import os, sys, re, json, warnings, numpy as np, torch, librosa
warnings.filterwarnings('ignore')
from faster_whisper import WhisperModel
exp = open(sys.argv[1]).read() if sys.argv[1] != '-' else None
mos = torch.hub.load(os.environ.get('SPEECHMOS_DIR', 'speechmos'), 'utmos22_strong', source='local', trust_repo=True)  # git clone --branch v1.2.0 https://github.com/tarepan/SpeechMOS
asr = WhisperModel('small.en', device='cpu', compute_type='int8')
norm = lambda s: re.sub(r"[^a-z0-9' ]", ' ', s.lower().replace('-', ' ').replace('.com', ' dot com')).split()
def wer(ref, hyp):
    r, h = norm(ref), norm(hyp); d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        p, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            p, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, p + (r[i - 1] != h[j - 1]))
    return d[len(h)] / max(1, len(r))
for w in sys.argv[2:]:
    y, sr = librosa.load(w, sr=16000, mono=True)
    with torch.no_grad():
        m = mos(torch.from_numpy(y).unsqueeze(0), 16000).item()
    segs, _ = asr.transcribe(y.astype(np.float32), beam_size=5, language='en')
    hyp = ' '.join(s.text.strip() for s in segs)
    out = {'file': w.split('/')[-1], 'utmos': round(m, 3), 'secs': round(len(y) / 16000, 2)}
    if exp: out['wer'] = round(wer(exp, hyp), 3)
    if not exp or out['wer'] > 0: out['heard'] = hyp
    print(json.dumps(out))
