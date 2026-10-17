# Cuts the take into shots/, then builds uts-intro.mp4: the take with captions, a cross-fade into the
# end card, and the eight narration clips placed at the times the take was scheduled against.
# Usage: python3 compose.py <take-dir> <cards-dir> <out-dir>
import json, os, subprocess, sys

take, cards, out = (os.path.abspath(x) for x in sys.argv[1:4])
voice = os.path.abspath(os.path.join(os.path.dirname(__file__), '../work/voice'))
tl = json.load(open(f'{take}/timeline.json'))
OFF = tl['offset']
A = {int(k): v for k, v in tl['A'].items()}
D = {int(k): v for k, v in tl['D'].items()}
END = next(e['t'] for e in tl['events'] if e['label'] == 'END')
P7S, P8S, ECD, XF = 0.9, 5.13, 10.0, 0.8          # must match the cards.js run
E = END - XF                                       # end card starts here (cross-fade begins)
TOTAL = E + ECD
NAMES = ['P1-setup-accounts', 'P2-construct-data-to-reserve', 'P3-greenlight', 'P4-trade-paper-books', 'P5-compute-and-accounts', 'P6-profile-guided-workflow']

def run(cmd):
    print('+', ' '.join(cmd)[:300]); subprocess.run(cmd, check=True)

# --- shots/: the take, cut at the paragraph boundaries, no captions or audio
os.makedirs(f'{out}/shots', exist_ok=True)
bounds = [0.0] + [A[k] for k in range(2, 7)] + [END]
for i, name in enumerate(NAMES):
    s, e = bounds[i], bounds[i + 1]
    run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{OFF + s:.3f}', '-i', f'{take}/raw.mkv', '-t', f'{e - s:.3f}',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', f'{out}/shots/{name}.mp4'])
run(['ffmpeg', '-loglevel', 'error', '-y', '-framerate', '30', '-i', f'{cards}/endframes/%04d.png',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', f'{out}/shots/P7-P8-end-card.mp4'])

# --- narration/: copy the clips beside the video
os.makedirs(f'{out}/narration', exist_ok=True)
for p in range(1, 9):
    run(['cp', f'{voice}/P{p}.mp3', f'{out}/narration/P{p}.mp3'])

# --- the film
inputs = ['-ss', f'{OFF:.3f}', '-t', f'{END:.3f}', '-i', f'{take}/raw.mkv',
          '-framerate', '30', '-i', f'{cards}/endframes/%04d.png']
for i in range(1, 7):
    inputs += ['-loop', '1', '-framerate', '30', '-t', f'{END:.3f}', '-i', f'{cards}/cap{i}.png']
for p in range(1, 9):
    inputs += ['-i', f'{voice}/P{p}.mp3']

f = []
f.append(f'[0:v]setpts=PTS-STARTPTS,format=yuv444p,fade=t=in:st=0:d=0.6[w0]')
seg_start = {1: 0.25, 2: A[2], 3: A[3], 4: A[4], 5: A[5], 6: A[6]}
seg_end = {1: A[2], 2: A[3], 3: A[4], 4: A[5], 5: A[6], 6: END - 1.2}
prev = 'w0'
for i in range(1, 7):
    s, e = seg_start[i] + 0.6, seg_end[i] - 0.45
    f.append(f'[{1 + i}:v]format=rgba,fade=t=in:st={s:.3f}:d=0.35:alpha=1,fade=t=out:st={e - 0.35:.3f}:d=0.35:alpha=1[c{i}]')
    f.append(f'[{prev}][c{i}]overlay=x=56:y=H-h-60:format=auto[w{i}]')
    prev = f'w{i}'
f.append(f'[{prev}]format=yuv420p,settb=1/30000[walk]')
f.append(f'[1:v]format=yuv420p,settb=1/30000[ec]')
f.append(f'[walk][ec]xfade=transition=fade:duration={XF}:offset={E:.3f},format=yuv420p[v]')
starts = {**{p: A[p] for p in range(1, 7)}, 7: E + P7S, 8: E + P8S}
labels = []
for p in range(1, 9):
    ms = int(round(starts[p] * 1000))
    f.append(f'[{7 + p}:a]aresample=48000,aformat=channel_layouts=mono,adelay={ms}:all=1[a{p}]')
    labels.append(f'[a{p}]')
f.append(f'{"".join(labels)}amix=inputs=8:normalize=0:duration=longest,apad=whole_dur={TOTAL:.3f},'
         f'highpass=f=70,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=200,'
         f'loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000,aformat=channel_layouts=stereo[a]')

run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *inputs, '-filter_complex', ';'.join(f),
     '-map', '[v]', '-map', '[a]', '-t', f'{TOTAL:.3f}', '-r', '30',
     '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
     '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', f'{out}/uts-intro.mp4'])
json.dump({'END': END, 'E': E, 'TOTAL': TOTAL, 'audio_starts': starts, 'segments': list(zip(NAMES, bounds[:-1], bounds[1:]))},
          open(f'{out}/work-compose.json', 'w'), indent=1)
print('total', TOTAL)
