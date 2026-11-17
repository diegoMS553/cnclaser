"""
Motor de Procesamiento de Imagenes y Grabado Vectorial (OpenCV + LaserGRBL)
===========================================================================
Implementa las tecnicas de importacion, vectorizacion y tramado de LaserGRBL
combinadas con algoritmos de vision artificial de OpenCV (cv2):

  1. Pre-procesamiento OpenCV / LaserGRBL:
     - Ajuste de Brillo y Contraste lineal/no-lineal (estilo LaserGRBL)
     - Ecualizacion adaptativa de histograma CLAHE (cv2.createCLAHE)
     - Filtrado de ruido: Bilateral (preserva bordes), Gaussiano, Mediana
     - Umbralizacion: Global, Otsu automatico, Adaptativo Gaussiano y Adaptativo Media
     - Eliminacion de manchas (Spot Removal) por componentes conexos (cv2.connectedComponentsWithStats)

  2. Modos de Conversion a Trazos (Polilineas 2D para Plotter / CNC):
     - "centro"          : Centerline / Esqueleto (Adelgazamiento Zhang-Suen + Grafo topologico)
     - "canny"           : Detector de Bordes OpenCV Canny (cv2.Canny + encadenamiento)
     - "xdog"            : Boceto Artistico XDoG (Extended Difference of Gaussians)
     - "contorno"        : LaserGRBL Vectorize! (cv2.findContours + Suavizado Chaikin + approxPolyDP)
     - "contorno_relleno": Contornos vectoriales + Relleno Line-to-Line
     - "line2line"       : LaserGRBL Line-to-Line Tracing (Serpentina 0/45/90/135 deg)
     - "crosshatch"      : Sombreado Cruzado Multicapa por Tonos de Gris (3 capas tonales)
     - "dithering"       : LaserGRBL 1-Bit B&W Dithering (Atkinson, Floyd-Steinberg, Stucki, Jarvis, Sierra, Bayer)
"""

import base64
import io
import math
import time
import cv2
import numpy as np
from PIL import Image


# ---------------------------------------------------------------------------
# 1. DECODIFICACION Y PRE-PROCESAMIENTO OPENCV + LASERGRBL
# ---------------------------------------------------------------------------
def decodificar_imagen_base64(data_url: str, max_lado_px: int = 480) -> np.ndarray:
    """Decodifica un data URL o base64 en una matriz en escala de grises uint8 (fondo blanco = 255)."""
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    pil_img = Image.open(io.BytesIO(raw)).convert("RGBA")
    fondo = Image.new("RGBA", pil_img.size, (255, 255, 255, 255))
    comp = Image.alpha_composite(fondo, pil_img).convert("RGB")
    arr = np.array(comp, dtype=np.uint8)
    gris = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    h, w = gris.shape[:2]
    factor = min(1.0, float(max_lado_px) / float(max(w, h, 1)))
    nw = max(12, int(round(w * factor)))
    nh = max(12, int(round(h * factor)))
    if nw != w or nh != h:
        interp = cv2.INTER_AREA if factor < 1.0 else cv2.INTER_LINEAR
        gris = cv2.resize(gris, (nw, nh), interpolation=interp)
    return gris


def preprocesar_gris(gris: np.ndarray, op: dict) -> np.ndarray:
    """Aplica CLAHE, Brillo, Contraste y Filtro de Ruido (Bilateral / Gaussiano / Mediana)."""
    img = gris.copy()

    # 1. Ecualizacion adaptativa CLAHE (OpenCV) para rescatar detalle en sombras y luces
    if op.get("clahe", False):
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        img = clahe.apply(img)

    # 2. Brillo (-100..100) y Contraste (-100..100) estilo LaserGRBL
    brillo = float(op.get("brillo", 0.0))
    contraste = float(op.get("contraste", 0.0))
    if abs(brillo) > 0.1 or abs(contraste) > 0.1:
        f_c = (259.0 * (contraste + 255.0)) / (255.0 * (259.0 - contraste)) if contraste < 258 else 4.0
        flt = img.astype(np.float32)
        flt = f_c * (flt - 128.0) + 128.0 + (brillo * 1.28)
        img = np.clip(flt, 0, 255).astype(np.uint8)

    # 3. Filtro de suavizado / reduccion de ruido OpenCV
    nivel = int(op.get("suavizado", 1))
    tipo_filtro = str(op.get("tipoFiltro", "bilateral")).lower()
    if nivel > 0:
        if tipo_filtro == "bilateral":
            # Preserva bordes nitidos mientras aplana ruido en superficies
            d = 5 + nivel * 2
            sigma = 25 + nivel * 20
            img = cv2.bilateralFilter(img, d=d, sigmaColor=sigma, sigmaSpace=sigma)
        elif tipo_filtro == "mediana":
            k = 3 if nivel == 1 else (5 if nivel == 2 else 7)
            img = cv2.medianBlur(img, k)
        else:
            k = 3 if nivel == 1 else (5 if nivel == 2 else 7)
            img = cv2.GaussianBlur(img, (k, k), 0)

    if op.get("invertir", False):
        img = 255 - img

    return img


