// ==========================================================================
// IMPORTADOR VECTORIAL SVG (INKSCAPE / ESTANDAR W3C) PARA NEMA STUDIO PRO
// Convierte <path>, <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>
// con transformaciones anidadas, De Casteljau adaptativo, arcos elipticos,
// Douglas-Peucker, relleno scanline opcional y agrupacion por capas/objetos.
// ==========================================================================

let _svgImportState = {
    nombreArchivo: "",
    xmlTexto: "",
    resultado: null
};

let _svgUniqueCounter = 0;

// --- 1. ALGEBRA DE MATRICES AFINES 2D [a, b, c, d, e, f] ---
function svgMatIdentidad() {
    return [1, 0, 0, 1, 0, 0];
}

function svgMatMult(m1, m2) {
    return [
        m1[0] * m2[0] + m1[2] * m2[1],
        m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3],
        m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
        m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
}

function svgAplicarMat(m, x, y) {
    return [
        m[0] * x + m[2] * y + m[4],
        m[1] * x + m[3] * y + m[5]
    ];
}

function svgFactorEscalaMatriz(m) {
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    return Math.max(0.0001, (sx + sy) * 0.5);
}

function svgParseTransformAttr(transformStr) {
    if (!transformStr || typeof transformStr !== "string") return svgMatIdentidad();
    let mat = svgMatIdentidad();
    const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = regex.exec(transformStr)) !== null) {
        const tipo = match[1].trim();
        const args = match[2]
            .trim()
            .split(/[\s,]+/)
            .map(Number)
            .filter(n => !Number.isNaN(n));
        let sub = svgMatIdentidad();
        if (tipo === "matrix" && args.length >= 6) {
            sub = [args[0], args[1], args[2], args[3], args[4], args[5]];
        } else if (tipo === "translate") {
            const tx = args[0] || 0;
            const ty = args.length > 1 ? args[1] : 0;
            sub = [1, 0, 0, 1, tx, ty];
        } else if (tipo === "scale") {
            const sx = args[0] !== undefined ? args[0] : 1;
            const sy = args.length > 1 ? args[1] : sx;
            sub = [sx, 0, 0, sy, 0, 0];
        } else if (tipo === "rotate") {
            const ang = ((args[0] || 0) * Math.PI) / 180;
            const cos = Math.cos(ang);
            const sin = Math.sin(ang);
            if (args.length >= 3) {
                const cx = args[1] || 0;
                const cy = args[2] || 0;
                sub = svgMatMult(
                    [1, 0, 0, 1, cx, cy],
                    svgMatMult([cos, sin, -sin, cos, 0, 0], [1, 0, 0, 1, -cx, -cy])
                );
            } else {
                sub = [cos, sin, -sin, cos, 0, 0];
            }
        } else if (tipo === "skewX") {
            const t = Math.tan(((args[0] || 0) * Math.PI) / 180);
            sub = [1, 0, t, 1, 0, 0];
        } else if (tipo === "skewY") {
            const t = Math.tan(((args[0] || 0) * Math.PI) / 180);
            sub = [1, t, 0, 1, 0, 0];
        }
        mat = svgMatMult(mat, sub);
    }
    return mat;
}

// --- 2. CONVERSION DE UNIDADES SVG / INKSCAPE A MILIMETROS (96 DPI) ---
function svgLongitudAMM(valorStr, fallbackMM = 0) {
    if (valorStr === null || valorStr === undefined) return fallbackMM;
    const str = String(valorStr).trim();
    if (!str) return fallbackMM;
    const m = str.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-zA-Z%]*)$/i);
    if (!m) return fallbackMM;
    const val = parseFloat(m[1]);
    if (Number.isNaN(val)) return fallbackMM;
    const unit = (m[2] || "px").toLowerCase();
    switch (unit) {
        case "mm": return val;
        case "cm": return val * 10.0;
        case "m":  return val * 1000.0;
        case "in": return val * 25.4;
        case "pt": return val * (25.4 / 72.0);
        case "pc": return val * (25.4 / 6.0);
        case "px":
        default:   return val * (25.4 / 96.0); // Estandar Inkscape 0.92+ / CSS 96 DPI
    }
}

function svgObtenerGeometriaDocumento(svgEl) {
    const vbAttr = svgEl.getAttribute("viewBox");
    const wAttr = svgEl.getAttribute("width");
    const hAttr = svgEl.getAttribute("height");

    let vbX = 0, vbY = 0, vbW = 0, vbH = 0;
    if (vbAttr) {
        const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
            [vbX, vbY, vbW, vbH] = parts;
        }
    }

    const tieneW = wAttr && !String(wAttr).trim().endsWith("%");
    const tieneH = hAttr && !String(hAttr).trim().endsWith("%");

    let widthMM = tieneW ? svgLongitudAMM(wAttr, 0) : 0;
    let heightMM = tieneH ? svgLongitudAMM(hAttr, 0) : 0;

    if (widthMM <= 0 && vbW > 0) widthMM = vbW * (25.4 / 96.0);
    if (heightMM <= 0 && vbH > 0) heightMM = vbH * (25.4 / 96.0);
    if (widthMM <= 0) widthMM = 160;
    if (heightMM <= 0) heightMM = 120;

    const scaleX = vbW > 0 ? (widthMM / vbW) : (tieneW ? svgLongitudAMM("1" + (wAttr.replace(/[0-9.+-]/g, "") || "px"), 25.4 / 96.0) : (25.4 / 96.0));
    const scaleY = vbH > 0 ? (heightMM / vbH) : (tieneH ? svgLongitudAMM("1" + (hAttr.replace(/[0-9.+-]/g, "") || "px"), 25.4 / 96.0) : (25.4 / 96.0));

    // Matriz raiz que convierte coordenadas de usuario SVG a milimetros (todavia con +Y hacia abajo)
    const matRaiz = [
        scaleX, 0,
        0, scaleY,
        -vbX * scaleX,
        -vbY * scaleY
    ];

    return {
        widthMM,
        heightMM,
        vbX,
        vbY,
        vbW: vbW || widthMM,
        vbH: vbH || heightMM,
        scaleX,
        scaleY,
        matRaiz
    };
}

