# Speak one line of text to an mp3 (plus word timings) with edge-tts, through the session proxy.
import asyncio, json, os, sys
import certifi
certifi.where = lambda: '/root/.ccr/ca-bundle.crt'
import edge_tts

async def main(voice, rate, text, out):
    c = edge_tts.Communicate(text, voice, rate=rate, proxy=os.environ.get('HTTPS_PROXY'), boundary='WordBoundary')
    words = []
    with open(out, 'wb') as f:
        async for ch in c.stream():
            if ch['type'] == 'audio':
                f.write(ch['data'])
            elif ch['type'] == 'WordBoundary':
                words.append({'t': ch['offset'] / 1e7, 'd': ch['duration'] / 1e7, 'w': ch['text']})
    with open(out.rsplit('.', 1)[0] + '.words.json', 'w') as f:
        json.dump(words, f, indent=1)

voice, rate, text, out = sys.argv[1:5]
asyncio.run(main(voice, rate, text, out))
