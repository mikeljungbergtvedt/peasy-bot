#!/usr/bin/env python3
"""GB-ML: henter Finn-annonser for samme merke+modell som en Car.info-bil.

Skriver DOC-/AD-linjer (JSON) til stdout, og en META-linje først.
  python3 fetch_finn.py --carinfo cache/carinfo-plate/EH84013.json [--max-ads 350] [--delay 0.5] [--resolve-only]

Modellvalg (Finn-taksonomi fra søke-API-ets filtre):
  1. mest spesifikke Finn-modell (nivå 2) som matcher Car.info-navnet, hvis >= MIN_ADS treff
  2. ellers Finn-serie (nivå 1)            -> fallback=True (også under MIN_ADS, da thin_data)
  Aldri hele merket: en Hilux skal ikke sammenlignes med Auris. Ingen modell/serie -> ok=False.
Registreringsklasse (--regclass): 1 personbil, 2 varebil. Settes fra Vegvesen (EU-klasse N1 = varebil).
Leser bare fra finn.no. Skriver ingen filer selv (kalleren bestemmer hvor stdout havner).
"""
import argparse, json, re, subprocess, sys, time, html as H, unicodedata

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
API = "https://www.finn.no/mobility/search/api/search/SEARCH_ID_CAR_USED"
MIN_ADS = 40
MIN_ADS_SERIE = 10  # under dette: for lite data
REGCLASS = 1


def get(url):
    return subprocess.run(['curl', '-s', '--compressed', '--max-time', '20', '-A', UA,
                           '-H', 'Accept-Language: nb-NO,nb;q=0.9', url],
                          capture_output=True, text=True).stdout


def fold(s):
    s = unicodedata.normalize('NFKD', str(s or '').lower()).replace('ø', 'o').replace('æ', 'ae')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', s)).strip()


def search(params, page=1):
    q = '&'.join('%s=%s' % (k, v) for k, v in params.items())
    return json.loads(get('%s?%s&registration_class=%d&sales_form=1&page=%d' % (API, q, REGCLASS, page)) or '{}')


def walk_filters(o, out, depth=0, parent=None):
    if isinstance(o, dict):
        if 'display_name' in o and 'value' in o and re.match(r'^\d\.\d+', str(o.get('value'))):
            item = dict(name=o['display_name'], value=o['value'], hits=o.get('hits') or 0, parent=parent)
            out.append(item); parent = item['value']
        for v in o.values():
            walk_filters(v, out, depth + 1, parent)
    elif isinstance(o, list):
        for v in o:
            walk_filters(v, out, depth, parent)


def resolve(ci):
    r = ci['raw']['result']
    brand = r.get('brand') or ''
    names = ' '.join(fold(x) for x in [r.get('car_name'), r.get('sales_name'), r.get('model_gen_engine'), r.get('series'), r.get('model')])
    j = search({'q': brand.replace(' ', '%20')})
    items = []; walk_filters(j.get('filters'), items)
    make = next((i for i in items if i['value'].startswith('0.') and fold(i['name']) == fold(brand)), None)
    if not make:
        return dict(ok=False, err='fant ikke merke %s i Finn-filtre' % brand)
    j = search({'model': make['value']})
    items = []; walk_filters(j.get('filters'), items)
    mk = make['value'].split('.')[1]
    cand = [i for i in items if re.match(r'^[12]\.%s\.' % mk, i['value'])]

    def score(i):
        n = fold(i['name'])
        if not n or not re.search(r'(^| )%s( |$)' % re.escape(n), names):
            # tillat «5-Serie» ~ «5 series»
            n2 = n.replace('serie', 'series')
            if not re.search(r'(^| )%s( |$)' % re.escape(n2), names):
                return None
        return (i['value'].startswith('2.'), len(n))
    scored = sorted([(score(i), i) for i in cand if score(i)], key=lambda x: x[0], reverse=True)
    chain = []
    if scored:
        best = scored[0][1]
        chain.append(best)
        if best['value'].startswith('2.'):
            par = '1.' + '.'.join(best['value'].split('.')[1:3])
            p = next((i for i in cand if i['value'] == par), None)
            if p: chain.append(p)
    tried = [dict(name=x['name'], code=x['value'], hits=x['hits']) for x in chain]
    if not chain:
        return dict(ok=False, err='fant ikke modellen på Finn (%s, %s)' % (brand, 'varebil' if REGCLASS == 2 else 'personbil'),
                    regclass=REGCLASS, tried=tried)
    for level, c in enumerate(chain):
        siste = level == len(chain) - 1
        if c['hits'] >= MIN_ADS or (siste and c['hits'] >= MIN_ADS_SERIE):
            return dict(ok=True, brand=brand, code=c['value'], name=c['name'], hits=c['hits'],
                        level=('modell' if c['value'].startswith('2.') else 'serie'),
                        fallback=level > 0, thin=c['hits'] < MIN_ADS, regclass=REGCLASS, tried=tried[:level + 1])
    return dict(ok=False, err='for lite data på Finn (%d annonser for %s)' % (chain[-1]['hits'], chain[-1]['name']),
                regclass=REGCLASS, tried=tried)