// --- 3. DISCRETIZACION ADAPTATIVA DE CURVAS BEZIER (DE CASTELJAU) Y ARCOS ---
function svgSubdividirCubicBezier(x0, y0, x1, y1, x2, y2, x3, y3, tolSq, prof, outPts) {
    if (prof < 10) {
        const dx = x3 - x0;
        const dy = y3 - y0;
        const lenSq = dx * dx + dy * dy;
        let d1Sq, d2Sq;
        if (lenSq > 1e-9) {
            const u1 = ((x1 - x0) * dx + (y1 - y0) * dy) / lenSq;
            const u2 = ((x2 - x0) * dx + (y2 - y0) * dy) / lenSq;
            const px1 = x0 + Math.max(0, Math.min(1, u1)) * dx;
            const py1 = y0 + Math.max(0, Math.min(1, u1)) * dy;
            const px2 = x0 + Math.max(0, Math.min(1, u2)) * dx;
            const py2 = y0 + Math.max(0, Math.min(1, u2)) * dy;
            d1Sq = (x1 - px1) * (x1 - px1) + (y1 - py1) * (y1 - py1);
            d2Sq = (x2 - px2) * (x2 - px2) + (y2 - py2) * (y2 - py2);
        } else {
            d1Sq = (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0);
            d2Sq = (x2 - x0) * (x2 - x0) + (y2 - y0) * (y2 - y0);
        }
        if (Math.max(d1Sq, d2Sq) <= tolSq) {
            outPts.push([x3, y3]);
            return;
        }
    } else {
        outPts.push([x3, y3]);
        return;
    }

    const x01 = (x0 + x1) * 0.5, y01 = (y0 + y1) * 0.5;
    const x12 = (x1 + x2) * 0.5, y12 = (y1 + y2) * 0.5;
    const x23 = (x2 + x3) * 0.5, y23 = (y2 + y3) * 0.5;
    const x012 = (x01 + x12) * 0.5, y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5, y123 = (y12 + y23) * 0.5;
    const x0123 = (x012 + x123) * 0.5, y0123 = (y012 + y123) * 0.5;

    svgSubdividirCubicBezier(x0, y0, x01, y01, x012, y012, x0123, y0123, tolSq, prof + 1, outPts);
    svgSubdividirCubicBezier(x0123, y0123, x123, y123, x23, y23, x3, y3, tolSq, prof + 1, outPts);
}

function svgSubdividirQuadBezier(x0, y0, x1, y1, x2, y2, tolSq, prof, outPts) {
    // Elevar cuadratica a cubica exacta y usar el mismo De Casteljau
    const cx1 = x0 + (2 / 3) * (x1 - x0);
    const cy1 = y0 + (2 / 3) * (y1 - y0);
    const cx2 = x2 + (2 / 3) * (x1 - x2);
    const cy2 = y2 + (2 / 3) * (y1 - y2);
    svgSubdividirCubicBezier(x0, y0, cx1, cy1, cx2, cy2, x2, y2, tolSq, prof, outPts);
}

// Conversión de arco elíptico SVG (W3C F.6.5 / F.6.6) a segmentos adaptativos
function svgDiscretizarArco(x1, y1, rxIn, ryIn, phiDeg, largeArcFlag, sweepFlag, x2, y2, tolUser, outPts) {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx < 1e-7 || ry < 1e-7 || (Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9)) {
        outPts.push([x2, y2]);
        return;
    }

    const phi = (phiDeg * Math.PI) / 180.0;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    const dx2 = (x1 - x2) * 0.5;
    const dy2 = (y1 - y2) * 0.5;
    const x1p = cosPhi * dx2 + sinPhi * dy2;
    const y1p = -sinPhi * dx2 + cosPhi * dy2;

    let rxSq = rx * rx;
    let rySq = ry * ry;
    const x1pSq = x1p * x1p;
    const y1pSq = y1p * y1p;

    const lambda = x1pSq / rxSq + y1pSq / rySq;
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rx *= s;
        ry *= s;
        rxSq = rx * rx;
        rySq = ry * ry;
    }

    const num = Math.max(0, rxSq * rySq - rxSq * y1pSq - rySq * x1pSq);
    const den = rxSq * y1pSq + rySq * x1pSq;
    const rad = den > 1e-12 ? Math.sqrt(num / den) : 0;
    const sign = (Boolean(largeArcFlag) === Boolean(sweepFlag)) ? -1 : 1;
    const cxp = sign * rad * ((rx * y1p) / ry);
    const cyp = sign * rad * (-(ry * x1p) / rx);

    const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) * 0.5;
    const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) * 0.5;

    function vecAng(ux, uy, vx, vy) {
        const dot = ux * vx + uy * vy;
        const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        const c = len > 1e-12 ? Math.max(-1, Math.min(1, dot / len)) : 1;
        const a = Math.acos(c);
        return (ux * vy - uy * vx) < 0 ? -a : a;
    }

    const theta1 = vecAng(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dTheta = vecAng(
        (x1p - cxp) / rx,
        (y1p - cyp) / ry,
        (-x1p - cxp) / rx,
        (-y1p - cyp) / ry
    );

    if (!sweepFlag && dTheta > 0) dTheta -= Math.PI * 2;
    else if (sweepFlag && dTheta < 0) dTheta += Math.PI * 2;

    const rMax = Math.max(rx, ry);
    const stepAng = rMax > tolUser
        ? Math.max(0.035, Math.min(0.25, Math.sqrt((8 * Math.max(1e-4, tolUser)) / rMax)))
        : 0.25;
    const steps = Math.max(4, Math.min(240, Math.ceil(Math.abs(dTheta) / stepAng)));

    for (let i = 1; i <= steps; i++) {
        const ang = theta1 + (dTheta * i) / steps;
        const ex = rx * Math.cos(ang);
        const ey = ry * Math.sin(ang);
        const px = cosPhi * ex - sinPhi * ey + cx;
        const py = sinPhi * ex + cosPhi * ey + cy;
        outPts.push([px, py]);
    }
}

