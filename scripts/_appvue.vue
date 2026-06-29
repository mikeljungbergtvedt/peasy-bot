<template>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-M4NSHTDP"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
<!-- demo-banner fjernet i v3.84 -->

<nav class="nav">
<div class="nav-inner">
<a href="#" class="nav-logo">
<img src="/Peasy_Logo_ORG.png" alt="Peasy" width="62" height="28" fetchpriority="high" decoding="async" />
</a>
<div class="nav-links">
<a href="#om">Om oss</a>
<a href="#how">Slik virker det</a>
<a href="#proof">Anmeldelser</a>
<a href="#faq">FAQ</a>
<a :href="accountUrl" target="_blank" rel="noopener">Min Side</a>
<form class="nav-cta-form" id="nav-form" :action="carAddUrl" method="GET"><input type="hidden" name="step" value="search" /><div class="nav-plate"><img src="/number-plate-flag-no-2.svg" alt="NO" class="nav-plate-flag" width="20" height="32" fetchpriority="high" /><input type="text" name="reg_number" class="nav-reg-input" placeholder="BU 39939" maxlength="8" autocomplete="off" autocapitalize="characters" inputmode="text" required /></div><button type="submit" class="nav-cta-btn">Få estimat →</button></form>
</div>
<button class="hamburger-btn" aria-label="Meny" type="button"><span></span></button>
</div>
</nav>
<main>

<!-- HERO -->
<section class="hero">
<div class="hero-eyebrow">2 000+ bilforhandlere klare nå</div>
<h1 class="hero-title">Vi <em>kjøper</em> bilen din<br />til prisen <span class="hero-title-reg">forhandlermarkedet</span><br />setter.</h1>
<p class="hero-sub">Send registreringsnummer og få et gratis estimat. Bilen legges på en lukket auksjon der over 2 000+ bilforhandlere konkurrerer — det avgjør prisen. Du får det høyeste budet, og bestemmer selv om du vil selge til oss.</p>
<form id="hero-form" class="hero-form estimate-form" :action="carAddUrl" method="GET">
<input type="hidden" name="step" value="1" />
<div class="hero-input-wrap">
<div class="hero-input-row">
<div class="hero-plate-box">
<img src="/number-plate-flag-no-2.svg" alt="NO" class="hero-plate-flag" width="20" height="32" fetchpriority="high" />
<input id="hero-reg-input" class="hero-reg" name="reg_number" placeholder="BU 39939" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" required />
</div>
<button type="submit" class="btn-submit hero-submit">Få estimat →</button>
</div>
</div>
</form>
        <!-- Konsept-punkter: svarer paa "hva er resten?" over fold, ogsaa paa mobil -->
        <ul class="hero-points">
          <li>2 000+ bilforhandlere kjemper om bilen på vår <strong>lukkede auksjon</strong> — det presser prisen opp.</li>
          <li>Vi tilbyr deg det høyeste budet. <strong>Du bestemmer</strong> — helt uforpliktende, og gratis.</li>
          <li>Sier du ja, <strong>kjøper vi bilen</strong> og overtar reklamasjonsansvaret. Du slipper alt etterspill.</li>
        </ul>
<div class="hero-google-rating"><span class="hero-stars">★★★★★</span> <strong>4,9 av 5</strong> · <span data-review-count="{n} anmeldelser">13 anmeldelser</span> på <span class="hero-glogo">Google</span></div>
<div class="recent-sale" id="recentSale" aria-live="polite"><span class="recent-sale-dot"></span><span class="recent-sale-label">SIST SOLGT</span><span class="recent-sale-body"><span class="recent-sale-car"></span><span class="recent-sale-sep"> · </span><span class="recent-sale-km"></span><span class="recent-sale-sep"> · </span><span class="recent-sale-price"></span><span class="recent-sale-sep"> · </span><span class="recent-sale-days"></span></span></div>
        <div class="hero-form-trust">✓ Gratis · ✓ Ingen forpliktelser · ✓ Tar 30 sekunder</div>
        <a href="#how" class="hero-secondary-link">Hvordan virker det →</a>


</section>



    <!-- Vi gjor resten: 3-stegs mikrostrip -->
    <section class="resten-strip" style="padding:40px 24px 8px;max-width:1080px;margin:0 auto;">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;text-align:left;">
        <div class="resten-step" style="position:relative;">
          <div style="font-size:clamp(34px,5vw,46px);font-weight:800;line-height:1;color:var(--green);opacity:.18;margin-bottom:6px;">01</div>
          <div style="font-size:clamp(15px,1.7vw,18px);font-weight:700;color:var(--green);line-height:1.25;">Send <em style="font-style:normal;position:relative;display:inline-block;">regnr<span style="position:absolute;left:-2px;right:-2px;bottom:2px;height:8px;background:var(--yellow);z-index:-1;border-radius:2px;opacity:.7;"></span></em></div>
          <div style="font-size:13.5px;color:var(--green);opacity:.62;margin-top:4px;line-height:1.35;">Gratis estimat på ca. 4 timer. Aksepterer du, henter vi bilen.</div>
        </div>
        <div class="resten-step" style="position:relative;">
          <div style="font-size:clamp(34px,5vw,46px);font-weight:800;line-height:1;color:var(--green);opacity:.18;margin-bottom:6px;">02</div>
          <div style="font-size:clamp(15px,1.7vw,18px);font-weight:700;color:var(--green);line-height:1.25;">Bilen er hos oss</div>
          <div style="font-size:13.5px;color:var(--green);opacity:.62;margin-top:4px;line-height:1.35;">Vi klargjør bilen og kjører budrunden. Du gjør ingenting.</div>
        </div>
        <div class="resten-step" style="position:relative;">
          <div style="font-size:clamp(34px,5vw,46px);font-weight:800;line-height:1;color:var(--green);opacity:.18;margin-bottom:6px;">03</div>
          <div style="font-size:clamp(15px,1.7vw,18px);font-weight:700;color:var(--green);line-height:1.25;">Du får budet</div>
          <div style="font-size:13.5px;color:var(--green);opacity:.62;margin-top:4px;line-height:1.35;">Se høyeste bud og bestem deg. Si ja — oppgjør senest 2 dager etter signert kontrakt.</div>
        </div>
      </div>
    </section>

    <!-- Konsept-pitch: hva Peasy ER, i ett blikk -->
    <section class="trygghet-section" style="padding-top:96px;padding-bottom:96px;">
      <div style="max-width:880px;margin:0 auto;text-align:center;">
        <div class="section-eyebrow" style="justify-content:center;">Dette er Peasy</div>
        <h2 class="concept-h2" style="font-size:clamp(36px,5.2vw,60px);font-weight:800;letter-spacing:-.035em;line-height:1.05;color:var(--green);margin-bottom:28px;">Bilbransjens egen auksjon. <em style="font-style:normal;position:relative;display:inline-block;">Nå åpen for deg.<span style="position:absolute;left:-2px;right:-2px;bottom:4px;height:12px;background:var(--yellow);z-index:-1;border-radius:2px;opacity:.7;"></span></em></h2>
        <p class="trygghet-lead" style="font-size:clamp(17px,2.1vw,21px);margin-left:auto;margin-right:auto;max-width:680px;"><strong>2 000+ bilforhandlere</strong> konkurrerer om bilen din — i en lukket budrunde kun for bilforhandlere. Vi henter, vasker og lar NAF/Viking taksere. Helt gratis.</p>
        <p class="trygghet-sub" style="margin-left:auto;margin-right:auto;max-width:600px;">Du får høyeste bud og sier ja eller nei. Ingen forpliktelser.</p>
      </div>
    </section>

<!-- Trygghetsboks -->
<section class="trust-box-section">
<div class="trust-box-inner">
<div class="trust-box-card">
<div class="trust-box-icon">
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" /></svg>
</div>
<div class="trust-box-text">
<strong>Bilen er din til du sier ja</strong>
<span>Ingen forpliktelser. Du bestemmer om du vil selge når høyeste bud kommer.</span>
</div>
</div>
<div class="trust-box-card">
<div class="trust-box-icon">
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M16 8 8 16M8 8l8 8" /></svg>
</div>
<div class="trust-box-text">
<strong>Kostnadsfritt for privatpersoner</strong>
<span>Henting, vask, foto, taksering — alt inkludert. Ingen skjulte gebyrer.</span>
</div>
</div>
<div class="trust-box-card">
<div class="trust-box-icon">
<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7 9 18l-5-5" /></svg>
</div>
<div class="trust-box-text">
<strong>Vi tar reklamasjonsrisikoen</strong>
<span>Etter aksept tar Peasy ansvar overfor sluttkjøper. Du slipper alt etterspill.</span>
</div>
</div>
</div>
</section>

<!-- Trygghet/Eiere -->
<section class="trygghet-section">
<div class="trygghet-inner">
<div class="trygghet-copy">
<div class="section-eyebrow">Trygghet</div>
<h2>Levert av bilbransjens <em>største aktører</em></h2>
<p class="trygghet-lead">Peasy er 100 % eid av <strong>Autoringen AS</strong> — et samarbeid mellom Norges største bilforhandlere. Bilen din går gjennom samme auksjonssystem som bilforhandlerne selv bruker hver dag — vi solgte nærmere 15 000 biler i 2025 alene.</p>
<p class="trygghet-sub">Vi tar ansvar for hele prosessen, overtar reklamasjonsansvaret fra deg, og sørger for raskt oppgjør etter at du har akseptert budet.</p>
</div>
<div class="owners-marquee" aria-label="Eiere av Peasy">
<div class="owners-marquee-track">
<img src="/logos-cropped/Moller_c.png" alt="Møller Mobility" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Bilia_c.png" alt="Bilia" width="40" height="28" loading="lazy" decoding="async" />
<img src="/BoS.svg" alt="Bertel O. Steen" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Toyota_c.png" alt="Toyota Norge / Bauda" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Kverneland_c.png" alt="Kverneland Bil" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/AR_c.png" alt="Autoringen" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Moller_c.png" alt="Møller Mobility" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Bilia_c.png" alt="Bilia" width="40" height="28" loading="lazy" decoding="async" />
<img src="/BoS.svg" alt="Bertel O. Steen" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Toyota_c.png" alt="Toyota Norge / Bauda" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Kverneland_c.png" alt="Kverneland Bil" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/AR_c.png" alt="Autoringen" width="40" height="28" loading="lazy" decoding="async" />
</div>
</div>
</div>
</section>

<!-- Partnere full seksjon -->
<section class="partners-section">
<div class="partners-inner">
<div class="partners-copy">
<div class="section-eyebrow">Operative partnere</div>
<h2>Uavhengig kvalitet <em>i hvert ledd</em></h2>
<p class="partners-lead">Vi gjør ikke alt selv. Hvert steg i prosessen håndteres av etablerte aktører med egen kvalitetskontroll — det betyr at tilstanden på bilen din er verifisert av noen andre enn oss, og bilforhandlerne får et nøytralt grunnlag å by på.</p>
</div>
<div class="partners-marquee" aria-label="Operative partnere">
<div class="partners-marquee-track">
<img src="/logos-cropped/Naf_c.png" alt="NAF" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Viking_c.png" alt="Viking Kontroll" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Gire_c.png" alt="Gire" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Drive_c.png" alt="Drive.no" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Naf_c.png" alt="NAF" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Viking_c.png" alt="Viking Kontroll" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Gire_c.png" alt="Gire" width="40" height="28" loading="lazy" decoding="async" />
<img src="/logos-cropped/Drive_c.png" alt="Drive.no" width="40" height="28" loading="lazy" decoding="async" />
</div>
</div>
</div>
</section>

<!-- ESTIMATE FORM -->
<section class="form-section" id="start">
<h2>Få estimat på 4 timer*</h2>
<p class="form-sub">Send registreringsnummer. Vi regner som bilforhandleren regner — Finn-pris minus margin, omreg og påkost. Et ærlig estimat.</p>
<p class="form-footnote">* I åpningstid mandag-fredag 08-16.</p>
<form id="peasy-form" class="estimate-form" :action="carAddUrl" method="GET">
<input type="hidden" name="step" value="search" />
<div class="hero-plate-box form-plate-box"><img src="/number-plate-flag-no-2.svg" alt="NO" class="hero-plate-flag" width="20" height="32" fetchpriority="high" /><input id="form-reg-input" class="hero-reg" name="reg_number" placeholder="BU 39939" maxlength="8" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" required /></div>
<button type="submit" class="btn-submit">Få estimat →</button>
</form>
<div class="form-trust">
<span style="color:var(--yellow)">★★★★★</span> <strong>4,9 av 5</strong> · <span data-review-count="{n} anmeldelser">13 anmeldelser</span> på Google
</div>
</section>

<!-- HOW -->
<section class="how-section" id="how">
<div class="how-header">
<div class="section-eyebrow">Slik virker Peasy</div>
<h2>Fra <em>sofa til solgt</em> — i tre steg.</h2>
<p class="how-intro">Du sender registreringsnummer. Vi henter bilen gratis i Stor-Oslo, Moss, Fredrikstad, Asker, Drammen, Bergen, Trondheim og Stavanger/Sandnes — eller du leverer selv. Vi vasker, fotograferer og lar NAF eller Viking taksere. Så konkurrerer 2 000+ bilforhandlere. Du får høyeste bud — og bestemmer selv om du selger.</p>
</div>
<div class="how-cards">