def binarizar_opencv(gris: np.ndarray, op: dict) -> np.ndarray:
    """
    Devuelve mascara binaria uint8 (1 = zona activa/oscura a dibujar, 0 = fondo blanco)
    usando los metodos de OpenCV y LaserGRBL.
    """
    metodo = str(op.get("metodoUmbral", "global")).lower()
    umbral = int(np.clip(float(op.get("umbral", 128)), 5, 250))

    if metodo == "otsu":
        _, bin_inv = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    elif metodo == "adaptativo_gauss":
        bloque = max(11, int(round(min(gris.shape[:2]) * 0.06)) | 1)
        c_val = max(2.0, (255.0 - umbral) * 0.08)
        bin_inv = cv2.adaptiveThreshold(
            gris, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, bloque, c_val
        )
    elif metodo == "adaptativo_media":
        bloque = max(11, int(round(min(gris.shape[:2]) * 0.06)) | 1)
        c_val = max(2.0, (255.0 - umbral) * 0.08)
        bin_inv = cv2.adaptiveThreshold(
            gris, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, bloque, c_val
        )
    else:
        _, bin_inv = cv2.threshold(gris, umbral, 255, cv2.THRESH_BINARY_INV)

    mascara = (bin_inv > 0).astype(np.uint8)

    # Spot Removal (LaserGRBL): elimina manchas pequenas con connectedComponentsWithStats
    area_min = max(1, int(round(float(op.get("areaMinPx", 0)))))
    if area_min > 1:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mascara, connectivity=8)
        for lbl in range(1, num_labels):
            if stats[lbl, cv2.CC_STAT_AREA] < area_min:
                mascara[labels == lbl] = 0

    return mascara


# ---------------------------------------------------------------------------
# 2. ALGORITMOS DE EXTRACCION DE TRAZOS (OPENCV + LASERGRBL)
# ---------------------------------------------------------------------------
def adelgazar_zhang_suen(mascara: np.ndarray) -> np.ndarray:
    """Adelgazamiento morfologico Zhang-Suen vectorizado con NumPy para obtener esqueleto de 1 px."""
    img = (mascara > 0).astype(np.uint8)
    pad = np.pad(img, 1, mode="constant", constant_values=0)

    while True:
        cambiado = False
        for paso in (0, 1):
            p2 = pad[:-2, 1:-1]
            p3 = pad[:-2, 2:]
            p4 = pad[1:-1, 2:]
            p5 = pad[2:, 2:]
            p6 = pad[2:, 1:-1]
            p7 = pad[2:, :-2]
            p8 = pad[1:-1, :-2]
            p9 = pad[:-2, :-2]
            p1 = pad[1:-1, 1:-1]

            B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
            A = (
                ((p2 == 0) & (p3 == 1)).astype(np.uint8)
                + ((p3 == 0) & (p4 == 1)).astype(np.uint8)
                + ((p4 == 0) & (p5 == 1)).astype(np.uint8)
                + ((p5 == 0) & (p6 == 1)).astype(np.uint8)
                + ((p6 == 0) & (p7 == 1)).astype(np.uint8)
                + ((p7 == 0) & (p8 == 1)).astype(np.uint8)
                + ((p8 == 0) & (p9 == 1)).astype(np.uint8)
                + ((p9 == 0) & (p2 == 1)).astype(np.uint8)
            )
            cond = (p1 == 1) & (B >= 2) & (B <= 6) & (A == 1)
            if paso == 0:
                cond &= ((p2 * p4 * p6) == 0) & ((p4 * p6 * p8) == 0)
            else:
                cond &= ((p2 * p4 * p8) == 0) & ((p2 * p6 * p8) == 0)

            if np.any(cond):
                pad[1:-1, 1:-1][cond] = 0
                cambiado = True
        if not cambiado:
            break

    return pad[1:-1, 1:-1]


