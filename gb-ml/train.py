#!/usr/bin/env python3
"""GB-ML: selvlærende Finn-prismodell. reg.nr inn -> Finn-pris ut.

Trener KUN på Finn-annonser for samme merke/modell (pris, år, km, hk, variant, utstyr).
Ingen håndsatte kronebeløp. Car.info brukes kun for bilen som prises.

  python3 train.py --carinfo <carinfo.json> --data <fetch_finn-output.txt> [--dossier <dossier.json>] --out <result.json>

Output-JSON er det GB-fanen i Pulse viser (se gb-ml.js / README.md).
"""
import warnings; warnings.filterwarnings('ignore')
import argparse, json, re, sys, time, unicodedata
from collections import Counter
import numpy as np, pandas as pd
from sklearn.linear_model import RidgeCV, LassoCV
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.base import clone

MIN_FEAT_ADS = 8      # utstyrsfeature må finnes i minst N annonser
MIN_ADS = 40          # under dette: tynt datagrunnlag (flagges)
SEED = 42
THIS_YEAR = time.localtime().tm_year

# ---------- tekstnormalisering (synonymer, ikke priser) ----------
def fold(s):
    s = unicodedata.normalize('NFKD', str(s).lower())
    s = s.replace('ø', 'o').replace('æ', 'ae').replace('å', 'a')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9+ ]+', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

# kanoniske begreper: regex (på foldet tekst) -> nøkkel. Samme mapping brukes for Finn og Car.info.
CANON = [
    (r'hengerfeste|tilhengerfeste|\bkrok\b|trailer ?hitch|towbar|anhengerkobling', 'hengerfeste'),
    (r'panorama|soltak|glasstak|sky ?lounge|sunroof', 'panorama_soltak'),
    (r'head ?up|\bhud\b', 'head_up'),
    (r'harman|kardon|\bh k\b', 'harman_kardon'),
    (r'bowers|wilkins|\bb w\b', 'bowers_wilkins'),
    (r'adaptiv (cruise|fartsholder)|aktiv cruise|active cruise|\bacc\b|distanse', 'adaptiv_cruise'),
    (r'^cruisekontroll|^cruise control|^fartsholder', 'cruisekontroll'),
    (r'360|surround view|rundtom', 'kamera_360'),
    (r'ryggekamera|revers ?kamera|rear view camera|kameraer', 'ryggekamera'),
    (r'luftfjaer|air suspension|luftfjering|two axle air', 'luftfjaering'),
    (r'integral active steering|bakhjulsstyring|4 hjulsstyring|firehjulsstyring|bakakselstyring|hjulstyring', 'bakhjulsstyring'),
    (r'soft ?close|myk lukking|servolukking', 'soft_close'),
    (r'laserlys|laser ?light|\blaser', 'laserlys'),
    (r'massasje|massage', 'massasje'),
    (r'ventiler', 'ventilerte_seter'),
    (r'setevarme|oppvarmede? (for)?seter|seat heating|heated seat', 'setevarme'),
    (r'rattvarme|oppvarmet ratt|heated steering', 'rattvarme'),
    (r'heat comfort|varmekomfort|klimakomfort|varmepakke', 'varmekomfort_pakke'),
    (r'm ?sport ?pro', 'm_sport_pro'),
    (r'sport ?s? ?pa?k|sports?pakke|m ?sport|sport package|sportpakke', 'sportspakke'),
    (r'comfort ?access|nokkelfri|nokkellos|keyless|comfacc', 'nokkelfri'),
    (r'elektrisk.*sete|el ?seter|el sete|elektriske seter|power seat|memory|minne', 'el_seter_minne'),
    (r'skinn|leather|lær', 'skinn'),
    (r'navigasjon|\bgps\b|navi\b', 'navigasjon'),
    (r'carplay', 'apple_carplay'),
    (r'android auto', 'android_auto'),
    (r'tradlos lading|wireless charg|induktiv', 'tradlos_lading'),
    (r'blindsone|blind spot', 'blindsone'),
    (r'kjorefelt|lane|filskift', 'filassistent'),
    (r'parkeringsassist|parking assist|park assist', 'parkeringsassistent'),
    (r'parkeringssensor.*foran|pdc foran', 'p_sensor_foran'),
    (r'parkeringssensor.*bak|pdc bak', 'p_sensor_bak'),
    (r'tyverialarm|alarm', 'alarm'),
    (r'regnsensor', 'regnsensor'),
    (r'driving assistant professional|driving assistant pro|autopilot', 'driving_assistant_pro'),
    (r'22 ?"|22 tom|22 inch|22 felg|\b22\b', 'felg_22'),
    (r'21 ?"|21 tom|21 inch|21 felg|\b21\b', 'felg_21'),
    (r'20 ?"|20 tom|20 inch|20 felg', 'felg_20'),
    (r'tonede ruter|privacy glass|mork(e)? rut', 'tonede_ruter'),
    (r'klima ?(anlegg|automatikk)|automatisk klima|climate control|klimasoner', 'klimaanlegg_auto'),
    (r'dab', 'dab'),
    (r'isofix', 'isofix'),
    (r'wifi|hotspot', 'wifi'),
    (r'vinterhjul|vinterdekk|s ?\+ ?v|sommer.*vinter', 'ekstra_hjulsett'),
]

