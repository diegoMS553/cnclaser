"""
Modulo de Calibracion de Trazos y Autoajuste de Perfiles de Material para CNC Laser 5W.

Provee:
1. Normalizacion y contrato de datos enriquecido para perfiles de material laser
   (parametros nucleares y parametros geometricos derivados).
2. Generador de Hoja de Calibracion Compacta 4x4 (<= 40 x 40 mm, 16 cuadrantes)
   con geometria especializada por celda (tramo H con aceleracion previa, tramo V,
   vertice 90 deg, diagonal 45 deg, arco/semicirculo y par paralelo a 0.4 mm).
3. Calculo de factor de correccion de densidad energetica global K_cal para
   autoajuste proporcional del resto de materiales dentro de limites seguros.
"""

import copy
import math

VEL_MIN_SEGURA_HZ = 50
VEL_MAX_SEGURA_HZ = 450
POT_MIN_SEGURA_PCT = 15.0
POT_MAX_SEGURA_PCT = 95.0


def normalizar_preset_material(clave, datos):
    """
    Garantiza que un perfil de material contenga el esquema enriquecido completo
    (parametros_nucleares + parametros_geometricos_derivados) y mantiene claves
    planas sincronizadas para compatibilidad con la interfaz existente.
    """
    src = copy.deepcopy(datos or {})
    pn = dict(src.get("parametros_nucleares") or {})
    pg = dict(src.get("parametros_geometricos_derivados") or {})

    potencia_pct = float(pn.get("potencia_pct", src.get("potencia_pct", 65.0)))
    potencia_pct = round(max(1.0, min(100.0, potencia_pct)), 1)

    vel_grab = int(round(float(pn.get("velocidad_grabado_hz", src.get("velocidad_grabado_hz", 180)))))
    vel_grab = max(VEL_MIN_SEGURA_HZ, min(VEL_MAX_SEGURA_HZ, vel_grab))

    vel_viaje = int(round(float(pn.get("velocidad_viaje_hz", src.get("velocidad_viaje_hz", 500)))))
    vel_viaje = max(100, min(800, vel_viaje))

    retraso_paso_us = int(round(1000000.0 / float(vel_grab)))
    retraso_ignicion_ms = int(round(float(pn.get("retraso_ignicion_ms", src.get("retraso_ignicion_ms", 25)))))
    retraso_ignicion_ms = max(0, min(200, retraso_ignicion_ms))

    retraso_corte_ms = int(round(float(pn.get("retraso_corte_ms", src.get("retraso_corte_ms", 1)))))
    retraso_corte_ms = max(0, min(50, retraso_corte_ms))

    spot_kerf_mm = round(max(0.05, min(0.80, float(pg.get("spot_kerf_mm", src.get("spot_mm", 0.15))))), 3)
    balance_xy = round(max(-35.0, min(35.0, float(pg.get("balance_anisotropia_xy_pct", src.get("balance_haz_xy_pct", 0.0))))), 1)
    factor_esquina_min = round(max(0.70, min(1.00, float(pg.get("factor_esquina_min", src.get("factor_esquina_min", 0.72))))), 2)
    radio_anti_sangrado = round(max(0.20, min(2.50, float(pg.get("radio_anti_sangrado_mm", src.get("radio_anti_sangrado_mm", 0.65))))), 2)
    z_offset_foco = int(round(float(pg.get("z_offset_foco_pulsos", src.get("z_offset_foco_pulsos", 0)))))
    pasadas = max(1, min(20, int(round(float(pg.get("pasadas", src.get("pasadas", 1)))))))
    z_paso_pasada = int(round(float(pg.get("z_paso_por_pasada_pulsos", src.get("z_paso_pasada_pulsos", 0)))))

    return {
        "id_material": str(src.get("id_material") or clave),
        "nombre": str(src.get("nombre") or clave),
        "descripcion": str(src.get("descripcion") or ""),
        "modo_operacion": str(src.get("modo_operacion") or "grabado_linea"),
        "parametros_nucleares": {
            "potencia_pct": potencia_pct,
            "velocidad_grabado_hz": vel_grab,
            "velocidad_viaje_hz": vel_viaje,
            "retraso_paso_us": retraso_paso_us,
            "retraso_ignicion_ms": retraso_ignicion_ms,
            "retraso_corte_ms": retraso_corte_ms
        },
        "parametros_geometricos_derivados": {
            "spot_kerf_mm": spot_kerf_mm,
            "balance_anisotropia_xy_pct": balance_xy,
            "factor_esquina_min": factor_esquina_min,
            "radio_anti_sangrado_mm": radio_anti_sangrado,
            "z_offset_foco_pulsos": z_offset_foco,
            "pasadas": pasadas,
            "z_paso_por_pasada_pulsos": z_paso_pasada
        },
        # Claves planas sincronizadas para compatibilidad directa
        "potencia_pct": potencia_pct,
        "velocidad_grabado_hz": vel_grab,
        "velocidad_viaje_hz": vel_viaje,
        "retraso_paso_us": retraso_paso_us,
        "retraso_ignicion_ms": retraso_ignicion_ms,
        "retraso_corte_ms": retraso_corte_ms,
        "pasadas": pasadas,
        "spot_mm": spot_kerf_mm,
        "balance_haz_xy_pct": balance_xy,
        "factor_esquina_min": factor_esquina_min,
        "radio_anti_sangrado_mm": radio_anti_sangrado,
        "z_offset_foco_pulsos": z_offset_foco,
        "z_paso_pasada_pulsos": z_paso_pasada
    }