def trazar_esqueleto(esq: np.ndarray) -> list:
    """Recorre un mapa binario de 1 px de grosor (esqueleto o bordes Canny) generando polilineas continuas."""
    h, w = esq.shape[:2]
    ys, xs = np.nonzero(esq)
    if len(xs) == 0:
        return []

    activos = set(int(y * w + x) for y, x in zip(ys, xs))

    def vecinos(idx: int) -> list:
        x = idx % w
        y = idx // w
        res = []
        n = (y > 0) and ((idx - w) in activos)
        s = (y < h - 1) and ((idx + w) in activos)
        e = (x < w - 1) and ((idx + 1) in activos)
        o = (x > 0) and ((idx - 1) in activos)
        if n:
            res.append(idx - w)
        if s:
            res.append(idx + w)
        if e:
            res.append(idx + 1)
        if o:
            res.append(idx - 1)
        if x < w - 1 and y > 0 and (idx - w + 1) in activos and not n and not e:
            res.append(idx - w + 1)
        if x > 0 and y > 0 and (idx - w - 1) in activos and not n and not o:
            res.append(idx - w - 1)
        if x < w - 1 and y < h - 1 and (idx + w + 1) in activos and not s and not e:
            res.append(idx + w + 1)
        if x > 0 and y < h - 1 and (idx + w - 1) in activos and not s and not o:
            res.append(idx + w - 1)
        return res

    adj = {i: vecinos(i) for i in activos}
    grado = {i: len(v) for i, v in adj.items()}
    usadas = set()
    caminos = []

    def clave_arista(a: int, b: int) -> tuple:
        return (a, b) if a < b else (b, a)

    def a_punto(i: int) -> list:
        return [(i % w) + 0.5, (i // w) + 0.5]

    def recorrer(ini: int, sig: int):
        camino = [a_punto(ini), a_punto(sig)]
        usadas.add(clave_arista(ini, sig))
        prev, cur = ini, sig
        while grado.get(cur, 0) == 2:
            prox = -1
            for n in adj[cur]:
                if n != prev and clave_arista(cur, n) not in usadas:
                    prox = n
                    break
            if prox < 0:
                break
            usadas.add(clave_arista(cur, prox))
            camino.append(a_punto(prox))
            prev, cur = cur, prox
        caminos.append(camino)

    for i, gdo in grado.items():
        if gdo == 2:
            continue
        for n in adj[i]:
            if clave_arista(i, n) not in usadas:
                recorrer(i, n)

    for i, gdo in grado.items():
        if gdo != 2:
            continue
        for n in adj[i]:
            if clave_arista(i, n) not in usadas:
                recorrer(i, n)

    return caminos


def extraer_bordes_canny_opencv(gris: np.ndarray, op: dict) -> tuple:
    """Usa cv2.Canny con histeresis adaptada al umbral elegido y adelgazamiento a 1 px."""
    umbral = float(op.get("umbral", 128))
    # Mapear slider de umbral (10..245): mayor umbral = mas sensible a bordes suaves
    sensibilidad = np.clip((255.0 - umbral) / 255.0, 0.08, 0.92)
    t_alto = max(25.0, min(230.0, 260.0 * sensibilidad))
    t_bajo = max(10.0, t_alto * 0.42)

    bordes = cv2.Canny(gris, threshold1=t_bajo, threshold2=t_alto, L2gradient=True)
    mascara = (bordes > 0).astype(np.uint8)

    area_min = max(1, int(round(float(op.get("areaMinPx", 0)))))
    if area_min > 1:
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mascara, connectivity=8)
        for lbl in range(1, num_labels):
            if stats[lbl, cv2.CC_STAT_AREA] < area_min:
                mascara[labels == lbl] = 0

    esq = adelgazar_zhang_suen(mascara)
    return trazar_esqueleto(esq), esq


def extraer_boceto_xdog_opencv(gris: np.ndarray, op: dict) -> tuple:
    """
    Algoritmo XDoG (Extended Difference of Gaussians) con OpenCV:
    Extrae lineas de boceto artistico resaltando contornos y pliegues tonales.
    """
    flt = gris.astype(np.float32) / 255.0
    g1 = cv2.GaussianBlur(flt, (0, 0), sigmaX=0.8)
    g2 = cv2.GaussianBlur(flt, (0, 0), sigmaX=1.6 * 1.6)
    tau = 0.98
    phi = 10.0
    eps = -0.02 + ((float(op.get("umbral", 128)) - 128.0) / 255.0) * 0.15
    u = (1.0 + tau) * g1 - tau * g2
    xdog = np.where(u >= eps, 1.0, 1.0 + np.tanh(phi * (u - eps)))
    mascara = (xdog < 0.65).astype(np.uint8)

    area_min = max(2, int(round(float(op.get("areaMinPx", 2)))))
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mascara, connectivity=8)
    for lbl in range(1, num_labels):
        if stats[lbl, cv2.CC_STAT_AREA] < area_min:
            mascara[labels == lbl] = 0

    esq = adelgazar_zhang_suen(mascara)
    return trazar_esqueleto(esq), mascara


