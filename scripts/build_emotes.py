"""Build a small pinned Fluent pack in cloud CI; never clone the full repository."""
import hashlib
import io
import json
import urllib.request
from pathlib import Path
from urllib.parse import quote
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'frontend/public/emotes'
REV = 'daa0365c09795789ed2bc6e8b228c97736cb6669'
REPO = 'microsoft/fluentui-emoji-animated'
ITEMS = {
    'heart': 'Beating heart', 'hug': 'Hugging face',
    'laugh': 'Face with tears of joy', 'love': 'Smiling face with hearts',
    'kiss': 'Face blowing a kiss', 'think': 'Thinking face',
    'party': 'Partying face', 'smile': 'Beaming face with smiling eyes',
    'sleep': 'Sleeping face', 'wow': 'Star-struck',
    'fire': 'Fire', 'sparkles': 'Sparkles',
}
def sha(data):
    return hashlib.sha256(data).hexdigest()
def fetch(url, limit=12*1024*1024):
    request = urllib.request.Request(url, headers={'User-Agent':'KUKU-emote-build'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(limit+1)
    if len(data) > limit:
        raise RuntimeError('Source exceeds size limit')
    return data
def check():
    manifest = json.loads((ROOT/'manifest.json').read_text())
    assert manifest['revision'] == REV and set(manifest['items']) == set(ITEMS)
    for key, item in manifest['items'].items():
        for suffix in ['webp','png']:
            data = (ROOT/(key+'.'+suffix)).read_bytes()
            assert sha(data) == item[suffix+'_sha256']
        with Image.open(ROOT/(key+'.webp')) as image:
            assert image.n_frames > 1 and image.info.get('loop') == 1
    print('Verified', len(ITEMS), 'emotes and file checksums')
def build():
    ROOT.mkdir(parents=True, exist_ok=True)
    tree = json.loads(fetch(f'https://api.github.com/repos/{REPO}/git/trees/{REV}?recursive=1'))['tree']
    manifest = {'source':'https://github.com/'+REPO,'revision':REV,'license':'MIT',
                'conversion':{'edges':[160,128,112],'quality':[76,62],'method':3,'loop':1,'max_fps':25,'minimize_size':True},'items':{}}
    for key, folder in ITEMS.items():
        paths = [x['path'] for x in tree if x['path'].startswith('assets/'+folder+'/animated/') and x['path'].endswith('.png')]
        if len(paths) != 1:
            raise RuntimeError('Expected exactly one source for '+folder+': '+str(paths))
        source = 'https://media.githubusercontent.com/media/'+REPO+'/'+REV+'/'+quote(paths[0],safe='/')
        raw = fetch(source)
        with Image.open(io.BytesIO(raw)) as image:
            start = 1 if image.info.get('default_image') else 0
            if image.n_frames-start < 2:
                raise RuntimeError('Source is not animated: '+folder)
            for edge in [160,128,112]:
                frames, durations = [], []
                for frame in range(start,image.n_frames):
                    image.seek(frame)
                    duration = max(1,round(image.info.get('duration',100)))
                    if durations and durations[-1] < 40:
                        durations[-1] += duration
                        continue
                    copy = image.convert('RGBA')
                    copy.thumbnail((edge,edge),Image.Resampling.LANCZOS)
                    frames.append(copy)
                    durations.append(duration)
                for quality in [76,62]:
                    encoded = io.BytesIO()
                    frames[0].save(encoded,'WEBP',save_all=True,append_images=frames[1:],duration=durations,loop=1,quality=quality,method=3,minimize_size=True,allow_mixed=True)
                    data = encoded.getvalue()
                    if len(data) <= 300*1024:
                        break
                if len(data) <= 300*1024:
                    poster = io.BytesIO();frames[0].save(poster,'PNG',optimize=True)
                    poster_data = poster.getvalue()
                    break
                for copy in frames: copy.close()
            else:
                raise RuntimeError('Animation exceeds budget: '+key)
            for copy in frames: copy.close()
        (ROOT/(key+'.webp')).write_bytes(data)
        (ROOT/(key+'.png')).write_bytes(poster_data)
        manifest['items'][key] = {'name':folder,'source':source,'source_sha256':sha(raw),
            'webp_sha256':sha(data),'png_sha256':sha(poster_data),'bytes':len(data),
            'edge':edge,'quality':quality,'frames':len(durations),'duration_ms':sum(durations)}
        print(key,len(data),'bytes',len(durations),'frames',flush=True)
    license_text = fetch(f'https://raw.githubusercontent.com/{REPO}/{REV}/LICENSE').decode()
    (ROOT/'LICENSE.txt').write_text(license_text,encoding='utf-8')
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    assert sum(x.stat().st_size for x in ROOT.iterdir()) <= 4*1024*1024
    check()
if __name__ == '__main__':
    check() if (ROOT/'manifest.json').exists() else build()