// --- 4. PARSER DE ATRIBUTO d="..." DE <path> (TODOS LOS COMANDOS ABSOLUTOS Y RELATIVOS) ---
function svgParsePathD(dStr, tolUser) {
    if (!dStr || typeof dStr !== "string") return [];
    const tokens = dStr.match(/[a-df-zA-DF-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
    if (!tokens || tokens.length === 0) return [];

    const tolSq = Math.max(1e-6, tolUser * tolUser);
    const subpaths = [];
    let actual = null;

    let idx = 0;
    let cmd = "";
    let curX = 0, curY = 0;
    let startX = 0, startY = 0;
    let prevCtrlX = 0, prevCtrlY = 0;
    let prevCmd = "";

    function esComando(tok) {
        return /^[a-df-zA-DF-Z]$/.test(tok);
    }

    function leerNum() {
        return parseFloat(tokens[idx++]);
    }

    function asegurarSubpath(x, y) {
        if (!actual || actual.length === 0) {
            actual = [[x, y]];
            subpaths.push(actual);
        }
    }

    while (idx < tokens.length) {
        if (esComando(tokens[idx])) {
            cmd = tokens[idx++];
        } else if (!cmd) {
            break;
        }

        const esRel = cmd === cmd.toLowerCase();
        const cmdUp = cmd.toUpperCase();

        if (cmdUp === "M") {
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            curX = x; curY = y;
            startX = x; startY = y;
            actual = [[curX, curY]];
            subpaths.push(actual);
            prevCmd = "M";
            // Segun especificacion SVG, pares adicionales tras M se tratan como L implicito
            cmd = esRel ? "l" : "L";
        } else if (cmdUp === "L") {
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            curX = x; curY = y;
            actual.push([curX, curY]);
            prevCmd = "L";
        } else if (cmdUp === "H") {
            const x = leerNum() + (esRel ? curX : 0);
            asegurarSubpath(curX, curY);
            curX = x;
            actual.push([curX, curY]);
            prevCmd = "H";
        } else if (cmdUp === "V") {
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            curY = y;
            actual.push([curX, curY]);
            prevCmd = "V";
        } else if (cmdUp === "C") {
            const x1 = leerNum() + (esRel ? curX : 0);
            const y1 = leerNum() + (esRel ? curY : 0);
            const x2 = leerNum() + (esRel ? curX : 0);
            const y2 = leerNum() + (esRel ? curY : 0);
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            svgSubdividirCubicBezier(curX, curY, x1, y1, x2, y2, x, y, tolSq, 0, actual);
            prevCtrlX = x2; prevCtrlY = y2;
            curX = x; curY = y;
            prevCmd = "C";
        } else if (cmdUp === "S") {
            const x1 = (prevCmd === "C" || prevCmd === "S") ? (2 * curX - prevCtrlX) : curX;
            const y1 = (prevCmd === "C" || prevCmd === "S") ? (2 * curY - prevCtrlY) : curY;
            const x2 = leerNum() + (esRel ? curX : 0);
            const y2 = leerNum() + (esRel ? curY : 0);
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            svgSubdividirCubicBezier(curX, curY, x1, y1, x2, y2, x, y, tolSq, 0, actual);
            prevCtrlX = x2; prevCtrlY = y2;
            curX = x; curY = y;
            prevCmd = "S";
        } else if (cmdUp === "Q") {
            const x1 = leerNum() + (esRel ? curX : 0);
            const y1 = leerNum() + (esRel ? curY : 0);
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            svgSubdividirQuadBezier(curX, curY, x1, y1, x, y, tolSq, 0, actual);
            prevCtrlX = x1; prevCtrlY = y1;
            curX = x; curY = y;
            prevCmd = "Q";
        } else if (cmdUp === "T") {
            const x1 = (prevCmd === "Q" || prevCmd === "T") ? (2 * curX - prevCtrlX) : curX;
            const y1 = (prevCmd === "Q" || prevCmd === "T") ? (2 * curY - prevCtrlY) : curY;
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            svgSubdividirQuadBezier(curX, curY, x1, y1, x, y, tolSq, 0, actual);
            prevCtrlX = x1; prevCtrlY = y1;
            curX = x; curY = y;
            prevCmd = "T";
        } else if (cmdUp === "A") {
            const rx = leerNum();
            const ry = leerNum();
            const rot = leerNum();
            const large = leerNum();
            const sweep = leerNum();
            const x = leerNum() + (esRel ? curX : 0);
            const y = leerNum() + (esRel ? curY : 0);
            asegurarSubpath(curX, curY);
            svgDiscretizarArco(curX, curY, rx, ry, rot, large !== 0, sweep !== 0, x, y, tolUser, actual);
            curX = x; curY = y;
            prevCmd = "A";
        } else if (cmdUp === "Z") {
            if (actual && actual.length > 0) {
                if (Math.hypot(curX - startX, curY - startY) > 1e-5) {
                    actual.push([startX, startY]);
                }
            }
            curX = startX; curY = startY;
            prevCmd = "Z";
        } else {
            idx++;
        }
    }

    return subpaths.filter(sp => sp && sp.length >= 2);
}

// --- 5. EXTRACCION DE PRIMITIVAS GEOMETRICAS (<rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>) ---
function svgConvertirElementoASubpathsLocales(el, tolUser) {
    const tag = (el.localName || el.tagName || "").toLowerCase();
    if (tag === "path") {
        return svgParsePathD(el.getAttribute("d") || "", tolUser);
    }
    if (tag === "line") {
        const x1 = parseFloat(el.getAttribute("x1") || "0") || 0;
        const y1 = parseFloat(el.getAttribute("y1") || "0") || 0;
        const x2 = parseFloat(el.getAttribute("x2") || "0") || 0;
        const y2 = parseFloat(el.getAttribute("y2") || "0") || 0;
        return [[[x1, y1], [x2, y2]]];
    }
    if (tag === "polyline" || tag === "polygon") {
        const raw = (el.getAttribute("points") || "").trim();
        if (!raw) return [];
        const nums = raw.split(/[\s,]+/).map(Number).filter(n => !Number.isNaN(n));
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) {
            pts.push([nums[i], nums[i + 1]]);
        }
        if (pts.length < 2) return [];
        if (tag === "polygon") {
            const [fx, fy] = pts[0];
            const [lx, ly] = pts[pts.length - 1];
            if (Math.hypot(fx - lx, fy - ly) > 1e-5) pts.push([fx, fy]);
        }
        return [pts];
    }
    if (tag === "rect") {
        const x = parseFloat(el.getAttribute("x") || "0") || 0;
        const y = parseFloat(el.getAttribute("y") || "0") || 0;
        const w = parseFloat(el.getAttribute("width") || "0") || 0;
        const h = parseFloat(el.getAttribute("height") || "0") || 0;
        if (w <= 0 || h <= 0) return [];
        let rx = parseFloat(el.getAttribute("rx") || "0") || 0;
        let ry = parseFloat(el.getAttribute("ry") || "0") || 0;
        if (rx > 0 && ry === 0) ry = rx;
        if (ry > 0 && rx === 0) rx = ry;
        rx = Math.min(rx, w * 0.5);
        ry = Math.min(ry, h * 0.5);
        if (rx <= 1e-4 || ry <= 1e-4) {
            return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
        }
        const d = `M ${x + rx} ${y} H ${x + w - rx} A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry} V ${y + h - ry} A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h} H ${x + rx} A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry} V ${y + ry} A ${rx} ${ry} 0 0 1 ${x + rx} ${y} Z`;
        return svgParsePathD(d, tolUser);
    }
    if (tag === "circle" || tag === "ellipse") {
        const cx = parseFloat(el.getAttribute("cx") || "0") || 0;
        const cy = parseFloat(el.getAttribute("cy") || "0") || 0;
        const rx = tag === "circle"
            ? (parseFloat(el.getAttribute("r") || "0") || 0)
            : (parseFloat(el.getAttribute("rx") || "0") || 0);
        const ry = tag === "circle"
            ? rx
            : (parseFloat(el.getAttribute("ry") || "0") || 0);
        if (rx <= 0 || ry <= 0) return [];
        const rMax = Math.max(rx, ry);
        const nSeg = Math.max(18, Math.min(180, Math.ceil((2 * Math.PI) / Math.max(0.04, Math.sqrt((8 * Math.max(1e-4, tolUser)) / rMax)))));
        const pts = [];
        for (let i = 0; i <= nSeg; i++) {
            const a = (i / nSeg) * Math.PI * 2;
            pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
        }
        return [pts];
    }
    return [];
}

// --- 6. LIMPIEZA, DOUGLAS-PEUCKER Y RELLENO SCANLINE (HATCH) ---
function svgLimpiarPolilinea(pts, minDist = 0.005) {
    if (!pts || pts.length < 2) return [];
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        const prev = out[out.length - 1];
        if (Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]) >= minDist) {
            out.push(pts[i]);
        }
    }
    return out.length >= 2 ? out : [];
}