def strip(s):
    return H.unescape(re.sub(r'<[^>]+>', ' ', s)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--carinfo', required=True)
    ap.add_argument('--max-ads', type=int, default=350)
    ap.add_argument('--delay', type=float, default=0.5)
    ap.add_argument('--resolve-only', action='store_true')
    ap.add_argument('--regclass', type=int, default=1, choices=[1, 2])
    a = ap.parse_args()
    global REGCLASS
    REGCLASS = a.regclass
    ci = json.load(open(a.carinfo))
    res = resolve(ci)
    print('META ' + json.dumps(res, ensure_ascii=False), flush=True)
    if not res.get('ok') or a.resolve_only:
        return
    year = ci['raw']['result'].get('model_year') or 0
    docs, seen = [], set()
    for p in range(1, 60):
        j = search({'model': res['code'], 'sort': 'PUBLISHED_DESC'}, p)
        new = [x for x in j.get('docs', []) if x.get('ad_id') not in seen]
        if not new: break
        for x in new:
            seen.add(x.get('ad_id'))
            docs.append({k: x.get(k) for k in ['ad_id', 'heading', 'make', 'model', 'model_specification', 'year', 'mileage', 'price',
                                               'dealer_segment', 'organisation_name', 'driving_range', 'fuel', 'transmission', 'flags', 'location']})
        time.sleep(a.delay)
    for d in docs:
        print('DOC ' + json.dumps(d, ensure_ascii=False), flush=True)
    # annonsesider: nærmest i årsmodell først, maks max-ads
    docs.sort(key=lambda d: abs((d.get('year') or 0) - year))
    for d in docs[:a.max_ads]:
        h = get('https://www.finn.no/mobility/item/%d' % d['ad_id'])
        out = {'ad_id': d['ad_id'], 'len': len(h)}
        m = re.search(r'<h2[^>]*>Utstyr</h2>\s*<ul[^>]*>(.*?)</ul>', h, re.S)
        out['utstyr'] = [re.sub(r'\s+', ' ', strip(x)) for x in re.findall(r'<li[^>]*>(.*?)</li>', m.group(1), re.S)] if m else []
        out['specs'] = {re.sub(r'\s+', ' ', strip(dt)): re.sub(r'\s+', ' ', strip(dd))
                        for dt, dd in re.findall(r'<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>', h, re.S)
                        if len(strip(dt)) < 60 and len(strip(dd)) < 120}
        t = re.search(r'<title>(.*?)</title>', h, re.S)
        out['title'] = strip(t.group(1)) if t else None
        print('AD ' + json.dumps(out, ensure_ascii=False), flush=True)
        time.sleep(a.delay)
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