<div class="how-card accent">
<div class="how-card-content" data-step="01">
<div class="how-card-num">01 — Estimat</div>
<h3>Send registreringsnummer fra hvor som helst.</h3>
<p>Tar 30 sekunder. Du får et estimat regnet som en bilforhandler regner — vi starter med bilforhandlerpris fra Finn og trekker fra margin, omregistrering og eventuell påkost. Endelig bud kommer etter auksjon. Du bestemmer selv om du vil selge.</p>
<div class="live-badge">Estimat innen 4 timer</div>
</div>
<div class="how-card-visual"><span class="big">30s</span></div>
</div>

<div class="how-card dark reverse">
<div class="how-card-content" data-step="02">
<div class="how-card-num">02 — Vi tar over</div>
<h3>Henting, vask, foto, NAF-tilstand.</h3>
<p>Vi kommer hjem til deg. Henter bilen gratis. Forbereder den profesjonelt for auksjon. Du trenger ikke møte kjøpere eller svare meldinger.</p>
<div class="live-badge">Vi henter hjemme hos deg: Stor-Oslo, Moss, Fredrikstad, Asker, Drammen, Bergen, Trondheim, Stavanger/Sandnes</div>
</div>
<div class="how-card-visual"><span class="big">Du gjør ingenting</span></div>
</div>

<div class="how-card">
<div class="how-card-content" data-step="03">
<div class="how-card-num">03 — Lukket auksjon</div>
<h3>2 000+ bilforhandlere konkurrerer.</h3>
<p>Bilen kommer på lukket auksjon. Beste bud vinner. Du bestemmer om du vil selge — du er aldri bundet. Oppgjør senest 2 dager etter signert kontrakt.</p>
<div class="live-badge">Penger etter aksept</div>
</div>
<div class="how-card-visual"><span class="big">2 000+</span></div>
</div>

</div>
</section>


<!-- Video kommer -->
<section class="compare-section" style="background:#fff">
<div style="max-width:1080px;margin:0 auto;text-align:center">
<div style="font-size:12px;color:#004225;font-weight:700;text-transform:uppercase;letter-spacing:.2em;margin-bottom:16px">Sammenlign</div>
<h2 style="font-size:clamp(36px,4.5vw,56px);font-weight:800;letter-spacing:-.035em;line-height:1.05;color:#004225;margin-bottom:48px">Selge selv <em style="font-style:normal;position:relative;display:inline-block">eller med Peasy<span style="position:absolute;left:-2px;right:-2px;bottom:4px;height:10px;background:#FFCC33;z-index:-1;border-radius:2px;opacity:.7"></span></em></h2>
<div style="width:100%;max-width:780px;margin:0 auto">
<div class="compare-box" style="position:relative;width:100%;aspect-ratio:16/9;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(22,59,48,.18);background:#f9f6ef;display:grid;grid-template-columns:1fr 1fr">

<div style="padding:48px 36px;display:flex;flex-direction:column;background:#f9f6ef;color:#0a2818">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;margin-bottom:8px;opacity:.6">Selge på egenhånd</div>
  <h3 style="font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:0 0 20px;color:#163b30">Skambud, styr og<br />kveldsvisninger.</h3>
  <ul style="list-style:none;margin:0;padding:0;flex:1">
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(22,59,48,.08);font-size:12.5px"><span style="color:#6b7570;font-weight:500">Reklamasjonsansvar</span><span style="font-weight:700;color:#163b30">Du, i 2 år</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(22,59,48,.08);font-size:12.5px"><span style="color:#6b7570;font-weight:500">Fremmede på prøvekjøring</span><span style="font-weight:700;color:#163b30">Ja</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(22,59,48,.08);font-size:12.5px"><span style="color:#6b7570;font-weight:500">Skambud og forhandling</span><span style="font-weight:700;color:#163b30">Ja</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(22,59,48,.08);font-size:12.5px"><span style="color:#6b7570;font-weight:500">Foto og annonse</span><span style="font-weight:700;color:#163b30">Du</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;font-size:12.5px"><span style="color:#6b7570;font-weight:500">Tidsbruk</span><span style="font-weight:700;color:#163b30">Ukevis styr</span></li>
  </ul>
  <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(22,59,48,.12)">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#6b7570;margin-bottom:4px">Salgspris</div>
    <div style="font-size:14px;font-weight:800;color:#163b30;line-height:1.3">Det du orker å forhandle frem</div>
  </div>
</div>
<div style="padding:48px 36px;display:flex;flex-direction:column;background:#163b30;color:#fff">
  <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;margin-bottom:8px;color:#f8c21e">Peasy</div>
  <h3 style="font-size:20px;font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:0 0 20px;color:#fff">Du sender oss<br />registreringsnummer.</h3>
  <ul style="list-style:none;margin:0;padding:0;flex:1">
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:12.5px"><span style="color:rgba(255,255,255,.5);font-weight:500">Reklamasjonsansvar</span><span style="font-weight:700;color:#fff">Vi tar det</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:12.5px"><span style="color:rgba(255,255,255,.5);font-weight:500">Fremmede på prøvekjøring</span><span style="font-weight:700;color:#fff">Aldri</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:12.5px"><span style="color:rgba(255,255,255,.5);font-weight:500">Skambud og forhandling</span><span style="font-weight:700;color:#fff">Nei</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:12.5px"><span style="color:rgba(255,255,255,.5);font-weight:500">Foto og annonse</span><span style="font-weight:700;color:#fff">Vi</span></li>
    <li style="display:flex;justify-content:space-between;align-items:baseline;padding:8px 0;font-size:12.5px"><span style="color:rgba(255,255,255,.5);font-weight:500">Oppgjør</span><span style="font-weight:700;color:#fff">2 dager etter signert</span></li>
  </ul>
  <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.15)">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#f8c21e;margin-bottom:4px">Salgspris</div>
    <div style="font-size:14px;font-weight:800;color:#fff;line-height:1.3">Høyeste bud av 2 000+ bilforhandlere</div>
  </div>
</div>
</div>
</div>
</div>
</section>

<!-- PROOF / Reviews -->
<section class="proof" id="proof">
<div class="proof-header">
<div class="proof-rating"><span class="stars">★★★★★</span><strong>4,9 av 5</strong> · <span data-review-count="{n} anmeldelser">13 anmeldelser</span> <span class="glogo"></span> Google</div>
<p class="proof-quote">Vi er nye, men kundene <em>er allerede overbevist</em>.</p>
</div>

<div class="rv-grid" id="rv-grid"><div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--gray);font-size:14px">Laster anmeldelser …</div></div>

<div style="margin-bottom:64px"><a class="rv-cta" href="https://www.google.com/maps/place/?q=place_id:ChIJTelCDZ_UdkYRT50OQBqRoB0" target="_blank" rel="noopener">Les alle <span data-review-count="{n}">13</span> anmeldelser →</a></div>

<div class="proof-stats">
<div class="proof-stat"><strong>4,9★</strong><span>Google-rating</span></div>
<div class="proof-stat"><strong data-review-count="{n}">13</strong><span>Anmeldelser</span></div>
<div class="proof-stat"><strong>2 000+</strong><span>Forhandlere</span></div>
<div class="proof-stat"><strong>7 arb. dager</strong><span>Garantert bud</span></div>
</div>
</section>


<!-- Om oss -->
<section class="om-section" id="om">
<div class="om-inner">
<div class="om-copy">
<div class="section-eyebrow">Om Peasy</div>
<h2>80 000 biler senere<br />kom <em>Peasy</em> til verden.</h2>
<p class="om-lead">Etter å ha solgt over <strong>80 000 biler</strong> for våre eiere i Autoringen, gikk vi lenge med tanken: <em>burde ikke privatpersoner også få tilgang til vår lukkede forhandlerauksjon?</em></p>
<p>Autoringen har <strong>fem anlegg</strong> landet rundt: Oslo (Skedsmokorset), Ski, Trondheim, Bergen og Stavanger. Hvert anlegg vasker, fotograferer og samarbeider med NAF og Viking som utfører uavhengige tilstandsrapporter. Med kun 3-4 dagers produksjonstid så vi at infrastrukturen var perfekt egnet til å hjelpe privatpersoner få godt betalt for bilen sin — uten salgsstress og uten reklamasjonsrisiko.</p>
<p class="om-pull">Slik kom Peasy til verden.</p>
<p>Tilbakemeldingene fra våre første 100 salg ser du lenger opp. Vi vokser raskt, og vi gleder oss til å hjelpe deg.</p>
</div>
<div class="om-stats">
<div class="om-stat"><strong>80 000+</strong><span>Biler solgt til bilforhandlere!</span></div>
<div class="om-stat"><strong>2 000+</strong><span>Forhandlere i nettverket</span></div>
<div class="om-stat"><strong>5</strong><span>Anlegg i Norge</span></div>
<div class="om-stat"><strong>4,9★</strong><span>Google-rating</span></div>
</div>
</div>
</section>

<!-- Kontakt -->
<section class="callme-section" id="kontakt">
  <div class="callme-wrap">
    <div class="callme-text">
      <div class="section-eyebrow">Kontakt</div>
      <h2>Lurer du på noe?<br /><em>Vi ringer deg tilbake.</em></h2>
      <p>Legg igjen nummeret så ringer vi i åpningstid (man–fre 08–16). Spørsmål om bilen, prosessen, eller noe annet — vi hjelper deg.</p>
    </div>
    <form id="callme-form" class="callme-form" :action="callMeApiUrl" method="post">
      <div class="callme-field">
        <label for="callme-phone">Mobilnummer *</label>
        <div class="callme-phone-wrap">
          <span class="callme-prefix">+47</span>
          <input id="callme-phone" name="phone" type="tel" inputmode="numeric" autocomplete="tel" required pattern="[49][0-9 ]{7,10}" placeholder="987 65 432" />
        </div>
      </div>
      <div class="callme-field">
        <label for="callme-comment">Kommentar (valgfritt)</label>
        <textarea id="callme-comment" name="comment" rows="3" placeholder="Kan dere ringe meg vedr..."></textarea>
      </div>
      <button type="submit" class="callme-submit">Be om tilbakeringing →</button>
      <div class="callme-success" hidden>✓ Takk! Vi ringer deg snart.</div>
      <div class="callme-error" hidden></div>
    </form>
  </div>
</section>

<section class="faq-section" id="faq" style="scroll-margin-top:0">
<div class="faq-header">
<div class="section-eyebrow">Vanlige spørsmål</div>
<h2>Alt du lurer på.</h2>
<div class="faq-search-wrap">
<svg class="faq-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
<input class="faq-search" placeholder="Søk i spørsmål …" />
</div>
</div>
<div class="faq-list" id="faq-list" data-collapsed="true">
  <div
    v-for="(item, i) in faq"
    :key="i"
    class="faq-item"
    :class="{ 'faq-veil': i >= 8 }"
  >
    <div class="faq-q" v-html="item.title"></div>
    <div class="faq-a" v-html="item.content"></div>
  </div>
  <button class="faq-reveal" type="button" aria-expanded="false">Vis alle spørsmål</button>
</div>
</section>

<!-- FINAL CTA -->
<section class="final-cta">
<h2>Klar?<br />Send registreringsnummer</h2>
<p>Send registreringsnummer — vi tar resten herfra.</p>
<a href="#start" class="btn btn-primary" style="font-size:17px;padding:20px 44px">Få estimat nå →</a>
</section>

</main>
<footer>
<div class="footer-inner">
<div class="footer-col footer-logo" style="display:flex;flex-direction:column;justify-content:flex-start">
<img src="/Peasy_Logo_ORG.png" alt="Peasy" width="180" height="81" loading="lazy" decoding="async" />
<p style="font-size:14px;color:var(--gray);line-height:1.6;max-width:320px">Den enkleste måten å selge bil på i Norge.</p>
</div>
<div class="footer-col" style="display:flex;flex-direction:column"><ul style="list-style:none;padding:0;margin:0"><li><a href="#om">Om oss</a></li><li><a href="#vilkar" onclick="event.preventDefault();document.getElementById('vilkar-modal').style.display='flex'">Vilkår</a></li><li><a href="#personvern" onclick="event.preventDefault();document.getElementById('personvern-modal').style.display='flex'">Personvern</a></li></ul></div>
<div class="footer-col" style="display:flex;flex-direction:column"><ul style="list-style:none;padding:0;margin:0"><li><a href="#faq">FAQ</a></li><li><a href="#kontakt">Kontakt</a></li><li><a :href="accountUrl" target="_blank" rel="noopener">Min Side</a></li></ul></div>
<div class="footer-col" style="display:flex;flex-direction:column"><ul style="list-style:none;padding:0;margin:0"><li style="font-size:14px;color:var(--gray);line-height:1.6">Autoringen AS<br />Strandveien 15-17<br />1366 Lysaker<br />Org.nr. 987 327 359<br /><a href="tel:+4724201900" style="color:var(--green);font-weight:600">+47 24 20 19 00</a><br /><a :href="siteUrl" style="color:var(--green);font-weight:600">peasy.no</a></li></ul></div>



</div>
<div class="footer-bottom"><span>© 2026 Peasy / Autoringen AS</span></div>
</footer>


