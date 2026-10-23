/* Beleg-OCR: lädt Tesseract.js (lokal, offline) erst bei Bedarf, bereitet das Bild auf und liest den Text.
   Alles läuft im Gerät – es wird nichts hochgeladen. */
(function(root){
'use strict';
var BASE = new URL('ocr/', document.baseURI || location.href).href;   // absolute Pfade (Worker braucht das)
var cfg = { psm: '6', langs: 'deu+eng', maxLong: 3200, idleMs: 90000 };
var tessP = null, workerP = null, idleTimer = null, curLog = null;

function loadScript(src){
  return new Promise(function(res, rej){
    var s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = function(){ rej(new Error('OCR-Modul nicht ladbar (' + src.split('/').pop() + ')')); };
    document.head.appendChild(s);
  });
}
function loadTess(){
  if (root.Tesseract) return Promise.resolve(root.Tesseract);
  if (!tessP) tessP = loadScript(BASE + 'tesseract.min.js').then(function(){ return root.Tesseract; }, function(e){ tessP = null; throw e; });
  return tessP;
}
function getWorker(){
  if (workerP) return workerP;
  workerP = loadTess().then(function(T){
    return T.createWorker(cfg.langs.split('+'), 1, {
      workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE + 'lang', gzip: true,
      cacheMethod: 'none', workerBlobURL: false,
      logger: function(m){ if (curLog) curLog(m); }
    });
  }).then(function(w){
    return w.setParameters({ tessedit_pageseg_mode: cfg.psm, preserve_interword_spaces: '1', user_defined_dpi: '300' }).then(function(){ return w; });
  }).catch(function(e){ workerP = null; throw e; });
  return workerP;
}
var lastKill = 0;
// Tesseract wirft nach terminate() noch einen harmlosen Fehler aus einem Rest-Callback (worker=null) – nach Abbruch ignorieren
window.addEventListener('error', function(ev){ if (Date.now() - lastKill < 8000 && /postMessage/.test(ev.message || '') && /\/ocr\/tesseract/.test(ev.filename || '')) ev.preventDefault(); });
function killWorker(){
  lastKill = Date.now(); clearTimeout(idleTimer);
  var p = workerP; workerP = null;
  if (p) p.then(function(w){ return w.terminate(); }).catch(function(){});
}
function armIdle(){ clearTimeout(idleTimer); idleTimer = setTimeout(killWorker, cfg.idleMs); }

// ---------- Bild vorbereiten ----------
function loadBitmap(blob){
  return new Promise(function(res, rej){
    var url = URL.createObjectURL(blob), img = new Image();
    img.onload = function(){ URL.revokeObjectURL(url); res(img); };
    img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht gelesen werden')); };
    img.src = url;
  });
}
function cr_up(sw){ return Math.min(3, 1400 / sw); }
// Sucht das Papier: kleine Graustufenkarte, Otsu-Schwelle, größte helle Zusammenhangskomponente.
// Nur wenn sie ein "solider" Block ist (kein Text/Dark-Mode) und deutlich kleiner als das Bild -> Ausschnitt (mit Rand), sonst null.
function findPaper(img, W, H){
  var s = 160 / Math.max(W, H), mw = Math.max(8, Math.round(W * s)), mh = Math.max(8, Math.round(H * s));
  var c = document.createElement('canvas'); c.width = mw; c.height = mh;
  var g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, mw, mh);
  var d = g.getImageData(0, 0, mw, mh).data, n = mw * mh, v = new Uint8Array(n), i, hist = new Uint32Array(256);
  for (i = 0; i < n; i++){ v[i] = (d[4*i] * 77 + d[4*i+1] * 150 + d[4*i+2] * 29) >> 8; hist[v[i]]++; }
  var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
  var wB = 0, sB = 0, best = -1, th = 128;
  for (i = 0; i < 256; i++){ wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break; sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, bt = wB * wF * (mB - mF) * (mB - mF); if (bt > best){ best = bt; th = i; } }
  var lab = new Int32Array(n), bestN = 0, bestLab = 0, bb = null, cur = 0, stack = [];
  for (i = 0; i < n; i++){
    if (v[i] <= th || lab[i]) continue;
    cur++; var cnt = 0, x0 = mw, y0 = mh, x1 = 0, y1 = 0; stack.length = 0; stack.push(i); lab[i] = cur;
    while (stack.length){
      var p = stack.pop(), px = p % mw, py = (p / mw) | 0; cnt++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0 && v[p-1] > th && !lab[p-1]){ lab[p-1] = cur; stack.push(p-1); }
      if (px < mw-1 && v[p+1] > th && !lab[p+1]){ lab[p+1] = cur; stack.push(p+1); }
      if (py > 0 && v[p-mw] > th && !lab[p-mw]){ lab[p-mw] = cur; stack.push(p-mw); }
      if (py < mh-1 && v[p+mw] > th && !lab[p+mw]){ lab[p+mw] = cur; stack.push(p+mw); }
    }
    if (cnt > bestN){ bestN = cnt; bestLab = cur; bb = { x0: x0, y0: y0, x1: x1, y1: y1 }; }
  }
  if (!bb) return null;
  var bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1, area = bw * bh;
  if (bestN / area < 0.7) return null;          // kein solider Block (z. B. Text auf dunklem Grund)
  if (area > 0.6 * n) return null;              // füllt ohnehin das Bild
  if (bestN < 0.04 * n) return null;            // zu klein, vermutlich Fehlerkennung
  var mx = Math.max(2, Math.round(bw * 0.04)), my = Math.max(2, Math.round(bh * 0.03));
  var X0 = Math.max(0, bb.x0 - mx), Y0 = Math.max(0, bb.y0 - my), X1 = Math.min(mw, bb.x1 + 1 + mx), Y1 = Math.min(mh, bb.y1 + 1 + my);
  // "Außen" = vom Rand des Ausschnitts aus erreichbar ohne das Papier zu berühren (1 Zelle Sicherheitsabstand)
  var cw = X1 - X0, ch = Y1 - Y0, out = new Uint8Array(cw * ch), st2 = [], xx, yy;
  var pid = bestLab;
  for (xx = 0; xx < cw; xx++){ st2.push(xx); st2.push((ch - 1) * cw + xx); }
  for (yy = 0; yy < ch; yy++){ st2.push(yy * cw); st2.push(yy * cw + cw - 1); }
  var pl = function(x, y){ return lab[(y + Y0) * mw + (x + X0)] === pid; };
  while (st2.length){
    var q = st2.pop(); if (out[q]) continue; var qx = q % cw, qy = (q / cw) | 0; if (pl(qx, qy)) continue; out[q] = 1;
    if (qx > 0) st2.push(q - 1); if (qx < cw - 1) st2.push(q + 1); if (qy > 0) st2.push(q - cw); if (qy < ch - 1) st2.push(q + cw);
  }
  var out2 = new Uint8Array(out);   // 1 Zelle verbreitern (Treppenkanten)
  for (yy = 0; yy < ch; yy++) for (xx = 0; xx < cw; xx++){ var o = yy * cw + xx; if (out[o] || (xx > 0 && out[o-1]) || (xx < cw-1 && out[o+1]) || (yy > 0 && out[o-cw]) || (yy < ch-1 && out[o+cw])) out2[o] = 1; }
  out = out2;
  return { x: Math.round(X0 / mw * W), y: Math.round(Y0 / mh * H), w: Math.round((X1 - X0) / mw * W), h: Math.round((Y1 - Y0) / mh * H), out: out, cw: cw, ch: ch };
}