def extraer_contornos_opencv(mascara: np.ndarray) -> list:
    """
    Equivalente a LaserGRBL Vectorize! usando cv2.findContours (jerarquia completa
    de bordes exteriores e interiores).
    """
    bin255 = (mascara * 255).astype(np.uint8)
    contornos, _ = cv2.findContours(bin255, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    trazos = []
    for cnt in contornos:
        if len(cnt) < 3:
            continue
        pts = [[float(p[0][0]) + 0.5, float(p[0][1]) + 0.5] for p in cnt]
        if pts[0] != pts[-1]:
            pts.append([pts[0][0], pts[0][1]])
        trazos.append(pts)
    return trazos


def trazar_line2line(mascara: np.ndarray, espaciado_px: float, angulo_grados: float) -> list:
    """
    LaserGRBL Line-to-Line Tracing:
    Escanea la mascara activa en lineas paralelas con angulo configurable (0, 45, 90, 135 deg)
    alternando el sentido en zig-zag (serpentina) para minimizar viajes en vacio.
    """
    h, w = mascara.shape[:2]
    ang = math.radians(angulo_grados)
    dx, dy = math.cos(ang), math.sin(ang)
    nx, ny = -dy, dx
    cx, cy = w / 2.0, h / 2.0
    D = math.hypot(w, h) / 2.0 + 2.0
    paso_u = 0.5
    paso_t = max(0.75, float(espaciado_px))

    lineas = []
    fila = 0
    t = -D
    while t <= D:
        tramos = []
        dentro = False
        u_ini = 0.0
        u = -D
        while u <= D + paso_u:
            x = cx + t * nx + u * dx
            y = cy + t * ny + u * dy
            xi, yi = int(math.floor(x)), int(math.floor(y))
            v = mascara[yi, xi] if (0 <= xi < w and 0 <= yi < h) else 0
            if v and not dentro:
                dentro = True
                u_ini = u
            elif not v and dentro:
                dentro = False
                u_fin = u - paso_u
                if u_fin - u_ini >= 0.5:
                    tramos.append([
                        [cx + t * nx + u_ini * dx, cy + t * ny + u_ini * dy],
                        [cx + t * nx + u_fin * dx, cy + t * ny + u_fin * dy],
                    ])
            u += paso_u
        if fila % 2 == 1:
            tramos.reverse()
            for tr in tramos:
                tr.reverse()
        lineas.extend(tramos)
        fila += 1
        t += paso_t
    return lineas


def trazar_crosshatch_tonal(gris: np.ndarray, op: dict) -> tuple:
    """
    Sombreado Cruzado Multicapa (Cross-Hatch Tonal):
    Divide la escala de grises en 3 niveles de oscuridad y aplica barridos cruzados
    progresivos (45 deg para grises medios, 135 deg para sombras, 0 deg para negros profundos).
    """
    umbral = float(op.get("umbral", 128))
    esp = max(0.8, float(op.get("espaciadoPx", 2.0)))
    ang_base = float(op.get("anguloRelleno", 45.0))

    m_claro = (gris < min(245.0, umbral * 1.15)).astype(np.uint8)
    m_medio = (gris < umbral * 0.78).astype(np.uint8)
    m_oscuro = (gris < umbral * 0.42).astype(np.uint8)

    trazos = []
    trazos.extend(trazar_line2line(m_claro, esp * 1.35, ang_base))
    trazos.extend(trazar_line2line(m_medio, esp * 1.1, (ang_base + 90.0) % 180.0))
    trazos.extend(trazar_line2line(m_oscuro, esp * 0.95, 0.0))
    return trazos, m_claro


def trazar_raster_modulacion_linea(gris: np.ndarray, op: dict) -> tuple:
    """
    Raster Engraving con Modulacion de Potencia por Lineas (PWM por tramo):
    Escanea la imagen en lineas paralelas (0, 45, 90, 135 deg) en modo bidireccional
    (serpentina) o unidireccional, cuantizando la oscuridad con correccion Gamma en
    niveles de potencia (potenciaMinPct..potenciaMaxPct). Agrupa tramos contiguos
    de igual potencia en segmentos [x_fin, y_fin, pct_potencia].
    """
    h, w = gris.shape[:2]
    umbral_blanco = float(np.clip(float(op.get("umbral", 220)), 10.0, 250.0))
    p_min = float(np.clip(float(op.get("potenciaMinPct", 12.0)), 0.0, 95.0))
    p_max = float(np.clip(float(op.get("potenciaMaxPct", 85.0)), max(5.0, p_min + 1.0), 100.0))
    niveles = int(np.clip(round(float(op.get("nivelesPwm", 16))), 2, 64))
    gamma = float(np.clip(float(op.get("gamma", 1.0)), 0.3, 2.5))
    espaciado_px = max(0.75, float(op.get("espaciadoPx", 1.5)))
    angulo_grados = float(op.get("anguloRelleno", 0.0))
    direccion = str(op.get("direccionRaster", "bidireccional")).lower()
    salto_blanco_px = max(0.0, float(op.get("saltoBlancoPx", 3.0)))

    # Mapa precalculado de potencia (%) y mascara tonal (0 o 2..255) para vista previa
    g_flt = gris.astype(np.float32)
    activos = g_flt < umbral_blanco
    osc = np.clip((umbral_blanco - g_flt) / max(1.0, umbral_blanco), 0.0, 1.0)
    if abs(gamma - 1.0) > 1e-3:
        osc = np.power(osc, gamma)
    q_idx = np.round(osc * (niveles - 1)) / max(1, niveles - 1)
    pwr_map = np.where(activos, np.round(p_min + q_idx * (p_max - p_min), 1), 0.0).astype(np.float32)

    mascara_tonal = np.zeros((h, w), dtype=np.uint8)
    mascara_tonal[activos] = np.clip(np.round(q_idx[activos] * 255.0), 2, 255).astype(np.uint8)

    ang = math.radians(angulo_grados)
    dx, dy = math.cos(ang), math.sin(ang)
    nx, ny = -dy, dx
    cx, cy = w / 2.0, h / 2.0
    D = math.hypot(w, h) / 2.0 + 2.0
    paso_u = 0.5

    trazos = []
    fila = 0
    t = -D
    while t <= D:
        runs = []
        run_act_pwr = None
        run_u_ini = 0.0

        u = -D
        while u <= D + paso_u:
            x = cx + t * nx + u * dx
            y = cy + t * ny + u * dy
            xi, yi = int(math.floor(x)), int(math.floor(y))
            pwr = float(pwr_map[yi, xi]) if (0 <= xi < w and 0 <= yi < h) else 0.0

            if run_act_pwr is None:
                run_act_pwr = pwr
                run_u_ini = u
            elif abs(pwr - run_act_pwr) > 0.05:
                runs.append([run_u_ini, u, run_act_pwr])
                run_act_pwr = pwr
                run_u_ini = u
            u += paso_u

        if run_act_pwr is not None and run_act_pwr > 0.05:
            runs.append([run_u_ini, u, run_act_pwr])

        # Recortar blancos iniciales y finales de la linea de escaneo
        while runs and runs[0][2] <= 0.05:
            runs.pop(0)
        while runs and runs[-1][2] <= 0.05:
            runs.pop()

        if runs:
            if direccion == "bidireccional" and (fila % 2 == 1):
                runs = [[r[1], r[0], r[2]] for r in reversed(runs)]

            poly_actual = None
            for u0, u1, pwr_seg in runs:
                p_ini = [cx + t * nx + u0 * dx, cy + t * ny + u0 * dy]
                p_fin = [cx + t * nx + u1 * dx, cy + t * ny + u1 * dy]
                largo_u = abs(u1 - u0)

                if pwr_seg <= 0.05:
                    # Hueco blanco interno dentro de la misma linea
                    if poly_actual is not None and largo_u <= salto_blanco_px:
                        poly_actual.append([p_fin[0], p_fin[1], 0.0])
                    else:
                        if poly_actual is not None and len(poly_actual) >= 2:
                            trazos.append(poly_actual)
                        poly_actual = None
                else:
                    if poly_actual is None:
                        poly_actual = [p_ini, [p_fin[0], p_fin[1], pwr_seg]]
                    else:
                        poly_actual.append([p_fin[0], p_fin[1], pwr_seg])

            if poly_actual is not None and len(poly_actual) >= 2:
                trazos.append(poly_actual)

        fila += 1
        t += espaciado_px

    return trazos, mascara_tonal


# ---------------------------------------------------------------------------
# 3. LASERGRBL 1-BIT B&W DITHERING (DIFUSION DE ERROR Y MATRICES)
# ---------------------------------------------------------------------------
MATRICES_DITHERING = {
    "atkinson": (
        8.0,
        [(1, 0, 1), (2, 0, 1), (-1, 1, 1), (0, 1, 1), (1, 1, 1), (0, 2, 1)],
    ),
    "floyd_steinberg": (
        16.0,
        [(1, 0, 7), (-1, 1, 3), (0, 1, 5), (1, 1, 1)],
    ),
    "stucki": (
        42.0,
        [
            (1, 0, 8), (2, 0, 4),
            (-2, 1, 2), (-1, 1, 4), (0, 1, 8), (1, 1, 4), (2, 1, 2),
            (-2, 2, 1), (-1, 2, 2), (0, 2, 4), (1, 2, 2), (2, 2, 1),
        ],
    ),
    "jarvis": (
        48.0,
        [
            (1, 0, 7), (2, 0, 5),
            (-2, 1, 3), (-1, 1, 5), (0, 1, 7), (1, 1, 5), (2, 1, 3),
            (-2, 2, 1), (-1, 2, 3), (0, 2, 5), (1, 2, 3), (2, 2, 1),
        ],
    ),
    "sierra": (
        32.0,
        [
            (1, 0, 5), (2, 0, 3),
            (-2, 1, 2), (-1, 1, 4), (0, 1, 5), (1, 1, 4), (2, 1, 2),
            (-1, 2, 2), (0, 2, 3), (1, 2, 2),
        ],
    ),
}

BAYER_4X4 = (
    np.array(
        [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]],
        dtype=np.float32,
    )
    + 0.5
) * (255.0 / 16.0)