function svgDouglasPeucker(pts, epsilon) {
    if (!pts || pts.length <= 2 || epsilon <= 0) return pts;
    const esCerrado = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.02;
    if (esCerrado && pts.length > 4) {
        const mid = Math.floor(pts.length / 2);
        const p1 = svgDouglasPeucker(pts.slice(0, mid + 1), epsilon);
        const p2 = svgDouglasPeucker(pts.slice(mid), epsilon);
        return p1.slice(0, -1).concat(p2);
    }

    let dmax = 0;
    let idx = 0;
    const [ax, ay] = pts[0];
    const [bx, by] = pts[pts.length - 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    for (let i = 1; i < pts.length - 1; i++) {
        const [px, py] = pts[i];
        let d;
        if (lenSq > 1e-10) {
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
            d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        } else {
            d = Math.hypot(px - ax, py - ay);
        }
        if (d > dmax) {
            idx = i;
            dmax = d;
        }
    }

    if (dmax > epsilon) {
        const rec1 = svgDouglasPeucker(pts.slice(0, idx + 1), epsilon);
        const rec2 = svgDouglasPeucker(pts.slice(idx), epsilon);
        return rec1.slice(0, -1).concat(rec2);
    }
    return [pts[0], pts[pts.length - 1]];
}

// Genera lineas de relleno scanline (regla even-odd) para subpaths cerrados con fill
function svgGenerarHatchRelleno(subpathsMM, pasoMM) {
    const cerrados = subpathsMM.filter(sp => sp.length >= 3 && Math.hypot(sp[0][0] - sp[sp.length - 1][0], sp[0][1] - sp[sp.length - 1][1]) < 0.35);
    if (cerrados.length === 0 || pasoMM <= 0.05) return [];

    let minY = Infinity, maxY = -Infinity;
    cerrados.forEach(sp => {
        sp.forEach(([, y]) => {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });
    });
    if (!Number.isFinite(minY) || maxY - minY < pasoMM) return [];

    const hatch = [];
    let flip = false;
    for (let y = minY + pasoMM * 0.5; y < maxY; y += pasoMM) {
        const xs = [];
        cerrados.forEach(sp => {
            for (let i = 0; i < sp.length - 1; i++) {
                const [x1, y1] = sp[i];
                const [x2, y2] = sp[i + 1];
                if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
                    const t = (y - y1) / (y2 - y1);
                    xs.push(x1 + t * (x2 - x1));
                }
            }
        });
        xs.sort((a, b) => a - b);
        const fila = [];
        for (let k = 0; k + 1 < xs.length; k += 2) {
            if (xs[k + 1] - xs[k] >= 0.15) {
                fila.push([[xs[k], y], [xs[k + 1], y]]);
            }
        }
        if (flip) {
            fila.reverse().forEach(seg => hatch.push([seg[1], seg[0]]));
        } else {
            fila.forEach(seg => hatch.push(seg));
        }
        flip = !flip;
    }
    return hatch;
}