<div id="vilkar-modal" onclick="if(event.target===this)this.style.display='none'" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;justify-content:center;align-items:center;padding:24px;cursor:pointer">
  <div style="background:#fff;max-width:760px;width:100%;max-height:80vh;overflow-y:auto;border-radius:24px;padding:48px;position:relative;cursor:default">
    <button onclick="document.getElementById('vilkar-modal').style.display='none'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:28px;cursor:pointer;color:var(--gray)">&times;</button>
    <!-- modal-h2 fjernet i v3.88 - ERP leverer egen h3 -->
    <div id="vilkar-body" style="font-size:14.5px;line-height:1.6;color:var(--ink)" v-html="vilkar"></div>
  </div>
</div>
<div id="personvern-modal" onclick="if(event.target===this)this.style.display='none'" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;justify-content:center;align-items:center;padding:24px;cursor:pointer">
<div onclick="event.stopPropagation()" style="background:#fff;border-radius:16px;max-width:680px;width:100%;max-height:85vh;overflow-y:auto;padding:32px 28px;position:relative;cursor:default">
<button onclick="document.getElementById('personvern-modal').style.display='none'" style="position:absolute;top:16px;right:16px;background:none;border:none;font-size:28px;cursor:pointer;color:var(--gray)">&times;</button>
<div id="personvern-body" style="font-size:14.5px;line-height:1.6;color:var(--ink)">
<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:0 0 10px">Personvernerkl&aelig;ring for Peasy</h3>
<p>Peasy (Autoringen AS, org.nr. 987 327 359 MVA) behandler dine personopplysninger i samsvar med GDPR og norsk personvernlovgivning.</p>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Hvilke opplysninger samler vi inn?</h3>
<ul style="margin:10px 0 18px;padding-left:22px;list-style:disc">
<li><strong>Bilinformasjon:</strong> registreringsnummer, merke, modell, &aring;rsmodell, kilometerstand, tilstandsbeskrivelse, bilder.</li>
<li><strong>Kontaktinformasjon:</strong> navn, e-postadresse, telefonnummer, adresse.</li>
<li><strong>Tekniske data:</strong> IP-adresse, nettleser, enhetstype, side-aktivitet (gjennom Google Analytics og lignende, kun etter samtykke).</li>
<li><strong>Markedsf&oslash;ringskilder:</strong> UTM-parametere (utm_source, utm_campaign, gclid, fbclid m.m.) for &aring; spore hvilken kanal du kom fra &mdash; kun etter samtykke.</li>
</ul>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Hvorfor samler vi inn opplysningene?</h3>
<ul style="margin:10px 0 18px;padding-left:22px;list-style:disc">
<li>For &aring; gi deg en n&oslash;yaktig verdivurdering og prisestimat.</li>
<li>For &aring; gjennomf&oslash;re salget av bilen din via auksjon hos v&aring;rt forhandlernettverk.</li>
<li>For &aring; sende deg statusoppdateringer, p&aring;minnelser og betalingsbekreftelser p&aring; e-post og SMS.</li>
<li>For &aring; oppfylle lovkrav (regnskap, skatt, kj&oslash;retoyregisteret).</li>
<li>For &aring; forbedre tjenesten og m&aring;le hvor effektive markedsf&oslash;ringskanalene v&aring;re er.</li>
</ul>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Cookies og samtykke</h3>
<p>Vi bruker informasjonskapsler. Essensielle cookies er n&oslash;dvendige for at siden skal virke. Analyse- og markedsf&oslash;ringscookies krever ditt aktive samtykke gjennom Klaro-banneret. Du kan endre samtykket ditt n&aring;r som helst ved &aring; klikke p&aring; cookie-ikonet nederst i hj&oslash;rnet.</p>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Hvem deler vi opplysninger med?</h3>
<ul style="margin:10px 0 18px;padding-left:22px;list-style:disc">
<li><strong>Autoringen AS</strong> &mdash; eier av Peasy, h&aring;ndterer auksjon og oppgj&oslash;r.</li>
<li><strong>NAF / Viking</strong> &mdash; uavhengig tilstandsrapport av bilen.</li>
<li><strong>Gire</strong> &mdash; logistikkpartner for henting av bil.</li>
<li><strong>Forhandlere i Autoringens nettverk</strong> &mdash; mottar bil-info (uten dine personopplysninger) for budgivning.</li>
<li><strong>Google (Analytics, Tag Manager)</strong> &mdash; kun etter samtykke.</li>
<li><strong>Meta / Facebook</strong> &mdash; kun etter samtykke til markedsf&oslash;ringscookies.</li>
</ul>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Dine rettigheter</h3>
<ul style="margin:10px 0 18px;padding-left:22px;list-style:disc">
<li>Innsyn i opplysninger vi har om deg.</li>
<li>Retting av feil eller utdaterte opplysninger.</li>
<li>Sletting (&laquo;retten til &aring; bli glemt&raquo;) n&aring;r lovkrav ikke hindrer det.</li>
<li>Begrensning av behandling.</li>
<li>Data-portabilitet.</li>
<li>Klage til Datatilsynet (datatilsynet.no).</li>
</ul>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Lagringstid</h3>
<p>Vi lagrer dine opplysninger s&aring; lenge det er n&oslash;dvendig for &aring; gjennomf&oslash;re salgsprosessen og oppfylle lovp&aring;lagte krav (typisk 5 &aring;r etter siste transaksjon i henhold til bokf&oslash;ringsloven). Markedsf&oslash;ringsdata slettes etter 24 m&aring;neder hvis du ikke har v&aelig;rt aktiv.</p>

<h3 style="font-size:18px;font-weight:700;color:var(--green);margin:20px 0 10px">Kontakt</h3>
<p>Sp&oslash;rsm&aring;l om personvern? Send e-post til <a :href="`mailto:${contactEmail}`" style="color:var(--green);text-decoration:underline">post@peasy.no</a> &mdash; vi svarer innen 30 dager.</p>

<p style="font-size:12px;color:var(--gray);margin-top:24px;border-top:1px solid var(--green-soft);padding-top:16px">Sist oppdatert 13.05.2026. Behandlingsansvarlig: Autoringen AS, org.nr. 987 327 359.</p>
</div>
</div>
</div>

<div class="sticky-cta" id="sticky-cta"><a href="#start">Selg bilen din i dag →</a></div>
<button class="back-to-top" id="back-to-top" aria-label="Til toppen"><img src="/arrow-narrow-up.svg" alt="" width="20" height="20" /></button>

<div class="mobile-menu" id="mobile-menu">
  <button class="mm-close" aria-label="Lukk meny" type="button">✕</button>
  <a href="#om" data-mm-close>Om oss</a>
  <a href="#how" data-mm-close>Slik virker det</a>
  <a href="#proof" data-mm-close>Anmeldelser</a>
  <a href="#faq" data-mm-close>FAQ</a>
  <a :href="accountUrl" target="_blank" rel="noopener" data-mm-close>Min Side</a>

  <a href="#start" class="mm-cta" data-mm-close>Start salg →</a>
</div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import faqData from './data/faq.json'
import vilkarHtml from './data/vilkar.html?raw'

// --- Data for the template ---
const faq = ref(faqData)
const vilkar = ref(vilkarHtml)

// --- URLs from .env (used in the template) ---
const siteUrl = import.meta.env.VITE_SITE_URL
const accountUrl = import.meta.env.VITE_ACCOUNT_URL
const carAddUrl = import.meta.env.VITE_CAR_ADD_URL
const callMeApiUrl = import.meta.env.VITE_CALLME_API_URL
const contactEmail = import.meta.env.VITE_CONTACT_EMAIL

onMounted(() => {
  initFaq()
  initReviews()
  initModals()
  initStatsAnimation()
  initCallMeForm()
  initMobileMenu()
  initHeroForm()
  initBackToTop()
  initRecentSale()
  initUtmForwarder()
})

// === FAQ: accordion, "show all", search ===
function initFaq() {
  document.querySelectorAll('.faq-q').forEach(q=>q.addEventListener('click',()=>q.parentElement.classList.toggle('open')));(function(){var list=document.getElementById('faq-list');if(!list)return;var btn=list.querySelector('.faq-reveal');if(btn){btn.addEventListener('click',function(){var open=btn.getAttribute('aria-expanded')==='true';list.setAttribute('data-collapsed',open?'true':'false');btn.setAttribute('aria-expanded',open?'false':'true');btn.textContent=open?'Vis alle spørsmål':'Skjul spørsmål'})}var s=document.querySelector('.faq-search');if(s){s.addEventListener('input',function(e){var v=(e.target.value||'').trim();if(v){list.setAttribute('data-collapsed','false')}else if(btn&&btn.getAttribute('aria-expanded')!=='true'){list.setAttribute('data-collapsed','true')}})}})();

  const search=document.querySelector('.faq-search');
  if(search){search.addEventListener('input',e=>{const v=e.target.value.toLowerCase().trim();document.querySelectorAll('.faq-item').forEach(item=>{const txt=item.textContent.toLowerCase();item.style.display=(!v||txt.includes(v))?'':'none';});});}
}

// === Reviews: fetch /peasy-reviews.json, render #rv-grid ===
function initReviews() {
  (async()=>{try{const r=await fetch('peasy-reviews.json?cb='+Date.now());const j=await r.json();const grid=document.getElementById('rv-grid');if(!grid||!j.reviews)return;const sorted=[...j.reviews].sort((a,b)=>(b.publishTime||'').localeCompare(a.publishTime||''));const cards=sorted.slice(0,5).map(rv=>{let name=rv.authorAttribution?.displayName||'Anonym kunde';name=name.split(' ').map(w=>w?w[0].toUpperCase()+w.slice(1).toLowerCase():w).join(' ');const time=rv.relativePublishTimeDescription||'';const text=(rv.text?.text||'').replace(/\n/g,' ').slice(0,400);const init=name[0]?.toUpperCase()||'?';return `<div class="rv-card"><div class="rv-stars">★★★★★</div><blockquote>"${text}"</blockquote><div class="rv-foot"><div class="rv-avatar">${init}</div><div><div class="rv-name">${name}</div><div class="rv-time">${time}</div></div></div></div>`;}).join('');grid.innerHTML=cards;const rt=document.querySelector('.proof-rating strong');if(rt&&j.rating)rt.textContent=j.rating.toString().replace('.',',')+' av 5';
  const cnt=j.userRatingCount;
  if(cnt){
    document.querySelectorAll('[data-review-count]').forEach(el=>{
      el.textContent=el.dataset.reviewCount.replace('{n}', cnt);
    });
  }}catch(e){console.error('rev',e);}})();
}

// === Modals vilkår/personvern: hash router + Escape ===
function initModals() {
  function hashRouter(){var hash=location.hash.replace(/^#/,'');if(hash==='vilkar'){var m=document.getElementById('vilkar-modal');if(m)m.style.display='flex'}else if(hash==='personvern'){var m=document.getElementById('personvern-modal');if(m)m.style.display='flex'}}
  hashRouter();
  window.addEventListener('hashchange',hashRouter);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){["vilkar-modal","personvern-modal"].forEach(id=>{const m=document.getElementById(id);if(m&&m.style.display==="flex")m.style.display="none";});}});
}

// === Animate .proof-stat numbers via IntersectionObserver ===
function initStatsAnimation() {
  const stats = document.querySelectorAll('.proof-stat strong');
  if(!('IntersectionObserver' in window) || stats.length === 0) return;
  const animate = (el) => {
    const target = el.textContent.trim();
    const num = parseFloat(target.replace(/\s+/g,'').replace(',','.').match(/[\d.]+/)?.[0] || 0);
    if(!num || num < 1) return;
    const suffix = target.replace(/[\d.,\s]/g,'').trim();
    const isFloat = target.includes(',');
    const duration = 1200;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now-start)/duration, 1);
      const eased = 1 - Math.pow(1-t, 3);
      const current = num * eased;
      const formatted = isFloat ? current.toFixed(1).replace('.',',') : Math.round(current).toLocaleString('no-NO').replace(',',' ');
      el.textContent = formatted + suffix;
      if(t < 1) requestAnimationFrame(step);
      else el.textContent = target;
    };
    requestAnimationFrame(step);
  };
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting){
        animate(e.target);
        obs.unobserve(e.target);
      }
    });
  }, {threshold: 0.5});
  stats.forEach(s => obs.observe(s));
}

// === Call-me form #callme-form: async POST ===
function initCallMeForm() {
  const form = document.getElementById('callme-form');
  if(!form) return;
  const btn = form.querySelector('.callme-submit');
  const ok = form.querySelector('.callme-success');
  const err = form.querySelector('.callme-error');
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    err.hidden = true;
    ok.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Sender...';
    try{
      const phone = '+47' + form.phone.value.replace(/\s/g,'');
      const fd = new FormData();
      fd.append('phone', phone);
      fd.append('comment', form.comment.value || '');
      const r = await fetch(form.action, { method:'POST', body: fd });
      if(!r.ok) throw new Error('Server svarte ' + r.status);
      ok.hidden = false;
      form.phone.value = '';
      form.comment.value = '';
      if(window.dataLayer){ window.dataLayer.push({event:'callme_submit'}); }
    }catch(ex){
      err.textContent = 'Kunne ikke sende. Prøv igjen, eller ring +47 24 20 19 00.';
      err.hidden = false;
      console.error('callme', ex);
    }finally{
      btn.disabled = false;
      btn.textContent = 'Be om tilbakeringing →';
    }
  });
}