def aplicar_dithering_lasergrbl(gris: np.ndarray, op: dict) -> tuple:
    """
    Aplica el algoritmo 1-Bit B&W Dithering seleccionado (Atkinson, Floyd-Steinberg,
    Stucki, Jarvis, Sierra o Bayer) y agrupa los pixeles oscuros contiguos en
    segmentos horizontales corridos en serpentina.
    """
    h, w = gris.shape[:2]
    umbral = float(op.get("umbral", 128))
    alg = str(op.get("ditheringAlg", "atkinson")).lower()
    paso_fila = max(1, int(round(float(op.get("espaciadoPx", 1.5)))))

    if alg == "bayer":
        tiled = np.tile(BAYER_4X4, (h // 4 + 1, w // 4 + 1))[:h, :w]
        ajuste = gris.astype(np.float32) + (128.0 - umbral)
        mascara = (ajuste < tiled).astype(np.uint8)
    else:
        div, vecinos = MATRICES_DITHERING.get(alg, MATRICES_DITHERING["atkinson"])
        buf = gris.astype(np.float32).copy()
        mascara = np.zeros((h, w), dtype=np.uint8)
        for y in range(h):
            serp = (y % 2 == 1)
            xs = range(w - 1, -1, -1) if serp else range(w)
            dir_x = -1 if serp else 1
            for x in xs:
                viejo = buf[y, x]
                nuevo = 0.0 if viejo < umbral else 255.0
                if nuevo == 0.0:
                    mascara[y, x] = 1
                err = (viejo - nuevo) / div
                for dx, dy, peso in vecinos:
                    nx = x + dx * dir_x
                    ny = y + dy
                    if 0 <= nx < w and 0 <= ny < h:
                        buf[ny, nx] += err * peso

    # Convertir filas de la mascara 1-bit en segmentos corridos en zig-zag
    trazos = []
    fila_idx = 0
    for y in range(0, h, paso_fila):
        fila = mascara[y]
        tramos = []
        x = 0
        while x < w:
            if fila[x]:
                x_ini = x
                while x + 1 < w and fila[x + 1]:
                    x += 1
                x_fin = x
                y_c = y + 0.5
                if x_fin > x_ini:
                    tramos.append([[x_ini + 0.2, y_c], [x_fin + 0.8, y_c]])
                else:
                    # Micro-trazo para un punto individual de dithering
                    tramos.append([[x_ini + 0.2, y_c], [x_ini + 0.8, y_c]])
            x += 1
        if fila_idx % 2 == 1:
            tramos.reverse()
            for tr in tramos:
                tr.reverse()
        trazos.extend(tramos)
        fila_idx += 1

    return trazos, mascara


# ---------------------------------------------------------------------------
# 4. SUAVIZADO CHAIKIN (POTRACE SMOOTHING), DOUGLAS-PEUCKER Y OPTIMIZACION TSP
# ---------------------------------------------------------------------------
def suavizar_chaikin(pts: list, iteraciones: int) -> list:
    """Suavizado de esquinas de Chaikin (equivalente a Smoothing en LaserGRBL Vectorize!)."""
    if iteraciones <= 0 or len(pts) < 3:
        return pts
    cerrado = math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 1.5
    cur = pts
    for _ in range(min(3, iteraciones)):
        if len(cur) < 3:
            break
        nuevos = [] if cerrado else [cur[0]]
        limite = len(cur) - 1
        for i in range(limite):
            p0, p1 = cur[i], cur[i + 1]
            q = [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]]
            r = [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]]
            nuevos.extend([q, r])
        if cerrado:
            nuevos.append(nuevos[0])
        else:
            nuevos.append(cur[-1])
        cur = nuevos
    return cur