def canon_items(texts):
    out = set()
    for t in texts:
        f = fold(re.sub(r'^\s*[0-9][0-9A-Z]{2}\s+', '', str(t)))  # fjern BMW-opsjonskode "337 "
        f = re.sub(r'\bfinnes\b', '', f).strip()
        hit = False
        for rx, key in CANON:
            if re.search(rx, f):
                out.add(key); hit = True
                if key != 'm_sport_pro':
                    break
        if not hit and 2 < len(f) < 40:
            out.add('raw:' + f)
    return out

LABEL = {'hengerfeste': 'Hengerfeste', 'panorama_soltak': 'Panorama/soltak', 'head_up': 'Head-up', 'harman_kardon': 'Harman Kardon',
         'bowers_wilkins': 'Bowers & Wilkins', 'adaptiv_cruise': 'Adaptiv cruise', 'cruisekontroll': 'Cruisekontroll', 'kamera_360': '360°-kamera',
         'ryggekamera': 'Ryggekamera', 'luftfjaering': 'Luftfjæring', 'bakhjulsstyring': 'Bakhjulsstyring', 'soft_close': 'Soft close',
         'laserlys': 'Laserlys', 'massasje': 'Massasje', 'ventilerte_seter': 'Ventilerte seter', 'setevarme': 'Setevarme', 'rattvarme': 'Rattvarme',
         'varmekomfort_pakke': 'Varmekomfort-pakke', 'm_sport_pro': 'M Sport Pro', 'sportspakke': 'Sportspakke', 'nokkelfri': 'Nøkkelfri',
         'el_seter_minne': 'El-seter', 'skinn': 'Skinn', 'navigasjon': 'Navigasjon', 'apple_carplay': 'Apple CarPlay', 'android_auto': 'Android Auto',
         'tradlos_lading': 'Trådløs lading', 'blindsone': 'Blindsonevarsler', 'filassistent': 'Filassistent', 'parkeringsassistent': 'Parkeringsassistent',
         'p_sensor_foran': 'P-sensor foran', 'p_sensor_bak': 'P-sensor bak', 'alarm': 'Alarm', 'regnsensor': 'Regnsensor',
         'driving_assistant_pro': 'Driving Assistant Pro', 'felg_22': '22" felg', 'felg_21': '21" felg', 'felg_20': '20" felg',
         'tonede_ruter': 'Tonede ruter', 'klimaanlegg_auto': 'Klimaautomatikk', 'dab': 'DAB', 'isofix': 'Isofix', 'wifi': 'WiFi',
         'ekstra_hjulsett': 'Ekstra hjulsett', 'raw:kjorecomputer': 'Kjørecomputer', 'raw:sentrallas': 'Sentrallås',
         'raw:aeb fotgjenger': 'Nødbrems fotgjenger', 'raw:lyssensor': 'Lyssensor', 'raw:bluetooth': 'Bluetooth',
         'raw:bakkestartassistent': 'Bakkestartassistent', 'raw:tretthetsvarsling': 'Tretthetsvarsling'}


def label(f):
    if f in LABEL: return LABEL[f]
    return f[4:].capitalize() if f.startswith('raw:') else f


def num(s):
    if s is None: return None
    m = re.sub(r'[^\d]', '', str(s))
    return float(m) if m else None


ELHYB = False  # målbilen er el eller hybrid: rekkevidde er proxy, aldri hk/kW


def el_hyb(fuel):
    f = fold(fuel or '')
    return f == 'el' or f.startswith('el ') or 'elektr' in f or 'hybrid' in f