// --- 7. RECORRIDO JERARQUICO DEL ARBOL DOM SVG ---
const SVG_TAGS_IGNORADOS = new Set([
    "defs", "clippath", "mask", "pattern", "marker", "symbol",
    "metadata", "namedview", "style", "script", "lineargradient",
    "radialgradient", "filter", "title", "desc"
]);

function svgElementoOculto(el) {
    const disp = (el.getAttribute("display") || "").trim().toLowerCase();
    const vis = (el.getAttribute("visibility") || "").trim().toLowerCase();
    if (disp === "none" || vis === "hidden" || vis === "collapse") return true;
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) return true;
    return false;
}

function svgTieneFillVisible(el) {
    const fillAttr = (el.getAttribute("fill") || "").trim().toLowerCase();
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (fillAttr === "none" || fillAttr === "transparent" || /fill\s*:\s*none/.test(style)) return false;
    if (/fill-opacity\s*:\s*0(?:\.0+)?(?:\s*;|$)/.test(style) || el.getAttribute("fill-opacity") === "0") return false;
    return Boolean(fillAttr || /fill\s*:/.test(style));
}

function svgOptimizarOrdenTrazos(trazos) {
    if (!trazos || trazos.length <= 1) return trazos;
    const pendientes = trazos.map(t => t.slice());
    const resultado = [];
    let cx = 0, cy = 0;

    while (pendientes.length > 0) {
        let bestIdx = 0;
        let bestRev = false;
        let bestDist = Infinity;

        for (let i = 0; i < pendientes.length; i++) {
            const tr = pendientes[i];
            const pIni = tr[0];
            const pFin = tr[tr.length - 1];
            const dIni = Math.hypot(pIni[0] - cx, pIni[1] - cy);
            if (dIni < bestDist) {
                bestDist = dIni;
                bestIdx = i;
                bestRev = false;
            }
            const dFin = Math.hypot(pFin[0] - cx, pFin[1] - cy);
            if (dFin < bestDist) {
                bestDist = dFin;
                bestIdx = i;
                bestRev = true;
            }
        }

        const elegido = pendientes.splice(bestIdx, 1)[0];
        if (bestRev) elegido.reverse();
        resultado.push(elegido);
        const ult = elegido[elegido.length - 1];
        cx = ult[0];
        cy = ult[1];
    }
    return resultado;
}