// === Mobile menu (hamburger) + sticky bottom CTA ===
function initMobileMenu() {
  // Hamburger-meny
  var hamb = document.querySelector('.hamburger-btn');
  var mm = document.getElementById('mobile-menu');
  if(hamb && mm){
    hamb.addEventListener('click', function(){ mm.classList.add('open'); document.body.style.overflow='hidden'; });
    var close = mm.querySelector('.mm-close');
    if(close) close.addEventListener('click', function(){ mm.classList.remove('open'); document.body.style.overflow=''; });
    mm.querySelectorAll('[data-mm-close]').forEach(function(a){
      a.addEventListener('click', function(){ mm.classList.remove('open'); document.body.style.overflow=''; });
    });
  }
  // Sticky bottom CTA - vises etter hero scroll
  var sticky = document.getElementById('sticky-cta');
  var hero = document.querySelector('.hero');
  if(sticky && hero){
    function onScroll(){
      var heroBottom = hero.getBoundingClientRect().bottom;
      if(heroBottom < 80) sticky.classList.add('visible');
      else sticky.classList.remove('visible');
    }
    window.addEventListener('scroll', onScroll, {passive:true});
    onScroll();
  }
}

// === Hero form: registration-number formatting ===
function initHeroForm() {
  var hf = document.getElementById('hero-form');
  if(!hf) return;
  hf.addEventListener('submit', function(e){
    var input = hf.querySelector('input[name="reg_number"]');
    if(input && input.value){
      input.value = input.value.replace(/\s+/g,'').toUpperCase();
    }
  });
  // Live formattering: lar brukeren skrive med eller uten space, viser med space etter 2. tegn
  var reg = hf.querySelector('input[name="reg_number"]');
  if(reg){
    reg.addEventListener('input', function(e){
      var v = this.value.replace(/\s+/g,'').toUpperCase();
      if(v.length > 7) v = v.slice(0,7);
      // Sett inn space etter 2 bokstaver hvis det er 3+ tegn
      if(v.length > 2){
        this.value = v.slice(0,2) + ' ' + v.slice(2);
      } else {
        this.value = v;
      }
    });
  }
}

// === Back-to-top button + smooth-scroll for #start links ===
function initBackToTop() {
  var btt=document.getElementById('back-to-top');if(btt){btt.addEventListener('click',function(e){e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});history.replaceState(null,'',location.pathname);});window.addEventListener('scroll',function(){if(window.scrollY>600)btt.classList.add('visible');else btt.classList.remove('visible');});}document.querySelectorAll('a[href="#start"]').forEach(function(a){a.addEventListener('click',function(e){var el=document.getElementById('start');if(el){e.preventDefault();el.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(function(){history.replaceState(null,'',location.pathname);},800);}});});
}

// === Recent-sale widget #recentSale ===
function initRecentSale() {
  var cases=[
    {car:'Toyota Yaris Hybrid 2013',km:'182 000 km',price:'56 500 kr',days:'2 dager'},
    {car:'Honda HR-V 2017',km:'132 000 km',price:'129 000 kr',days:'2 dager'},
    {car:'Skoda Kodiaq 2017',km:'126 000 km',price:'210 000 kr',days:'2 dager'},
    {car:'BMW iX3 2022',km:'47 600 km',price:'370 500 kr',days:'2 dager'},
    {car:'Mercedes-Benz GLS 2020',km:'97 000 km',price:'903 500 kr',days:'4 dager'}
  ];
  function init(){
    var el=document.getElementById('recentSale');
    if(!el) return;
    var c=cases[Math.floor(Math.random()*cases.length)];
    if(window.matchMedia('(max-width:600px)').matches){
      var title=document.querySelector('.hero-title');
      if(title&&title.parentNode){
        el.classList.add('is-mobile-top');
        title.parentNode.insertBefore(el,title.nextSibling);
      }
    }
    el.querySelector('.recent-sale-car').textContent=c.car;
    el.querySelector('.recent-sale-km').textContent=c.km;
    el.querySelector('.recent-sale-price').textContent=c.price;
    el.querySelector('.recent-sale-days').textContent=c.days;
  }
  init();
}

// === Forward UTM/click-id into forms + dataLayer events ===
function initUtmForwarder() {
  const FORWARD = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'gclid', 'fbclid', 'msclkid', 'ttclid', 'ref', 'referrer', 'source', 'campaign',
    'adset', 'placement', 'ad-id'];

  function getParams() {
    const p = new URLSearchParams(window.location.search);
    const out = {};
    FORWARD.forEach((k) => { const v = p.get(k); if (v) out[k] = v; });
    try {
      const stored = JSON.parse(sessionStorage.getItem('peasy_utm') || '{}');
      Object.keys(stored).forEach((k) => { if (!out[k]) out[k] = stored[k]; });
      if (Object.keys(out).length) sessionStorage.setItem('peasy_utm', JSON.stringify(out));
    } catch (e) { /* sessionStorage unavailable — ignore */ }
    return out;
  }

  function inject(form, params) {
    Object.keys(params).forEach((k) => {
      if (form.querySelector('input[name="' + k + '"]')) return;
      const inp = document.createElement('input');
      inp.type = 'hidden';
      inp.name = k;
      inp.value = params[k];
      form.appendChild(inp);
    });
  }

  const params = getParams();
  const forms = document.querySelectorAll('#hero-form, #peasy-form, #callme-form, #nav-form');

  if (Object.keys(params).length) {
    forms.forEach((f) => inject(f, params));
    const mo = new MutationObserver(() => forms.forEach((f) => inject(f, params)));
    forms.forEach((f) => mo.observe(f, { childList: true }));
  }

  // dataLayer event on #peasy-form submit
  const peasyForm = document.getElementById('peasy-form');
  if (peasyForm) {
    peasyForm.addEventListener('submit', () => {
      if (window.dataLayer) {
        window.dataLayer.push({ event: 'lead_form_submit', form_id: 'peasy-form' });
      }
    });
  }
}
</script>