def _generar_geometria_cuadrante(cx, cy, celda_tam_mm=8.5):
    """
    Construye la geometria especializada para una celda de (celda_tam_mm x celda_tam_mm)
    anclada en (cx, cy), escalando proporcionalmente los trazos segun el tamano total
    del plano configurado. Mantiene separacion abierta y legible en el par paralelo
    para evitar que se fusione o parezca una figura cerrada en matrices compactas.
    """
    trazos = []
    s = float(celda_tam_mm) / 8.5

    # 1. Tramo H (con aproximacion previa 0W) + Vertice 90 deg + Tramo V + Diagonal 45 deg
    trazos.append({
        "tipo": "h_v_diag",
        "pre_aprox": [round(cx + 0.1 * s, 3), round(cy + 7.7 * s, 3)],
        "puntos": [
            [round(cx + 0.6 * s, 3), round(cy + 7.7 * s, 3)],
            [round(cx + 7.8 * s, 3), round(cy + 7.7 * s, 3)],  # Horizontal
            [round(cx + 7.8 * s, 3), round(cy + 4.5 * s, 3)],  # Vertice 90 deg + Vertical
            [round(cx + 5.0 * s, 3), round(cy + 1.7 * s, 3)]   # Diagonal 45 deg
        ]
    })

    # 2. Arco / semicirculo abierto (12 segmentos suaves) con holgura respecto a otros trazos
    centro_x = cx + 2.5 * s
    centro_y = cy + 4.3 * s
    radio = 1.55 * s
    pasos_arco = 12
    pts_arco = []
    for k in range(pasos_arco + 1):
        ang = math.pi * (float(k) / float(pasos_arco))
        px = centro_x + radio * math.cos(ang)
        py = centro_y + radio * math.sin(ang)
        pts_arco.append([round(px, 3), round(py, 3)])
    trazos.append({
        "tipo": "arco_curva",
        "pre_aprox": None,
        "puntos": pts_arco
    })

    # 3. Par de lineas paralelas abiertas con separacion proporcional segura (min 0.85 mm)
    #    para evaluar kerf y halo termico sin cerrarse ni fusionarse por pre-ignicion
    sep_paralelas_mm = round(max(0.85, 0.95 * s), 3)
    y_par_inf = cy + 0.9 * s
    y_par_sup = min(cy + 3.5 * s, y_par_inf + sep_paralelas_mm)
    trazos.append({
        "tipo": "paralela_inferior",
        "pre_aprox": None,
        "puntos": [
            [round(cx + 0.6 * s, 3), round(y_par_inf, 3)],
            [round(cx + 4.0 * s, 3), round(y_par_inf, 3)]
        ]
    })
    trazos.append({
        "tipo": "paralela_superior",
        "pre_aprox": None,
        "puntos": [
            [round(cx + 0.6 * s, 3), round(y_par_sup, 3)],
            [round(cx + 4.0 * s, 3), round(y_par_sup, 3)]
        ]
    })

    return trazos