def simplificar_opencv(pts: list, tol_px: float) -> list:
    """Simplificacion poligonal con cv2.approxPolyDP (Ramer-Douglas-Peucker en C++)."""
    if len(pts) <= 2 or tol_px <= 0:
        return pts
    arr = np.array(pts, dtype=np.float32).reshape((-1, 1, 2))
    approx = cv2.approxPolyDP(arr, epsilon=float(tol_px), closed=False)
    res = [[float(p[0][0]), float(p[0][1])] for p in approx]
    return res if len(res) >= 2 else [pts[0], pts[-1]]


def longitud_trazo(pts: list) -> float:
    L = 0.0
    for i in range(1, len(pts)):
        L += math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    return L


def ordenar_cercano(trazos: list, alto_px: int) -> list:
    """Ordena los trazos por vecino mas cercano empezando desde la esquina inferior izquierda (Home 0,0)."""
    if len(trazos) <= 1:
        return trazos
    restantes = list(trazos)
    salida = []
    px, py = 0.0, float(alto_px)
    while restantes:
        mejor_i = 0
        mejor_d = float("inf")
        inv = False
        for i, t in enumerate(restantes):
            a = t[0]
            b = t[-1]
            da = (a[0] - px) ** 2 + (a[1] - py) ** 2
            db = (b[0] - px) ** 2 + (b[1] - py) ** 2
            if da < mejor_d:
                mejor_d = da
                mejor_i = i
                inv = False
            if db < mejor_d:
                mejor_d = db
                mejor_i = i
                inv = True
        elegido = restantes.pop(mejor_i)
        if inv:
            elegido = list(reversed(elegido))
        salida.append(elegido)
        px, py = elegido[-1][0], elegido[-1][1]
    return salida


