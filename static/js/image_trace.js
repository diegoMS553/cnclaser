// ==========================================================================
// MOTOR DE GRABADO Y VECTORIZACION DE IMAGENES (LASERGRBL + OPENCV)
// --------------------------------------------------------------------------
// Implementa tanto el cliente para el backend Python OpenCV (/api/process_image)
// como los algoritmos equivalentes en JavaScript para vista previa instantanea:
//
// Pre-procesamiento (estilo LaserGRBL + OpenCV):
//   - Brillo (-100..+100) y Contraste (-100..+100)
//   - Realce local de contraste CLAHE (ecualizacion adaptativa por bloques)
//   - Filtros de ruido: Bilateral (preserva bordes), Gaussiano, Mediana
//   - Umbralizacion: Global, Otsu automatico, Adaptativo Gaussiano y Adaptativo Media
//   - Spot Removal: eliminacion de manchas pequenas por componentes conexos
//
// Modos de Grabado / Vectorizacion:
//   - "centro"          : Centerline / Esqueleto (Zhang-Suen + Grafo topologico)
//   - "canny"           : Detector de Bordes Canny (Gradiente Sobel + NMS + Histeresis)
//   - "xdog"            : Boceto Artistico XDoG (Extended Difference of Gaussians)
//   - "contorno"        : LaserGRBL Vectorize! (Marching Squares + Suavizado Chaikin + DP)
//   - "contorno_relleno": Contornos vectoriales + Relleno Line-to-Line
//   - "line2line"       : LaserGRBL Line-to-Line Tracing (Serpentina 0/45/90/135 deg)
//   - "crosshatch"      : Sombreado Cruzado Multicapa por Tonos de Gris (3 capas tonales)
//   - "dithering"       : LaserGRBL 1-Bit B&W Dithering (Atkinson, Floyd-Steinberg, Stucki, Jarvis, Sierra, Bayer)
// ==========================================================================
const ImageTrace = (() => {

    // ----------------------------------------------------------------------
    // 1. RASTERIZADO, CLAHE, BRILLO/CONTRASTE Y FILTROS (BILATERAL / GAUSS / MEDIANA)
    // ----------------------------------------------------------------------
    function rasterizar(img, maxLadoPx) {
        const iw = img.naturalWidth || img.width;
        const ih = img.naturalHeight || img.height;
        const factor = Math.min(1, maxLadoPx / Math.max(iw, ih, 1));
        const w = Math.max(12, Math.round(iw * factor));
        const h = Math.max(12, Math.round(ih * factor));

        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const datos = ctx.getImageData(0, 0, w, h).data;

        const gris = new Float32Array(w * h);
        for (let i = 0, p = 0; i < gris.length; i++, p += 4) {
            gris[i] = 0.299 * datos[p] + 0.587 * datos[p + 1] + 0.114 * datos[p + 2];
        }
        return { w, h, gris };
    }

    function aplicarCLAHE(gris, w, h) {
        const out = new Float32Array(w * h);
        const hist = new Uint32Array(256);
        let total = w * h;
        for (let i = 0; i < total; i++) {
            const v = Math.max(0, Math.min(255, Math.round(gris[i])));
            hist[v]++;
        }
        const clip = Math.max(1, Math.floor((total / 256) * 2.2));
        let exceso = 0;
        for (let i = 0; i < 256; i++) {
            if (hist[i] > clip) {
                exceso += hist[i] - clip;
                hist[i] = clip;
            }
        }
        const incr = Math.floor(exceso / 256);
        for (let i = 0; i < 256; i++) hist[i] += incr;

        const cdf = new Float32Array(256);
        let acum = 0;
        for (let i = 0; i < 256; i++) {
            acum += hist[i];
            cdf[i] = (acum / total) * 255;
        }
        for (let i = 0; i < total; i++) {
            const v = Math.max(0, Math.min(255, Math.round(gris[i])));
            out[i] = 0.65 * cdf[v] + 0.35 * gris[i];
        }
        return out;
    }

    function aplicarBrilloContraste(gris, brillo, contraste, invertir) {
        const out = new Float32Array(gris.length);
        const c = Math.max(-100, Math.min(100, contraste || 0));
        const b = Math.max(-100, Math.min(100, brillo || 0));
        const fc = (259 * (c + 255)) / (255 * (259 - c));
        for (let i = 0; i < gris.length; i++) {
            let v = fc * (gris[i] - 128) + 128 + b * 1.28;
            v = Math.max(0, Math.min(255, v));
            out[i] = invertir ? (255 - v) : v;
        }
        return out;
    }

    function filtroGaussiano(gris, w, h, pasadas) {
        let src = gris;
        for (let n = 0; n < pasadas; n++) {
            const dst = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let s = 0, wSum = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        const yy = y + dy;
                        if (yy < 0 || yy >= h) continue;
                        for (let dx = -1; dx <= 1; dx++) {
                            const xx = x + dx;
                            if (xx < 0 || xx >= w) continue;
                            const k = (dx === 0 && dy === 0) ? 4 : (dx === 0 || dy === 0 ? 2 : 1);
                            s += src[yy * w + xx] * k;
                            wSum += k;
                        }
                    }
                    dst[y * w + x] = s / wSum;
                }
            }
            src = dst;
        }
        return src;
    }

    function filtroBilateral(gris, w, h, nivel) {
        const r = Math.min(3, Math.max(1, nivel));
        const sigmaColor = 24 + nivel * 16;
        const denomColor = 2 * sigmaColor * sigmaColor;
        const dst = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const centro = gris[y * w + x];
                let suma = 0, pesoTotal = 0;
                for (let dy = -r; dy <= r; dy++) {
                    const yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (let dx = -r; dx <= r; dx++) {
                        const xx = x + dx;
                        if (xx < 0 || xx >= w) continue;
                        const val = gris[yy * w + xx];
                        const diff = val - centro;
                        const wC = Math.exp(-(diff * diff) / denomColor);
                        const wS = 1 / (1 + dx * dx + dy * dy);
                        const wT = wC * wS;
                        suma += val * wT;
                        pesoTotal += wT;
                    }
                }
                dst[y * w + x] = suma / Math.max(1e-6, pesoTotal);
            }
        }
        return dst;
    }

    function filtroMediana(gris, w, h) {
        const dst = new Float32Array(w * h);
        const vec = new Float32Array(9);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let k = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    const yy = Math.max(0, Math.min(h - 1, y + dy));
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = Math.max(0, Math.min(w - 1, x + dx));
                        vec[k++] = gris[yy * w + xx];
                    }
                }
                vec.sort();
                dst[y * w + x] = vec[4];
            }
        }
        return dst;
    }

    function preprocesarGris(gris, w, h, op) {
        let g = op.clahe ? aplicarCLAHE(gris, w, h) : gris;
        g = aplicarBrilloContraste(g, op.brillo || 0, op.contraste || 0, Boolean(op.invertir));
        const nivel = Math.round(op.suavizado ?? 1);
        const tipo = (op.tipoFiltro || "bilateral").toLowerCase();
        if (nivel > 0) {
            if (tipo === "bilateral") g = filtroBilateral(g, w, h, nivel);
            else if (tipo === "mediana") g = filtroMediana(g, w, h);
            else g = filtroGaussiano(g, w, h, nivel);
        }
        return g;
    }

    // ----------------------------------------------------------------------
    // 2. BINARIZACION (GLOBAL, OTSU, ADAPTATIVA) + SPOT REMOVAL
    // ----------------------------------------------------------------------
    function calcularUmbralOtsu(gris) {
        const hist = new Uint32Array(256);
        const total = gris.length;
        for (let i = 0; i < total; i++) {
            hist[Math.max(0, Math.min(255, Math.round(gris[i])))]++;
        }
        let sum = 0;
        for (let i = 0; i < 256; i++) sum += i * hist[i];
        let sumB = 0, wB = 0, maxVar = 0, umbral = 128;
        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB === 0) continue;
            const wF = total - wB;
            if (wF === 0) break;
            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (sum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > maxVar) {
                maxVar = varBetween;
                umbral = t;
            }
        }
        return umbral;
    }

    function binarizarImagen(gris, w, h, op) {
        const metodo = (op.metodoUmbral || "global").toLowerCase();
        const umbralBase = op.umbral ?? 128;
        const mascara = new Uint8Array(w * h);

        if (metodo === "adaptativo_gauss" || metodo === "adaptativo_media") {
            const sat = new Float64Array((w + 1) * (h + 1));
            for (let y = 1; y <= h; y++) {
                let filaS = 0;
                for (let x = 1; x <= w; x++) {
                    filaS += gris[(y - 1) * w + (x - 1)];
                    sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + filaS;
                }
            }
            const rad = Math.max(5, Math.round(Math.min(w, h) * 0.03));
            const cVal = Math.max(2, (255 - umbralBase) * 0.08);
            for (let y = 0; y < h; y++) {
                const y0 = Math.max(0, y - rad), y1 = Math.min(h - 1, y + rad);
                for (let x = 0; x < w; x++) {
                    const x0 = Math.max(0, x - rad), x1 = Math.min(w - 1, x + rad);
                    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
                    const suma = sat[(y1 + 1) * (w + 1) + (x1 + 1)]
                               - sat[y0 * (w + 1) + (x1 + 1)]
                               - sat[(y1 + 1) * (w + 1) + x0]
                               + sat[y0 * (w + 1) + x0];
                    const media = suma / area;
                    mascara[y * w + x] = gris[y * w + x] < (media - cVal) ? 1 : 0;
                }
            }
        } else {
            const u = metodo === "otsu" ? calcularUmbralOtsu(gris) : umbralBase;
            for (let i = 0; i < mascara.length; i++) {
                mascara[i] = gris[i] < u ? 1 : 0;
            }
        }
        return quitarManchas(mascara, w, h, Math.round(op.areaMinPx || 0));
    }

    function quitarManchas(mascara, w, h, areaMin) {
        if (areaMin <= 1) return mascara;
        const visto = new Uint8Array(w * h);
        const pila = [];
        const comp = [];
        for (let i = 0; i < mascara.length; i++) {
            if (!mascara[i] || visto[i]) continue;
            comp.length = 0;
            pila.push(i);
            visto[i] = 1;
            while (pila.length) {
                const p = pila.pop();
                comp.push(p);
                const x = p % w, y = (p / w) | 0;
                if (x > 0 && mascara[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila.push(p - 1); }
                if (x < w - 1 && mascara[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila.push(p + 1); }
                if (y > 0 && mascara[p - w] && !visto[p - w]) { visto[p - w] = 1; pila.push(p - w); }
                if (y < h - 1 && mascara[p + w] && !visto[p + w]) { visto[p + w] = 1; pila.push(p + w); }
            }
            if (comp.length < areaMin) {
                for (const p of comp) mascara[p] = 0;
            }
        }
        return mascara;
    }

    // ----------------------------------------------------------------------
    // 3. CONTORNOS (MARCHING SQUARES) + LINEA CENTRAL (ZHANG-SUEN)
    // ----------------------------------------------------------------------
    function trazarContornos(mascara, w, h) {
        const val = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : mascara[y * w + x];
        const segmentos = [];
        for (let y = -1; y < h; y++) {
            for (let x = -1; x < w; x++) {
                const a = val(x, y), b = val(x + 1, y), c = val(x + 1, y + 1), d = val(x, y + 1);
                const caso = (a << 3) | (b << 2) | (c << 1) | d;
                if (caso === 0 || caso === 15) continue;
                const T = [2 * x + 1, 2 * y];
                const R = [2 * x + 2, 2 * y + 1];
                const B = [2 * x + 1, 2 * y + 2];
                const L = [2 * x, 2 * y + 1];
                switch (caso) {
                    case 1: case 14: segmentos.push([L, B]); break;
                    case 2: case 13: segmentos.push([B, R]); break;
                    case 3: case 12: segmentos.push([L, R]); break;
                    case 4: case 11: segmentos.push([T, R]); break;
                    case 6: case 9: segmentos.push([T, B]); break;
                    case 7: case 8: segmentos.push([L, T]); break;
                    case 5: segmentos.push([L, T]); segmentos.push([B, R]); break;
                    case 10: segmentos.push([T, R]); segmentos.push([L, B]); break;
                }
            }
        }
        return enlazarSegmentos(segmentos).map(cad => cad.map(([px, py]) => [px / 2 + 0.5, py / 2 + 0.5]));
    }

    function enlazarSegmentos(segmentos) {
        const clave = (p) => p[0] * 100003 + p[1];
        const indice = new Map();
        segmentos.forEach((s, i) => {
            for (const p of s) {
                const k = clave(p);
                if (!indice.has(k)) indice.set(k, []);
                indice.get(k).push(i);
            }
        });
        const usado = new Uint8Array(segmentos.length);
        const cadenas = [];

        const extender = (cadena) => {
            for (;;) {
                const fin = cadena[cadena.length - 1];
                const lista = indice.get(clave(fin)) || [];
                let siguiente = -1;
                for (const si of lista) { if (!usado[si]) { siguiente = si; break; } }
                if (siguiente < 0) return;
                usado[siguiente] = 1;
                const [p, q] = segmentos[siguiente];
                cadena.push(clave(p) === clave(fin) ? q : p);
            }
        };

        for (let i = 0; i < segmentos.length; i++) {
            if (usado[i]) continue;
            usado[i] = 1;
            const cadena = [segmentos[i][0], segmentos[i][1]];
            extender(cadena);
            cadena.reverse();
            extender(cadena);
            cadenas.push(cadena);
        }
        return cadenas;
    }

    function adelgazar(mascara, w, h) {
        const m = new Uint8Array(mascara);
        const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : m[y * w + x];
        let cambio = true;
        const borrar = [];
        while (cambio) {
            cambio = false;
            for (let paso = 0; paso < 2; paso++) {
                borrar.length = 0;
                for (let y = 0; y < h; y++) {
                    for (let x = 0; x < w; x++) {
                        if (!m[y * w + x]) continue;
                        const p2 = g(x, y - 1), p3 = g(x + 1, y - 1), p4 = g(x + 1, y), p5 = g(x + 1, y + 1);
                        const p6 = g(x, y + 1), p7 = g(x - 1, y + 1), p8 = g(x - 1, y), p9 = g(x - 1, y - 1);
                        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                        if (B < 2 || B > 6) continue;
                        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
                                  (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
                        if (A !== 1) continue;
                        if (paso === 0) {
                            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
                        } else {
                            if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
                        }
                        borrar.push(y * w + x);
                    }
                }
                if (borrar.length) {
                    cambio = true;
                    for (const i of borrar) m[i] = 0;
                }
            }
        }
        return m;
    }

    function trazarEsqueleto(esq, w, h) {
        const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && esq[y * w + x] === 1;
        const vecinos = (i) => {
            const x = i % w, y = (i / w) | 0;
            const res = [];
            const n = on(x, y - 1), s = on(x, y + 1), e = on(x + 1, y), o = on(x - 1, y);
            if (n) res.push(i - w);
            if (s) res.push(i + w);
            if (e) res.push(i + 1);
            if (o) res.push(i - 1);
            if (on(x + 1, y - 1) && !n && !e) res.push(i - w + 1);
            if (on(x - 1, y - 1) && !n && !o) res.push(i - w - 1);
            if (on(x + 1, y + 1) && !s && !e) res.push(i + w + 1);
            if (on(x - 1, y + 1) && !s && !o) res.push(i + w - 1);
            return res;
        };

        const grado = new Map();
        const adj = new Map();
        for (let i = 0; i < esq.length; i++) {
            if (!esq[i]) continue;
            const v = vecinos(i);
            adj.set(i, v);
            grado.set(i, v.length);
        }

        const aristaUsada = new Set();
        const claveArista = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
        const caminos = [];
        const aPunto = (i) => [(i % w) + 0.5, ((i / w) | 0) + 0.5];

        const recorrer = (inicio, sig) => {
            const camino = [aPunto(inicio), aPunto(sig)];
            aristaUsada.add(claveArista(inicio, sig));
            let prev = inicio, cur = sig;
            while (grado.get(cur) === 2) {
                const lista = adj.get(cur);
                let prox = -1;
                for (const n of lista) {
                    if (n !== prev && !aristaUsada.has(claveArista(cur, n))) { prox = n; break; }
                }
                if (prox < 0) break;
                aristaUsada.add(claveArista(cur, prox));
                camino.push(aPunto(prox));
                prev = cur;
                cur = prox;
            }
            caminos.push(camino);
        };

        for (const [i, gdo] of grado) {
            if (gdo === 2) continue;
            for (const n of adj.get(i)) {
                if (!aristaUsada.has(claveArista(i, n))) recorrer(i, n);
            }
        }
        for (const [i, gdo] of grado) {
            if (gdo !== 2) continue;
            for (const n of adj.get(i)) {
                if (!aristaUsada.has(claveArista(i, n))) recorrer(i, n);
            }
        }
        return caminos;
    }

    // ----------------------------------------------------------------------
    // 4. DETECTOR DE BORDES CANNY Y BOCETO ARTISTICO XDoG
    // ----------------------------------------------------------------------
    function detectarBordesCanny(gris, w, h, op) {
        const mag = new Float32Array(w * h);
        const dir = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const gx = -gris[i - w - 1] + gris[i - w + 1]
                         - 2 * gris[i - 1] + 2 * gris[i + 1]
                         - gris[i + w - 1] + gris[i + w + 1];
                const gy = -gris[i - w - 1] - 2 * gris[i - w] - gris[i - w + 1]
                         + gris[i + w - 1] + 2 * gris[i + w] + gris[i + w + 1];
                mag[i] = Math.hypot(gx, gy);
                const ang = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
                dir[i] = (ang < 22.5 || ang >= 157.5) ? 0 : (ang < 67.5 ? 1 : (ang < 112.5 ? 2 : 3));
            }
        }
        const sens = Math.max(0.08, Math.min(0.92, (255 - (op.umbral ?? 128)) / 255));
        const tAlto = Math.max(25, Math.min(230, 260 * sens));
        const tBajo = tAlto * 0.42;
        const nms = new Uint8Array(w * h);
        const pila = [];
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const i = y * w + x;
                const m = mag[i];
                if (m < tBajo) continue;
                let m1 = 0, m2 = 0;
                if (dir[i] === 0) { m1 = mag[i - 1]; m2 = mag[i + 1]; }
                else if (dir[i] === 1) { m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; }
                else if (dir[i] === 2) { m1 = mag[i - w]; m2 = mag[i + w]; }
                else { m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; }
                if (m >= m1 && m >= m2) {
                    if (m >= tAlto) { nms[i] = 2; pila.push(i); }
                    else nms[i] = 1;
                }
            }
        }
        const bordes = new Uint8Array(w * h);
        while (pila.length) {
            const p = pila.pop();
            bordes[p] = 1;
            for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) {
                const q = p + d;
                if (q >= 0 && q < nms.length && nms[q] === 1 && !bordes[q]) {
                    nms[q] = 2;
                    pila.push(q);
                }
            }
        }
        const limpio = quitarManchas(bordes, w, h, Math.round(op.areaMinPx || 0));
        const esq = adelgazar(limpio, w, h);
        return { trazos: trazarEsqueleto(esq, w, h), mascara: esq };
    }

    function detectarBocetoXDoG(gris, w, h, op) {
        const g1 = filtroGaussiano(gris, w, h, 1);
        const g2 = filtroGaussiano(gris, w, h, 4);
        const tau = 0.98, phi = 10.0;
        const eps = -0.02 + (((op.umbral ?? 128) - 128) / 255) * 0.15;
        const mascara = new Uint8Array(w * h);
        for (let i = 0; i < mascara.length; i++) {
            const u = (1 + tau) * (g1[i] / 255) - tau * (g2[i] / 255);
            const xdog = u >= eps ? 1.0 : 1.0 + Math.tanh(phi * (u - eps));
            mascara[i] = xdog < 0.65 ? 1 : 0;
        }
        const limpio = quitarManchas(mascara, w, h, Math.max(2, Math.round(op.areaMinPx || 2)));
        const esq = adelgazar(limpio, w, h);
        return { trazos: trazarEsqueleto(esq, w, h), mascara: limpio };
    }

    // ----------------------------------------------------------------------
    // 5. LASERGRBL LINE-TO-LINE, CROSSHATCH Y 1-BIT B&W DITHERING
    // ----------------------------------------------------------------------
    function trazarRelleno(mascara, w, h, espaciadoPx, anguloGrados) {
        const ang = (anguloGrados * Math.PI) / 180;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const nx = -dy, ny = dx;
        const cx = w / 2, cy = h / 2;
        const D = Math.hypot(w, h) / 2 + 2;
        const pasoU = 0.5;
        const lineas = [];
        let fila = 0;
        for (let t = -D; t <= D; t += Math.max(0.75, espaciadoPx)) {
            const tramos = [];
            let dentro = false, uIni = 0;
            for (let u = -D; u <= D + pasoU; u += pasoU) {
                const x = cx + t * nx + u * dx;
                const y = cy + t * ny + u * dy;
                const xi = Math.floor(x), yi = Math.floor(y);
                const v = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? mascara[yi * w + xi] : 0;
                if (v && !dentro) { dentro = true; uIni = u; }
                else if (!v && dentro) {
                    dentro = false;
                    const uFin = u - pasoU;
                    if (uFin - uIni >= 0.5) {
                        tramos.push([
                            [cx + t * nx + uIni * dx, cy + t * ny + uIni * dy],
                            [cx + t * nx + uFin * dx, cy + t * ny + uFin * dy]
                        ]);
                    }
                }
            }
            if (fila % 2 === 1) {
                tramos.reverse();
                tramos.forEach(tr => tr.reverse());
            }
            lineas.push(...tramos);
            fila++;
        }
        return lineas;
    }

    function trazarCrossHatch(gris, w, h, op) {
        const u = op.umbral ?? 128;
        const esp = Math.max(0.8, op.espaciadoPx || 2);
        const ang = op.anguloRelleno ?? 45;
        const m1 = new Uint8Array(w * h);
        const m2 = new Uint8Array(w * h);
        const m3 = new Uint8Array(w * h);
        for (let i = 0; i < gris.length; i++) {
            if (gris[i] < Math.min(245, u * 1.15)) m1[i] = 1;
            if (gris[i] < u * 0.78) m2[i] = 1;
            if (gris[i] < u * 0.42) m3[i] = 1;
        }
        const trazos = [
            ...trazarRelleno(m1, w, h, esp * 1.35, ang),
            ...trazarRelleno(m2, w, h, esp * 1.1, (ang + 90) % 180),
            ...trazarRelleno(m3, w, h, esp * 0.95, 0)
        ];
        return { trazos, mascara: m1 };
    }

    function trazarRasterModulacionLinea(gris, w, h, op) {
        const umbralBlanco = Math.max(10, Math.min(250, Number(op.umbral ?? 220)));
        const pMin = Math.max(0, Math.min(95, Number(op.potenciaMinPct ?? 12)));
        const pMax = Math.max(Math.max(5, pMin + 1), Math.min(100, Number(op.potenciaMaxPct ?? 85)));
        const niveles = Math.max(2, Math.min(64, Math.round(Number(op.nivelesPwm ?? 16))));
        const gamma = Math.max(0.3, Math.min(2.5, Number(op.gamma ?? 1.0)));
        const espaciadoPx = Math.max(0.75, Number(op.espaciadoPx || 1.5));
        const anguloGrados = Number(op.anguloRelleno ?? 0);
        const direccion = String(op.direccionRaster || "bidireccional").toLowerCase();
        const saltoBlancoPx = Math.max(0, Number(op.saltoBlancoPx ?? 3.0));

        const pwrMap = new Float32Array(w * h);
        const mascaraTonal = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const g = gris[i];
            if (g < umbralBlanco) {
                let osc = Math.max(0, Math.min(1, (umbralBlanco - g) / Math.max(1, umbralBlanco)));
                if (Math.abs(gamma - 1.0) > 1e-3) osc = Math.pow(osc, gamma);
                const qIdx = Math.round(osc * (niveles - 1)) / Math.max(1, niveles - 1);
                pwrMap[i] = Math.round((pMin + qIdx * (pMax - pMin)) * 10) / 10;
                mascaraTonal[i] = Math.max(2, Math.min(255, Math.round(qIdx * 255)));
            }
        }

        const ang = (anguloGrados * Math.PI) / 180;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const nx = -dy, ny = dx;
        const cx = w / 2, cy = h / 2;
        const D = Math.hypot(w, h) / 2 + 2;
        const pasoU = 0.5;

        const trazos = [];
        let fila = 0;
        for (let t = -D; t <= D; t += espaciadoPx) {
            let runs = [];
            let runActPwr = null;
            let runUIni = 0;
            let u = -D;

            for (; u <= D + pasoU; u += pasoU) {
                const x = cx + t * nx + u * dx;
                const y = cy + t * ny + u * dy;
                const xi = Math.floor(x), yi = Math.floor(y);
                const pwr = (xi >= 0 && yi >= 0 && xi < w && yi < h) ? pwrMap[yi * w + xi] : 0;

                if (runActPwr === null) {
                    runActPwr = pwr;
                    runUIni = u;
                } else if (Math.abs(pwr - runActPwr) > 0.05) {
                    runs.push([runUIni, u, runActPwr]);
                    runActPwr = pwr;
                    runUIni = u;
                }
            }
            if (runActPwr !== null && runActPwr > 0.05) {
                runs.push([runUIni, u, runActPwr]);
            }

            while (runs.length > 0 && runs[0][2] <= 0.05) runs.shift();
            while (runs.length > 0 && runs[runs.length - 1][2] <= 0.05) runs.pop();

            if (runs.length > 0) {
                if (direccion === "bidireccional" && (fila % 2 === 1)) {
                    runs = runs.slice().reverse().map(r => [r[1], r[0], r[2]]);
                }

                let polyActual = null;
                for (const [u0, u1, pwrSeg] of runs) {
                    const pIni = [cx + t * nx + u0 * dx, cy + t * ny + u0 * dy];
                    const pFin = [cx + t * nx + u1 * dx, cy + t * ny + u1 * dy];
                    const largoU = Math.abs(u1 - u0);

                    if (pwrSeg <= 0.05) {
                        if (polyActual !== null && largoU <= saltoBlancoPx) {
                            polyActual.push([pFin[0], pFin[1], 0.0]);
                        } else {
                            if (polyActual !== null && polyActual.length >= 2) {
                                trazos.push(polyActual);
                            }
                            polyActual = null;
                        }
                    } else {
                        if (polyActual === null) {
                            polyActual = [pIni, [pFin[0], pFin[1], pwrSeg]];
                        } else {
                            polyActual.push([pFin[0], pFin[1], pwrSeg]);
                        }
                    }
                }
                if (polyActual !== null && polyActual.length >= 2) {
                    trazos.push(polyActual);
                }
            }
            fila++;
        }

        return { trazos, mascara: mascaraTonal };
    }

    const MATRICES_DITHER = {
        atkinson: { div: 8, vec: [[1,0,1],[2,0,1],[-1,1,1],[0,1,1],[1,1,1],[0,2,1]] },
        floyd_steinberg: { div: 16, vec: [[1,0,7],[-1,1,3],[0,1,5],[1,1,1]] },
        stucki: { div: 42, vec: [[1,0,8],[2,0,4],[-2,1,2],[-1,1,4],[0,1,8],[1,1,4],[2,1,2],[-2,2,1],[-1,2,2],[0,2,4],[1,2,2],[2,2,1]] },
        jarvis: { div: 48, vec: [[1,0,7],[2,0,5],[-2,1,3],[-1,1,5],[0,1,7],[1,1,5],[2,1,3],[-2,2,1],[-1,2,3],[0,2,5],[1,2,3],[2,2,1]] },
        sierra: { div: 32, vec: [[1,0,5],[2,0,3],[-2,1,2],[-1,1,4],[0,1,5],[1,1,4],[2,1,2],[-1,2,2],[0,2,3],[1,2,2]] }
    };
    const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) * (255 / 16));

    function trazarDitheringLaserGRBL(gris, w, h, op) {
        const umbral = op.umbral ?? 128;
        const alg = (op.ditheringAlg || "atkinson").toLowerCase();
        const pasoFila = Math.max(1, Math.round(op.espaciadoPx || 1.5));
        const mascara = new Uint8Array(w * h);

        if (alg === "bayer") {
            const aj = 128 - umbral;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const b = BAYER4[(y & 3) * 4 + (x & 3)];
                    mascara[y * w + x] = (gris[y * w + x] + aj) < b ? 1 : 0;
                }
            }
        } else {
            const cfg = MATRICES_DITHER[alg] || MATRICES_DITHER.atkinson;
            const buf = new Float32Array(gris);
            for (let y = 0; y < h; y++) {
                const serp = (y & 1) === 1;
                const dirX = serp ? -1 : 1;
                for (let step = 0; step < w; step++) {
                    const x = serp ? (w - 1 - step) : step;
                    const idx = y * w + x;
                    const viejo = buf[idx];
                    const nuevo = viejo < umbral ? 0 : 255;
                    if (nuevo === 0) mascara[idx] = 1;
                    const err = (viejo - nuevo) / cfg.div;
                    for (const [dx, dy, peso] of cfg.vec) {
                        const nx = x + dx * dirX, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            buf[ny * w + nx] += err * peso;
                        }
                    }
                }
            }
        }

        const trazos = [];
        let filaIdx = 0;
        for (let y = 0; y < h; y += pasoFila) {
            const tramos = [];
            let x = 0;
            while (x < w) {
                if (mascara[y * w + x]) {
                    const xIni = x;
                    while (x + 1 < w && mascara[y * w + x + 1]) x++;
                    const xFin = x;
                    const yc = y + 0.5;
                    tramos.push([[xIni + 0.2, yc], [xFin + 0.8, yc]]);
                }
                x++;
            }
            if (filaIdx & 1) {
                tramos.reverse();
                tramos.forEach(tr => tr.reverse());
            }
            trazos.push(...tramos);
            filaIdx++;
        }
        return { trazos, mascara };
    }

    // ----------------------------------------------------------------------
    // 6. SUAVIZADO CHAIKIN, DOUGLAS-PEUCKER Y OPTIMIZACION DE RUTA
    // ----------------------------------------------------------------------
    function suavizarChaikin(pts, iteraciones) {
        if (!iteraciones || iteraciones <= 0 || pts.length < 3) return pts;
        const cerrado = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1.5;
        let cur = pts;
        for (let it = 0; it < Math.min(3, iteraciones); it++) {
            if (cur.length < 3) break;
            const nuevos = cerrado ? [] : [cur[0]];
            for (let i = 0; i < cur.length - 1; i++) {
                const p0 = cur[i], p1 = cur[i + 1];
                nuevos.push(
                    [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]],
                    [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]
                );
            }
            if (cerrado) nuevos.push(nuevos[0]);
            else nuevos.push(cur[cur.length - 1]);
            cur = nuevos;
        }
        return cur;
    }

    function douglasPeucker(pts, tol) {
        if (pts.length <= 2 || tol <= 0) return pts;
        const tol2 = tol * tol;
        const conservar = new Uint8Array(pts.length);
        conservar[0] = 1;
        conservar[pts.length - 1] = 1;
        const pila = [[0, pts.length - 1]];
        while (pila.length) {
            const [i0, i1] = pila.pop();
            const [ax, ay] = pts[i0];
            const [bx, by] = pts[i1];
            const vx = bx - ax, vy = by - ay;
            const len2 = vx * vx + vy * vy;
            let dmax = -1, imax = -1;
            for (let i = i0 + 1; i < i1; i++) {
                const [px, py] = pts[i];
                let d2;
                if (len2 === 0) {
                    d2 = (px - ax) ** 2 + (py - ay) ** 2;
                } else {
                    const tt = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
                    d2 = (px - ax - tt * vx) ** 2 + (py - ay - tt * vy) ** 2;
                }
                if (d2 > dmax) { dmax = d2; imax = i; }
            }
            if (dmax > tol2 && imax > 0) {
                conservar[imax] = 1;
                pila.push([i0, imax], [imax, i1]);
            }
        }
        return pts.filter((_, i) => conservar[i]);
    }

    function longitud(pts) {
        let L = 0;
        for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        return L;
    }

    function ordenarCercano(trazos) {
        const restantes = trazos.slice();
        const salida = [];
        let px = 0, py = Infinity;
        let primero = true;
        while (restantes.length) {
            let mejor = 0, mejorD = Infinity, invertir = false;
            for (let i = 0; i < restantes.length; i++) {
                const t = restantes[i];
                const a = t[0], b = t[t.length - 1];
                const da = primero ? (a[0] ** 2 + (a[1] - 1e6) ** 2) : ((a[0] - px) ** 2 + (a[1] - py) ** 2);
                const db = primero ? (b[0] ** 2 + (b[1] - 1e6) ** 2) : ((b[0] - px) ** 2 + (b[1] - py) ** 2);
                if (da < mejorD) { mejorD = da; mejor = i; invertir = false; }
                if (db < mejorD) { mejorD = db; mejor = i; invertir = true; }
            }
            let t = restantes.splice(mejor, 1)[0];
            if (invertir) t = t.slice().reverse();
            salida.push(t);
            const fin = t[t.length - 1];
            px = fin[0]; py = fin[1];
            primero = false;
        }
        return salida;
    }

    function unirCercanos(trazos, distMax) {
        if (distMax <= 0 || trazos.length < 2) return trazos;
        const res = [trazos[0].slice()];
        for (let i = 1; i < trazos.length; i++) {
            const ult = res[res.length - 1];
            const fin = ult[ult.length - 1];
            const ini = trazos[i][0];
            if (Math.hypot(fin[0] - ini[0], fin[1] - ini[1]) <= distMax) {
                ult.push(...trazos[i].slice(1));
            } else {
                res.push(trazos[i].slice());
            }
        }
        return res;
    }

    function crearCanvasMascara(mascara, w, h) {
        const cvMask = document.createElement("canvas");
        cvMask.width = w;
        cvMask.height = h;
        const cm = cvMask.getContext("2d");
        const im = cm.createImageData(w, h);
        let esTonal = false;
        for (let i = 0; i < mascara.length; i++) {
            if (mascara[i] > 1) { esTonal = true; break; }
        }
        for (let i = 0; i < mascara.length; i++) {
            const val = mascara[i];
            if (esTonal) {
                im.data[i * 4] = 0; im.data[i * 4 + 1] = 0; im.data[i * 4 + 2] = 0;
                im.data[i * 4 + 3] = val;
            } else {
                const v = val ? 0 : 255;
                im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v;
                im.data[i * 4 + 3] = val ? 255 : 0;
            }
        }
        cm.putImageData(im, 0, 0);
        return cvMask;
    }

    // ----------------------------------------------------------------------
    // 7. PROCESO COMPLETO (LOCAL JS Y SERVIDOR OPENCV PYTHON)
    // ----------------------------------------------------------------------
    function procesar(img, op) {
        const t0 = performance.now();
        const { w, h, gris: grisCrudo } = rasterizar(img, op.resolucionPx || 400);
        const gris = preprocesarGris(grisCrudo, w, h, op);

        const modo = (op.modo || "centro").toLowerCase();
        const esTramado = modo === "dithering" || modo === "line2line" || modo === "crosshatch" || modo === "relleno" || modo === "raster_pwm";
        let trazos = [];
        let mascara;

        if (modo === "canny") {
            const r = detectarBordesCanny(gris, w, h, op);
            trazos = r.trazos;
            mascara = r.mascara;
        } else if (modo === "xdog") {
            const r = detectarBocetoXDoG(gris, w, h, op);
            trazos = r.trazos;
            mascara = r.mascara;
        } else if (modo === "dithering") {
            const r = trazarDitheringLaserGRBL(gris, w, h, op);
            trazos = r.trazos;
            mascara = r.mascara;
        } else if (modo === "crosshatch") {
            const r = trazarCrossHatch(gris, w, h, op);
            trazos = r.trazos;
            mascara = r.mascara;
        } else if (modo === "raster_pwm") {
            const r = trazarRasterModulacionLinea(gris, w, h, op);
            trazos = r.trazos;
            mascara = r.mascara;
        } else {
            mascara = binarizarImagen(gris, w, h, op);
            if (modo === "centro") {
                trazos = trazarEsqueleto(adelgazar(mascara, w, h), w, h);
            }
            if (modo === "contorno" || modo === "contorno_relleno") {
                trazos = trazos.concat(trazarContornos(mascara, w, h));
            }
            if (modo === "relleno" || modo === "line2line" || modo === "contorno_relleno") {
                trazos = trazos.concat(trazarRelleno(mascara, w, h, op.espaciadoPx || 2, op.anguloRelleno ?? 45));
            }
        }

        const sinSimplificar = modo === "dithering" || modo === "raster_pwm";
        const suavCurvas = Math.round(op.suavizadoCurvas ?? 1);
        const tolSimp = sinSimplificar ? 0 : (op.simplificarPx ?? 0.8);
        const minLen = sinSimplificar ? 0 : (op.longitudMinPx ?? 2);

        trazos = trazos
            .map(t => (!esTramado && suavCurvas > 0 && t.length >= 4) ? suavizarChaikin(t, suavCurvas) : t)
            .map(t => tolSimp > 0 ? douglasPeucker(t, tolSimp) : t)
            .filter(t => t.length >= 2 && (sinSimplificar || longitud(t) >= minLen));

        if (op.optimizarOrden !== false && !sinSimplificar) trazos = ordenarCercano(trazos);
        if (modo !== "raster_pwm") trazos = unirCercanos(trazos, op.unirPx || 0);

        let puntos = 0;
        trazos.forEach(t => { puntos += t.length; });

        return {
            motor: "JS LaserGRBL Local",
            trazos,
            anchoPx: w,
            altoPx: h,
            puntos,
            mascaraCanvas: crearCanvasMascara(mascara, w, h),
            ms: Math.round(performance.now() - t0)
        };
    }

    async function procesarServidorOpenCV(dataUrl, op) {
        const res = await fetch("/api/process_image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imagen_base64: dataUrl, opciones: op })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || "Error al procesar en servidor OpenCV");
        }
        const cvMask = document.createElement("canvas");
        cvMask.width = data.anchoPx;
        cvMask.height = data.altoPx;
        if (data.mascaraDataUrl) {
            await new Promise((resolve) => {
                const im = new Image();
                im.onload = () => {
                    cvMask.getContext("2d").drawImage(im, 0, 0);
                    resolve();
                };
                im.onerror = () => resolve();
                im.src = data.mascaraDataUrl;
            });
        }
        return {
            motor: data.motor || "OpenCV Python + LaserGRBL",
            trazos: data.trazos || [],
            anchoPx: data.anchoPx,
            altoPx: data.altoPx,
            puntos: data.puntos || 0,
            mascaraCanvas: cvMask,
            ms: data.ms || 0
        };
    }

    return { procesar, procesarServidorOpenCV, douglasPeucker };
})();