def generar_matriz_calibracion_4x4(preset_material, origen_x_mm, origen_y_mm, tamano_plano_mm=40.0):
    """
    Genera la Hoja de Calibracion 4x4 con tamano total configurable en el plano
    (tamano_plano_mm x tamano_plano_mm, rango 20..250 mm, por defecto 40 mm)
    dividida en 16 cuadrantes numerados del 1 al 16.

    - Columnas (0..3): Potencia centrada en potencia_pct (-15%, -5%, +5%, +15%),
      acotada estrictamente en [15%, 95%].
    - Filas (0..3): Velocidad centrada en velocidad_grabado_hz (-30%, -10%, +10%, +30%),
      acotada estrictamente en [50 Hz, 450 Hz].
    """
    norm = normalizar_preset_material(
        preset_material.get("id_material", "material"),
        preset_material
    )
    pn = norm["parametros_nucleares"]
    pot_base = float(pn["potencia_pct"])
    vel_base = float(pn["velocidad_grabado_hz"])
    vel_viaje = int(pn["velocidad_viaje_hz"])
    retraso_ign_ms = int(pn["retraso_ignicion_ms"])
    retraso_corte_ms = int(pn["retraso_corte_ms"])

    deltas_pot = (-15.0, -5.0, 5.0, 15.0)
    factores_vel = (0.70, 0.90, 1.10, 1.30)

    plano_mm = round(max(20.0, min(250.0, float(tamano_plano_mm or 40.0))), 2)
    gap_mm = round(max(1.0, plano_mm * 0.04), 3)
    celda_tam_mm = round((plano_mm - 3.0 * gap_mm) / 4.0, 3)
    paso_mm = round(celda_tam_mm + gap_mm, 3)
    ancho_total_mm = round(3.0 * paso_mm + celda_tam_mm, 2)
    alto_total_mm = round(3.0 * paso_mm + celda_tam_mm, 2)

    celdas = []
    resumen_tabla = []

    num_celda = 1
    for fila in range(4):
        vel_hz = int(round(vel_base * factores_vel[fila]))
        vel_hz = max(VEL_MIN_SEGURA_HZ, min(VEL_MAX_SEGURA_HZ, vel_hz))
        retraso_paso_us = int(round(1000000.0 / float(vel_hz)))

        # Fila 0 abajo (menor velocidad) -> Fila 3 arriba (mayor velocidad)
        cy = float(origen_y_mm) + fila * paso_mm

        for col in range(4):
            pot_pct = round(max(POT_MIN_SEGURA_PCT, min(POT_MAX_SEGURA_PCT, pot_base + deltas_pot[col])), 1)
            pwm_val = max(1, min(255, int(round((pot_pct / 100.0) * 255.0))))
            cx = float(origen_x_mm) + col * paso_mm

            trazos = _generar_geometria_cuadrante(cx, cy, celda_tam_mm)

            meta = {
                "celda": num_celda,
                "fila": fila,
                "columna": col,
                "potencia_pct": pot_pct,
                "potencia_pwm": pwm_val,
                "velocidad_grabado_hz": vel_hz,
                "velocidad_viaje_hz": vel_viaje,
                "retraso_paso_us": retraso_paso_us,
                "retraso_ignicion_ms": retraso_ign_ms,
                "retraso_corte_ms": retraso_corte_ms,
                "origen_x_mm": round(cx, 3),
                "origen_y_mm": round(cy, 3)
            }
            resumen_tabla.append(meta)

            celda_completa = dict(meta)
            celda_completa["trazos"] = trazos
            celdas.append(celda_completa)
            num_celda += 1

    return {
        "id_material": norm["id_material"],
        "nombre_material": norm["nombre"],
        "area_mm": {
            "origen_x": round(float(origen_x_mm), 3),
            "origen_y": round(float(origen_y_mm), 3),
            "tamano_plano_mm": plano_mm,
            "ancho": ancho_total_mm,
            "alto": alto_total_mm,
            "celda_mm": round(celda_tam_mm, 2),
            "separacion_mm": round(gap_mm, 2),
            "paso_mm": round(paso_mm, 2),
            "separacion_paralelas_mm": round(max(0.85, 0.95 * (celda_tam_mm / 8.5)), 2)
        },
        "celdas": celdas,
        "tabla_celdas": resumen_tabla
    }