def variant_of(model, hk, fuel=None, rng=None):
    """Generisk variant: Finn-modellnavn + effektbøtte (20 hk). El/hybrid: rekkeviddebøtte (50 km), aldri hk."""
    if el_hyb(fuel):
        b = 'rk%d' % (round(rng / 50.0) * 50) if rng else 'rk?'
    else:
        b = 'hk%d' % (round(hk / 20.0) * 20) if hk else 'hk?'
    return '%s|%s' % (model or '?', b)


# ---------- Car.info-pakker = fabrikkutstyr ----------
# Pakkenavn -> regex på foldet Finn-tekst (utstyrsliste + tittel + modellbeskrivelse), og typisk innhold.
# Pakken regnes som til stede i en annonse hvis navnet/synonymet står der, eller minst 2 innholdspunkter står der.
# Dette er tekstgjenkjenning, ikke priser: effekten i kroner lærer modellen selv fra Finn.
PKG = [
    (r'm ?sport ?package|^m ?sport$', r'm ?sport|msport', []),
    (r'^sport ?package$|^sport$|sportspakke', r'sport ?s? ?pa?k|sportspakke|sport package|sportspk|m ?sport|msport', []),
    (r'heat comfort', r'heat comfort|varmekomfort|varmepakke', [r'rattvarme|oppvarmet ratt|heated steering', r'setevarme bak|oppvarmede? baksete|rear seat heat', r'armlen']),
    (r'innovation', r'innovation|innovasjon', [r'head ?up|\bhud\b', r'laser|adaptiv\w* led|adaptive led', r'gest', r'parking assistant plus|parkeringsassistent pluss']),
    (r'^light$|lights? package|lys ?pakke', r'lys ?pakke|light package|lights package|ambient|ambiente lys', []),
    (r'active protection', r'active protection|aktiv beskyttelse', []),
    (r'connected ?drive', r'connected ?drive', []),
    (r'm ?aerodynamic', r'm ?aero', []),
    (r'comfort package|komfortpakke', r'comfort package|komfortpakke|comfort ?access|komfortadgang', []),
    (r'non ?smoker', r'roykfri|non ?smoker|ikke royk', []),
]


def pkg_rule(name):
    f = fold(name)
    if len(re.sub(r'[^a-z]', '', f)) < 3:
        return None  # f.eks. Porsche-trim «4»: ikke et utstyrsnavn
    for key_rx, rx, contents in PKG:
        if re.search(key_rx, f):
            return rx, contents
    core = re.sub(r'\b(package|pakke|pack|paket)\b', '', f).strip()
    return (re.escape(core), []) if core else None


def pkg_present(rule, text):
    rx, contents = rule
    if re.search(rx, text): return 'navn'
    if contents and sum(1 for c in contents if re.search(c, text)) >= 2: return 'innhold'
    return None


def load(path):
    meta, docs, ads = {}, {}, {}
    for l in open(path, encoding='utf-8'):
        if l.startswith('META '): meta = json.loads(l[5:])
        elif l.startswith('DOC '):
            d = json.loads(l[4:]); docs[d['ad_id']] = d
        elif l.startswith('AD '):
            a = json.loads(l[3:]); ads[a['ad_id']] = a
    rows = []
    for i, d in docs.items():
        a = ads.get(i)
        if not a or not a.get('utstyr'): continue
        sp = a.get('specs') or {}
        price = (d.get('price') or {}).get('amount')
        if not price or price < 10000: continue
        hk = num(sp.get('Effekt'))
        rows.append(dict(finnkode=i, price=float(price), year=d.get('year'), km=d.get('mileage') or num(sp.get('Kilometerstand')),
                         hk=hk, rng=num(d.get('driving_range')), model=d.get('model'),
                         variant=variant_of(d.get('model'), hk, d.get('fuel'), num(d.get('driving_range'))), fuel=d.get('fuel') or '?',
                         gear=d.get('transmission') or '?', dealer=d.get('dealer_segment') or '?',
                         sold='sold' in (d.get('flags') or []), spec=d.get('model_specification'),
                         equip=canon_items(a.get('utstyr') or []),
                         text=fold(' '.join((a.get('utstyr') or []) + [a.get('title') or '', d.get('model_specification') or '']))))
    return meta, len(docs), pd.DataFrame(rows)