function parsearDocumentoSVG(xmlTexto, opciones = {}) {
    const tolMM = Math.max(0.02, Math.min(2.0, Number(opciones.toleranciaMM) || 0.08));
    const simplifyMM = Math.max(0, Math.min(2.0, Number(opciones.simplificarMM) || 0.04));
    const modoPosicion = opciones.modoPosicion || "centrar_ajustar"; // "centrar_ajustar" | "origen_recortar" | "documento_original"
    const modoAgrupacion = opciones.modoAgrupacion || "unico";       // "unico" | "capas" | "elementos"
    const optimizarRuta = opciones.optimizarRuta !== false;
    const convertirTexto = Boolean(opciones.convertirTexto);
    const rellenarFill = Boolean(opciones.rellenarFill);
    const pasoHatchMM = Math.max(0.15, Math.min(10.0, Number(opciones.pasoHatchMM) || 0.8));

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlTexto, "image/svg+xml");
    const svgEl = doc.querySelector("svg");
    if (!svgEl) {
        return { ok: false, error: "El archivo seleccionado no contiene un elemento raiz <svg> valido." };
    }

    const docGeo = svgObtenerGeometriaDocumento(svgEl);
    const itemsExtraidos = [];
    let textosDetectados = 0;
    const capasSet = new Set();

    function recorrer(nodo, matAcum, capaActual) {
        if (!nodo || nodo.nodeType !== 1) return;
        const tag = (nodo.localName || nodo.tagName || "").toLowerCase();
        if (SVG_TAGS_IGNORADOS.has(tag) || svgElementoOculto(nodo)) return;

        const matLocal = svgParseTransformAttr(nodo.getAttribute("transform"));
        const mat = svgMatMult(matAcum, matLocal);

        let nombreCapa = capaActual;
        if (tag === "g") {
            const inkLabel = nodo.getAttribute("inkscape:label") || nodo.getAttribute("id");
            if (!capaActual && inkLabel) {
                nombreCapa = inkLabel;
            }
        }

        if (tag === "text") {
            const txtContent = (nodo.textContent || "").trim();
            if (txtContent) {
                textosDetectados++;
                if (convertirTexto && typeof FUENTE_CNC_STROKE === "object") {
                    const tx = parseFloat(nodo.getAttribute("x") || "0") || 0;
                    const ty = parseFloat(nodo.getAttribute("y") || "0") || 0;
                    const fontSizeStr = nodo.getAttribute("font-size") || "12";
                    const hUser = parseFloat(fontSizeStr) || 12;
                    const wChar = hUser * 0.62;
                    const stepX = wChar * 1.25;
                    const upper = txtContent.toUpperCase();
                    const subpathsTxt = [];
                    for (let c = 0; c < upper.length; c++) {
                        const glifo = FUENTE_CNC_STROKE[upper[c]];
                        if (!glifo) continue;
                        const ox = tx + c * stepX;
                        glifo.forEach(stroke => {
                            const pts = stroke.map(([nx, ny]) => svgAplicarMat(mat, ox + nx * wChar, ty - ny * hUser));
                            if (pts.length >= 2) subpathsTxt.push(pts);
                        });
                    }
                    if (subpathsTxt.length > 0) {
                        const cap = nombreCapa || "Texto SVG";
                        capasSet.add(cap);
                        itemsExtraidos.push({
                            nombre: `Texto "${txtContent.slice(0, 18)}"`,
                            capa: cap,
                            trazosRawMM: subpathsTxt
                        });
                    }
                }
            }
            return;
        }

        const escalaMat = svgFactorEscalaMatriz(mat);
        const tolUser = tolMM / escalaMat;
        const subpathsLocal = svgConvertirElementoASubpathsLocales(nodo, tolUser);

        if (subpathsLocal.length > 0) {
            const trazosMM = [];
            subpathsLocal.forEach(sp => {
                const transformado = sp.map(([x, y]) => svgAplicarMat(mat, x, y));
                let limpio = svgLimpiarPolilinea(transformado, 0.005);
                if (limpio.length >= 2 && simplifyMM > 0) {
                    limpio = svgDouglasPeucker(limpio, simplifyMM);
                }
                if (limpio.length >= 2) {
                    trazosMM.push(limpio);
                }
            });

            if (rellenarFill && svgTieneFillVisible(nodo) && trazosMM.length > 0) {
                const hatch = svgGenerarHatchRelleno(trazosMM, pasoHatchMM);
                hatch.forEach(h => trazosMM.push(h));
            }

            if (trazosMM.length > 0) {
                const idEl = nodo.getAttribute("inkscape:label") || nodo.getAttribute("id") || tag.toUpperCase();
                const cap = nombreCapa || "Capa Principal";
                capasSet.add(cap);
                itemsExtraidos.push({
                    nombre: `${idEl}`,
                    capa: cap,
                    trazosRawMM: trazosMM
                });
            }
        }

        const hijos = nodo.children || nodo.childNodes;
        for (let i = 0; i < hijos.length; i++) {
            recorrer(hijos[i], mat, nombreCapa);
        }
    }

    recorrer(svgEl, docGeo.matRaiz, "");

    if (itemsExtraidos.length === 0) {
        return {
            ok: false,
            textosDetectados,
            error: textosDetectados > 0
                ? "El SVG solo contiene nodos <text>. Activa 'Convertir <text> simple' o en Inkscape usa Trayecto -> Objeto a trayecto (Ctrl+Shift+C)."
                : "No se encontraron trayectos vectoriales (<path>, <rect>, <circle>, <polygon>, etc.) visibles en el archivo SVG."
        };
    }

    // 1. Invertir Eje Y (en SVG +Y baja; en CNC +Y sube) respecto a la altura del documento
    const docH = docGeo.heightMM;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    itemsExtraidos.forEach(item => {
        item.trazosCNC = item.trazosRawMM.map(tr =>
            tr.map(([x, y]) => {
                const cy = docH - y;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (cy < minY) minY = cy;
                if (cy > maxY) maxY = cy;
                return [x, cy];
            })
        );
    });

    const rawW = Math.max(0.01, maxX - minX);
    const rawH = Math.max(0.01, maxY - minY);
    const mesa = typeof obtenerLimitesMesaMM === "function" ? obtenerLimitesMesaMM() : { anchoMM: 160, altoMM: 120 };
    const mesaW = Math.max(5, mesa.anchoMM || 160);
    const mesaH = Math.max(5, mesa.altoMM || 120);

    // 2. Calcular transformacion de encuadre / escala a la Zona Calibrada
    let factorEscala = 1.0;
    let offsetX = 0;
    let offsetY = 0;

    if (modoPosicion === "centrar_ajustar") {
        const maxUtilW = mesaW * 0.90;
        const maxUtilH = mesaH * 0.90;
        if (rawW > maxUtilW || rawH > maxUtilH || opciones.forzarAjuste90) {
            factorEscala = Math.min(maxUtilW / rawW, maxUtilH / rawH);
        }
        const finalW = rawW * factorEscala;
        const finalH = rawH * factorEscala;
        offsetX = (mesaW - finalW) * 0.5 - minX * factorEscala;
        offsetY = (mesaH - finalH) * 0.5 - minY * factorEscala;
    } else if (modoPosicion === "origen_recortar") {
        const margen = 2.0;
        const maxUtilW = Math.max(2, mesaW - margen * 2);
        const maxUtilH = Math.max(2, mesaH - margen * 2);
        if (rawW > maxUtilW || rawH > maxUtilH) {
            factorEscala = Math.min(maxUtilW / rawW, maxUtilH / rawH);
        }
        offsetX = margen - minX * factorEscala;
        offsetY = margen - minY * factorEscala;
    } else {
        // documento_original: mantiene coordenadas del lienzo Inkscape (recortando solo si sale de 0..mesa)
        if (maxX > mesaW || maxY > mesaH || minX < 0 || minY < 0) {
            const maxUtilW = mesaW * 0.92;
            const maxUtilH = mesaH * 0.92;
            if (rawW > maxUtilW || rawH > maxUtilH) {
                factorEscala = Math.min(maxUtilW / rawW, maxUtilH / rawH);
            }
            offsetX = Math.max(1, Math.min(mesaW - rawW * factorEscala - 1, minX * factorEscala)) - minX * factorEscala;
            offsetY = Math.max(1, Math.min(mesaH - rawH * factorEscala - 1, minY * factorEscala)) - minY * factorEscala;
        }
    }

    let finalMinX = Infinity, finalMinY = Infinity, finalMaxX = -Infinity, finalMaxY = -Infinity;
    itemsExtraidos.forEach(item => {
        item.trazosFinales = item.trazosCNC.map(tr =>
            tr.map(([x, y]) => {
                const fx = Number((x * factorEscala + offsetX).toFixed(3));
                const fy = Number((y * factorEscala + offsetY).toFixed(3));
                if (fx < finalMinX) finalMinX = fx;
                if (fx > finalMaxX) finalMaxX = fx;
                if (fy < finalMinY) finalMinY = fy;
                if (fy > finalMaxY) finalMaxY = fy;
                return [fx, fy];
            })
        );
    });

    // 3. Agrupar segun la opcion elegida por el usuario
    const figurasGeneradas = [];
    const baseName = (_svgImportState.nombreArchivo || "Vector.svg").replace(/\.svg$/i, "");

    if (modoAgrupacion === "unico") {
        let todosTrazos = itemsExtraidos.flatMap(it => it.trazosFinales);
        if (optimizarRuta) todosTrazos = svgOptimizarOrdenTrazos(todosTrazos);
        figurasGeneradas.push({
            nombre: `SVG ${baseName} (${todosTrazos.length} trazos)`,
            trazos: todosTrazos
        });
    } else if (modoAgrupacion === "capas") {
        const porCapa = new Map();
        itemsExtraidos.forEach(it => {
            if (!porCapa.has(it.capa)) porCapa.set(it.capa, []);
            porCapa.get(it.capa).push(...it.trazosFinales);
        });
        porCapa.forEach((lista, nombreCapa) => {
            const trOpt = optimizarRuta ? svgOptimizarOrdenTrazos(lista) : lista;
            figurasGeneradas.push({
                nombre: `SVG [${nombreCapa}] (${trOpt.length} trazos)`,
                trazos: trOpt
            });
        });
    } else {
        itemsExtraidos.forEach((it, idx) => {
            const trOpt = optimizarRuta ? svgOptimizarOrdenTrazos(it.trazosFinales) : it.trazosFinales;
            figurasGeneradas.push({
                nombre: `SVG #${idx + 1} ${it.nombre}`,
                trazos: trOpt
            });
        });
    }

    let totalTrazos = 0;
    let totalSegmentos = 0;
    figurasGeneradas.forEach(f => {
        totalTrazos += f.trazos.length;
        f.trazos.forEach(t => {
            totalSegmentos += Math.max(0, t.length - 1);
        });
    });

    return {
        ok: true,
        docWidthMM: docGeo.widthMM,
        docHeightMM: docGeo.heightMM,
        rawW,
        rawH,
        finalW: Math.max(0, finalMaxX - finalMinX),
        finalH: Math.max(0, finalMaxY - finalMinY),
        factorEscala,
        capasCount: capasSet.size,
        elementosCount: itemsExtraidos.length,
        textosDetectados,
        totalTrazos,
        totalSegmentos,
        figuras: figurasGeneradas
    };
}