<style>
:root{
  --green:#004225;
  --green-dark:#003319;
  --green-soft:#e8efea;
  --yellow:#FFCC33;
  --blue:#82bfd2;
  --ink:#0f1d18;
  --gray:#6b7575;
  --bg-soft:#f5f5f2;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{overflow-x:hidden;font-family:'Inter',-apple-system,system-ui,sans-serif;color:var(--ink);background:#fff;line-height:1.45;-webkit-font-smoothing:antialiased}

.demo-banner{background:var(--yellow);color:var(--green);text-align:center;padding:10px 24px;font-size:13px;font-weight:600}
.demo-banner a{color:var(--green);text-decoration:underline}

.nav{position:sticky;top:0;background:rgba(255,255,255,.85);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);z-index:100;border-bottom:1px solid rgba(0,66,37,.06)}
.nav-inner{max-width:1280px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:relative}
.nav-logo{display:flex;flex-direction:column;align-items:flex-start;gap:2px}
.nav-logo .payoff{font-size:10px;color:var(--green);font-weight:500;letter-spacing:.02em;line-height:1}
.nav-logo img{height:28px;display:block}
.nav-links{display:flex;gap:32px;align-items:center;font-size:14px}
.nav-links a{color:var(--ink);text-decoration:none;opacity:.85;font-weight:500;transition:opacity .15s}
.nav-links a:hover{opacity:1}
.nav-cta{color:#fff!important;background:var(--green);padding:10px 22px;border-radius:9999px;opacity:1!important;font-weight:600}.nav-cta-form{display:flex;align-items:center;gap:8px}.nav-plate{display:flex;align-items:center;background:#fff;border:2px solid var(--green);border-radius:8px;padding:0;overflow:hidden;height:38px}.nav-plate-flag{height:100%;width:auto;display:block;border-radius:6px 0 0 6px;flex-shrink:0}.nav-reg-input{border:none;outline:none;font-family:inherit;font-size:14px;font-weight:700;color:var(--green);padding:0 10px;width:110px;text-transform:uppercase;letter-spacing:.04em;background:#fff;height:100%}.nav-reg-input::placeholder{color:#bdc4be;font-weight:500}.nav-cta-btn{background:var(--green);color:#fff;border:none;border-radius:9999px;padding:10px 18px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:background .15s}.nav-cta-btn:hover{background:#0a2818}

/* HERO */
.hero{min-height:88vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:80px 24px 60px;background:#fff;position:relative;overflow:hidden}
.hero-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--green);font-weight:600;margin-bottom:28px;letter-spacing:.02em;background:var(--green-soft);padding:8px 18px;border-radius:9999px}
.hero-eyebrow::before{content:"";width:8px;height:8px;background:#10b981;border-radius:50%;animation:pulse 1.8s infinite;flex-shrink:0;transform-origin:center}
@keyframes pulse{0%{transform:scale(1);box-shadow:0 0 0 0 rgba(16,185,129,.7)}70%{transform:scale(1.15);box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{transform:scale(1);box-shadow:0 0 0 0 rgba(16,185,129,0)}}
h1.hero-title{font-size:clamp(52px,8vw,120px);font-weight:800;letter-spacing:-.045em;line-height:.95;margin-bottom:24px;max-width:1100px;color:var(--green)}
h1.hero-title em{font-style:normal;position:relative;display:inline-block}.hero-title .hero-title-reg{font-size:.62em;font-weight:700;letter-spacing:-.025em;display:inline-block;line-height:.95}
h1.hero-title em::after{content:"";position:absolute;left:-4px;right:-4px;bottom:8px;height:18px;background:var(--yellow);z-index:-1;border-radius:4px}
.hero-sub{font-size:clamp(17px,1.6vw,21px);color:var(--gray);font-weight:400;max-width:600px;margin-bottom:40px;line-height:1.5}
.hero-points{list-style:none;margin:0 auto 36px;padding:0;max-width:560px;text-align:left;display:grid;gap:12px}
.hero-points li{position:relative;padding-left:30px;font-size:clamp(15px,1.4vw,17px);line-height:1.45;color:var(--green)}
.hero-points li::before{content:"";position:absolute;left:0;top:2px;width:20px;height:20px;border-radius:50%;background:var(--green-soft);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2310b981' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:center;background-size:13px}
.hero-cta-group{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:56px}
.btn{padding:16px 36px;border-radius:9999px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none;border:none;display:inline-flex;align-items:center;gap:8px;transition:transform .15s,opacity .15s;font-family:inherit}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--green);color:#fff}
.btn-secondary{background:transparent;color:var(--green);border:1.5px solid rgba(0,66,37,.18)}
.btn-secondary:hover{background:var(--green-soft)}

/* Video — sort med ekte video-look */
.video-frame{background:#000;border-radius:24px;position:relative;overflow:hidden;box-shadow:0 12px 40px rgba(22,59,48,.10)}
.video-frame::before{content:"";position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,0) 50%,rgba(0,0,0,.4) 100%);pointer-events:none;z-index:1}
.video-controls{position:absolute;bottom:16px;left:16px;right:16px;display:flex;align-items:center;gap:12px;z-index:3;color:#fff;font-size:12px;opacity:.85}
.video-controls .bar{flex:1;height:3px;background:rgba(255,255,255,.25);border-radius:9999px;overflow:hidden}
.video-controls .bar::after{content:"";display:block;width:18%;height:100%;background:var(--yellow);border-radius:9999px}
.video-tag{position:absolute;top:16px;left:16px;background:rgba(0,0,0,.55);backdrop-filter:blur(8px);color:#fff;padding:6px 12px;border-radius:9999px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;z-index:3}
.video-tag .live-dot{display:inline-block;width:6px;height:6px;background:#ef4444;border-radius:50%;margin-right:6px;animation:pulse 2s infinite;vertical-align:middle}
.video-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:14px;z-index:2}
.video-play{width:84px;height:84px;background:rgba(255,255,255,.95);border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 32px rgba(0,0,0,.4);cursor:pointer;transition:transform .2s}
.video-play:hover{transform:scale(1.06)}
.video-play::after{content:"";width:0;height:0;border-left:24px solid var(--ink);border-top:14px solid transparent;border-bottom:14px solid transparent;margin-left:6px}
.video-title{font-size:18px;font-weight:600;opacity:.95}

.hero-video{max-width:640px;margin:0 auto;width:100%;aspect-ratio:16/9}
.hero-video.video-frame{background:#0a0a0a url("https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&q=80&auto=format") center/cover}
.hero-video.video-frame::after{content:"";position:absolute;inset:0;background:rgba(0,0,0,.55);z-index:1}

/* Trust-bar partnere */
.trust-bar{background:var(--bg-soft);padding:48px 24px;text-align:center}
.trust-bar-label{font-size:12px;color:var(--gray);font-weight:600;text-transform:uppercase;letter-spacing:.2em;margin-bottom:24px}
.trust-bar-logos{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:48px}
.trust-bar-logos img{height:36px;opacity:.55;filter:grayscale(1);transition:opacity .2s,filter .2s}
.trust-bar-logos img:hover{opacity:1;filter:grayscale(0)}

/* Form section */
.form-section{background:var(--green);color:#fff;padding:120px 24px;text-align:center;position:relative;overflow:hidden}
.form-section::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 20%,rgba(255,204,51,.08),transparent 50%);pointer-events:none}
.form-section h2{font-size:clamp(38px,5vw,68px);font-weight:800;letter-spacing:-.04em;line-height:1;margin-bottom:20px;position:relative}
.form-section .form-sub{font-size:18px;color:rgba(255,255,255,.7);max-width:520px;margin:0 auto 44px;position:relative}
.form-section .form-footnote{font-size:13px;color:rgba(255,255,255,.55);margin:0 0 24px;text-align:center}
.estimate-form{max-width:520px;margin:0 auto;display:grid;gap:12px;position:relative}
.estimate-form input{padding:20px 24px;border:1.5px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;border-radius:14px;font-size:18px;outline:none;transition:border-color .15s,background .15s;font-family:inherit}
.estimate-form input:focus{border-color:var(--yellow);background:rgba(255,255,255,.08)}
.estimate-form input.reg{font-size:30px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;text-align:center;font-family:Helvetica,Arial,sans-serif;color:var(--yellow)}
.estimate-form input::placeholder{color:rgba(255,255,255,.35);font-weight:400;text-transform:none;letter-spacing:0}
.estimate-form input.reg::placeholder{letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:rgba(255,204,51,.4)}
.estimate-form .btn-submit{padding:20px;background:var(--yellow);color:var(--green);border:none;border-radius:14px;font-size:17px;font-weight:700;cursor:pointer;font-family:inherit;transition:transform .15s,background .15s}
.estimate-form .btn-submit:hover{transform:scale(1.01);background:#ffd84d}
.form-trust{margin-top:32px;font-size:14px;color:rgba(255,255,255,.6);position:relative}
.form-trust strong{color:#fff}

/* HOW IT WORKS */
.how-section{padding:120px 24px;background:#fff}
.how-header{max-width:1280px;margin:0 auto 72px;text-align:center}
.section-eyebrow{font-size:12px;color:var(--green);font-weight:700;text-transform:uppercase;letter-spacing:.2em;margin-bottom:16px}
.how-header h2{font-size:clamp(40px,5vw,68px);font-weight:800;letter-spacing:-.04em;line-height:1.05;max-width:820px;margin:0 auto;color:var(--green)}
.how-header h2 em{font-style:normal;color:var(--green);position:relative}
.how-header h2 em::after{content:"";position:absolute;left:0;right:0;bottom:6px;height:14px;background:var(--yellow);z-index:-1;border-radius:3px;opacity:.7}

.how-intro{font-size:18px;color:var(--gray);max-width:780px;margin:24px auto 0;line-height:1.55}
.how-cards{max-width:1280px;margin:0 auto;display:grid;gap:24px}
.how-card{background:var(--bg-soft);border-radius:32px;padding:64px;display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;min-height:480px;overflow:hidden;position:relative}
.how-card.dark{background:var(--green);color:#fff}
.how-card.accent{background:#fff;border:2px solid var(--green-soft)}
.how-card.reverse{direction:rtl}
.how-card.reverse>*{direction:ltr}
.how-card-content h3{font-size:clamp(30px,3.2vw,44px);font-weight:800;letter-spacing:-.025em;line-height:1.05;margin-bottom:20px}
.how-card-content p{font-size:17px;line-height:1.55;opacity:.78;margin-bottom:24px}
.how-card-num{display:inline-block;font-size:14px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;margin-bottom:24px;opacity:.65}
.how-card-content::before{content:attr(data-step);display:block;font-size:clamp(80px,10vw,140px);font-weight:900;line-height:.85;letter-spacing:-.05em;color:var(--green);opacity:.12;margin-bottom:-40px}
.how-card-visual{aspect-ratio:1.05;background:#e6e8e3;border-radius:24px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.how-card.dark .how-card-visual{background:rgba(255,255,255,.06)}
.how-card.accent .how-card-visual{background:var(--green-soft)}
.how-card-visual .big{font-size:clamp(64px,9vw,128px);font-weight:900;letter-spacing:-.05em;line-height:1;color:var(--green)}
.how-card.dark .how-card-visual .big{color:var(--yellow)}
.how-card.dark .how-card-content::before{color:var(--yellow);opacity:.18}
.live-badge{display:inline-flex;align-items:center;gap:8px;background:var(--green-soft);color:var(--green);padding:7px 14px;border-radius:9999px;font-size:13px;font-weight:600;margin-bottom:24px}
.how-card.dark .live-badge{background:rgba(255,204,51,.15);color:var(--yellow)}
.live-badge::before{content:"";width:7px;height:7px;background:currentColor;border-radius:50%;animation:pulse 2s infinite}

/* Wash card med ekte bil-bilde-bakgrunn */
.wash-visual{aspect-ratio:1.05;border-radius:24px;position:relative;overflow:hidden;background:#000 url("https://images.unsplash.com/photo-1605164599901-db7f68c4b1c3?w=900&q=80&auto=format") center/cover}
.wash-visual::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.2) 0%,rgba(0,0,0,.65) 100%);z-index:1}
.wash-visual::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 30%,rgba(130,191,210,.25),transparent 40%);z-index:1}
.wash-visual .video-tag,.wash-visual .video-play,.wash-visual .video-controls,.wash-visual .video-title{z-index:3}
.wash-visual .video-placeholder{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;z-index:3;color:#fff}

/* PROOF / Reviews */
.proof{padding:120px 24px;background:var(--bg-soft);text-align:center}
.proof-header{max-width:640px;margin:0 auto 56px}
.proof-quote{font-size:clamp(30px,4vw,52px);font-weight:600;letter-spacing:-.03em;line-height:1.15;margin:0 auto 24px;color:var(--green);max-width:640px}
.proof-quote em{font-style:normal;background:var(--yellow);padding:0 8px;border-radius:6px;color:var(--green)}
.proof-rating{display:inline-flex;align-items:center;gap:10px;margin-bottom:8px;font-size:18px;color:var(--green);font-weight:600}
.proof-rating .stars{color:var(--yellow);font-size:22px;letter-spacing:2px}
.proof-rating .glogo{display:inline-block;width:18px;height:18px;background:conic-gradient(from 0deg,#4285F4 0deg 90deg,#34A853 90deg 180deg,#FBBC05 180deg 270deg,#EA4335 270deg 360deg);border-radius:50%;margin-left:4px}

/* Bil-vask video — full width section */
.wash-section{max-width:1100px;margin:0 auto 64px;aspect-ratio:21/9;border-radius:24px;position:relative;overflow:hidden;background:#000 url("https://images.unsplash.com/photo-1605164599901-db7f68c4b1c3?w=1400&q=80&auto=format") center/cover}
.wash-section::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15) 0%,rgba(0,0,0,.7) 100%);z-index:1}
.wash-section::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 40%,rgba(130,191,210,.2),transparent 50%);z-index:1}
.wash-section .video-placeholder,.wash-section .video-controls,.wash-section .video-tag{z-index:3}

/* Reviews grid */
.rv-grid{max-width:1280px;margin:0 auto 64px;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.rv-card{background:#fff;border-radius:20px;padding:28px;text-align:left;height:100%;display:flex;flex-direction:column;box-shadow:0 1px 3px rgba(0,66,37,.06)}
.rv-stars{color:var(--yellow);font-size:18px;letter-spacing:2px;margin-bottom:14px}
.rv-card blockquote{font-size:15px;line-height:1.55;color:var(--ink);margin-bottom:20px;flex:1;font-weight:400}
.rv-foot{display:flex;align-items:center;gap:12px;padding-top:16px;border-top:1px solid rgba(0,66,37,.08)}
.rv-avatar{width:36px;height:36px;background:var(--green);color:var(--yellow);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0}
.rv-name{font-size:13px;font-weight:600;color:var(--ink)}
.rv-time{font-size:12px;color:var(--gray)}
.rv-cta{display:inline-flex;align-items:center;gap:8px;background:#000;color:#fff;padding:14px 28px;border-radius:9999px;text-decoration:none;font-size:14px;font-weight:600}

.proof-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:48px;max-width:1080px;margin:64px auto 0;padding-top:48px;border-top:1px solid rgba(0,66,37,.1)}
.proof-stat strong{display:block;font-size:clamp(36px,4vw,56px);font-weight:800;letter-spacing:-.03em;color:var(--green);line-height:1}
.proof-stat span{display:block;margin-top:8px;font-size:14px;color:var(--gray)}

/* FAQ */
.faq-section{padding:120px 24px;background:#fff}
.faq-header{max-width:640px;margin:0 auto 56px;text-align:center}
.faq-header h2{font-size:clamp(36px,5vw,60px);font-weight:800;letter-spacing:-.04em;line-height:1.05;color:var(--green)}
.faq-search-wrap{max-width:600px;margin:32px auto 0;position:relative}
.faq-search{width:100%;padding:18px 24px 18px 56px;border:1.5px solid var(--green-soft);border-radius:9999px;font-size:16px;background:#fff;outline:none;font-family:inherit;transition:border-color .15s}
.faq-search:focus{border-color:var(--green)}
.faq-search-icon{position:absolute;left:20px;top:50%;transform:translateY(-50%);opacity:.4;color:var(--green)}
.faq-list{max-width:640px;margin:0 auto;background:var(--bg-soft);border-radius:24px;overflow:hidden}.faq-list[data-collapsed="true"] .faq-item.faq-veil{display:none}.faq-list[data-collapsed="true"] .faq-item.faq-edge{position:relative}.faq-list[data-collapsed="true"] .faq-item.faq-edge::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:80px;background:linear-gradient(to bottom,rgba(248,247,243,0) 0%,var(--bg-soft) 90%);pointer-events:none;z-index:1}.faq-reveal{display:none;padding:22px 32px;font-size:16px;font-weight:600;color:var(--green);cursor:pointer;background:transparent;border:none;border-top:1px solid rgba(0,66,37,.06);width:100%;text-align:left;font-family:inherit;align-items:center;justify-content:space-between;transition:background .2s}.faq-list[data-collapsed="true"] .faq-reveal{display:flex}.faq-reveal:hover{background:rgba(0,66,37,.03)}.faq-reveal::after{content:"+";font-size:24px;font-weight:300;opacity:.5;transition:transform .2s}.faq-reveal[aria-expanded="true"]::after{content:"−"}.faq-reveal:hover::after{opacity:1}@keyframes faqSlideIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}.faq-list[data-collapsed="false"] .faq-item.faq-veil{animation:faqSlideIn .35s ease-out both}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(10){animation-delay:.03s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(11){animation-delay:.06s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(12){animation-delay:.09s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(13){animation-delay:.12s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(14){animation-delay:.15s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(15){animation-delay:.18s}.faq-list[data-collapsed="false"] .faq-item.faq-veil:nth-child(n+16){animation-delay:.21s}
.faq-item{border-bottom:1px solid rgba(0,66,37,.06)}.faq-item.open{background:rgba(0,66,37,.025);box-shadow:inset 3px 0 0 var(--green)}
.faq-item:last-child{border-bottom:none}
.faq-q{padding:22px 32px;font-size:16px;font-weight:600;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background .15s;color:var(--green);gap:16px}
.faq-q:hover{background:rgba(0,66,37,.03)}.faq-q::after{content:"+";font-size:24px;font-weight:300;line-height:1;width:24px;height:24px;text-align:center;display:inline-block;opacity:.5;flex-shrink:0;color:currentColor;transition:opacity .2s ease}.faq-item.open .faq-q::after{content:"−";opacity:.9}.faq-q:hover::after{opacity:.9}
.faq-a{max-height:0;overflow:hidden;padding:0;transition:max-height .35s,padding .35s}
.faq-item.open .faq-a{max-height:600px;padding:0 32px 22px}
.faq-a p{font-size:14.5px;line-height:1.65;color:var(--gray);margin:0 0 14px}
.faq-a p:last-child{margin-bottom:0}
.faq-a strong{color:var(--ink);font-weight:700}
.faq-a ul{margin:10px 0 16px;padding-left:22px;list-style:disc}
.faq-a li{font-size:14.5px;line-height:1.65;color:var(--gray);margin:6px 0}
.faq-a li strong{color:var(--ink)}
.faq-a br+strong{display:inline-block;margin-top:6px}
.faq-a a{color:var(--green);text-decoration:underline}
#vilkar-body p{margin:0 0 14px;font-size:14.5px;line-height:1.65;color:var(--ink)}
#vilkar-body p:last-child{margin-bottom:0}
#vilkar-body strong{color:var(--green);font-weight:700}
#vilkar-body h3{font-size:18px;font-weight:700;color:var(--green);margin:24px 0 10px}
#vilkar-body h3:first-child{margin-top:0}
#vilkar-body ul{margin:10px 0 18px;padding-left:22px;list-style:disc}
#vilkar-body li{margin:6px 0;line-height:1.6}
#vilkar-body li strong{color:var(--green)}
#vilkar-body a{color:var(--green);text-decoration:underline}

/* FINAL CTA */
.final-cta{background:var(--green);color:#fff;padding:140px 24px;text-align:center;position:relative;overflow:hidden}
.final-cta::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 100%,rgba(255,204,51,.18),transparent 60%);pointer-events:none}
.final-cta h2{font-size:clamp(44px,6.5vw,88px);font-weight:800;letter-spacing:-.045em;line-height:.98;margin-bottom:24px;position:relative}
.final-cta p{font-size:19px;color:rgba(255,255,255,.7);margin-bottom:48px;position:relative}
.final-cta .btn-primary{background:var(--yellow);color:var(--green)}
.final-cta .btn-primary:hover{background:#ffd84d}

/* FOOTER */
footer{background:#fff;padding:64px 24px 32px;border-top:1px solid rgba(0,66,37,.08)}
.footer-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:48px;margin-bottom:48px}
.footer-logo .payoff{font-size:10px;color:var(--green);font-weight:500;letter-spacing:.02em;margin-bottom:4px}
.footer-logo img{height:40px;width:auto;max-width:140px;object-fit:contain;display:inline-block;margin-bottom:16px;flex-shrink:0;flex-grow:0}
.footer-col.footer-logo{align-items:flex-start}
.footer-col h4{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--gray);margin-bottom:16px;font-weight:600}
.footer-col ul{list-style:none}
.footer-col li{margin-bottom:10px}
.footer-col a{color:var(--ink);text-decoration:none;font-size:14px}
.footer-col a:hover{color:var(--green)}
.footer-bottom{max-width:1280px;margin:0 auto;padding-top:24px;border-top:1px solid rgba(0,66,37,.06);font-size:13px;color:var(--gray);display:flex;justify-content:space-between;flex-wrap:wrap;gap:16px}

@media(max-width:900px){
.rv-grid{grid-template-columns:1fr}
}
@media(max-width:768px){
.nav-links a:not(.nav-cta){display:none}.nav{position:fixed;top:0;left:0;right:0;width:100%}body{padding-top:60px}.nav-links .nav-cta-form{display:none}@media(min-width:769px){.nav-links .nav-cta-form{display:flex}}
.how-card{grid-template-columns:1fr;padding:40px 32px;min-height:auto;gap:32px}
.how-card.reverse{direction:ltr}
.proof-stats{grid-template-columns:repeat(2,1fr);gap:32px}
.footer-inner{grid-template-columns:1fr 1fr;gap:32px}
.trust-bar-logos{gap:32px}
.trust-bar-logos img{height:28px}
.wash-section{aspect-ratio:16/9}
}

.owners-bar{background:#fff;padding:64px 24px 40px}
.owners-bar .trust-bar-label{color:var(--green);font-size:13px;margin-bottom:32px}
.owners-bar .trust-bar-logos.owners img{height:48px;opacity:1;filter:none}
.partners-bar{background:var(--bg-soft);padding:32px 24px}
.partners-bar .trust-bar-label{font-size:11px;margin-bottom:18px}
.partners-bar .trust-bar-logos img{height:24px;opacity:.55;filter:grayscale(1)}
.partners-bar .trust-bar-logos img:hover{opacity:1;filter:none}

.trygghet-section{background:#fff;padding:120px 24px}
.trygghet-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}
.trygghet-copy h2{font-size:clamp(36px,4.5vw,56px);font-weight:800;letter-spacing:-.035em;line-height:1.05;color:var(--green);margin-bottom:24px}
.trygghet-copy h2 em{font-style:normal;position:relative;display:inline-block}
.trygghet-copy h2 em::after{content:"";position:absolute;left:-2px;right:-2px;bottom:4px;height:10px;background:var(--yellow);z-index:-1;border-radius:2px;opacity:.7}
.trygghet-lead{font-size:18px;line-height:1.6;color:var(--ink);margin-bottom:20px}
.trygghet-lead strong{color:var(--green);font-weight:700}
.trygghet-sub{font-size:15px;line-height:1.6;color:var(--gray)}
.owners-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.owner-sub{display:block;text-align:center;margin-top:4px;font-size:11px;font-weight:600;color:#6b7570;letter-spacing:.02em}.owner-card-with-sub{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0}.owner-card{background:var(--bg-soft);border-radius:16px;padding:28px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:160px;border:1px solid rgba(0,66,37,.06);transition:transform .15s,box-shadow .15s}
.owner-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,66,37,.08)}
.owner-card img{max-height:56px;max-width:140px;width:auto;height:auto;object-fit:contain;filter:none;opacity:1}
.owner-card .owner-name{font-size:13px;font-weight:600;color:var(--green);text-align:center;letter-spacing:.01em}

.partners-section{background:var(--bg-soft);padding:120px 24px}
.partners-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1fr 1.2fr;gap:80px;align-items:center}
.partners-copy h2{font-size:clamp(36px,4.5vw,56px);font-weight:800;letter-spacing:-.035em;line-height:1.05;color:var(--green);margin-bottom:24px}
.partners-copy h2 em{font-style:normal;position:relative;display:inline-block}
.partners-copy h2 em::after{content:"";position:absolute;left:-2px;right:-2px;bottom:4px;height:10px;background:var(--yellow);z-index:-1;border-radius:2px;opacity:.7}
.partners-lead{font-size:17px;line-height:1.6;color:var(--ink)}
.partners-grid-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
.partner-card{background:#fff;border-radius:16px;padding:20px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:180px;border:1px solid rgba(0,66,37,.08);transition:transform .15s,box-shadow .15s}
.partner-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,66,37,.08)}
.partner-card-gire img{max-height:96px!important;max-width:160px!important}@media(max-width:768px){.partner-card-gire img{max-height:64px!important;max-width:128px!important}}.partner-card img{max-height:120px;max-width:200px;width:auto;height:auto;object-fit:contain;margin-bottom:8px}
.partner-card .partner-name{font-size:14px;font-weight:700;color:var(--green)}
.partner-card .partner-role{font-size:12px;color:var(--gray);text-align:center;letter-spacing:.01em}

@media(max-width:768px){
  .trygghet-inner,.partners-inner{grid-template-columns:1fr;gap:40px}
  .partners-grid{gap:32px}
}

.om-section{background:#fff;padding:120px 24px}
.om-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:1.2fr 1fr;gap:80px;align-items:center}
.om-copy h2{font-size:clamp(36px,4.5vw,56px);font-weight:800;letter-spacing:-.035em;line-height:1.05;color:var(--green);margin-bottom:24px}
.om-copy h2 em{font-style:normal;position:relative;display:inline-block}
.om-copy h2 em::after{content:"";position:absolute;left:-2px;right:-2px;bottom:4px;height:10px;background:var(--yellow);z-index:-1;border-radius:2px}
.om-copy p{font-size:17px;line-height:1.6;color:var(--ink);margin-bottom:18px}
.om-copy p.om-lead{font-size:19px;color:var(--gray)}
.om-copy strong{color:var(--green);font-weight:700}
.om-copy p.om-pull{font-size:22px;color:var(--green);font-weight:600;border-left:4px solid var(--yellow);padding:6px 0 6px 20px;margin:28px 0}
.om-stats{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.om-stat{background:var(--bg-soft);border-radius:20px;padding:32px 24px;text-align:center}
.om-stat strong{display:block;font-size:clamp(36px,4vw,48px);font-weight:800;letter-spacing:-.03em;color:var(--green);line-height:1;margin-bottom:8px}
.om-stat span{display:block;font-size:13px;color:var(--gray)}
@media(max-width:768px){.om-inner{grid-template-columns:minmax(0,1fr);gap:48px}.om-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}

.trust-box-section{background:#fff;padding:60px 24px 0}
.trust-box-inner{max-width:1280px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.trust-box-card{background:var(--green-soft);border-radius:20px;padding:28px;display:flex;align-items:flex-start;gap:18px;transition:transform .15s,box-shadow .15s}
.trust-box-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,66,37,.08)}
.trust-box-icon{flex-shrink:0;width:48px;height:48px;background:var(--green);color:var(--yellow);border-radius:12px;display:flex;align-items:center;justify-content:center}
.trust-box-text{display:flex;flex-direction:column;gap:6px}
.trust-box-text strong{font-size:16px;color:var(--green);font-weight:700;line-height:1.3}
.trust-box-text span{font-size:14px;color:var(--ink);line-height:1.5;opacity:.75}
@media(max-width:900px){.trust-box-inner{grid-template-columns:1fr;gap:12px}}

/* Ring-meg-tilbake */
.callme-section{padding:96px 24px;background:var(--green-soft)}
.callme-wrap{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:start}
@media (max-width:780px){.callme-wrap{grid-template-columns:minmax(0,1fr);gap:32px}}
.callme-text h2{font-size:clamp(36px,5vw,56px);font-weight:800;color:var(--green);line-height:1.05;letter-spacing:-.03em;margin:12px 0 20px}
.callme-text h2 em{font-style:normal;color:var(--green);position:relative;display:inline-block}
.callme-text h2 em::after{content:"";position:absolute;left:-4px;right:-4px;bottom:6px;height:18px;background:var(--yellow);z-index:-1;border-radius:4px}
.callme-text p{font-size:17px;line-height:1.6;color:var(--green);opacity:.85;max-width:480px}
.callme-form{background:#fff;padding:32px;border-radius:24px;display:flex;flex-direction:column;gap:18px;box-shadow:0 4px 24px rgba(0,66,37,.08)}
.callme-field{display:flex;flex-direction:column;gap:8px}
.callme-field label{font-size:14px;font-weight:600;color:var(--green);letter-spacing:.01em}
.callme-phone-wrap{display:flex;align-items:stretch;border:1.5px solid #d4ddd6;border-radius:14px;overflow:hidden;transition:border-color .15s}
.callme-phone-wrap:focus-within{border-color:var(--yellow)}
.callme-prefix{padding:14px 16px;background:var(--green-soft);color:var(--green);font-weight:600;font-size:16px;display:flex;align-items:center}
#callme-phone{flex:1;min-width:0;border:none;padding:14px 16px;font-size:16px;font-family:inherit;background:transparent;outline:none;color:var(--green)}
#callme-comment{padding:14px 16px;border:1.5px solid #d4ddd6;border-radius:14px;font-size:15px;font-family:inherit;resize:vertical;outline:none;color:var(--green);transition:border-color .15s}
#callme-comment:focus{border-color:var(--yellow)}
.callme-submit{padding:18px 24px;background:var(--green);color:#fff;border:none;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;transition:background .15s,transform .15s;font-family:inherit;margin-top:4px}
.callme-submit:hover{background:#003319;transform:translateY(-1px)}
.callme-submit:disabled{opacity:.5;cursor:wait}
.callme-success{padding:14px 18px;background:var(--green-soft);color:var(--green);border-radius:12px;font-weight:600;text-align:center}
.callme-error{padding:14px 18px;background:#ffe5e5;color:#a01515;border-radius:12px;font-weight:600;text-align:center;font-size:14px}

/* Min side modal med iframe */

/* ========== MOBILE OPTIMIZATION v3.84 ========== */
@media (max-width: 720px) {
  /* --- Reg.nr: numerisk keyboard + 16px font (forhindrer iOS zoom) --- */
  .estimate-form input.reg{font-size:28px!important}
  .estimate-form input{font-size:16px}

  /* --- Hero: kompakt sa skjemaet er above-the-fold --- */
  .hero{padding:24px 20px 32px}
  .hero-eyebrow{font-size:11px;padding:6px 14px;margin-bottom:16px}
  .hero-title{font-size:clamp(36px,9vw,52px)!important;letter-spacing:-.04em;line-height:1.02;margin-bottom:14px}
  .hero-sub{font-size:15px;line-height:1.4;margin-bottom:22px}
  .hero-cta-group{margin-bottom:32px}

  /* --- Skjema: stables, full bredde, store touch-targets --- */
  .estimate-form{max-width:100%;gap:10px}
  .estimate-form input.reg{padding:18px 16px;text-align:center}
  .estimate-form .btn-submit{padding:18px 24px;font-size:17px;min-height:54px}

  /* --- Hero CTA-knapper: stables, full bredde --- */
  .hero-cta-group{flex-direction:column;gap:10px}
  .hero-cta-group .btn-primary,.hero-cta-group .btn-secondary{width:100%;padding:16px;font-size:16px;min-height:52px;justify-content:center}

  /* --- Top nav: skjul lenker, bare logo + Start salg + hamburger --- */
  .nav{padding:12px 16px}
  .nav-inner{gap:8px}
  .nav-links{display:none}
  .nav-cta{display:none}.nav-cta-form{display:none!important} /* erstattes av sticky bottom-bar */
  .hamburger-btn{display:flex!important;align-items:center;justify-content:center;width:44px;height:44px;border:none;background:transparent;cursor:pointer;padding:0;margin-left:auto}
  .hamburger-btn span{display:block;width:22px;height:2px;background:var(--green);position:relative}
  .hamburger-btn span::before,.hamburger-btn span::after{content:"";position:absolute;left:0;width:22px;height:2px;background:var(--green)}
  .hamburger-btn span::before{top:-7px}
  .hamburger-btn span::after{top:7px}

  /* --- How-cards: en kolonne, mindre padding --- */
  .how-card{grid-template-columns:1fr;padding:32px 24px;min-height:auto;gap:20px}
  .how-card-content h3{font-size:clamp(26px,6vw,36px)}
  .how-card-visual{aspect-ratio:1.3}
  .how-card-visual .big{font-size:clamp(48px,14vw,80px)}

  /* --- Trust-box: en kolonne --- */
  .trust-box-section{padding:48px 20px}
  .trust-box-inner{grid-template-columns:1fr!important;gap:14px}

  /* --- FAQ: mindre padding --- */
  .faq-section{padding:64px 20px!important}
  .faq-q{font-size:15px;padding:18px 16px}
  .faq-item.open .faq-a{padding:0 16px 18px}
  .faq-a{font-size:14px;line-height:1.5}

  /* --- Callme-section: mindre padding, full-width form --- */
  .callme-section{padding:48px 20px}
  .callme-text h2{font-size:clamp(28px,7vw,40px)!important}
  .callme-text p{font-size:15px}
  .callme-form{padding:20px}
  .callme-submit{padding:16px;font-size:16px;min-height:54px}

  /* --- Footer: en kolonne, sentert --- */
  .footer{padding:40px 20px 100px} /* ekstra bunn-padding for sticky CTA */
  .footer-inner{grid-template-columns:1fr!important;gap:32px;text-align:left}
  .footer-col{align-items:flex-start}

  /* --- Sticky bottom CTA: vises etter hero scroll --- */
  .sticky-cta{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e7e6;padding:12px 16px env(safe-area-inset-bottom,12px);z-index:100;box-shadow:0 -4px 20px rgba(0,0,0,.08);transform:translateY(100%);transition:transform .25s ease}
  .sticky-cta.visible{transform:translateY(0)}
  .sticky-cta a{display:block;background:var(--green);color:#fff;padding:16px;border-radius:9999px;text-align:center;font-weight:700;font-size:16px;text-decoration:none;min-height:54px;line-height:1.4}

  /* --- Mobile menu (apnes via hamburger) --- */
  .mobile-menu{position:fixed;inset:0;background:#fff;z-index:200;display:none;flex-direction:column;padding:80px 24px 24px}
  .mobile-menu.open{display:flex}
  .mobile-menu a{padding:18px 0;font-size:20px;font-weight:600;color:var(--green);border-bottom:1px solid #eee;text-decoration:none}
  .mobile-menu .mm-close{position:absolute;top:16px;right:16px;width:44px;height:44px;border:none;background:transparent;font-size:28px;color:var(--green);cursor:pointer}
  .mobile-menu .mm-cta{margin-top:auto;background:var(--green);color:#fff;text-align:center;border-radius:9999px;padding:18px;border-bottom:none}

  /* --- Demo-banner: mindre tekst pa mobil --- */
  .demo-banner{font-size:11px;padding:8px 12px;line-height:1.3}

  /* --- Modaler: full skjerm pa mobil --- */
}
.hamburger-btn{display:none}
.mobile-menu{display:none}
.sticky-cta{display:none}
@media (max-width: 720px){.sticky-cta{display:block}}

/* Hero-form: synlig reg.nr-skjema rett i hero */
.hero-form{max-width:520px;margin:0 auto 16px;width:100%}
/* old hero-form-row erstattet av eu-plate */
/* old hero-reg styles flyttet til .eu-plate-input */
/* erstattet av .eu-plate .eu-plate-input::placeholder */
.hero-form .hero-submit{background:var(--green);color:#fff;border:none;border-radius:12px;padding:0 24px;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s,transform .15s;font-family:inherit;white-space:nowrap;flex-shrink:0}
.hero-form .hero-submit:hover{background:#003319;transform:translateY(-1px)}
.hero-form-trust{font-size:13px;color:var(--green);opacity:.7;text-align:center;margin-top:14px;font-weight:500;letter-spacing:.01em}
/* Hero konsept-toggle: forklarer at bilen blir HOS oss til salg. Diskret, luftig, gjenbruker gul/gronn paletten. */
.hero-concept{max-width:520px;margin:14px auto 0;background:var(--bg-soft);border:1px solid rgba(0,66,55,.12);border-radius:14px;overflow:hidden;text-align:left}
.hero-concept-sum{list-style:none;cursor:pointer;padding:13px 16px;display:flex;align-items:center;gap:10px;font-weight:700;color:var(--green);font-size:14.5px;line-height:1.3}
.hero-concept-sum::-webkit-details-marker{display:none}
.hero-concept-i{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:var(--yellow);display:inline-flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;font-style:italic}
.hero-concept-t{flex:1}
.hero-concept-t em{font-style:normal;position:relative;display:inline-block}
.hero-concept-t em::after{content:"";position:absolute;left:-1px;right:-1px;bottom:1px;height:7px;background:var(--yellow);z-index:-1;opacity:.7;border-radius:2px}
.hero-concept-chev{flex-shrink:0;color:var(--green);opacity:.55;font-size:13px;font-weight:600;white-space:nowrap}
.hero-concept[open] .hero-concept-chev{font-size:0}
.hero-concept[open] .hero-concept-chev::after{content:"Lukk ⌃";font-size:13px}
.hero-concept-body{padding:2px 16px 16px;font-size:13.5px;line-height:1.5;color:var(--green)}
.hero-concept-body p{margin:0 0 10px;opacity:.85}
.hero-concept-note{margin:0 !important;padding:10px 12px;background:#fff;border-radius:10px;font-size:13px;opacity:1 !important}

.hero-secondary-link{display:inline-block;color:var(--green);opacity:.65;text-decoration:underline;font-size:14px;margin-top:8px;transition:opacity .15s}
.hero-secondary-link:hover{opacity:1}
@media (max-width:720px){
  .hero-form{margin-bottom:14px}
  .hero-form-row{flex-direction:column;gap:6px;padding:8px;border-radius:18px}
  .hero-form .hero-reg{padding:16px 18px;font-size:22px;text-align:center}
  .hero-form .hero-submit{padding:16px 20px;border-radius:12px;font-size:16px;min-height:54px}
  .hero-form-trust{font-size:12px;margin-top:10px}
  .hero-secondary-link{font-size:13px;margin-top:6px}
}

/* EU-plate inspirert reg.nr-input v3.84 */
.hero-plate-wrap{display:flex;gap:12px;align-items:stretch;width:100%;max-width:520px;margin:0 auto}
.eu-plate{flex:1;display:flex;align-items:stretch;background:#fff;border-radius:10px;border:2px solid #1a1a1a;overflow:hidden;box-shadow:0 6px 20px rgba(0,66,37,.18),inset 0 -2px 0 rgba(0,0,0,.06);min-height:64px;position:relative}
.eu-plate-strip{background:#003399;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6px 10px;flex-shrink:0;min-width:36px;border-right:1px solid #1a1a1a}
.eu-plate-strip .eu-stars{color:#FFCC00;font-size:14px;line-height:1;margin-bottom:2px}
.eu-plate-strip .eu-n{font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:14px;letter-spacing:.05em;line-height:1}
.eu-plate .eu-plate-input{flex:1;border:none;background:#fff;padding:0 16px;font-size:32px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;text-align:center;color:#1a1a1a;outline:none;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;min-width:0;width:100%}
.eu-plate .eu-plate-input::placeholder{color:rgba(26,26,26,.35);font-weight:700;letter-spacing:.12em}
.eu-plate:focus-within{border-color:var(--yellow);box-shadow:0 6px 20px rgba(255,204,51,.3),0 0 0 3px rgba(255,204,51,.2),inset 0 -2px 0 rgba(0,0,0,.06)}
.hero-submit{flex-shrink:0}
@media (max-width:720px){
  .hero-plate-wrap{flex-direction:column;gap:10px}
  .eu-plate{min-height:72px;border-radius:12px}
  .eu-plate-strip{min-width:42px;padding:8px 12px}
  .eu-plate-strip .eu-stars{font-size:16px}
  .eu-plate-strip .eu-n{font-size:16px}
  .eu-plate .eu-plate-input{font-size:34px;padding:0 12px;letter-spacing:.1em}
  .hero-submit{width:100%;padding:18px;font-size:17px;min-height:56px;border-radius:14px}
}

/* Hero input v3.84 - kopiert fra peasy.no live */
.hero-input-wrap{max-width:520px;margin:0 auto;width:100%}
.hero-input-row{display:flex;gap:10px;align-items:stretch}
.hero-plate-box{flex:1;position:relative;background:#fff;border:1.5px solid rgba(0,0,0,.2);border-radius:10px;overflow:hidden;display:flex;align-items:center}
.hero-plate-flag{position:absolute;left:0;top:0;height:100%;width:auto;display:block;z-index:1;border-radius:10px 0 0 10px}
.hero-plate-box input.hero-reg{flex:1;border:none;background:transparent;padding:18px 18px 18px 64px;font-size:20px;font-weight:600;color:#000;outline:none;font-family:inherit;min-width:0;width:100%;letter-spacing:.02em;text-transform:uppercase;position:relative;z-index:2}
.hero-plate-box input.hero-reg::placeholder{color:rgba(0,0,0,.35);font-weight:500;text-transform:none;letter-spacing:0}
.hero-plate-box:focus-within{border-color:var(--green);box-shadow:0 0 0 3px rgba(0,66,37,.15)}
.hero-submit{flex-shrink:0}
@media (max-width:720px){
  .hero-input-row{flex-direction:column;gap:10px}
  .hero-plate-box input.hero-reg{padding:18px 16px 18px 60px;font-size:18px}
  .hero-submit{width:100%;padding:18px;font-size:17px;min-height:54px;border-radius:14px}
}

/* === v3.84 mobile overflow-guard + grid-fixes === */
@media (max-width: 768px) {
  html { overflow-x: hidden; }
  body { width: 100%; max-width: 100vw; overflow-x: hidden; position: relative; }
  *, *::before, *::after { box-sizing: border-box; max-width: 100%; }
  img, video, svg, iframe { max-width: 100%; height: auto; }
  .nav-inner, .hero, .trust-box-section, .how-section, .om-section, .form-section,
  .faq-section, .testimonials, .footer, .callme-wrap, .rv-section, .proof-section {
    max-width: 100vw; padding-left: 16px; padding-right: 16px; overflow-x: hidden;
  }
  .container, .nav, section { max-width: 100vw; }
  h1, h2, h3, p { word-wrap: break-word; overflow-wrap: break-word; }
  .hero-title { font-size: clamp(32px, 9vw, 48px); line-height: 1.05; }
  .hero-sub { font-size: 16px; }
  .resten-strip{padding:28px 18px 4px !important;}
  .resten-strip>div{grid-template-columns:1fr !important;gap:14px !important;}
  .resten-step{display:flex;align-items:baseline;gap:12px;}
  .resten-step>div:first-child{margin-bottom:0 !important;}
  .hero-form { max-width: 100%; padding: 12px; }
  .hero-plate-box { max-width: 100%; }
  .hero-plate-box input.hero-reg { font-size: 18px; padding: 16px 12px 16px 56px; }
  .estimate-form { padding: 16px; }
  .form-plate-box { width: 100%; }
  /* Fix 1: owners-grid 3-kol -> 2-kol pa mobil */
  .owners-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 12px !important; width: 100% !important; }
  .owner-card { width: 100% !important; min-width: 0 !important; }
  /* Fix 2: proof-rating flexbox kollaps -> wrap pent */
  .proof-rating { flex-wrap: wrap; gap: 8px; justify-content: center; font-size: 14px; line-height: 1.4; }
  .proof-rating > * { flex: 0 0 auto; white-space: nowrap; }
  .proof-rating strong { white-space: normal; }
  .proof-stats { grid-template-columns: repeat(2, 1fr) !important; gap: 16px; }
  /* Fix 3: form-trust ratings linebreak ok */
  .form-trust { font-size: 13px; line-height: 1.5; }
  /* === v3.84 polish === */
  /* Fix hero: redusert min-height pa mobil (var 88vh = altfor stor luft) */
  .hero { min-height: auto !important; padding: 16px 16px 36px !important; }
  .hero-eyebrow { margin-bottom: 16px !important; }
  .hero-title { margin-bottom: 12px !important; }
  .hero-sub { margin-bottom: 20px !important; }
  /* Fix partner-card: lik logo-storrelse pa alle 4 logoer */
  .partner-card { min-height: 180px !important; padding: 24px 16px !important; gap: 10px !important; }
  .partner-card img { max-height: 64px !important; max-width: 100px !important; width: auto !important; height: auto !important; object-fit: contain !important; } .partner-card-gire img { max-height: 48px !important; max-width: 80px !important; }
  .partner-card .partner-name { font-size: 13px !important; }
  .partner-card .partner-role { font-size: 11px !important; }
  /* Demo-banner kompakt */
  .demo-banner { padding: 6px 12px !important; font-size: 11px !important; }
  /* Owners-bar logoer like store */
  .owners-bar .trust-bar-logos.owners img { height: 36px !important; max-width: 80px !important; object-fit: contain !important; }
}
/* === slutt v3.84 mobile guard === */

/* v3.95 ux-fixes (badge plassering, pil, GH-sync) - ny spoiler-bezier + sirkel-favicon */
.hero{position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;right:-8%;top:-10%;width:36vw;max-width:520px;aspect-ratio:165/184;background:url("spoiler-shape.svg") center/contain no-repeat;opacity:0.045;pointer-events:none;z-index:0;transform:rotate(-8deg)}
@media(max-width:768px){.hero::before{display:none}}
.hero>*{position:relative;z-index:1}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important}}
@media(max-width:720px){body{padding-bottom:88px}footer a{display:inline-block;min-height:44px;line-height:44px;padding:0 8px}}

.back-to-top{position:fixed;bottom:80px;right:16px;width:44px;height:44px;border-radius:50%;background:#fc3;color:#163B30;display:flex;align-items:center;justify-content:center;text-decoration:none;line-height:1;z-index:99;opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;box-shadow:0 4px 12px rgba(0,0,0,.2);border:none;cursor:pointer}.back-to-top img{width:20px;height:20px;display:block}
.back-to-top.visible{opacity:.92;pointer-events:auto}
.back-to-top:hover{opacity:1;transform:translateY(-2px)}
@media(min-width:721px){.back-to-top{bottom:24px;right:24px}}

/* === Owners visning (v3.99.27) === */
/* Desktop (>=641px): statisk sentrert rad, ingen animasjon */
.owners-marquee{position:relative;width:100%;padding:8px 0;overflow:hidden}
.owners-marquee-track{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:48px 56px;width:100%;animation:none}
.owners-marquee-track img{height:38px;width:auto;flex-shrink:0;object-fit:contain;display:block}
/* Skjul duplikatene paa desktop (de 6 siste img er duplikater for marquee-loop) */
.owners-marquee-track img:nth-child(n+7){display:none}

/* Mobil (<=640px): marquee scroll, raskere fart */
@media (max-width:640px){
  .owners-marquee{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 40px,#000 calc(100% - 40px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 40px,#000 calc(100% - 40px),transparent 100%)}
  .owners-marquee-track{flex-wrap:nowrap;justify-content:flex-start;gap:40px;width:max-content;animation:owners-scroll 2.5s linear infinite;will-change:transform}
  .owners-marquee-track img{height:32px}
  /* Vis duplikatene paa mobil for somlos loop */
  .owners-marquee-track img:nth-child(n+7){display:block}
  .owners-marquee:hover .owners-marquee-track{animation-play-state:paused}
}
@keyframes owners-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){
  .owners-marquee-track{animation:none !important}
}
/* === Partners visning (v3.99.28) === */
.partners-marquee{position:relative;width:100%;padding:8px 0;overflow:hidden}
.partners-marquee-track{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:48px 56px;width:100%;animation:none}
.partners-marquee-track img{height:42px;width:auto;flex-shrink:0;object-fit:contain;display:block}
/* NAF har kvadratisk format, far litt mer hoyde for visuell balanse */
.partners-marquee-track img[alt="NAF"]{height:56px}
.partners-marquee-track img:nth-child(n+5){display:none}
.partners-marquee-track img[alt="NAF"]:nth-child(n+5){display:none}

@media (max-width:640px){
  .partners-marquee{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 40px,#000 calc(100% - 40px),transparent 100%);mask-image:linear-gradient(90deg,transparent 0,#000 40px,#000 calc(100% - 40px),transparent 100%)}
  .partners-marquee-track{flex-wrap:nowrap;justify-content:flex-start;gap:40px;width:max-content;animation:partners-scroll 22s linear infinite;will-change:transform}
  .partners-marquee-track img{height:36px}
  .partners-marquee-track img[alt="NAF"]{height:48px}
  .partners-marquee-track img:nth-child(n+5){display:block}
  .partners-marquee:hover .partners-marquee-track{animation-play-state:paused}
}
@keyframes partners-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){
  .partners-marquee-track{animation:none !important}
}


/* === v3.99.28: Desktop statisk grid (samme som mobil) - eier 3x2, partner 2x2 === */
.owners-marquee{overflow:visible !important;-webkit-mask-image:none !important;mask-image:none !important;padding:16px 0 !important;max-width:720px;margin:0 auto}
.owners-marquee-track{display:grid !important;grid-template-columns:repeat(3,1fr) !important;gap:32px 48px !important;width:100% !important;animation:none !important;justify-content:center !important;align-items:center !important;padding:0 24px !important}
.owners-marquee-track img{height:32px !important;width:auto !important;max-width:160px !important;object-fit:contain !important;justify-self:center !important}
.owners-marquee-track img:nth-child(n+7){display:none !important}

.partners-marquee{overflow:visible !important;-webkit-mask-image:none !important;mask-image:none !important;padding:16px 0 !important;max-width:560px;margin:0 auto}
.partners-marquee-track{display:grid !important;grid-template-columns:repeat(2,1fr) !important;gap:32px 48px !important;width:100% !important;animation:none !important;justify-content:center !important;align-items:center !important;padding:0 24px !important}
.partners-marquee-track img{height:32px !important;width:auto !important;max-width:140px !important;object-fit:contain !important;justify-self:center !important}
.partners-marquee-track img[alt="NAF"]{height:36px !important}
.partners-marquee-track img:nth-child(n+5){display:none !important}

/* === Mobil-stack v3.99.27: eier 3x2, partner 2x2, samme stsr som Peasy-logo === */
@media (max-width:640px){
  /* EIER-marquee paa mobil: skjul marquee, vis 3x2 grid */
  .owners-marquee{overflow:visible !important;-webkit-mask-image:none !important;mask-image:none !important;padding:8px 0 !important}
  .owners-marquee-track{display:grid !important;grid-template-columns:repeat(3,1fr) !important;gap:20px 16px !important;width:100% !important;animation:none !important;flex-wrap:wrap !important;justify-content:center !important;align-items:center !important;padding:0 16px !important}
  .owners-marquee-track img{height:28px !important;width:auto !important;max-width:100% !important;object-fit:contain !important;justify-self:center !important}
  /* Skjul duplikatene (kun 6 forste vises) */
  .owners-marquee-track img:nth-child(n+7){display:none !important}

  /* PARTNER-marquee paa mobil: skjul marquee, vis 2x2 grid */
  .partners-marquee{overflow:visible !important;-webkit-mask-image:none !important;mask-image:none !important;padding:8px 0 !important}
  .partners-marquee-track{display:grid !important;grid-template-columns:repeat(2,1fr) !important;gap:20px 16px !important;width:100% !important;animation:none !important;flex-wrap:wrap !important;justify-content:center !important;align-items:center !important;padding:0 16px !important}
  .partners-marquee-track img{height:28px !important;width:auto !important;max-width:100% !important;object-fit:contain !important;justify-self:center !important}
  /* NAF litt hoyere pga kvadratisk format */
  .partners-marquee-track img[alt="NAF"]{height:32px !important}
  /* Vis bare de 4 forste, skjul duplikater */
  .partners-marquee-track img:nth-child(n+5){display:none !important}
}

/* === Sist solgt === */
.recent-sale{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.4em .6em;margin:.85rem auto 0;padding:.55rem 1rem;border-radius:999px;background:rgba(0,66,37,.04);border:1px solid rgba(0,66,37,.08);font-size:.875rem;line-height:1.35;color:#264a3a;max-width:560px;font-weight:500}
.recent-sale-dot{width:.55rem;height:.55rem;border-radius:50%;background:#1ea15a;box-shadow:0 0 0 0 rgba(30,161,90,.55);animation:pulseDot 1.8s infinite}
@keyframes pulseDot{0%{box-shadow:0 0 0 0 rgba(30,161,90,.55)}70%{box-shadow:0 0 0 10px rgba(30,161,90,0)}100%{box-shadow:0 0 0 0 rgba(30,161,90,0)}}
.recent-sale-label{font-size:.72rem;letter-spacing:.08em;font-weight:700;color:#1ea15a;text-transform:uppercase}
.recent-sale-body{display:inline-flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.25em .35em}
.recent-sale-car{font-weight:700;color:#0d3d23}
.recent-sale-price{font-weight:700;color:#0d3d23}
.recent-sale-days{font-weight:700;color:#1ea15a}
.recent-sale-sep{opacity:.5}
@media (max-width:480px){.recent-sale{font-size:.78rem;padding:.5rem .85rem}.recent-sale-label{font-size:.65rem}}
/* === /Sist solgt === */
/* === Hero Google rating === */
.hero-google-rating{text-align:center;margin:.75rem auto 0;font-size:.9rem;color:#264a3a;line-height:1.4;max-width:560px}
.hero-google-rating .hero-stars{color:#f5b400;letter-spacing:.05em;font-size:1rem;vertical-align:middle}
.hero-google-rating strong{color:#0d3d23;font-weight:700}
.hero-google-rating .hero-glogo{font-weight:600}
@media (max-width:480px){.hero-google-rating{font-size:.82rem}}
/* === /Hero Google rating === */


/* ===== MOBIL HERO-OPTIMALISERING (konvertering above-the-fold) ===== */
@media(max-width:600px){
  .hero{min-height:auto!important;padding:80px 16px 28px!important}
  .hero-title{font-size:clamp(28px,7.5vw,40px)!important;line-height:1.05!important;margin-bottom:10px!important;letter-spacing:-.03em!important}
  .hero-title .hero-title-reg{font-size:.7em!important}
  .hero-title em::after{height:10px!important;bottom:4px!important}
  .hero-sub{font-size:14px!important;line-height:1.35!important;margin-bottom:14px!important;max-width:320px!important}
  .estimate-form{max-width:100%!important;gap:8px!important}
  .estimate-form input.reg{padding:14px 12px!important;font-size:24px!important;text-align:center!important}
  .estimate-form .btn-submit{padding:16px 20px!important;font-size:16px!important;min-height:50px!important;border-radius:12px!important}
  .hero-google-rating{font-size:.78rem!important;margin:.5rem auto 0!important;line-height:1.3!important}
  .hero-google-rating .hero-stars{font-size:.85rem!important}
  .recent-sale{font-size:.72rem!important;padding:.4rem .7rem!important;margin:.45rem auto 0!important;gap:.25em .4em!important}
  .recent-sale-label{font-size:.6rem!important}
  .hero-form-trust{font-size:11px!important;margin-top:8px!important;line-height:1.3!important;opacity:.7!important}
  .hero-secondary-link{font-size:12px!important;margin-top:6px!important}
}
@media(max-width:380px){
  .estimate-form{grid-template-columns:1fr!important}
  .hero-title{font-size:26px!important}
  .hero-sub{font-size:13px!important;margin-bottom:12px!important}
}
/* ===== /MOBIL HERO ===== */

/* === Mobil: flytt Sist solgt opp under tittel, skjul subhead === */
@media(max-width:600px){
  .hero-sub{display:none!important}
  .recent-sale.is-mobile-top{margin:6px auto 14px!important;order:-1}
}
/* === /Mobil reorder === */

/* ===== MOBIL FINAL-CTA (samme prinsipper som hero) ===== */
@media(max-width:600px){
  .final-cta{padding:48px 16px!important}
  .final-cta h2{font-size:clamp(26px,7vw,36px)!important;line-height:1.1!important;margin-bottom:12px!important;letter-spacing:-.025em!important}
  .final-cta p{font-size:14px!important;line-height:1.4!important;margin-bottom:24px!important;max-width:320px!important;margin-left:auto!important;margin-right:auto!important}
  .final-cta .btn-primary{font-size:16px!important;padding:14px 28px!important;min-height:50px!important;border-radius:12px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
}
@media(max-width:380px){
  .final-cta h2{font-size:24px!important}
  .final-cta p{font-size:13px!important}
}
/* ===== /MOBIL FINAL-CTA ===== */

/* Task 5: compare-box mobile override */
@media(max-width:640px){.compare-box{grid-template-columns:1fr !important;aspect-ratio:auto !important}.compare-box>div{padding:32px 24px !important}}

/* === Fix #1a: Trust-box tekst-overflow under 400px === */
@media (max-width:400px){
  .trust-box-card{min-width:0}
  .trust-box-text{min-width:0}
  .trust-box-text strong,.trust-box-text span{word-wrap:break-word;overflow-wrap:break-word}
}
/* === /Fix #1a === */

/* === Fix #7: Skjul back-to-top under 640px (sticky-cta dekker behovet) === */
@media (max-width:640px){
  .back-to-top{display:none !important}
}
/* === /Fix #7 === */

/* === DESKTOP HERO POLISH v4 === */
@media(min-width:769px){
  .hero{min-height:auto;padding:56px 24px 64px}
  h1.hero-title{font-size:clamp(40px,4.2vw,56px);line-height:1.08;letter-spacing:-.03em;max-width:18ch;margin-bottom:20px}
  .hero-sub{font-size:clamp(16px,1.25vw,19px);max-width:620px;margin-bottom:28px}
  .hero-eyebrow{margin-bottom:22px}
  .hero-form{max-width:560px}
  .hero-points{max-width:620px;margin-top:8px;margin-bottom:28px}
  .hero-points li{font-size:16px}
  .recent-sale{margin-top:0}
}

/* === KONSISTENT VERTIKAL RYTME (lagt til av markedsforing) === */
/* Desktop: alle standard-band 96px topp/bunn. Mobil: 64px. Hero strammet i toppen. */
.trygghet-section,.trust-box-section,.partners-section,.form-section,.how-section,.proof,.om-section,.callme-section,.compare-section,.faq-section{padding-top:96px!important;padding-bottom:96px!important}
.final-cta{padding-top:96px!important;padding-bottom:96px!important}
.resten-strip{padding-top:28px!important;padding-bottom:28px!important}
@media(max-width:768px){
  .trygghet-section,.trust-box-section,.partners-section,.form-section,.how-section,.proof,.om-section,.callme-section,.compare-section,.faq-section{padding-top:64px!important;padding-bottom:64px!important}
  .final-cta{padding-top:64px!important;padding-bottom:64px!important}
  .resten-strip{padding-top:24px!important;padding-bottom:24px!important}
  .hero{padding-top:44px!important;padding-bottom:28px!important}
}
/* === slutt rytme === */
</style>