def carinfo_target(path, km_override=None):
    j = json.load(open(path)); r = j['raw']['result']
    names = []
    def walk(lst):
        for x in lst or []:
            vals = x.get('values') or []
            if vals and str(vals[0]).lower() == 'ja':
                names.append(x.get('name') or '')
            walk(x.get('children'))
    walk(r.get('attributes'))
    pk = r.get('packages') or {}
    pkgs = [p for v in pk.values() for p in (v if isinstance(v, list) else [v])]
    mapped = {t: sorted(canon_items([t])) for t in names}  # pakker håndteres som fabrikkutstyr (PKG)
    fuel = None
    for x in r.get('attributes') or []:
        if (x.get('name') or '').strip() == 'Drivstoff':
            for c in x.get('children') or []:
                if (c.get('values') or [''])[0] == 'ja': fuel = c.get('name')
    return dict(year=r.get('model_year'), km=km_override or j.get('km'), hk=r.get('horsepower'), name=r.get('car_name'),
                brand=r.get('brand'), model=r.get('model'), fuel=fuel, packages=pkgs, mapped=mapped, n_attr=len(names))


def design(df, feats, cats, base_only=False):
    cols = {}
    cols['age'] = (THIS_YEAR + 1 - df['year'].astype(float)).values
    km = df['km'].fillna(df['km'].median()).astype(float)
    cols['logkm'] = np.log1p(km).values
    cols['km_per_year'] = (km / np.clip(cols['age'], 0.5, None) / 1e4).values
    if ELHYB and 'rng' in df and df['rng'].notna().any():
        cols['logrange'] = np.log(df['rng'].fillna(df['rng'].median()).astype(float)).values
    else:
        cols['loghk'] = np.log(df['hk'].fillna(df['hk'].median() if df['hk'].notna().any() else 100).astype(float)).values
    for col, vals in cats.items():
        for v in vals:
            cols['%s_%s' % (col, v)] = (df[col] == v).astype(float).values
    if not base_only:
        for f in feats:
            cols['eq_' + f] = df['equip'].apply(lambda e: float(f in e)).values
        cols['eq_count'] = df['equip'].apply(lambda e: float(len([x for x in e if x in feats]))).values
    return pd.DataFrame(cols, index=df.index)


def cv_pred(model, X, y, cv):
    p = cross_val_predict(model, X, y, cv=cv)
    return float(np.mean(np.abs(np.exp(p) / np.exp(y) - 1)) * 100), p