// --- 8. CONTROLADOR DE INTERFAZ DEL MODAL DE IMPORTACION SVG ---
function leerOpcionesModalSVG() {
    return {
        modoPosicion: document.getElementById("select-svg-pos-mode")?.value || "centrar_ajustar",
        modoAgrupacion: document.getElementById("select-svg-group-mode")?.value || "unico",
        toleranciaMM: parseFloat(document.getElementById("input-svg-tol")?.value || "0.08") || 0.08,
        simplificarMM: parseFloat(document.getElementById("input-svg-simplify")?.value || "0.04") || 0.04,
        optimizarRuta: Boolean(document.getElementById("chk-svg-optimize")?.checked ?? true),
        forzarAjuste90: Boolean(document.getElementById("chk-svg-fit90")?.checked ?? false),
        convertirTexto: Boolean(document.getElementById("chk-svg-convert-text")?.checked ?? true),
        rellenarFill: Boolean(document.getElementById("chk-svg-hatch-fill")?.checked ?? false),
        pasoHatchMM: parseFloat(document.getElementById("input-svg-hatch-spacing")?.value || "0.8") || 0.8
    };
}

function recalcularVistaPreviaSVGModal() {
    const infoBox = document.getElementById("svg-import-summary");
    const warnBox = document.getElementById("svg-import-warning");
    const btnApply = document.getElementById("btn-svg-modal-apply");

    if (!_svgImportState.xmlTexto) {
        if (infoBox) infoBox.innerHTML = `<div class="empty-shapes-msg">Selecciona un archivo <b>.svg</b> de Inkscape o software vectorial para analizar sus trayectos.</div>`;
        if (warnBox) warnBox.classList.add("hidden");
        if (btnApply) btnApply.disabled = true;
        return;
    }

    const res = parsearDocumentoSVG(_svgImportState.xmlTexto, leerOpcionesModalSVG());
    _svgImportState.resultado = res;

    if (!res.ok) {
        if (infoBox) infoBox.innerHTML = `<div class="img-warning">${res.error}</div>`;
        if (warnBox) warnBox.classList.add("hidden");
        if (btnApply) btnApply.disabled = true;
        return;
    }

    if (btnApply) btnApply.disabled = false;

    const escTxt = Math.abs(res.factorEscala - 1.0) < 0.005
        ? "100% (1:1 Original)"
        : `${(res.factorEscala * 100).toFixed(1)}% (Auto-ajustado)`;

    if (infoBox) {
        infoBox.innerHTML = `
            <div class="img-stats-grid">
                <div class="img-stat"><span>ARCHIVO / LIENZO SVG</span><strong>${res.docWidthMM.toFixed(1)} x ${res.docHeightMM.toFixed(1)} mm</strong></div>
                <div class="img-stat"><span>DIMENSION FINAL CNC</span><strong>${res.finalW.toFixed(1)} x ${res.finalH.toFixed(1)} mm</strong></div>
                <div class="img-stat"><span>TRAZOS / SEGMENTOS</span><strong>${res.totalTrazos} trazos | ${res.totalSegmentos} seg</strong></div>
                <div class="img-stat"><span>ESCALA / FIGURAS</span><strong>${escTxt} | ${res.figuras.length} fig</strong></div>
            </div>
        `;
    }

    if (warnBox) {
        if (res.textosDetectados > 0) {
            warnBox.textContent = `Se detectaron ${res.textosDetectados} nodo(s) <text> en el SVG. Para conservar la tipografia exacta de Inkscape usa 'Trayecto -> Objeto a trayecto (Ctrl+Shift+C)', o manten activa la opcion 'Convertir <text> simple'.`;
            warnBox.classList.remove("hidden");
        } else {
            warnBox.classList.add("hidden");
        }
    }
}