def unir_cercanos(trazos: list, dist_max: float) -> list:
    if dist_max <= 0 or len(trazos) < 2:
        return trazos
    res = [list(trazos[0])]
    for t in trazos[1:]:
        ult = res[-1]
        if math.hypot(ult[-1][0] - t[0][0], ult[-1][1] - t[0][1]) <= dist_max:
            ult.extend(t[1:])
        else:
            res.append(list(t))
    return res


def mascara_a_png_base64(mascara: np.ndarray) -> str:
    """Codifica la mascara binaria (1 = negro) o tonal (2..255 = alpha) como data URL PNG para la vista previa."""
    h, w = mascara.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    if np.max(mascara) > 1:
        rgba[:, :, 3] = mascara.astype(np.uint8)
    else:
        activos = mascara > 0
        rgba[activos, 3] = 255
    pil_mask = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    pil_mask.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


# ---------------------------------------------------------------------------
# 5. FUNCION PRINCIPAL DE PROCESAMIENTO OPENCV + LASERGRBL
# ---------------------------------------------------------------------------
def procesar_imagen_opencv(data_url: str, op: dict) -> dict:
    t0 = time.perf_counter()
    res_px = int(np.clip(float(op.get("resolucionPx", 400)), 48, 1000))
    gris_base = decodificar_imagen_base64(data_url, max_lado_px=res_px)
    gris = preprocesar_gris(gris_base, op)
    h, w = gris.shape[:2]

    modo = str(op.get("modo", "centro")).lower()
    suavizado_curvas = int(op.get("suavizadoCurvas", 1))
    es_tramado = modo in ("dithering", "line2line", "crosshatch", "raster_pwm")

    if modo == "canny":
        trazos, mascara = extraer_bordes_canny_opencv(gris, op)
    elif modo == "xdog":
        trazos, mascara = extraer_boceto_xdog_opencv(gris, op)
    elif modo == "dithering":
        trazos, mascara = aplicar_dithering_lasergrbl(gris, op)
    elif modo == "crosshatch":
        trazos, mascara = trazar_crosshatch_tonal(gris, op)
    elif modo == "raster_pwm":
        trazos, mascara = trazar_raster_modulacion_linea(gris, op)
    else:
        mascara = binarizar_opencv(gris, op)
        if modo == "centro":
            esq = adelgazar_zhang_suen(mascara)
            trazos = trazar_esqueleto(esq)
        elif modo == "contorno":
            trazos = extraer_contornos_opencv(mascara)
        elif modo in ("relleno", "line2line"):
            trazos = trazar_line2line(
                mascara,
                float(op.get("espaciadoPx", 2.0)),
                float(op.get("anguloRelleno", 45.0)),
            )
        elif modo == "contorno_relleno":
            trazos = extraer_contornos_opencv(mascara) + trazar_line2line(
                mascara,
                float(op.get("espaciadoPx", 2.0)),
                float(op.get("anguloRelleno", 45.0)),
            )
        else:
            esq = adelgazar_zhang_suen(mascara)
            trazos = trazar_esqueleto(esq)

    sin_simplificar = modo in ("dithering", "raster_pwm")
    tol_simp = 0.0 if sin_simplificar else float(op.get("simplificarPx", 0.8))
    long_min = 0.0 if sin_simplificar else float(op.get("longitudMinPx", 1.5))

    procesados = []
    for t in trazos:
        if len(t) < 2:
            continue
        if not es_tramado and suavizado_curvas > 0 and len(t) >= 4:
            t = suavizar_chaikin(t, suavizado_curvas)
        if tol_simp > 0 and len(t) > 2:
            t = simplificar_opencv(t, tol_simp)
        if len(t) >= 2 and (sin_simplificar or longitud_trazo(t) >= long_min):
            procesados.append([
                [round(p[0], 2), round(p[1], 2), round(p[2], 1)] if len(p) > 2 else [round(p[0], 2), round(p[1], 2)]
                for p in t
            ])

    if op.get("optimizarOrden", True) and not sin_simplificar:
        procesados = ordenar_cercano(procesados, h)

    unir_px = 0.0 if modo == "raster_pwm" else float(op.get("unirPx", 0.0))
    if unir_px > 0:
        procesados = unir_cercanos(procesados, unir_px)

    total_puntos = sum(len(t) for t in procesados)
    ms = int(round((time.perf_counter() - t0) * 1000))

    return {
        "ok": True,
        "motor": f"OpenCV {cv2.__version__} + LaserGRBL",
        "trazos": procesados,
        "anchoPx": int(w),
        "altoPx": int(h),
        "puntos": int(total_puntos),
        "mascaraDataUrl": mascara_a_png_base64(mascara),
        "ms": ms,
    }