function preprocess(blob, opt){
  opt = opt || {};
  return loadBitmap(blob).then(function(img){
    var W = img.naturalWidth, H = img.naturalHeight, k = 1;
    var maxLong = opt.maxLong || cfg.maxLong;
    // Beleg im Bild finden (Foto auf Tisch): größte helle, durchgehende Fläche -> zuschneiden und größer rechnen
    var sx = 0, sy = 0, sw = W, sh = H, cr = null;
    if (opt.crop !== false){ cr = findPaper(img, W, H); if (cr){ sx = cr.x; sy = cr.y; sw = cr.w; sh = cr.h; } }
    var L = Math.max(sw, sh);
    if (L > maxLong) k = maxLong / L;
    else if (sw < 1400 && (opt.upscale !== false)) k = Math.min(cr_up(sw), maxLong / L);   // kleine Bilder/Ausschnitte hochskalieren
    var w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    var id = g.getImageData(0, 0, w, h), d = id.data, n = w * h, i;
    var gray = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) gray[i] = (d[4*i] * 77 + d[4*i+1] * 150 + d[4*i+2] * 29) >> 8;
    // Dunkler Hintergrund (Dark-Mode-Screenshot)? Erkennung: eine einzige, flache dunkle Farbe dominiert das Bild
    // (ein Foto auf dunklem Holztisch hat keine so flache Fläche und wird nicht invertiert)
    var h8 = new Uint32Array(256), st0 = Math.max(1, (n / 60000) | 0), cnt = 0;
    for (i = 0; i < n; i += st0){ h8[gray[i]]++; cnt++; }
    var mb = 0, ms = 0, q;
    for (q = 0; q < 256; q++){ var sm = h8[q]; if (q) sm += h8[q-1]; if (q < 255) sm += h8[q+1]; if (sm > ms){ ms = sm; mb = q; } }
    var invert = ms / cnt > 0.4 && mb < 100;   // exakt eine flache dunkle Farbe (Foto-Rauschen/Holzmaserung erreicht das nie)
    if (invert) for (i = 0; i < n; i++) gray[i] = 255 - gray[i];
    // Hintergrund (Schatten, Beleuchtung) schätzen: stark verkleinert; Papier = lokales Maximum.
    // Dunkle Balken mit heller Schrift (z. B. Shop-Kopfzeile im Screenshot) werden lokal umgekehrt.
    if (opt.flatten !== false){
      var bw = Math.max(8, Math.round(w / 24)), bh = Math.max(8, Math.round(h / 24));
      var sc = document.createElement('canvas'); sc.width = bw; sc.height = bh;
      var sg = sc.getContext('2d', { willReadFrequently: true });
      var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
      var tg = tmp.getContext('2d'); var tid = tg.createImageData(w, h);
      for (i = 0; i < n; i++){ var v = gray[i]; tid.data[4*i] = v; tid.data[4*i+1] = v; tid.data[4*i+2] = v; tid.data[4*i+3] = 255; }
      tg.putImageData(tid, 0, 0);
      sg.imageSmoothingQuality = 'high'; sg.drawImage(tmp, 0, 0, bw, bh);
      var sd = sg.getImageData(0, 0, bw, bh).data, bg = new Float32Array(bw * bh);
      for (i = 0; i < bw * bh; i++) bg[i] = sd[4*i];
      var bgMax = new Float32Array(bw * bh), bgMin = new Float32Array(bw * bh), x, y, dx, dy;
      for (y = 0; y < bh; y++) for (x = 0; x < bw; x++){
        var mx = 0, mn = 255;
        for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++){
          var yy = y + dy, xx = x + dx; if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
          var vv = bg[yy * bw + xx]; if (vv > mx) mx = vv; if (vv < mn) mn = vv;
        }
        bgMax[y * bw + x] = mx; bgMin[y * bw + x] = mn;
      }
      var bb = new Uint8ClampedArray(bw * bh * 4);
      for (i = 0; i < bw * bh; i++){ bb[4*i] = bgMax[i]; bb[4*i+1] = bgMin[i]; bb[4*i+2] = bg[i]; bb[4*i+3] = 255; }
      sg.putImageData(new ImageData(bb, bw, bh), 0, 0);
      var big = document.createElement('canvas'); big.width = w; big.height = h;
      var bgc = big.getContext('2d', { willReadFrequently: true }); bgc.imageSmoothingEnabled = true; bgc.imageSmoothingQuality = 'high';
      bgc.drawImage(sc, 0, 0, w, h);
      var bd = bgc.getImageData(0, 0, w, h).data;
      for (i = 0; i < n; i++){
        var gv = gray[i], q2;
        if (bd[4*i+2] < 75){ var dk = bd[4*i+1]; q2 = (255 - gv) * 255 / (256 - dk); }   // dunkler Balken: Schrift ist heller als Grund
        else { var b = bd[4*i] || 1; q2 = gv * 255 / b; }
        gray[i] = q2 > 255 ? 255 : q2 < 0 ? 0 : q2;
      }
    }
    // Alles außerhalb des Papiers (Tisch, Rand) weiß machen, damit keine dunklen Ränder/Kanten stören
    if (cr && cr.out){
      var mc = document.createElement('canvas'); mc.width = cr.cw; mc.height = cr.ch;
      var mg = mc.getContext('2d'), mid = mg.createImageData(cr.cw, cr.ch), mi;
      for (mi = 0; mi < cr.out.length; mi++){ var ov = cr.out[mi] ? 255 : 0; mid.data[4*mi] = mid.data[4*mi+1] = mid.data[4*mi+2] = ov; mid.data[4*mi+3] = 255; }
      mg.putImageData(mid, 0, 0);
      var m2 = document.createElement('canvas'); m2.width = w; m2.height = h;
      var m2g = m2.getContext('2d', { willReadFrequently: true }); m2g.imageSmoothingQuality = 'high'; m2g.drawImage(mc, 0, 0, w, h);
      var md = m2g.getImageData(0, 0, w, h).data;
      for (i = 0; i < n; i++) if (md[4*i] > 40) gray[i] = 255;
    }
    // Kontrast spreizen (1 %/99 %-Perzentil)
    var hist = new Uint32Array(256); for (i = 0; i < n; i++) hist[gray[i]]++;
    var lo = 0, hi = 255, acc = 0;
    for (i = 0; i < 256; i++){ acc += hist[i]; if (acc > n * 0.01){ lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--){ acc += hist[i]; if (acc > n * 0.2){ hi = i; break; } }   // Papier = hellste 20 %
    if (hi - lo < 40){ lo = 0; hi = 255; }
    var sp = 255 / (hi - lo);
    for (i = 0; i < n; i++){ var z = (gray[i] - lo) * sp; z = z < 0 ? 0 : z > 255 ? 255 : z; d[4*i] = d[4*i+1] = d[4*i+2] = z; d[4*i+3] = 255; }
    g.putImageData(id, 0, 0);
    return { canvas: c, w: w, h: h, inverted: invert };
  });
}