function cargarArchivoSVG(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    procesarArchivoSVGObjeto(file);
    event.target.value = "";
}

function procesarArchivoSVGObjeto(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        _svgImportState.nombreArchivo = file.name || "diseno.svg";
        _svgImportState.xmlTexto = String(e.target?.result || "");
        const lblFile = document.getElementById("lbl-svg-filename");
        if (lblFile) lblFile.textContent = `Archivo cargado: ${_svgImportState.nombreArchivo}`;
        abrirModal("modal-importar-svg");
        recalcularVistaPreviaSVGModal();
    };
    reader.readAsText(file);
}

function confirmarImportacionSVG() {
    if (!_svgImportState.resultado || !_svgImportState.resultado.ok) {
        recalcularVistaPreviaSVGModal();
    }
    const res = _svgImportState.resultado;
    if (!res || !res.ok || !res.figuras || res.figuras.length === 0) {
        mostrarMensajeConsola("Selecciona primero un archivo .svg valido para importar.", true);
        return false;
    }

    cambiarVista("drawing");
    let ultimoId = null;
    res.figuras.forEach((figData, i) => {
        _svgUniqueCounter = (_svgUniqueCounter + 1) % 100000;
        const id = agregarFiguraAlDibujo(figData.nombre, null, {
            trazos: figData.trazos,
            tipo: "svg",
            seleccionar: i === res.figuras.length - 1
        });
        // Garantizar ID unico incluso si se insertan multiples capas en el mismo milisegundo
        const creada = dibujo.figuras[dibujo.figuras.length - 1];
        if (creada && creada.id === id) {
            creada.id = Date.now() * 100 + _svgUniqueCounter;
            if (i === res.figuras.length - 1) {
                dibujo.seleccion = { tipo: "figura", id: creada.id };
            }
            ultimoId = creada.id;
        }
    });

    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
    seleccionarHerramientaDibujo("select");

    mostrarMensajeConsola(
        `SVG "${_svgImportState.nombreArchivo}" importado: ${res.figuras.length} figura(s), ${res.totalTrazos} trazos y ${res.totalSegmentos} segmentos (${res.finalW.toFixed(1)} x ${res.finalH.toFixed(1)} mm).`
    );
    return ultimoId !== null;
}