def dossier_utpris(path):
    if not path: return None, None
    try:
        d = json.load(open(path))
    except Exception:
        return None, None
    return d.get('finn_utpris'), d.get('finn_utpris_kilde')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--carinfo', required=True); ap.add_argument('--data', required=True)
    ap.add_argument('--dossier'); ap.add_argument('--km', type=float); ap.add_argument('--dealer', default='Forhandler')
    ap.add_argument('--regnr'); ap.add_argument('--out', default='-')
    ap.add_argument('--range', type=float, help='målbilens rekkevidde (WLTP km), el/hybrid')
    ap.add_argument('--elhyb', action='store_true', help='målbilen er el eller hybrid (fra Vegvesen)')
    a = ap.parse_args()

    meta, n_search, df = load(a.data)
    tgt = carinfo_target(a.carinfo, a.km)
    global ELHYB
    ELHYB = bool(a.elhyb or el_hyb(tgt.get('fuel')))
    regnr = a.regnr or json.load(open(a.carinfo)).get('plate')
    utpris, utpris_kilde = dossier_utpris(a.dossier)
    out = dict(ok=True, regnr=regnr, generated_at=time.strftime('%Y-%m-%dT%H:%M:%S%z'),
               ident=dict(car_name=tgt['name'], brand=tgt['brand'], model=tgt['model'], year=tgt['year'], km=tgt['km'], hk=tgt['hk'],
                          fuel=tgt['fuel'], packages=tgt['packages']),
               finn_model=meta, n_search=n_search, n_ads=int(len(df)), finn_utpris=utpris, finn_utpris_kilde=utpris_kilde,
               thin_data=len(df) < MIN_ADS, fallback=bool(meta.get('fallback')))
    if meta.get('ok') is False:
        out.update(ok=False, err=meta.get('err') or 'fant ikke modellen på Finn')
        return emit(out, a.out)
    if len(df) < 10:
        out.update(ok=False, err='for få Finn-annonser med utstyr (%d)' % len(df))
        return emit(out, a.out)

    cats = {'variant': sorted(df['variant'].unique()), 'fuel': sorted(df['fuel'].unique()),
            'gear': sorted(df['gear'].unique()), 'dealer': sorted(df['dealer'].unique())}
    cnt = Counter(f for e in df['equip'] for f in e)
    # fabrikkutstyr: bilens Car.info-pakker som egne features i Finn-annonsene
    pkg_info = []
    for p in tgt['packages']:
        rule = pkg_rule(p)
        if not rule:
            pkg_info.append(dict(name=p, key=None, n_ads=None, note='ikke et utstyrsnavn')); continue
        key = 'pkg:' + fold(p)
        hits = df['text'].apply(lambda t: pkg_present(rule, t))
        df['equip'] = [e | {key} if isinstance(h, str) else e for e, h in zip(df['equip'], hits)]
        pkg_info.append(dict(name=p, key=key, n_ads=int(hits.notna().sum()), n_via_innhold=int((hits == 'innhold').sum())))
    cnt = Counter(f for e in df['equip'] for f in e)
    feats = sorted(f for f, c in cnt.items() if (3 if f.startswith('pkg:') else MIN_FEAT_ADS) <= c <= len(df) - (3 if f.startswith('pkg:') else MIN_FEAT_ADS))
    y = np.log(df['price'].values)
    cv = KFold(min(10, max(3, len(df) // 8)), shuffle=True, random_state=SEED)
    X = design(df, feats, cats); Xb = design(df, feats, cats, base_only=True)
    models = {
        'ridge': make_pipeline(StandardScaler(), RidgeCV(alphas=np.logspace(-2, 3, 30))),
        'lasso': make_pipeline(StandardScaler(), LassoCV(cv=5, random_state=SEED, max_iter=20000)),
        'gbr': GradientBoostingRegressor(n_estimators=400, learning_rate=0.03, max_depth=3, subsample=0.8, random_state=SEED),
    }
    res = {k: cv_pred(m, X, y, cv) for k, m in models.items()}
    res_b = {k: cv_pred(m, Xb, y, cv) for k, m in models.items()}
    best = min(res, key=lambda k: res[k][0]); best_b = min(res_b, key=lambda k: res_b[k][0])

    # målbil (variant fra Car.info-modellnavn finnes ikke i Finn: bruk nærmeste Finn-modell med samme hk-bøtte)
    tv_bucket = variant_of('', tgt['hk'], 'el' if ELHYB else None, a.range).split('|')[1]
    same = df[df['variant'].str.endswith('|' + tv_bucket)]
    # Velg varianten der Finn-modellnavnet står i bilens navn, mest spesifikk først (Taycan GTS foran Taycan / Taycan 4).
    # Rekkevidde eller hk alene skiller ikke trim (Taycan 4 og GTS har begge ~450 km).
    tname = fold(tgt.get('name') or '')
    def navn_treff(v):
        m = fold(v.split('|')[0]); toks = [t for t in m.split() if t]
        return len(m) if toks and all(re.search(r'(^| )%s( |$)' % re.escape(t), tname) for t in toks) else -1
    t_variant = None
    for kand in ([same] if len(same) else []) + [df]:
        vc = kand['variant'].value_counts()
        rang = sorted(vc.index, key=lambda v: (navn_treff(v), vc[v]), reverse=True)
        if rang and navn_treff(rang[0]) >= 0:
            t_variant = rang[0]; break
    if t_variant is None and len(same):
        t_variant = same['variant'].mode().iloc[0]
    t_fuel = df['fuel'].mode().iloc[0]
    if tgt['fuel']:
        ff = [f for f in cats['fuel'] if f.lower()[:3] in tgt['fuel'].lower() or tgt['fuel'].lower()[:3] in f.lower()]
        if ff: t_fuel = ff[0]
    t_gear = df['gear'].mode().iloc[0]
    tequip = set(f for v in tgt['mapped'].values() for f in v) | {p['key'] for p in pkg_info if p['key']}
    tdf = pd.DataFrame([dict(year=tgt['year'], km=tgt['km'], hk=tgt['hk'], rng=a.range, variant=t_variant, fuel=t_fuel, gear=t_gear,
                             dealer=a.dealer, equip=tequip)])
    Xt = design(tdf, feats, cats).reindex(columns=X.columns, fill_value=0.0)
    Xtb = design(tdf, feats, cats, base_only=True).reindex(columns=Xb.columns, fill_value=0.0)
    m = clone(models[best]).fit(X, y); mb = clone(models[best_b]).fit(Xb, y)
    pred = float(np.exp(m.predict(Xt)[0])); pred_b = float(np.exp(mb.predict(Xtb)[0]))
    q = lambda r: np.quantile(np.exp(y - r), [0.1, 0.9])
    q10, q90 = q(res[best][1]); qb10, qb90 = q(res_b[best_b][1])

    tog = {}
    for f in feats:
        x1 = Xt.copy(); x0 = Xt.copy(); c1 = 'eq_' + f
        x1[c1] = 1.0; x0[c1] = 0.0
        x1['eq_count'] = Xt['eq_count'] + (0 if f in tequip else 1); x0['eq_count'] = Xt['eq_count'] - (1 if f in tequip else 0)
        tog[f] = float(np.exp(m.predict(x1)[0]) - np.exp(m.predict(x0)[0]))

    c = df.copy()
    c['dist'] = (c['variant'] != t_variant) * 10 + (c['year'] - tgt['year']).abs() + (c['km'] - (tgt['km'] or 0)).abs() / 20000
    comps = []
    eh_vocab = sorted(f for f in tequip if f in feats)
    cc = Counter()
    for _, r in c.sort_values('dist').head(5).iterrows():
        e = set(r['equip'])
        for f in e:
            if not f.startswith('raw:') and f in tog: cc[f] += 1
        comps.append(dict(finnkode=int(r['finnkode']), url='https://www.finn.no/mobility/item/%d' % r['finnkode'], variant=r['variant'],
                          year=int(r['year']), km=None if pd.isna(r['km']) else int(r['km']), price=int(r['price']), dealer=r['dealer'],
                          spec=r['spec'], n_equip=len(e),
                          overlap_pct=(round(100 * len(set(eh_vocab) & e) / len(eh_vocab)) if eh_vocab else None)))
    shown = [f for f in tequip if (f in feats or not f.startswith('raw:')) and not f.startswith('pkg:')]  # skjul rå Car.info-attributter uten Finn-motstykke
    pkg_canon = set(f for p in tgt['packages'] for f in canon_items([p]))  # f.eks. «Sport Package» -> sportspakke: dekkes av pakke-chipen
    pkg_chips = [dict(key=p['key'], label=p['name'], status='pakke', n_ads=p['n_ads'], n_via_innhold=p.get('n_via_innhold'),
                      in_model=bool(p['key'] and p['key'] in feats), kr=(round(tog[p['key']]) if p['key'] in tog else None), note=p.get('note'))
                 for p in pkg_info]
    equip = pkg_chips + [dict(key=f, label=label(f), status='har', kr=round(tog[f]) if f in tog else None) for f in
             sorted(shown, key=lambda f: (f.startswith('raw:'), -abs(tog.get(f, 0))))]
    equip += [dict(key=f, label=label(f), status='ukjent', n_comps=n, kr=round(tog[f]))
              for f, n in cc.most_common() if n >= 2 and f not in tequip and f not in pkg_canon]
    rnd = lambda v: int(round(v / 1000.0) * 1000)
    out.update(
        variant=t_variant, dealer=a.dealer,
        pred_base=rnd(pred_b), interval_80_base=[rnd(pred_b * qb10), rnd(pred_b * qb90)],
        cv_mape_base=round(res_b[best_b][0], 2), model_base=best_b,
        pred_equip=rnd(pred), interval_80_equip=[rnd(pred * q10), rnd(pred * q90)],
        cv_mape_equip=round(res[best][0], 2), model_equip=best,
        cv_mape_all=dict(med_utstyr={k: round(v[0], 2) for k, v in res.items()}, uten_utstyr={k: round(v[0], 2) for k, v in res_b.items()}),
        equip_used=False,
        equip_note='Car.info-pakkene er bilens fabrikkutstyr og er matchet mot Finn-annonsenes utstyr/tekst. Enkeltopsjoner utenfor pakkene (f.eks. panorama, lyd, understell) er ukjent, og modellen tolker «ikke oppgitt» som «mangler». Derfor brukes ikke utstyrsjustert pris som hovedpris.',
        packages=pkg_info,
        carinfo_equip_count=len(eh_vocab),
        equip=equip, comps=comps,
        diff_vs_utpris=(rnd(pred_b) - int(utpris)) if utpris else None,
    )
    emit(out, a.out)


def emit(out, path):
    s = json.dumps(out, ensure_ascii=False, indent=1, default=lambda o: o.item() if hasattr(o, 'item') else str(o))
    if path == '-': print(s)
    else: open(path, 'w').write(s)


if __name__ == '__main__':
    main()