// ---------- Hauptfunktion ----------
// onProgress({stage:'prep'|'load'|'read', pct:0..100, label:string})
function run(blob, onProgress, opt){
  opt = opt || {};
  var t0 = Date.now(), tPrep, first = !workerP;
  function emit(stage, pct, label){ if (onProgress) try{ onProgress({ stage: stage, pct: Math.max(0, Math.min(100, Math.round(pct))), label: label }); }catch(e){} }
  clearTimeout(idleTimer);
  emit('prep', 2, 'Bild wird vorbereitet …');
  var stageBase = { 'loading tesseract core': 5, 'initializing tesseract': 12, 'loading language traineddata': 16, 'initializing api': 26 };
  curLog = function(m){
    if (!m || !m.status) return;
    if (m.status === 'recognizing text') emit('read', 30 + 68 * (m.progress || 0), 'Text wird gelesen … ' + Math.round(100 * (m.progress || 0)) + ' %');
    else if (stageBase[m.status] != null) emit('load', stageBase[m.status] + (m.progress || 0) * 6, first ? 'Texterkennung wird geladen (nur beim ersten Mal) …' : 'Texterkennung startet …');
  };
  var prepP = preprocess(blob, opt), wP = getWorker();
  return Promise.all([prepP, wP]).then(function(r){
    tPrep = Date.now() - t0;
    var pre = r[0], w = r[1];
    emit('read', 30, 'Text wird gelesen …');
    var timeout = new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('Zeitüberschreitung bei der Texterkennung')); }, opt.timeoutMs || 120000); });
    return Promise.race([w.recognize(pre.canvas), timeout]).then(function(res){
      var data = res.data || {};
      armIdle();
      return { text: data.text || '', confidence: data.confidence, ms: Date.now() - t0, prepMs: tPrep, w: pre.w, h: pre.h, inverted: pre.inverted, first: first };
    });
  }).catch(function(e){ killWorker(); throw e; }).then(function(x){ curLog = null; emit('read', 100, 'Fertig'); return x; }, function(e){ curLog = null; throw e; });
}
function prefetch(){
  if (navigator.serviceWorker && navigator.serviceWorker.ready) navigator.serviceWorker.ready.then(function(reg){ if (reg.active) reg.active.postMessage({ type: 'prefetch-ocr' }); }).catch(function(){});
}
function setConfig(o){ for (var k in o) cfg[k] = o[k]; killWorker(); }

root.BelegOCR = { run: run, preprocess: preprocess, prefetch: prefetch, config: cfg, setConfig: setConfig, kill: killWorker, warm: getWorker };
})(window);