def aplicar_factor_global_materiales(presets_dict, id_material_origen, p_anterior, v_anterior, p_nueva, v_nueva):
    """
    Calcula el factor de correccion de densidad energetica:
        K_cal = (P_nueva / V_nueva) / (P_anterior / V_anterior)

    Reescala proporcionalmente velocidad_grabado_hz (y su retraso_paso_us) en
    el resto de los perfiles de material respetando el rango seguro [50, 450] Hz.
    Si la velocidad resultante cae por debajo de 50 Hz, acota a 50 Hz y aumenta
    el numero de pasadas automaticamente para compensar la energia requerida.
    """
    e_ant = max(1e-6, float(p_anterior) / max(1.0, float(v_anterior)))
    e_nva = max(1e-6, float(p_nueva) / max(1.0, float(v_nueva)))
    k_cal = e_nva / e_ant
    k_cal = max(0.35, min(3.0, k_cal))

    ajustes = []
    for clave, pr_raw in presets_dict.items():
        if clave == id_material_origen:
            continue
        pr = normalizar_preset_material(clave, pr_raw)
        pn = pr["parametros_nucleares"]
        pg = pr["parametros_geometricos_derivados"]

        v_orig = float(pn["velocidad_grabado_hz"])
        p_orig = float(pn["potencia_pct"])
        pasadas_orig = int(pg["pasadas"])

        v_teorica = v_orig / k_cal
        nuevas_pasadas = pasadas_orig

        if v_teorica < VEL_MIN_SEGURA_HZ:
            v_final = VEL_MIN_SEGURA_HZ
            ratio_faltante = VEL_MIN_SEGURA_HZ / max(1.0, v_teorica)
            nuevas_pasadas = max(pasadas_orig + 1, int(math.ceil(pasadas_orig * ratio_faltante)))
            nuevas_pasadas = min(10, nuevas_pasadas)
        elif v_teorica > VEL_MAX_SEGURA_HZ:
            v_final = VEL_MAX_SEGURA_HZ
        else:
            v_final = int(round(v_teorica))

        pn["velocidad_grabado_hz"] = v_final
        pn["retraso_paso_us"] = int(round(1000000.0 / float(v_final)))
        pg["pasadas"] = nuevas_pasadas

        presets_dict[clave] = normalizar_preset_material(clave, pr)
        ajustes.append({
            "id_material": clave,
            "potencia_pct": p_orig,
            "velocidad_anterior_hz": int(v_orig),
            "velocidad_nueva_hz": v_final,
            "pasadas_anterior": pasadas_orig,
            "pasadas_nueva": nuevas_pasadas
        })

    return round(k_cal, 4), ajustes
