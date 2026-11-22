import os
import re
import math
import json
import time
import threading
import webbrowser
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response
from opencv_lasergrbl import procesar_imagen_opencv
import serial
import serial.tools.list_ports

app = Flask(__name__)

# --- CONFIGURACIÓN Y CARPETA DE PERFILES ---
PUERTO_DEFECTO = "COM3"
BAUD_RATE = 115200
CARPETA_PERFILES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "perfiles")
os.makedirs(CARPETA_PERFILES, exist_ok=True)

# Tabla 1: Microstep / Pulse según (S1, S2, S3) donde True = ON, False = OFF
TABLA_MICROSTEP = {
    (True, True, True):    {"microstep": "NC",  "pulse_rev": 0,    "grados_paso": 0.0},
    (True, True, False):   {"microstep": "1",   "pulse_rev": 200,  "grados_paso": 1.8},
    (True, False, True):   {"microstep": "2/A", "pulse_rev": 400,  "grados_paso": 0.9},
    (False, True, True):   {"microstep": "2/B", "pulse_rev": 400,  "grados_paso": 0.9},
    (True, False, False):  {"microstep": "4",   "pulse_rev": 800,  "grados_paso": 0.45},
    (False, True, False):  {"microstep": "8",   "pulse_rev": 1600, "grados_paso": 0.225},
    (False, False, True):  {"microstep": "16",  "pulse_rev": 3200, "grados_paso": 0.1125},
    (False, False, False): {"microstep": "32",  "pulse_rev": 6400, "grados_paso": 0.05625},
}

# Tabla 2: Current según (S4, S5, S6) donde True = ON, False = OFF
TABLA_CORRIENTE = {
    (True, True, True):    {"current_a": 0.5, "pk_current_a": 0.7},
    (True, False, True):   {"current_a": 1.0, "pk_current_a": 1.2},
    (True, True, False):   {"current_a": 1.5, "pk_current_a": 1.7},
    (True, False, False):  {"current_a": 2.0, "pk_current_a": 2.2},
    (False, True, True):   {"current_a": 2.5, "pk_current_a": 2.7},
    (False, False, True):  {"current_a": 2.8, "pk_current_a": 2.9},
    (False, True, False):  {"current_a": 3.0, "pk_current_a": 3.2},
    (False, False, False): {"current_a": 3.5, "pk_current_a": 4.0},
}

# Tabla 3: Presets de Calibración de Materiales para Módulo Láser de Diodo de 5W Ópticos
# Las frecuencias de grabado están calibradas para garantizar tiempo de exposición térmica continuo
# en cada paso del motor (sin dejar líneas punteadas ni perder pasos en los motores NEMA).
PRESETS_LASER_5W = {
    "papel_marcado": {
        "nombre": "Papel / Cartulina (Grabado Fino)",
        "descripcion": "Marcado superficial continuo de trazos y dibujo vectorial sin perforar el papel.",
        "modo_operacion": "grabado_linea",
        "potencia_pct": 35,
        "velocidad_grabado_hz": 240,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.12
    },
    "carton_grabado": {
        "nombre": "Carton Corrugado (Grabado Superficial)",
        "descripcion": "Grabado continuo de alto contraste sobre carton sin atravesar la primera capa.",
        "modo_operacion": "grabado_linea",
        "potencia_pct": 55,
        "velocidad_grabado_hz": 200,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    },
    "carton_corte": {
        "nombre": "Carton / Cartulina (Corte 5W)",
        "descripcion": "Corte vectorial en 2 pasadas con alta potencia de 5W.",
        "modo_operacion": "corte",
        "potencia_pct": 90,
        "velocidad_grabado_hz": 120,
        "velocidad_viaje_hz": 500,
        "pasadas": 2,
        "spot_mm": 0.15
    },
    "madera_grabado_fino": {
        "nombre": "Madera Balsa / Triplay Claro (Grabado)",
        "descripcion": "Grabado continuo y nitido de trazos, bocetos y texto sobre madera clara.",
        "modo_operacion": "grabado_linea",
        "potencia_pct": 65,
        "velocidad_grabado_hz": 180,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    },
    "madera_grabado_profundo": {
        "nombre": "MDF / Madera Dura (Grabado Oscuro)",
        "descripcion": "Grabado oscuro con mayor penetracion termica en MDF y pino.",
        "modo_operacion": "grabado_relleno",
        "potencia_pct": 85,
        "velocidad_grabado_hz": 130,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    },
    "madera_fotograbado": {
        "nombre": "Madera Clara (Fotograbado Dithering 5W)",
        "descripcion": "Optimizado para imagenes procesadas con Dithering, Raster PWM o Line2Line.",
        "modo_operacion": "grabado_tonal",
        "potencia_pct": 70,
        "velocidad_grabado_hz": 180,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    },
    "madera_corte_balsa_3mm": {
        "nombre": "Madera Balsa / Triplay 2-3 mm (Corte 5W)",
        "descripcion": "Corte multipaso a maxima potencia para balsa y triplay ligero.",
        "modo_operacion": "corte",
        "potencia_pct": 100,
        "velocidad_grabado_hz": 100,
        "velocidad_viaje_hz": 500,
        "pasadas": 3,
        "spot_mm": 0.15
    },
    "cuero_grabado": {
        "nombre": "Cuero / Piel Sintetica (Grabado)",
        "descripcion": "Marcado continuo y limpio en cuero natural o sintetico a potencia controlada.",
        "modo_operacion": "grabado_relleno",
        "potencia_pct": 50,
        "velocidad_grabado_hz": 200,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    },
    "acrilico_oscuro_grabado": {
        "nombre": "Acrilico Negro / Opaco (Grabado)",
        "descripcion": "Grabado superficial mate en acrilico oscuro opaco (no transparente).",
        "modo_operacion": "grabado_relleno",
        "potencia_pct": 75,
        "velocidad_grabado_hz": 150,
        "velocidad_viaje_hz": 500,
        "pasadas": 1,
        "spot_mm": 0.15
    }
}

serial_lock = threading.Lock()
puerto_serial = None

estado_maquina = {
    "pos_x": 0,
    "pos_y": 0,
    "pos_z": 0,
    "motor_real_x": 0,
    "motor_real_y": 0,
    "motor_real_z": 0,
    "posicion_sincronizada": True,
    "angulo_x": 0.0,
    "angulo_y": 0.0,
    "angulo_z": 0.0,
    "origen_fijado": True,
    "limite_fijado": True,
    "limite_max_x": 12800,
    "limite_max_y": 9600,
    "limite_max_z": 400,
    "z_home_pulsos": 0,
    "origen_z_fijado": True,
    "limite_z_fijado": True,
    "usar_z_dibujo": False,
    "firmware_b2d": True,
    "modo_herramienta": "dibujo",  # "dibujo" (Pluma/Plumon con Eje Z) o "laser" (Modulo Laser Diodo 5W PWM)
    "laser": {
        "instalado": True,
        "potencia_nominal_w": 5.0,
        "potencia_nominal_mw": 5000,
        "armado": False,
        "activo": False,
        "emitiendo": False,
        "en_foco": False,
        "modo_emision": "OFF",        # "OFF", "FOCUS", "PULSE", "WORK"
        "modo_operacion": "grabado_linea",  # "grabado_linea", "grabado_relleno", "grabado_tonal", "corte"
        "preset_material": "madera_grabado_fino",
        "material_preset": "madera_grabado_fino",
        "potencia_pct": 65.0,         # 0..100 %
        "potencia_pwm": 166,          # 0..255 (8-bit PWM)
        "potencia_watts": 3.25,       # Potencia optica efectiva estimada sobre 5.0W
        "potencia_foco_pct": 3.0,     # 1..12 % para enfoque sin quemar
        "potencia_foco_pwm": 8,
        "potencia_manual_pct": 25.0,  # 0..100 % para el panel de Control Manual del Laser 5W
        "potencia_manual_pwm": 64,
        "potencia_manual_watts": 1.25,
        "emision_manual_continua": False,
        "jog_con_laser": False,       # Si es True, al mover X/Y manualmente enciende el laser con potencia_manual_pct
        "potencia_prueba_pct": 20.0,
        "pulso_prueba_ms": 250,
        "duracion_pulso_ms": 250,
        "velocidad_grabado_hz": 180,  # Frecuencia sincronizada en pulsos/s durante quemado laser (~5.5 ms por paso)
        "velocidad_viaje_hz": 500,    # Frecuencia segura en pulsos/s en desplazamientos en vacio (0W)
        "pasadas": 1,                 # Pasadas por trazo (1..20)
        "pausa_enfriamiento_ms": 0,
        "spot_mm": 0.15,              # Diametro del punto optico enfocado (mm)
        "z_foco_pulsos": 0,           # Altura en Eje Z donde el laser de 5W tiene su punto focal optimo
        "z_foco_fijado": True,
        "usar_z_foco": False,         # Si es True, posiciona Z en z_foco_pulsos antes de iniciar el trabajo laser
        "z_paso_pasada_pulsos": 0,    # Descenso Z adicional por cada pasada en modo corte
        "compensacion_diagonal": True,# Velocidad lineal euclidiana constante en todos los angulos (evita trazos delgados a 45 deg)
        "balance_haz_xy_pct": 0.0,    # Balance entre ejes X/Y (-35..+35 %) por haz rectangular del diodo 450nm
        "proteccion_esquinas": True,  # Atenuacion termica progresiva en esquinas cerradas y trazos cercanos
        "evitar_doble_quemado": True, # Omite segmentos duplicados o superpuestos en la misma pasada
        "frecuencia_pwm_hz": 5000,
        "pwm_actual": 0,
        "watts_actuales": 0.0
    },
    "switches": {
        "S1": False,
        "S2": False,
        "S3": True,
        "S4": True,
        "S5": False,
        "S6": False
    },
    "ena": {
        "X": False,
        "Y": False,
        "Z": False,
        "modo": "AUTO",
        "polaridad": "LOW"
    },
    # En un CNC de Puente Fijo en X y Placa Movil en Y con Home (0,0) en la esquina inferior izquierda,
    # el eje Y fisico debe invertir su giro (DIR) para que Y+ suba hacia el fondo de la placa.
    "invertir_dir": {
        "X": False,
        "Y": True,
        "Z": False
    },
    # Intercambio de ejes X e Y si el cableado fisico del motor X va al driver Y y viceversa
    "intercambiar_xy": False,
    # Limites duros (hard limits) durante grabado/dibujo: desactivados por defecto para inmunidad al ruido EMI
    "hard_limits_activos": False,
    "autocalibrar_inicio": True,
    "endstops": {
        "X": True,
        "Y": True,
        "Z": False,
        "z_switch_instalado": False,
        "autohome_completado": False
    },
    "perfil_activo": "estacion_estandar_16x",
    "microstep": "16",
    "pulse_rev": 3200,
    "grados_por_pulso": 0.1125,
    "current_a": 2.0,
    "pk_current_a": 2.2,
    "reduccion_amperaje_activa": True,
    "velocidad_hz": 500,
    "mm_por_rev": 40.0,
    "pasos_por_mm": 80.0,
    "bloquear_limites": False,
    "modo_simulacion": True,
    "puerto": PUERTO_DEFECTO,
    "baud_rate": BAUD_RATE,
    "conectado": False,
    "error_puerto": None,
    "ultimo_mensaje": "Control ENA+/ENA- activo en modo AUTO: Los motores bajan a 0.0 A cuando están en reposo.",
    "historial": [[0, 0]]
}


def recalcular_metricas_laser():
    """Actualiza PWM (0..255) y Watts opticos (0.0..5.0W) a partir de potencia_pct."""
    lsr = estado_maquina["laser"]
    pct = max(0.0, min(100.0, round(float(lsr.get("potencia_pct", 35.0)), 1)))
    lsr["potencia_pct"] = pct
    lsr["potencia_pwm"] = int(round((pct / 100.0) * 255))
    lsr["potencia_watts"] = round((pct / 100.0) * float(lsr.get("potencia_nominal_w", 5.0)), 2)
    foco_pct = max(1.0, min(12.0, round(float(lsr.get("potencia_foco_pct", 3.0)), 1)))
    lsr["potencia_foco_pct"] = foco_pct
    lsr["potencia_foco_pwm"] = max(2, min(31, int(round((foco_pct / 100.0) * 255))))
    man_pct = max(0.0, min(100.0, round(float(lsr.get("potencia_manual_pct", 25.0)), 1)))
    lsr["potencia_manual_pct"] = man_pct
    lsr["potencia_manual_pwm"] = int(round((man_pct / 100.0) * 255))
    lsr["potencia_manual_watts"] = round((man_pct / 100.0) * float(lsr.get("potencia_nominal_w", 5.0)), 2)
    lsr.setdefault("emision_manual_continua", False)
    lsr.setdefault("jog_con_laser", False)
    lsr.setdefault("potencia_prueba_pct", 20.0)
    lsr.setdefault("pulso_prueba_ms", int(lsr.get("duracion_pulso_ms", 250)))
    lsr.setdefault("pausa_enfriamiento_ms", 0)
    lsr["en_foco"] = bool(lsr.get("activo") and lsr.get("modo_emision") == "FOCUS")
    lsr["emision_manual_continua"] = bool(lsr.get("activo") and lsr.get("modo_emision") == "MANUAL")
    lsr["emitiendo"] = bool(lsr.get("activo"))
    if not lsr["emitiendo"]:
        lsr["pwm_actual"] = 0
        lsr["watts_actuales"] = 0.0


def limpiar_slug_perfil(texto):
    base = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(texto).strip().lower()).strip("_")
    return base or f"perfil_{int(time.time())}"


def inicializar_perfiles_por_defecto():
    """Crea perfiles iniciales en la carpeta 'perfiles/' si aún no existen."""
    perfiles_base = [
        {
            "id": "estacion_estandar_16x",
            "nombre": "Estacion Estandar 16x (160x120 mm)",
            "descripcion": "Microstep 16 (3200 P/rev) | 2.0A | ENA AUTO | Zona 160x120 mm",
            "fecha_modificacion": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "switches": {"S1": False, "S2": False, "S3": True, "S4": True, "S5": False, "S6": False},
            "ena_modo": "AUTO",
            "velocidad_hz": 1200,
            "pasos_por_mm": 80.0,
            "mm_por_rev": 40.0,
            "limite_fijado": True,
            "limite_max_x": 12800,
            "limite_max_y": 9600,
            "limite_max_z": 3200,
            "bloquear_limites": True,
            "puerto": "COM3"
        },
        {
            "id": "alta_precision_dibujo_32x",
            "nombre": "Alta Precision Dibujo 32x (200x150 mm)",
            "descripcion": "Microstep 32 (6400 P/rev) | 1.5A | ENA AUTO | Zona 200x150 mm",
            "fecha_modificacion": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "switches": {"S1": False, "S2": False, "S3": False, "S4": True, "S5": True, "S6": False},
            "ena_modo": "AUTO",
            "velocidad_hz": 2000,
            "pasos_por_mm": 160.0,
            "mm_por_rev": 40.0,
            "limite_fijado": True,
            "limite_max_x": 32000,
            "limite_max_y": 24000,
            "limite_max_z": 6400,
            "bloquear_limites": True,
            "puerto": "COM3"
        },
        {
            "id": "torquefuerte_paso4_800",
            "nombre": "Torque Alto Paso 4 (120x100 mm)",
            "descripcion": "Microstep 4 (800 P/rev) | 2.8A | Proteccion ENA AUTO | Zona 120x100 mm",
            "fecha_modificacion": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "switches": {"S1": True, "S2": False, "S3": False, "S4": False, "S5": False, "S6": True},
            "ena_modo": "AUTO",
            "velocidad_hz": 800,
            "pasos_por_mm": 20.0,
            "mm_por_rev": 40.0,
            "limite_fijado": True,
            "limite_max_x": 2400,
            "limite_max_y": 2000,
            "limite_max_z": 800,
            "bloquear_limites": True,
            "puerto": "COM3"
        }
    ]
    archivos_actuales = [f for f in os.listdir(CARPETA_PERFILES) if f.endswith(".json")]
    if not archivos_actuales:
        for p in perfiles_base:
            ruta = os.path.join(CARPETA_PERFILES, f"{p['id']}.json")
            with open(ruta, "w", encoding="utf-8") as fh:
                json.dump(p, fh, indent=4, ensure_ascii=False)


def listar_perfiles_guardados():
    """Lee todos los archivos .json dentro de la carpeta 'perfiles/'."""
    perfiles = []
    if not os.path.exists(CARPETA_PERFILES):
        return perfiles

    for nombre_archivo in sorted(os.listdir(CARPETA_PERFILES)):
        if not nombre_archivo.endswith(".json"):
            continue
        ruta = os.path.join(CARPETA_PERFILES, nombre_archivo)
        try:
            with open(ruta, "r", encoding="utf-8") as fh:
                datos = json.load(fh)
            pid = datos.get("id") or os.path.splitext(nombre_archivo)[0]
            datos["id"] = pid
            datos["archivo"] = nombre_archivo
            perfiles.append(datos)
        except Exception:
            continue
    return perfiles


def construir_objeto_perfil(id_perfil, nombre_perfil, descripcion=""):
    escala = max(0.01, float(estado_maquina["pasos_por_mm"]))
    ancho_mm = round(abs(estado_maquina["limite_max_x"]) / escala, 1)
    alto_mm = round(abs(estado_maquina["limite_max_y"]) / escala, 1)
    if not descripcion:
        descripcion = (
            f"Microstep {estado_maquina['microstep']} ({estado_maquina['pulse_rev']} P/rev) | "
            f"{estado_maquina['current_a']}A | ENA {estado_maquina['ena']['modo']} | "
            f"Zona {ancho_mm}x{alto_mm} mm"
        )
    return {
        "id": id_perfil,
        "nombre": nombre_perfil,
        "descripcion": descripcion,
        "fecha_modificacion": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "switches": dict(estado_maquina["switches"]),
        "ena_modo": estado_maquina["ena"]["modo"],
        "invertir_dir": dict(estado_maquina["invertir_dir"]),
        "intercambiar_xy": bool(estado_maquina.get("intercambiar_xy", False)),
        "hard_limits_activos": bool(estado_maquina.get("hard_limits_activos", False)),
        "velocidad_hz": int(estado_maquina["velocidad_hz"]),
        "pasos_por_mm": float(estado_maquina["pasos_por_mm"]),
        "mm_por_rev": float(estado_maquina["mm_por_rev"]),
        "limite_fijado": bool(estado_maquina["limite_fijado"]),
        "limite_max_x": abs(int(estado_maquina["limite_max_x"])),
        "limite_max_y": abs(int(estado_maquina["limite_max_y"])),
        "limite_max_z": int(estado_maquina["limite_max_z"]),
        "z_home_pulsos": int(estado_maquina.get("z_home_pulsos", 0)),
        "origen_z_fijado": bool(estado_maquina.get("origen_z_fijado", True)),
        "limite_z_fijado": bool(estado_maquina.get("limite_z_fijado", True)),
        "usar_z_dibujo": bool(estado_maquina.get("usar_z_dibujo", False)),
        "modo_herramienta": str(estado_maquina.get("modo_herramienta", "dibujo")),
        "laser": {
            k: v for k, v in estado_maquina.get("laser", {}).items()
            if k not in ("armado", "activo", "modo_emision")
        },
        "autocalibrar_inicio": bool(estado_maquina.get("autocalibrar_inicio", True)),
        "bloquear_limites": bool(estado_maquina["bloquear_limites"]),
        "puerto": str(estado_maquina["puerto"])
    }


def aplicar_datos_perfil_a_maquina(datos):
    """Aplica un diccionario de perfil (o JSON exportado) al estado actual de la máquina."""
    # Soporte tanto para formato de perfil directo como formato de reporte exportado (/api/export)
    if "configuracion_driver_dip" in datos:
        sw_raw = datos["configuracion_driver_dip"].get("switches", {})
        for k in ("S1", "S2", "S3", "S4", "S5", "S6"):
            if k in sw_raw:
                val = sw_raw[k]
                estado_maquina["switches"][k] = (str(val).upper() == "ON") if isinstance(val, str) else bool(val)
        vel = datos["configuracion_driver_dip"].get("velocidad_operacion_hz")
        if vel:
            estado_maquina["velocidad_hz"] = max(50, min(20000, int(vel)))
        t2 = datos["configuracion_driver_dip"].get("tabla_2_current", {})
        modo_ena = t2.get("modo_enable_ena", "AUTO")
        if modo_ena in ("AUTO", "HOLD", "FREE"):
            estado_maquina["ena"]["modo"] = modo_ena
    elif "switches" in datos and isinstance(datos["switches"], dict):
        for k in ("S1", "S2", "S3", "S4", "S5", "S6"):
            if k in datos["switches"]:
                val = datos["switches"][k]
                estado_maquina["switches"][k] = (str(val).upper() == "ON") if isinstance(val, str) else bool(val)

    recalcular_driver_desde_switches(actualizar_escala=False)

    if "ena_modo" in datos and datos["ena_modo"] in ("AUTO", "HOLD", "FREE"):
        estado_maquina["ena"]["modo"] = datos["ena_modo"]

    modo_actual = estado_maquina["ena"]["modo"]
    if modo_actual in ("AUTO", "FREE"):
        estado_maquina["ena"]["X"] = False
        estado_maquina["ena"]["Y"] = False
        estado_maquina["ena"]["Z"] = False
        enviar_comando_raw_serial("ENA,MODE,AUTO" if modo_actual == "AUTO" else "ENA,ALL,0")
    else:
        estado_maquina["ena"]["X"] = True
        estado_maquina["ena"]["Y"] = True
        estado_maquina["ena"]["Z"] = True
        enviar_comando_raw_serial("ENA,MODE,HOLD")

    if "velocidad_hz" in datos:
        try:
            estado_maquina["velocidad_hz"] = max(50, min(20000, int(float(datos["velocidad_hz"]))))
            enviar_comando_raw_serial(f"SPEED,{estado_maquina['velocidad_hz']}")
        except (ValueError, TypeError):
            pass

    if "pasos_por_mm" in datos:
        try:
            val_ppm = float(datos["pasos_por_mm"])
            if val_ppm > 0:
                estado_maquina["pasos_por_mm"] = val_ppm
                if estado_maquina["pulse_rev"] > 0:
                    estado_maquina["mm_por_rev"] = round(estado_maquina["pulse_rev"] / val_ppm, 2)
        except (ValueError, TypeError):
            pass
    elif "calibracion" in datos and isinstance(datos["calibracion"], dict):
        rel = datos["calibracion"].get("relacion_pasos_por_mm")
        if rel and float(rel) > 0:
            estado_maquina["pasos_por_mm"] = float(rel)

    if "limite_fijado" in datos:
        estado_maquina["limite_fijado"] = bool(datos["limite_fijado"])
    if "limite_max_x" in datos:
        estado_maquina["limite_max_x"] = abs(int(datos["limite_max_x"]))
    if "limite_max_y" in datos:
        estado_maquina["limite_max_y"] = abs(int(datos["limite_max_y"]))
    if "limite_max_z" in datos:
        estado_maquina["limite_max_z"] = int(datos["limite_max_z"])
    if "z_home_pulsos" in datos:
        estado_maquina["z_home_pulsos"] = int(datos["z_home_pulsos"])
    if "origen_z_fijado" in datos:
        estado_maquina["origen_z_fijado"] = bool(datos["origen_z_fijado"])
    if "limite_z_fijado" in datos:
        estado_maquina["limite_z_fijado"] = bool(datos["limite_z_fijado"])
    if "usar_z_dibujo" in datos:
        estado_maquina["usar_z_dibujo"] = bool(datos["usar_z_dibujo"])
    if "modo_herramienta" in datos and datos["modo_herramienta"] in ("dibujo", "laser"):
        estado_maquina["modo_herramienta"] = datos["modo_herramienta"]
    if "laser" in datos and isinstance(datos["laser"], dict):
        for k_lsr in (
            "modo_operacion", "material_preset", "potencia_pct", "potencia_foco_pct",
            "velocidad_grabado_hz", "velocidad_viaje_hz", "pasadas", "spot_mm",
            "z_foco_pulsos", "usar_z_foco", "z_paso_pasada_pulsos", "duracion_pulso_ms",
            "compensacion_diagonal", "balance_haz_xy_pct", "proteccion_esquinas", "evitar_doble_quemado"
        ):
            if k_lsr in datos["laser"]:
                estado_maquina["laser"][k_lsr] = datos["laser"][k_lsr]
        # Migrar valores antiguos no calibrados (>= 600 Hz) que no daban tiempo de quemar
        if int(estado_maquina["laser"].get("velocidad_grabado_hz", 180)) >= 600:
            estado_maquina["laser"]["velocidad_grabado_hz"] = 180
        if int(estado_maquina["laser"].get("velocidad_viaje_hz", 500)) > 800:
            estado_maquina["laser"]["velocidad_viaje_hz"] = 500
        recalcular_metricas_laser()
    if "autocalibrar_inicio" in datos:
        estado_maquina["autocalibrar_inicio"] = bool(datos["autocalibrar_inicio"])

    if "invertir_dir" in datos and isinstance(datos["invertir_dir"], dict):
        for k in ("X", "Y", "Z"):
            if k in datos["invertir_dir"]:
                estado_maquina["invertir_dir"][k] = bool(datos["invertir_dir"][k])

    if "intercambiar_xy" in datos:
        estado_maquina["intercambiar_xy"] = bool(datos["intercambiar_xy"])

    if "hard_limits_activos" in datos:
        estado_maquina["hard_limits_activos"] = bool(datos["hard_limits_activos"])
        enviar_comando_raw_serial(f"LIMITS,{1 if estado_maquina['hard_limits_activos'] else 0}")

    if "calibracion" in datos and isinstance(datos["calibracion"], dict):
        cal = datos["calibracion"]
        estado_maquina["limite_fijado"] = bool(cal.get("calibrado_completado", True))
        lims = cal.get("limites_maximos_pulsos", {})
        if "x" in lims:
            estado_maquina["limite_max_x"] = abs(int(lims["x"]))
        if "y" in lims:
            estado_maquina["limite_max_y"] = abs(int(lims["y"]))
        if "z" in lims:
            estado_maquina["limite_max_z"] = int(lims["z"])

    if "bloquear_limites" in datos:
        estado_maquina["bloquear_limites"] = bool(datos["bloquear_limites"])

    if "puerto" in datos and str(datos["puerto"]).strip():
        nuevo_puerto = str(datos["puerto"]).strip()
        if nuevo_puerto != estado_maquina["puerto"] or not estado_maquina["conectado"]:
            intentar_conexion_serial(nuevo_puerto, silencioso=True)

    if estado_maquina["pos_x"] < 0:
        estado_maquina["pos_x"] = 0
        estado_maquina["motor_real_x"] = 0
    if estado_maquina["pos_y"] < 0:
        estado_maquina["pos_y"] = 0
        estado_maquina["motor_real_y"] = 0

    if "id" in datos:
        estado_maquina["perfil_activo"] = datos["id"]


def evaluar_validaciones_seguridad():
    """Genera lista de validaciones a prueba de errores (Fail-Safe) incluyendo ENA+/ENA- y Amperaje."""
    alertas = []
    nivel_global = "ok"

    if estado_maquina["microstep"] == "NC" or estado_maquina["pulse_rev"] == 0:
        alertas.append({
            "tipo": "error",
            "codigo": "DRV_NC",
            "titulo": "Driver en estado NC (S1=ON, S2=ON, S3=ON)",
            "detalle": "El driver no generará pulsos de salida. Cambia S1, S2 o S3 a OFF."
        })
        nivel_global = "error"

    if estado_maquina["ena"]["modo"] == "FREE":
        alertas.append({
            "tipo": "warn",
            "codigo": "ENA_FREE",
            "titulo": "Motores en Corte Total ENA (0.0 A - Ejes Libres)",
            "detalle": "ENA+ está en HIGH en los 3 motores. Cambia ENA a modo AUTO o HOLD para habilitar el movimiento."
        })
        if nivel_global == "ok":
            nivel_global = "warn"

    if not estado_maquina["modo_simulacion"] and not estado_maquina["conectado"]:
        alertas.append({
            "tipo": "error",
            "codigo": "COM_DISCONNECTED",
            "titulo": f"Puerto {estado_maquina['puerto']} sin conexión física",
            "detalle": "Conecta el ESP32 al puerto COM seleccionado o activa el Modo Simulación."
        })
        nivel_global = "error"
    elif estado_maquina["error_puerto"]:
        alertas.append({
            "tipo": "warn",
            "codigo": "COM_FALLBACK",
            "titulo": f"Aviso en selección de puerto ({estado_maquina['puerto']})",
            "detalle": estado_maquina["error_puerto"]
        })
        if nivel_global == "ok":
            nivel_global = "warn"

    if estado_maquina["current_a"] >= 2.5 and estado_maquina["ena"]["modo"] == "HOLD":
        alertas.append({
            "tipo": "warn",
            "codigo": "HIGH_CURRENT_HOLD",
            "titulo": f"Alto amperaje continuo en reposo ({estado_maquina['current_a']}A en modo HOLD)",
            "detalle": "Con corrientes iguales o mayores a 2.5A los motores se calentarán en reposo. Se recomienda activar ENA en modo AUTO para bajar a 0.0A."
        })
        if nivel_global == "ok":
            nivel_global = "warn"

    if not estado_maquina["posicion_sincronizada"]:
        alertas.append({
            "tipo": "warn",
            "codigo": "POS_DESYNC",
            "titulo": "Posición pendiente de validación con el ESP32",
            "detalle": "Presiona 'Validar Motor' para confirmar que el conteo físico coincide."
        })
        if nivel_global == "ok":
            nivel_global = "warn"

    if estado_maquina["bloquear_limites"] and not estado_maquina["limite_fijado"]:
        alertas.append({
            "tipo": "warn",
            "codigo": "SOFT_LIM_UNSET",
            "titulo": "Enclave de seguridad activo sin límites fijados",
            "detalle": "Debes fijar primero el Límite Máximo (X, Y) para que la protección tenga efecto."
        })
        if nivel_global == "ok":
            nivel_global = "warn"

    if not alertas:
        modo_ena = estado_maquina["ena"]["modo"]
        detalle_ena = (
            f"ENA+ en modo AUTO (baja a 0.0A en reposo, sube a {estado_maquina['current_a']}A solo al mover)."
            if modo_ena == "AUTO"
            else f"ENA+ en modo HOLD ({estado_maquina['current_a']}A de retención activo)."
        )
        alertas.append({
            "tipo": "ok",
            "codigo": "SYSTEM_NOMINAL",
            "titulo": "Validación operativa superada (A prueba de errores)",
            "detalle": f"Driver {estado_maquina['pulse_rev']} P/rev | {detalle_ena}"
        })

    return {"nivel": nivel_global, "items": alertas}


def recalcular_driver_desde_switches(actualizar_escala=True):
    sw = estado_maquina["switches"]
    clave_ms = (bool(sw["S1"]), bool(sw["S2"]), bool(sw["S3"]))
    clave_cur = (bool(sw["S4"]), bool(sw["S5"]), bool(sw["S6"]))

    info_ms = TABLA_MICROSTEP.get(clave_ms, {"microstep": "NC", "pulse_rev": 0, "grados_paso": 0.0})
    info_cur = TABLA_CORRIENTE.get(clave_cur, {"current_a": 0.5, "pk_current_a": 0.7})

    estado_maquina["microstep"] = info_ms["microstep"]
    estado_maquina["pulse_rev"] = info_ms["pulse_rev"]
    estado_maquina["grados_por_pulso"] = info_ms["grados_paso"]
    estado_maquina["current_a"] = info_cur["current_a"]
    estado_maquina["pk_current_a"] = info_cur["pk_current_a"]

    if info_ms["microstep"] == "NC":
        estado_maquina["ena"]["X"] = False
        estado_maquina["ena"]["Y"] = False
        estado_maquina["ena"]["Z"] = False
        estado_maquina["reduccion_amperaje_activa"] = True
    elif info_cur["current_a"] >= 2.0:
        estado_maquina["reduccion_amperaje_activa"] = True
        if estado_maquina["ena"]["modo"] == "HOLD" and info_cur["current_a"] >= 2.5:
            estado_maquina["ena"]["modo"] = "AUTO"
            estado_maquina["ena"]["X"] = False
            estado_maquina["ena"]["Y"] = False
            estado_maquina["ena"]["Z"] = False

    if actualizar_escala and info_ms["pulse_rev"] > 0:
        mm_rev = max(0.1, float(estado_maquina.get("mm_por_rev", 40.0)))
        estado_maquina["pasos_por_mm"] = round(info_ms["pulse_rev"] / mm_rev, 2)


inicializar_perfiles_por_defecto()
recalcular_driver_desde_switches(actualizar_escala=True)


def sincronizar_perfil_inicial():
    perfiles = listar_perfiles_guardados()
    if not perfiles:
        return
    ids = [p.get("id") for p in perfiles]
    objetivo = None
    if estado_maquina["perfil_activo"] in ids:
        objetivo = next((p for p in perfiles if p.get("id") == estado_maquina["perfil_activo"]), None)
    else:
        objetivo = perfiles[0]
    if objetivo:
        aplicar_datos_perfil_a_maquina(objetivo)
        estado_maquina["bloquear_limites"] = False


_cache_puertos_com = {"ts": 0.0, "lista": [PUERTO_DEFECTO]}


def listar_puertos_com():
    ahora = time.time()
    if ahora - _cache_puertos_com["ts"] < 2.5 and _cache_puertos_com["lista"]:
        return _cache_puertos_com["lista"]
    puertos = [p.device for p in serial.tools.list_ports.comports()]
    if not puertos:
        puertos = [PUERTO_DEFECTO]
    _cache_puertos_com["ts"] = ahora
    _cache_puertos_com["lista"] = puertos
    return puertos


def enviar_comando_raw_serial(comando_str):
    """Envía un comando auxiliar (como ENA,... o ZERO) al ESP32 si está conectado."""
    global puerto_serial
    if estado_maquina["modo_simulacion"] or not puerto_serial or not puerto_serial.is_open:
        return True, "Simulado"
    with serial_lock:
        try:
            puerto_serial.reset_input_buffer()
            puerto_serial.write((comando_str.strip() + "\n").encode("utf-8"))
            inicio = time.time()
            while time.time() - inicio < 0.15:
                if puerto_serial.in_waiting > 0:
                    resp = puerto_serial.readline().decode("utf-8", errors="ignore").strip()
                    if resp.startswith("OK"):
                        return True, resp
                time.sleep(0.002)
            return True, "Enviado"
        except Exception as e:
            return False, str(e)


def intentar_conexion_serial(puerto, silencioso=False):
    global puerto_serial
    with serial_lock:
        if puerto_serial and puerto_serial.is_open:
            try:
                puerto_serial.close()
            except Exception:
                pass
        try:
            puerto_serial = serial.Serial(puerto, BAUD_RATE, timeout=1.5)
            time.sleep(1.5)
            estado_maquina["conectado"] = True
            estado_maquina["modo_simulacion"] = False
            estado_maquina["puerto"] = puerto
            estado_maquina["firmware_b2d"] = True
            estado_maquina["error_puerto"] = None
            estado_maquina["ultimo_mensaje"] = f"Conectado exitosamente a {puerto} ({BAUD_RATE} baudios)"
            return True, estado_maquina["ultimo_mensaje"]
        except Exception as e:
            puerto_serial = None
            estado_maquina["conectado"] = False
            estado_maquina["modo_simulacion"] = True
            estado_maquina["puerto"] = puerto
            if not silencioso:
                estado_maquina["error_puerto"] = f"No se detectó hardware en {puerto}. Se activó protección en Modo Simulación."
            estado_maquina["ultimo_mensaje"] = f"Puerto {puerto} no disponible. Modo Simulación Virtual activo."
            return False, str(e)


def enviar_por_serial(eje, pasos, dir_int, duracion_esperada):
    """
    Envía comando EJE,PASOS,DIR al ESP32 aplicando intercambio de ejes si aplica
    y la inversión cinemática de dirección (ej. placa móvil en Y con puente fijo en X).
    """
    global puerto_serial
    eje_fisico = eje
    if estado_maquina.get("intercambiar_xy", False):
        if eje == "X":
            eje_fisico = "Y"
        elif eje == "Y":
            eje_fisico = "X"

    invertido = bool(estado_maquina.get("invertir_dir", {}).get(eje_fisico, False))
    dir_fisico = (0 if dir_int == 1 else 1) if invertido else dir_int

    if estado_maquina["modo_simulacion"]:
        return True, f"Simulado (Eje físico={eje_fisico}, DIR físico={dir_fisico})"

    if not puerto_serial or not puerto_serial.is_open:
        return False, f"Error: El puerto {estado_maquina['puerto']} no está conectado. Activa Simulación o conecta el hardware."

    with serial_lock:
        try:
            comando = f"{eje_fisico},{pasos},{dir_fisico}\n"
            puerto_serial.reset_input_buffer()
            puerto_serial.write(comando.encode("utf-8"))

            timeout_max = max(5.0, duracion_esperada * 10)
            inicio = time.time()
            while time.time() - inicio < timeout_max:
                if puerto_serial.in_waiting > 0:
                    respuesta = puerto_serial.readline().decode("utf-8", errors="ignore").strip()
                    if respuesta.startswith("OK"):
                        return True, respuesta
                    elif respuesta.startswith("ERR"):
                        return False, f"Error reportado por el motor: {respuesta}"
                time.sleep(0.002)

            estado_maquina["posicion_sincronizada"] = False
            return False, f"Tiempo de espera agotado ({timeout_max:.1f}s) sin recibir confirmación 'OK' del motor en {eje}."
        except Exception as e:
            estado_maquina["conectado"] = False
            estado_maquina["modo_simulacion"] = True
            estado_maquina["posicion_sincronizada"] = False
            estado_maquina["error_puerto"] = f"Pérdida de conexión en {estado_maquina['puerto']}: {e}"
            return False, f"Fallo de comunicación serial: {e}"


def _esperar_ok_serial_bloqueado(timeout_max):
    """Espera respuesta 'OK' o 'ERR' dentro de un bloque con serial_lock ya adquirido."""
    inicio = time.time()
    while time.time() - inicio < timeout_max:
        if puerto_serial.in_waiting > 0:
            respuesta = puerto_serial.readline().decode("utf-8", errors="ignore").strip()
            if respuesta.startswith("OK"):
                return True, respuesta
            elif respuesta.startswith("ERR"):
                return False, f"Error reportado por el motor: {respuesta}"
        time.sleep(0.002)
    return False, f"Tiempo de espera agotado ({timeout_max:.1f}s) sin recibir confirmación 'OK' del ESP32."


def _verificar_soporte_b2d_bloqueado():
    """El firmware ESP32 soporta interpolación simultánea M2 y M2L (B2D:1) de forma nativa."""
    estado_maquina["firmware_b2d"] = True
    return True


def enviar_interpolacion_xy_serial(pasos_x, dir_x, pasos_y, dir_y, duracion_esperada, pwm_laser=None, vel_hz=None):
    """
    Mueve los ejes X e Y de forma simultánea (Interpolación Lineal 2D Bresenham):
    - Si pwm_laser > 0 (Modo Laser 5W activo), usa 'M2L,pasosX,dirX,pasosY,dirY,pwm,delayUs'
      para encender/modular el laser de 5W en sincronía exacta con cada paso del motor y apagarlo
      al concluir el segmento, garantizando tiempo térmico suficiente para quemado continuo sin puntos.
    - Si no hay laser activo (viaje en vacío 0W o Modo Dibujo), usa la misma rutina de movimiento de dibujo.
    """
    global puerto_serial
    if pasos_x <= 0 and pasos_y <= 0:
        return True, "Sin desplazamiento"

    usar_modo_laser = (pwm_laser is not None) and (int(pwm_laser) > 0)
    pwm_seg = max(0, min(255, int(pwm_laser))) if (pwm_laser is not None) else 0

    if usar_modo_laser:
        lsr = estado_maquina.get("laser", {})
        hz_base = int(vel_hz or lsr.get("velocidad_grabado_hz", 180))
        if hz_base >= 600:
            hz_base = 180
        hz_activo = max(25, min(500, hz_base))

        # Compensacion diagonal euclidiana: mantiene la velocidad lineal mm/s constante en todo angulo
        # (sin esto, las diagonales a 45 deg avanzan 41.4% mas rapido y queman mas delgado que H/V).
        pasos_dom = max(pasos_x, pasos_y)
        dist_euc = math.hypot(pasos_x, pasos_y)
        k_diag = (dist_euc / float(pasos_dom)) if (pasos_dom > 0 and lsr.get("compensacion_diagonal", True)) else 1.0
        delay_us = int(round((500000.0 / float(hz_activo)) * k_diag))
        delay_us = max(1000, min(20000, delay_us))

        # Balance anisotropico de haz X/Y (diodo 450nm con emisor rectangular):
        # bal_pct > 0 atenua movimientos en Y; bal_pct < 0 atenua movimientos en X.
        bal_pct = max(-35.0, min(35.0, float(lsr.get("balance_haz_xy_pct", 0.0))))
        if abs(bal_pct) > 0.1 and dist_euc > 0:
            cos2 = (pasos_x * pasos_x) / (dist_euc * dist_euc)
            sin2 = (pasos_y * pasos_y) / (dist_euc * dist_euc)
            factor_haz = (1.0 - (bal_pct / 100.0) * sin2) if bal_pct > 0 else (1.0 - (abs(bal_pct) / 100.0) * cos2)
            pwm_seg = max(1, min(255, int(round(pwm_seg * factor_haz))))
    else:
        hz_activo = max(50, min(4000, int(vel_hz or estado_maquina.get("velocidad_hz", 500))))
        delay_us = max(125, min(10000, int(500000 // hz_activo)))

    if not usar_modo_laser:
        if pasos_y <= 0:
            return enviar_por_serial("X", pasos_x, dir_x, duracion_esperada)
        if pasos_x <= 0:
            return enviar_por_serial("Y", pasos_y, dir_y, duracion_esperada)

    swapped = bool(estado_maquina.get("intercambiar_xy", False))
    if swapped:
        px_fis, dx_fis = pasos_y, dir_y
        py_fis, dy_fis = pasos_x, dir_x
    else:
        px_fis, dx_fis = pasos_x, dir_x
        py_fis, dy_fis = pasos_y, dir_y

    inv_x = bool(estado_maquina.get("invertir_dir", {}).get("X", False))
    inv_y = bool(estado_maquina.get("invertir_dir", {}).get("Y", False))
    dir_fis_x = (0 if dx_fis == 1 else 1) if inv_x else dx_fis
    dir_fis_y = (0 if dy_fis == 1 else 1) if inv_y else dy_fis

    if estado_maquina["modo_simulacion"]:
        if usar_modo_laser:
            return True, f"Simulado 2D + Laser 5W Sincronizado (PWM={pwm_seg}/255, Delay={delay_us}us, Swap={swapped})"
        return True, f"Simulado 2D Simultáneo (DIR_X={dir_fis_x}, DIR_Y={dir_fis_y}, Swap={swapped})"

    if not puerto_serial or not puerto_serial.is_open:
        return False, f"Error: El puerto {estado_maquina['puerto']} no está conectado. Activa Simulación o conecta el hardware."

    with serial_lock:
        try:
            duracion_real_seg = (max(px_fis, py_fis) * 2.0 * delay_us) / 1000000.0
            timeout_max = max(6.0, duracion_esperada * 12, duracion_real_seg * 4.0 + 5.0)
            if usar_modo_laser:
                comando = f"M2L,{px_fis},{dir_fis_x},{py_fis},{dir_fis_y},{pwm_seg},{delay_us}\n"
            else:
                comando = f"M2,{px_fis},{dir_fis_x},{py_fis},{dir_fis_y}\n"
            puerto_serial.reset_input_buffer()
            puerto_serial.write(comando.encode("utf-8"))
            ok, resp = _esperar_ok_serial_bloqueado(timeout_max)
            if not ok:
                estado_maquina["posicion_sincronizada"] = False
            return ok, resp
        except Exception as e:
            estado_maquina["conectado"] = False
            estado_maquina["modo_simulacion"] = True
            estado_maquina["posicion_sincronizada"] = False
            estado_maquina["error_puerto"] = f"Pérdida de conexión en {estado_maquina['puerto']}: {e}"
            return False, f"Fallo de comunicación serial 2D: {e}"


def construir_respuesta_estado(**extra):
    recalcular_metricas_laser()
    escala = max(0.001, float(estado_maquina["pasos_por_mm"]))
    lim_x = estado_maquina["limite_max_x"]
    lim_y = estado_maquina["limite_max_y"]
    lim_z = estado_maquina["limite_max_z"]
    p_rev = max(1, estado_maquina["pulse_rev"] or 3200)
    rpm = round((estado_maquina["velocidad_hz"] / p_rev) * 60.0, 1) if estado_maquina["pulse_rev"] > 0 else 0.0

    amp_x = estado_maquina["current_a"] if estado_maquina["ena"]["X"] else 0.0
    amp_y = estado_maquina["current_a"] if estado_maquina["ena"]["Y"] else 0.0
    amp_z = estado_maquina["current_a"] if estado_maquina["ena"]["Z"] else 0.0

    payload = {
        **estado_maquina,
        "presets_laser_5w": PRESETS_LASER_5W,
        "amperaje_reposo": {"X": amp_x, "Y": amp_y, "Z": amp_z},
        "rpm_estimadas": rpm,
        "puertos_disponibles": listar_puertos_com(),
        "perfiles_disponibles": listar_perfiles_guardados(),
        "carpeta_perfiles": CARPETA_PERFILES,
        "mm_x": round(estado_maquina["pos_x"] / escala, 2),
        "mm_y": round(estado_maquina["pos_y"] / escala, 2),
        "mm_z": round(estado_maquina["pos_z"] / escala, 2),
        "limite_mm_x": round(abs(lim_x) / escala, 2),
        "limite_mm_y": round(abs(lim_y) / escala, 2),
        "limite_mm_z": round(abs(lim_z) / escala, 2),
        "validaciones": evaluar_validaciones_seguridad()
    }
    payload.update(extra)
    return payload


intentar_conexion_serial(PUERTO_DEFECTO, silencioso=True)
sincronizar_perfil_inicial()


# --- RUTAS DE LA APLICACIÓN WEB ---

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/state", methods=["GET"])
def api_state():
    return jsonify(construir_respuesta_estado(ok=True))


# --- RUTAS DE GESTIÓN DE PERFILES (GUARDAR EN CARPETA, CARGAR, MODIFICAR, IMPORTAR, ELIMINAR) ---

@app.route("/api/profiles", methods=["GET"])
def api_profiles_list():
    return jsonify({
        "ok": True,
        "perfil_activo": estado_maquina["perfil_activo"],
        "carpeta": CARPETA_PERFILES,
        "perfiles": listar_perfiles_guardados()
    })


@app.route("/api/profiles/load", methods=["POST"])
def api_profiles_load():
    data = request.get_json(silent=True) or {}
    pid = limpiar_slug_perfil(data.get("id", ""))
    ruta = os.path.join(CARPETA_PERFILES, f"{pid}.json")

    if not os.path.exists(ruta):
        return jsonify(construir_respuesta_estado(
            ok=False,
            error=f"No se encontró el perfil '{pid}' en la carpeta de perfiles."
        )), 404

    try:
        with open(ruta, "r", encoding="utf-8") as fh:
            datos = json.load(fh)
        datos["id"] = pid
        aplicar_datos_perfil_a_maquina(datos)
        nombre = datos.get("nombre", pid)
        estado_maquina["ultimo_mensaje"] = (
            f"Perfil cargado: '{nombre}' ({estado_maquina['pulse_rev']} P/rev, "
            f"{estado_maquina['current_a']}A, Zona {round(abs(estado_maquina['limite_max_x'])/max(0.01, estado_maquina['pasos_por_mm']), 1)}x"
            f"{round(abs(estado_maquina['limite_max_y'])/max(0.01, estado_maquina['pasos_por_mm']), 1)} mm)."
        )
        return jsonify(construir_respuesta_estado(ok=True))
    except Exception as e:
        return jsonify(construir_respuesta_estado(ok=False, error=f"Error al cargar el perfil: {e}")), 500


@app.route("/api/profiles/save", methods=["POST"])
def api_profiles_save():
    data = request.get_json(silent=True) or {}
    modo_guardado = data.get("modo_guardado", "actualizar")  # "actualizar" o "nuevo"
    nombre_raw = str(data.get("nombre", "")).strip()

    if modo_guardado == "actualizar" and estado_maquina.get("perfil_activo"):
        pid = limpiar_slug_perfil(data.get("id") or estado_maquina["perfil_activo"])
        ruta_existente = os.path.join(CARPETA_PERFILES, f"{pid}.json")
        if not nombre_raw and os.path.exists(ruta_existente):
            try:
                with open(ruta_existente, "r", encoding="utf-8") as fh:
                    prev = json.load(fh)
                    nombre_raw = prev.get("nombre", pid)
            except Exception:
                nombre_raw = pid
    else:
        if not nombre_raw:
            return jsonify(construir_respuesta_estado(
                ok=False,
                error="Escribe un nombre para guardar el nuevo perfil en la carpeta."
            )), 400
        pid = limpiar_slug_perfil(nombre_raw)

    if not nombre_raw:
        nombre_raw = pid

    perfil_obj = construir_objeto_perfil(pid, nombre_raw, data.get("descripcion", ""))
    ruta = os.path.join(CARPETA_PERFILES, f"{pid}.json")

    try:
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(perfil_obj, fh, indent=4, ensure_ascii=False)
        estado_maquina["perfil_activo"] = pid
        estado_maquina["ultimo_mensaje"] = f"Perfil '{nombre_raw}' guardado en carpeta perfiles/{pid}.json."
        return jsonify(construir_respuesta_estado(ok=True, perfil_guardado=perfil_obj))
    except Exception as e:
        return jsonify(construir_respuesta_estado(ok=False, error=f"No se pudo guardar el perfil: {e}")), 500


@app.route("/api/profiles/import", methods=["POST"])
def api_profiles_import():
    data = request.get_json(silent=True) or {}
    contenido = data.get("config") or data
    nombre_archivo = str(data.get("filename", "")).strip()

    if not isinstance(contenido, dict):
        return jsonify(construir_respuesta_estado(ok=False, error="El archivo JSON importado no tiene un formato válido.")), 400

    nombre_perfil = (
        contenido.get("nombre")
        or contenido.get("proyecto")
        or os.path.splitext(nombre_archivo)[0]
        or f"Perfil Importado {datetime.now().strftime('%H:%M')}"
    )
    pid = limpiar_slug_perfil(contenido.get("id") or os.path.splitext(nombre_archivo)[0] or nombre_perfil)

    try:
        contenido["id"] = pid
        aplicar_datos_perfil_a_maquina(contenido)
        perfil_normalizado = construir_objeto_perfil(pid, nombre_perfil)
        ruta = os.path.join(CARPETA_PERFILES, f"{pid}.json")
        with open(ruta, "w", encoding="utf-8") as fh:
            json.dump(perfil_normalizado, fh, indent=4, ensure_ascii=False)

        estado_maquina["perfil_activo"] = pid
        estado_maquina["ultimo_mensaje"] = f"Configuración '{nombre_perfil}' importada, aplicada y guardada en perfiles/{pid}.json."
        return jsonify(construir_respuesta_estado(ok=True, perfil_importado=perfil_normalizado))
    except Exception as e:
        return jsonify(construir_respuesta_estado(ok=False, error=f"Error al importar configuración: {e}")), 500


@app.route("/api/profiles/delete", methods=["POST"])
def api_profiles_delete():
    data = request.get_json(silent=True) or {}
    pid = limpiar_slug_perfil(data.get("id", ""))
    ruta = os.path.join(CARPETA_PERFILES, f"{pid}.json")

    if not os.path.exists(ruta):
        return jsonify(construir_respuesta_estado(ok=False, error="El perfil seleccionado no existe.")), 404

    perfiles = listar_perfiles_guardados()
    if len(perfiles) <= 1:
        return jsonify(construir_respuesta_estado(
            ok=False,
            error="Debe permanecer al menos un perfil configurado en la carpeta."
        )), 400

    try:
        os.remove(ruta)
        restantes = listar_perfiles_guardados()
        if restantes:
            nuevo_activo = restantes[0]
            aplicar_datos_perfil_a_maquina(nuevo_activo)
        estado_maquina["ultimo_mensaje"] = f"Perfil '{pid}' eliminado de la carpeta."
        return jsonify(construir_respuesta_estado(ok=True))
    except Exception as e:
        return jsonify(construir_respuesta_estado(ok=False, error=f"No se pudo eliminar el perfil: {e}")), 500


@app.route("/api/connect", methods=["POST"])
def api_connect():
    global puerto_serial
    data = request.get_json(silent=True) or {}
    accion = data.get("accion", "conectar")
    puerto = str(data.get("puerto", PUERTO_DEFECTO)).strip()

    if not puerto:
        return jsonify(construir_respuesta_estado(ok=False, error="Debes seleccionar un puerto COM válido.")), 400

    if accion == "desconectar":
        with serial_lock:
            if puerto_serial and puerto_serial.is_open:
                try:
                    puerto_serial.close()
                except Exception:
                    pass
            puerto_serial = None
        estado_maquina["conectado"] = False
        estado_maquina["modo_simulacion"] = True
        estado_maquina["error_puerto"] = None
        estado_maquina["ultimo_mensaje"] = "Puerto desconectado de forma segura. Modo Simulación Virtual activo."
        return jsonify(construir_respuesta_estado(ok=True))

    exito, detalle = intentar_conexion_serial(puerto, silencioso=False)
    return jsonify(construir_respuesta_estado(ok=exito, error=None if exito else detalle))


@app.route("/api/enable", methods=["POST"])
def api_enable():
    """
    Controla las terminales ENA+ / ENA- de los motores (modo AUTO, HOLD, FREE, polaridad LOW/HIGH o por motor individual X, Y, Z).
    """
    data = request.get_json(silent=True) or {}
    modo = data.get("modo")
    eje = data.get("eje")
    activar = data.get("activar")
    polaridad = data.get("polaridad")

    if polaridad in ("LOW", "HIGH", "TOGGLE"):
        pol_actual = estado_maquina["ena"].get("polaridad", "LOW")
        nueva_pol = ("HIGH" if pol_actual == "LOW" else "LOW") if polaridad == "TOGGLE" else polaridad
        estado_maquina["ena"]["polaridad"] = nueva_pol
        enviar_comando_raw_serial(f"ENA,POL,{nueva_pol}")
        estado_maquina["ultimo_mensaje"] = (
            f"Polaridad ENA cambiada a Activo en {nueva_pol} (comando ENA,POL,{nueva_pol} enviado al ESP32)."
        )
        return jsonify(construir_respuesta_estado(ok=True))

    if modo in ("AUTO", "HOLD", "FREE"):
        estado_maquina["ena"]["modo"] = modo
        if modo == "AUTO":
            estado_maquina["ena"]["X"] = False
            estado_maquina["ena"]["Y"] = False
            estado_maquina["ena"]["Z"] = False
            enviar_comando_raw_serial("ENA,MODE,AUTO")
            estado_maquina["ultimo_mensaje"] = (
                f"Modo ENA AUTO activo: Los motores permanecen en 0.0 A en reposo y se energizan a {estado_maquina['current_a']} A solo al moverse."
            )
        elif modo == "HOLD":
            estado_maquina["ena"]["X"] = True
            estado_maquina["ena"]["Y"] = True
            estado_maquina["ena"]["Z"] = True
            enviar_comando_raw_serial("ENA,MODE,HOLD")
            estado_maquina["ultimo_mensaje"] = (
                f"Modo ENA HOLD activo: Bobinas energizadas (ENA+ = LOW) con retención de {estado_maquina['current_a']} A."
            )
        elif modo == "FREE":
            estado_maquina["ena"]["X"] = False
            estado_maquina["ena"]["Y"] = False
            estado_maquina["ena"]["Z"] = False
            enviar_comando_raw_serial("ENA,ALL,0")
            estado_maquina["ultimo_mensaje"] = (
                "Corte Total ENA (ENA+ = HIGH): Los 3 motores están desenergizados (0.0 A) y libres sin calentarse."
            )

    elif eje in ("X", "Y", "Z"):
        nuevo_estado = bool(activar) if activar is not None else (not estado_maquina["ena"][eje])
        estado_maquina["ena"][eje] = nuevo_estado
        enviar_comando_raw_serial(f"ENA,{eje},{1 if nuevo_estado else 0}")
        if nuevo_estado:
            estado_maquina["ultimo_mensaje"] = (
                f"Motor {eje} ENERGIZADO (ENA+ -> LOW | {estado_maquina['current_a']} A activos)."
            )
        else:
            estado_maquina["ultimo_mensaje"] = (
                f"Motor {eje} DESENERGIZADO (ENA+ -> HIGH | Amperaje reducido a 0.0 A)."
            )

    return jsonify(construir_respuesta_estado(ok=True))


@app.route("/api/verify_position", methods=["POST"])
def api_verify_position():
    global puerto_serial
    if estado_maquina["microstep"] == "NC":
        msg = "Error de validación: Los switches S1-S3 están en NC. Configura un Microstep válido antes de validar."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if not estado_maquina["modo_simulacion"]:
        if not puerto_serial or not puerto_serial.is_open:
            msg = f"Error: No hay conexión activa en {estado_maquina['puerto']} para validar el motor físico."
            estado_maquina["posicion_sincronizada"] = False
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        with serial_lock:
            try:
                puerto_serial.reset_input_buffer()
                puerto_serial.write(b"STATUS\n")
                time.sleep(0.15)
                resp = ""
                if puerto_serial.in_waiting > 0:
                    resp = puerto_serial.readline().decode("utf-8", errors="ignore").strip()
                if "SWX:" in resp:
                    estado_maquina["endstops"]["X"] = ("SWX:1" in resp)
                if "SWY:" in resp:
                    estado_maquina["endstops"]["Y"] = ("SWY:1" in resp)
                if "SWZ:" in resp:
                    estado_maquina["endstops"]["Z"] = ("SWZ:1" in resp)
                estado_maquina["motor_real_x"] = estado_maquina["pos_x"]
                estado_maquina["motor_real_y"] = estado_maquina["pos_y"]
                estado_maquina["motor_real_z"] = estado_maquina["pos_z"]
                estado_maquina["posicion_sincronizada"] = True
                estado_maquina["ultimo_mensaje"] = (
                    f"Posición, microswitches y estado ENA validados con ESP32 en {estado_maquina['puerto']}: "
                    f"X={estado_maquina['pos_x']}, Y={estado_maquina['pos_y']}, Z={estado_maquina['pos_z']} "
                    f"({resp if resp else 'Enlace OK'})."
                )
            except Exception as e:
                estado_maquina["posicion_sincronizada"] = False
                return jsonify(construir_respuesta_estado(ok=False, error=f"Fallo al validar motor: {e}"))
    else:
        estado_maquina["motor_real_x"] = estado_maquina["pos_x"]
        estado_maquina["motor_real_y"] = estado_maquina["pos_y"]
        estado_maquina["motor_real_z"] = estado_maquina["pos_z"]
        estado_maquina["endstops"]["X"] = (estado_maquina["pos_x"] == 0)
        estado_maquina["endstops"]["Y"] = (estado_maquina["pos_y"] == 0)
        estado_maquina["endstops"]["Z"] = False
        estado_maquina["posicion_sincronizada"] = True
        estado_maquina["error_puerto"] = None
        estado_maquina["ultimo_mensaje"] = (
            f"Validación completada: Posición confirmada en X={estado_maquina['pos_x']}, "
            f"Y={estado_maquina['pos_y']}, Z={estado_maquina['pos_z']} pulsos."
        )

    return jsonify(construir_respuesta_estado(ok=True))


@app.route("/api/autohome", methods=["POST"])
def api_autohome():
    """
    Ejecuta la rutina de Auto-Calibración mediante los Microinterruptores de X e Y (Switches con palanca de lámina y rodaja):
    - Microswitch X: Límite Inferior Izquierdo (Home X = 0)
    - Microswitch Y: Límite Inferior Izquierdo (Home Y = 0)
    - Eje Z: Sin microswitch (su calibración es manual e independiente mediante Fijar Home Z y Fijar Máximo Z).
    """
    global puerto_serial
    data = request.get_json(silent=True) or {}
    objetivo = str(data.get("eje", "ALL")).upper()

    if objetivo == "Z":
        msg = "El Eje Z no cuenta con microswitch activo. Calibra el Eje Z manualmente usando 'Fijar Home Z (0)' y 'Fijar Máximo Z (Papel)'."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["microstep"] == "NC" or estado_maquina["pulse_rev"] == 0:
        msg = "Auto-Calibración bloqueada: Driver en estado NC. Selecciona un Microstep válido."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["ena"]["modo"] == "FREE":
        msg = "Auto-Calibración bloqueada: Los motores están en Corte Total ENA (0.0 A). Cambia ENA a AUTO o HOLD."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    prev_x = estado_maquina["pos_x"]
    prev_y = estado_maquina["pos_y"]
    prev_z = estado_maquina["pos_z"]

    inv_x = bool(estado_maquina.get("invertir_dir", {}).get("X", False))
    inv_y = bool(estado_maquina.get("invertir_dir", {}).get("Y", True))

    # Direcciones físicas hacia cada microswitch (X e Y):
    # X -> hacia izquierda (lógico 0)
    # Y -> hacia origen inferior (lógico 0, invertido en placa móvil)
    dir_fis_x = 1 if inv_x else 0
    dir_fis_y = 1 if inv_y else 0

    if not estado_maquina["modo_simulacion"]:
        if not puerto_serial or not puerto_serial.is_open:
            msg = f"Error: El puerto {estado_maquina['puerto']} no está conectado para ejecutar Auto-Calibración con microswitches."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        with serial_lock:
            try:
                puerto_serial.reset_input_buffer()
                if objetivo in ("X", "Y"):
                    dir_eje = dir_fis_x if objetivo == "X" else dir_fis_y
                    cmd = f"HOME_AXIS,{objetivo},{dir_eje}\n"
                else:
                    cmd = f"AUTOHOME,{dir_fis_x},{dir_fis_y}\n"
                puerto_serial.write(cmd.encode("utf-8"))
                ok_ser, resp_ser = _esperar_ok_serial_bloqueado(45.0)
                if not ok_ser:
                    estado_maquina["posicion_sincronizada"] = False
                    estado_maquina["ultimo_mensaje"] = resp_ser
                    return jsonify(construir_respuesta_estado(ok=False, error=resp_ser))
            except Exception as e:
                estado_maquina["posicion_sincronizada"] = False
                return jsonify(construir_respuesta_estado(ok=False, error=f"Fallo en Auto-Calibración serial: {e}"))

    dest_x, dest_y, dest_z = prev_x, prev_y, prev_z
    if objetivo == "X":
        dest_x = 0
        estado_maquina["endstops"]["X"] = True
    elif objetivo == "Y":
        dest_y = 0
        estado_maquina["endstops"]["Y"] = True
    else:
        dest_x = 0
        dest_y = 0
        estado_maquina["origen_fijado"] = True
        estado_maquina["endstops"]["X"] = True
        estado_maquina["endstops"]["Y"] = True
        estado_maquina["endstops"]["Z"] = False
        estado_maquina["endstops"]["autohome_completado"] = True

    dx = dest_x - prev_x
    dy = dest_y - prev_y
    dz = 0
    pasos_max = max(abs(dx), abs(dy), 250)
    vel_hz = max(50, int(estado_maquina.get("velocidad_hz", 500)))
    duracion_seg = round(pasos_max / float(vel_hz), 3)
    duracion_anim_ms = int(max(350, min(6000, duracion_seg * 1000)))

    grados_por_pulso = float(estado_maquina["grados_por_pulso"])
    giro_x = dx * grados_por_pulso
    giro_y = dy * grados_por_pulso
    giro_z = 0.0

    estado_maquina["pos_x"] = dest_x
    estado_maquina["pos_y"] = dest_y
    estado_maquina["pos_z"] = dest_z
    estado_maquina["motor_real_x"] = dest_x
    estado_maquina["motor_real_y"] = dest_y
    estado_maquina["motor_real_z"] = dest_z
    estado_maquina["angulo_x"] = (estado_maquina["angulo_x"] + giro_x) % 360
    estado_maquina["angulo_y"] = (estado_maquina["angulo_y"] + giro_y) % 360
    estado_maquina["posicion_sincronizada"] = True

    if objetivo == "ALL":
        estado_maquina["historial"] = [[0, 0]]
        estado_maquina["ultimo_mensaje"] = (
            "Auto-Calibración por Microswitches (X, Y) completada en Límite Inferior Izquierdo (0, 0). Eje Z con calibración manual independiente."
        )
    else:
        if not estado_maquina["historial"] or estado_maquina["historial"][-1] != [dest_x, dest_y]:
            estado_maquina["historial"].append([dest_x, dest_y])
        estado_maquina["ultimo_mensaje"] = (
            f"Auto-Calibración Microswitch Eje {objetivo} (Límite Inferior Izquierdo) completada: Home {objetivo} = 0 pulsos."
        )

    return jsonify(construir_respuesta_estado(
        ok=True,
        movimiento={
            "eje": "XY" if objetivo == "ALL" else objetivo,
            "pasos": pasos_max,
            "pasos_x": abs(dx),
            "pasos_y": abs(dy),
            "delta_x": dx,
            "delta_y": dy,
            "grados_giro": giro_x if objetivo == "X" else giro_y,
            "grados_giro_x": giro_x,
            "grados_giro_y": giro_y,
            "duracion_ms": duracion_anim_ms,
            "duracion_seg": duracion_seg,
            "velocidad_hz": vel_hz,
            "desde": {"x": prev_x, "y": prev_y, "z": prev_z},
            "hasta": {"x": dest_x, "y": dest_y, "z": dest_z}
        }
    ))


@app.route("/api/move", methods=["POST"])
def api_move():
    data = request.get_json(silent=True) or {}
    eje = str(data.get("eje", "X")).upper()
    try:
        pasos = int(data.get("pasos", 100))
        dir_int = int(data.get("dir_int", 1))
    except (ValueError, TypeError):
        return jsonify(construir_respuesta_estado(ok=False, error="Cantidad de pulsos inválida.")), 400

    modificador = 1 if dir_int == 1 else -1

    if eje not in ("X", "Y", "Z") or pasos <= 0:
        return jsonify(construir_respuesta_estado(ok=False, error="El número de pulsos debe ser mayor a 0.")), 400

    if pasos > 100000:
        return jsonify(construir_respuesta_estado(
            ok=False,
            error="Por seguridad, un solo comando no puede exceder 100,000 pulsos."
        )), 400

    if estado_maquina["microstep"] == "NC" or estado_maquina["pulse_rev"] == 0:
        msg = "Movimiento bloqueado: Driver en estado NC (S1=ON, S2=ON, S3=ON). Selecciona un Microstep válido."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["ena"]["modo"] == "FREE":
        msg = "Movimiento bloqueado: Los motores están en Corte Total ENA (0.0 A). Cambia ENA a modo AUTO o HOLD."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["ena"]["modo"] == "HOLD" and not estado_maquina["ena"].get(eje, True):
        msg = f"Movimiento bloqueado: El motor {eje} tiene su señal ENA+ deshabilitada (HIGH / 0.0A). Activa ENA {eje} primero."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    prev_x = estado_maquina["pos_x"]
    prev_y = estado_maquina["pos_y"]
    prev_z = estado_maquina["pos_z"]

    dest_x, dest_y, dest_z = prev_x, prev_y, prev_z
    delta = pasos * modificador

    if eje == "X":
        dest_x += delta
    elif eje == "Y":
        dest_y += delta
    elif eje == "Z":
        dest_z += delta

    if estado_maquina["bloquear_limites"]:
        if not estado_maquina["limite_fijado"]:
            msg = "Enclave de seguridad activo: Debes fijar primero el Límite Máximo o desactivar el enclave para calibrar."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        min_x, max_x = min(0, estado_maquina["limite_max_x"]), max(0, estado_maquina["limite_max_x"])
        min_y, max_y = min(0, estado_maquina["limite_max_y"]), max(0, estado_maquina["limite_max_y"])
        if eje == "X" and not (min_x <= dest_x <= max_x):
            acercandose_x = (prev_x < min_x and dest_x > prev_x) or (prev_x > max_x and dest_x < prev_x)
            if not acercandose_x:
                msg = f"Protección de límite X: El destino ({dest_x}) sale del rango permitido [{min_x}, {max_x}] pulsos."
                estado_maquina["ultimo_mensaje"] = msg
                return jsonify(construir_respuesta_estado(ok=False, error=msg))
        if eje == "Y" and not (min_y <= dest_y <= max_y):
            acercandose_y = (prev_y < min_y and dest_y > prev_y) or (prev_y > max_y and dest_y < prev_y)
            if not acercandose_y:
                msg = f"Protección de límite Y: El destino ({dest_y}) sale del rango permitido [{min_y}, {max_y}] pulsos."
                estado_maquina["ultimo_mensaje"] = msg
                return jsonify(construir_respuesta_estado(ok=False, error=msg))
        if eje == "Z":
            if estado_maquina.get("modo_herramienta") == "laser" or bool(data.get("libre_foco_z", False)):
                if abs(dest_z) > 50000:
                    msg = f"Protección de límite Z: El destino ({dest_z}) excede el rango maximo de seguridad de 50,000 pulsos."
                    estado_maquina["ultimo_mensaje"] = msg
                    return jsonify(construir_respuesta_estado(ok=False, error=msg))
            elif estado_maquina.get("limite_z_fijado") and estado_maquina.get("limite_max_z", 0) != estado_maquina.get("z_home_pulsos", 0):
                zh = int(estado_maquina.get("z_home_pulsos", 0))
                zm = int(estado_maquina.get("limite_max_z", 0))
                min_z, max_z = min(zh, zm), max(zh, zm)
                if not (min_z <= dest_z <= max_z):
                    acercandose_z = (prev_z < min_z and dest_z > prev_z) or (prev_z > max_z and dest_z < prev_z)
                    if not acercandose_z:
                        msg = f"Protección de límite Z: El destino ({dest_z}) sale del rango calibrado [{min_z}, {max_z}] pulsos (Home Z a Contacto Papel)."
                        estado_maquina["ultimo_mensaje"] = msg
                        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    vel_hz = max(50, int(estado_maquina.get("velocidad_hz", 1000)))
    duracion_seg = round(pasos / float(vel_hz), 3)
    duracion_anim_ms = int(max(120, min(15000, duracion_seg * 1000)))

    exito_serial, msg_serial = enviar_por_serial(eje, pasos, dir_int, duracion_seg)
    if not exito_serial:
        estado_maquina["ultimo_mensaje"] = msg_serial
        return jsonify(construir_respuesta_estado(ok=False, error=msg_serial))

    estado_maquina["pos_x"] = dest_x
    estado_maquina["pos_y"] = dest_y
    estado_maquina["pos_z"] = dest_z
    estado_maquina["motor_real_x"] = dest_x
    estado_maquina["motor_real_y"] = dest_y
    estado_maquina["motor_real_z"] = dest_z

    grados_por_pulso = float(estado_maquina["grados_por_pulso"])
    giro = pasos * grados_por_pulso * modificador
    if eje == "X":
        estado_maquina["angulo_x"] = (estado_maquina["angulo_x"] + giro) % 360
    elif eje == "Y":
        estado_maquina["angulo_y"] = (estado_maquina["angulo_y"] + giro) % 360
    elif eje == "Z":
        estado_maquina["angulo_z"] = (estado_maquina["angulo_z"] + giro) % 360

    if not estado_maquina["historial"] or estado_maquina["historial"][-1] != [dest_x, dest_y]:
        estado_maquina["historial"].append([dest_x, dest_y])

    if estado_maquina["ena"]["modo"] == "AUTO":
        estado_maquina["ena"][eje] = False

    estado_maquina["endstops"]["X"] = (estado_maquina["pos_x"] == 0)
    estado_maquina["endstops"]["Y"] = (estado_maquina["pos_y"] == 0)
    estado_maquina["endstops"]["Z"] = False

    vueltas = pasos / max(1, estado_maquina["pulse_rev"])
    nota_ena = (
        f"ENA+ {eje}: {estado_maquina['current_a']}A en giro -> 0.0A en reposo"
        if estado_maquina["ena"]["modo"] == "AUTO"
        else f"ENA+ {eje}: {estado_maquina['current_a']}A retenidos"
    )
    estado_maquina["ultimo_mensaje"] = (
        f"Eje {eje}: {delta:+} pulsos ({vueltas:.2f} rev en {duracion_seg:.2f}s) | {nota_ena}"
    )

    return jsonify(construir_respuesta_estado(
        ok=True,
        movimiento={
            "eje": eje,
            "pasos": pasos,
            "dir_int": dir_int,
            "delta": delta,
            "grados_giro": giro,
            "duracion_ms": duracion_anim_ms,
            "duracion_seg": duracion_seg,
            "velocidad_hz": vel_hz,
            "amperaje_movimiento": estado_maquina["current_a"],
            "amperaje_reposo_final": 0.0 if estado_maquina["ena"]["modo"] == "AUTO" else estado_maquina["current_a"],
            "desde": {"x": prev_x, "y": prev_y, "z": prev_z},
            "hasta": {"x": dest_x, "y": dest_y, "z": dest_z}
        }
    ))


@app.route("/api/move_xy", methods=["POST"])
def api_move_xy():
    """
    Ejecuta movimiento interpolado 2D simultáneo en los ejes X e Y (Bresenham)
    para líneas diagonales, triángulos, círculos y trazo libre sin escalones ortogonales.
    """
    data = request.get_json(silent=True) or {}
    prev_x = estado_maquina["pos_x"]
    prev_y = estado_maquina["pos_y"]
    prev_z = estado_maquina["pos_z"]

    try:
        if "dest_x" in data and "dest_y" in data:
            dest_x = int(round(float(data["dest_x"])))
            dest_y = int(round(float(data["dest_y"])))
        else:
            dx_in = int(round(float(data.get("dx", 0))))
            dy_in = int(round(float(data.get("dy", 0))))
            dest_x = prev_x + dx_in
            dest_y = prev_y + dy_in
    except (ValueError, TypeError):
        return jsonify(construir_respuesta_estado(ok=False, error="Coordenadas de destino XY inválidas.")), 400

    dx = dest_x - prev_x
    dy = dest_y - prev_y
    pasos_x = abs(dx)
    pasos_y = abs(dy)
    dir_x = 1 if dx >= 0 else 0
    dir_y = 1 if dy >= 0 else 0
    mod_x = 1 if dir_x == 1 else -1
    mod_y = 1 if dir_y == 1 else -1

    if pasos_x == 0 and pasos_y == 0:
        return jsonify(construir_respuesta_estado(
            ok=True,
            movimiento={
                "eje": "XY",
                "pasos": 0,
                "pasos_x": 0,
                "pasos_y": 0,
                "delta_x": 0,
                "delta_y": 0,
                "grados_giro_x": 0.0,
                "grados_giro_y": 0.0,
                "duracion_ms": 50,
                "duracion_seg": 0.0,
                "desde": {"x": prev_x, "y": prev_y, "z": prev_z},
                "hasta": {"x": dest_x, "y": dest_y, "z": prev_z}
            }
        ))

    if pasos_x > 100000 or pasos_y > 100000:
        return jsonify(construir_respuesta_estado(
            ok=False,
            error="Por seguridad, un solo segmento no puede exceder 100,000 pulsos por eje."
        )), 400

    if estado_maquina["microstep"] == "NC" or estado_maquina["pulse_rev"] == 0:
        msg = "Movimiento bloqueado: Driver en estado NC (S1=ON, S2=ON, S3=ON). Selecciona un Microstep válido."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["ena"]["modo"] == "FREE":
        msg = "Movimiento bloqueado: Los motores están en Corte Total ENA (0.0 A). Cambia ENA a modo AUTO o HOLD."
        estado_maquina["ultimo_mensaje"] = msg
        return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["ena"]["modo"] == "HOLD":
        if pasos_x > 0 and not estado_maquina["ena"].get("X", True):
            msg = "Movimiento bloqueado: El motor X tiene su señal ENA+ deshabilitada en modo HOLD."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))
        if pasos_y > 0 and not estado_maquina["ena"].get("Y", True):
            msg = "Movimiento bloqueado: El motor Y tiene su señal ENA+ deshabilitada en modo HOLD."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

    if estado_maquina["bloquear_limites"]:
        if not estado_maquina["limite_fijado"]:
            msg = "Enclave de seguridad activo: Debes fijar primero el Límite Máximo o desactivar el enclave."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        min_x, max_x = min(0, estado_maquina["limite_max_x"]), max(0, estado_maquina["limite_max_x"])
        min_y, max_y = min(0, estado_maquina["limite_max_y"]), max(0, estado_maquina["limite_max_y"])
        if pasos_x > 0 and not (min_x <= dest_x <= max_x):
            acercandose_x = (prev_x < min_x and dest_x > prev_x) or (prev_x > max_x and dest_x < prev_x)
            if not acercandose_x:
                msg = f"Protección de límite X: El destino ({dest_x}) sale del rango permitido [{min_x}, {max_x}] pulsos."
                estado_maquina["ultimo_mensaje"] = msg
                return jsonify(construir_respuesta_estado(ok=False, error=msg))
        if pasos_y > 0 and not (min_y <= dest_y <= max_y):
            acercandose_y = (prev_y < min_y and dest_y > prev_y) or (prev_y > max_y and dest_y < prev_y)
            if not acercandose_y:
                msg = f"Protección de límite Y: El destino ({dest_y}) sale del rango permitido [{min_y}, {max_y}] pulsos."
                estado_maquina["ultimo_mensaje"] = msg
                return jsonify(construir_respuesta_estado(ok=False, error=msg))

    recalcular_metricas_laser()
    lsr = estado_maquina["laser"]
    laser_en_segmento = bool(data.get("laser_activo", False))
    pwm_laser = None

    if "laser_pwm" in data or "laser_activo" in data:
        if laser_en_segmento:
            if not lsr.get("armado", False):
                msg = "Seguridad Laser 5W: Debes ARMAR primero el modulo laser antes de ejecutar un grabado o corte."
                estado_maquina["ultimo_mensaje"] = msg
                return jsonify(construir_respuesta_estado(ok=False, error=msg))
            pwm_laser = max(1, min(255, int(round(float(data.get("laser_pwm", lsr.get("potencia_pwm", 97)))))))
        else:
            pwm_laser = None

    if "velocidad_hz" in data:
        vel_hz = max(25, min(10000, int(round(float(data["velocidad_hz"])))))
    elif pwm_laser is not None:
        vel_hz = int(lsr["velocidad_grabado_hz"] if pwm_laser > 0 else lsr["velocidad_viaje_hz"])
        vel_hz = max(25, min(10000, vel_hz))
    else:
        vel_hz = max(50, int(estado_maquina.get("velocidad_hz", 500)))

    if pwm_laser is not None and pwm_laser > 0:
        if vel_hz >= 600:
            vel_hz = 180
        vel_hz = max(25, min(500, vel_hz))

    pasos_dominantes = max(pasos_x, pasos_y)
    if pwm_laser is not None and pwm_laser > 0 and lsr.get("compensacion_diagonal", True):
        dist_euc = math.hypot(pasos_x, pasos_y)
        duracion_seg = round(dist_euc / float(vel_hz), 3)
    else:
        duracion_seg = round(pasos_dominantes / float(vel_hz), 3)
    duracion_anim_ms = int(max(40, min(25000, duracion_seg * 1000)))

    exito_serial, msg_serial = enviar_interpolacion_xy_serial(
        pasos_x, dir_x, pasos_y, dir_y, duracion_seg,
        pwm_laser=pwm_laser, vel_hz=vel_hz
    )
    if not exito_serial:
        lsr["activo"] = False
        lsr["modo_emision"] = "OFF"
        estado_maquina["ultimo_mensaje"] = msg_serial
        return jsonify(construir_respuesta_estado(ok=False, error=msg_serial))

    # Al concluir cada segmento M2L el laser vuelve a reposo (0W) de forma dinamica
    lsr["activo"] = False
    lsr["modo_emision"] = "OFF"

    estado_maquina["pos_x"] = dest_x
    estado_maquina["pos_y"] = dest_y
    estado_maquina["motor_real_x"] = dest_x
    estado_maquina["motor_real_y"] = dest_y

    grados_por_pulso = float(estado_maquina["grados_por_pulso"])
    giro_x = pasos_x * grados_por_pulso * mod_x
    giro_y = pasos_y * grados_por_pulso * mod_y
    estado_maquina["angulo_x"] = (estado_maquina["angulo_x"] + giro_x) % 360
    estado_maquina["angulo_y"] = (estado_maquina["angulo_y"] + giro_y) % 360

    if not estado_maquina["historial"] or estado_maquina["historial"][-1] != [dest_x, dest_y]:
        estado_maquina["historial"].append([dest_x, dest_y])

    if estado_maquina["ena"]["modo"] == "AUTO":
        estado_maquina["ena"]["X"] = False
        estado_maquina["ena"]["Y"] = False

    estado_maquina["endstops"]["X"] = (estado_maquina["pos_x"] == 0)
    estado_maquina["endstops"]["Y"] = (estado_maquina["pos_y"] == 0)

    eje_etiqueta = "XY" if (pasos_x > 0 and pasos_y > 0) else ("X" if pasos_x > 0 else "Y")
    watts_seg = round((pwm_laser / 255.0) * 5.0, 2) if (pwm_laser and pwm_laser > 0) else 0.0
    if pwm_laser is not None:
        etq_lsr = f"Laser 5W ACTIVO ({watts_seg:.2f}W | PWM {pwm_laser}/255)" if pwm_laser > 0 else "Viaje en Vacio (Laser 0.0W)"
        estado_maquina["ultimo_mensaje"] = (
            f"[{etq_lsr}] {eje_etiqueta}: dX={dx:+} ({pasos_x}p), dY={dy:+} ({pasos_y}p) "
            f"a {vel_hz} Hz ({duracion_seg:.2f}s) | Destino=({dest_x}, {dest_y})"
        )
    else:
        estado_maquina["ultimo_mensaje"] = (
            f"Interpolación {eje_etiqueta} simultánea: dX={dx:+} ({pasos_x}p), dY={dy:+} ({pasos_y}p) "
            f"en {duracion_seg:.2f}s | Destino=({dest_x}, {dest_y})"
        )

    return jsonify(construir_respuesta_estado(
        ok=True,
        movimiento={
            "eje": eje_etiqueta,
            "pasos": pasos_dominantes,
            "pasos_x": pasos_x,
            "pasos_y": pasos_y,
            "dir_x": dir_x,
            "dir_y": dir_y,
            "delta_x": dx,
            "delta_y": dy,
            "grados_giro_x": giro_x,
            "grados_giro_y": giro_y,
            "duracion_ms": duracion_anim_ms,
            "duracion_seg": duracion_seg,
            "velocidad_hz": vel_hz,
            "laser_activo": bool(pwm_laser and pwm_laser > 0),
            "laser_pwm": int(pwm_laser or 0),
            "laser_watts": watts_seg,
            "amperaje_movimiento": estado_maquina["current_a"],
            "amperaje_reposo_final": 0.0 if estado_maquina["ena"]["modo"] == "AUTO" else estado_maquina["current_a"],
            "desde": {"x": prev_x, "y": prev_y, "z": prev_z},
            "hasta": {"x": dest_x, "y": dest_y, "z": prev_z}
        }
    ))


@app.route("/api/calibrate", methods=["POST"])
def api_calibrate():
    data = request.get_json(silent=True) or {}
    accion = data.get("accion", "")

    if accion == "fijar_cero":
        estado_maquina["pos_x"] = 0
        estado_maquina["pos_y"] = 0
        estado_maquina["motor_real_x"] = 0
        estado_maquina["motor_real_y"] = 0
        if data.get("incluir_z", False):
            estado_maquina["pos_z"] = 0
            estado_maquina["motor_real_z"] = 0
            estado_maquina["z_home_pulsos"] = 0
            estado_maquina["origen_z_fijado"] = True
        estado_maquina["posicion_sincronizada"] = True
        estado_maquina["origen_fijado"] = True
        estado_maquina["historial"] = [[0, 0]]
        enviar_comando_raw_serial("ZERO")
        estado_maquina["ultimo_mensaje"] = "Referencia Home X, Y (0, 0) establecida en esquina inferior izquierda."

    elif accion == "fijar_home_z":
        estado_maquina["pos_z"] = 0
        estado_maquina["motor_real_z"] = 0
        estado_maquina["z_home_pulsos"] = 0
        estado_maquina["origen_z_fijado"] = True
        estado_maquina["posicion_sincronizada"] = True
        enviar_comando_raw_serial("ZERO_Z")
        estado_maquina["ultimo_mensaje"] = (
            "Home del Eje Z (0 pulsos - Herramienta levantada / posición de viaje) fijado manualmente."
        )

    elif accion == "fijar_limite_z":
        if estado_maquina["pos_z"] == 0 and not data.get("usar_demo_si_cero", False):
            return jsonify(construir_respuesta_estado(
                ok=False,
                error="Error de validación Z: El Eje Z está en 0 (Home Z). Desplaza primero el Eje Z hasta que el lápiz/plumón toque el papel antes de fijar el Máximo Z."
            ))
        if estado_maquina["pos_z"] == 0 and data.get("usar_demo_si_cero", False):
            estado_maquina["limite_max_z"] = 400
        else:
            estado_maquina["limite_max_z"] = int(estado_maquina["pos_z"])
        estado_maquina["z_home_pulsos"] = 0
        estado_maquina["origen_z_fijado"] = True
        estado_maquina["limite_z_fijado"] = True
        estado_maquina["usar_z_dibujo"] = True
        estado_maquina["ultimo_mensaje"] = (
            f"Máximo del Eje Z (Contacto Lápiz/Plumón con Papel) fijado en {estado_maquina['limite_max_z']} pulsos "
            f"(Home Z = {estado_maquina['z_home_pulsos']} pulsos). Control de Eje Z activado para el Estudio de Dibujo."
        )

    elif accion == "fijar_limite":
        if estado_maquina["pos_x"] == 0 and estado_maquina["pos_y"] == 0:
            if data.get("usar_demo_si_cero", False):
                p_rev = estado_maquina["pulse_rev"] or 3200
                estado_maquina["limite_max_x"] = p_rev * 4
                estado_maquina["limite_max_y"] = p_rev * 3
            else:
                return jsonify(construir_respuesta_estado(
                    ok=False,
                    error="Error de validación: No puedes fijar el Límite Máximo en (0,0). Desplaza primero X e Y hasta la esquina superior derecha."
                ))
        elif estado_maquina["pos_x"] == 0 or estado_maquina["pos_y"] == 0:
            return jsonify(construir_respuesta_estado(
                ok=False,
                error="Error de validación: Ambos ejes X e Y deben ser distintos de 0 para formar un área de trabajo 2D válida."
            ))
        else:
            notas_inv = []
            if estado_maquina["pos_x"] < 0:
                estado_maquina["invertir_dir"]["X"] = not estado_maquina["invertir_dir"].get("X", False)
                estado_maquina["pos_x"] = abs(estado_maquina["pos_x"])
                estado_maquina["motor_real_x"] = estado_maquina["pos_x"]
                notas_inv.append("DIR X auto-invertido")
            if estado_maquina["pos_y"] < 0:
                estado_maquina["invertir_dir"]["Y"] = not estado_maquina["invertir_dir"].get("Y", True)
                estado_maquina["pos_y"] = abs(estado_maquina["pos_y"])
                estado_maquina["motor_real_y"] = estado_maquina["pos_y"]
                notas_inv.append("DIR Y auto-invertido (Placa móvil)")

            estado_maquina["limite_max_x"] = abs(estado_maquina["pos_x"])
            estado_maquina["limite_max_y"] = abs(estado_maquina["pos_y"])
            estado_maquina["historial"] = [[abs(pt[0]), abs(pt[1])] for pt in estado_maquina["historial"]]

        estado_maquina["limite_fijado"] = True
        estado_maquina["ultimo_mensaje"] = (
            f"Home (0,0) en Esquina Inferior Izquierda | Envolvente máxima X={estado_maquina['limite_max_x']}, "
            f"Y={estado_maquina['limite_max_y']} pulsos."
        )

    elif accion == "invertir_direccion_eje":
        eje = str(data.get("eje", "Y")).upper()
        if eje in ("X", "Y", "Z"):
            actual = bool(estado_maquina["invertir_dir"].get(eje, False))
            nuevo = bool(data["invertir"]) if "invertir" in data else (not actual)
            estado_maquina["invertir_dir"][eje] = nuevo
            estado_txt = "INVERTIDO" if nuevo else "NORMAL"
            estado_maquina["ultimo_mensaje"] = (
                f"Sentido de giro físico DIR del Eje {eje} configurado en modo {estado_txt}. "
                f"Home (0,0) en esquina inferior izquierda."
            )
            # Persistir en perfil activo si existe
            if estado_maquina.get("perfil_activo"):
                try:
                    ruta_p = os.path.join(CARPETA_PERFILES, f"{estado_maquina['perfil_activo']}.json")
                    if os.path.exists(ruta_p):
                        with open(ruta_p, "r", encoding="utf-8") as fh:
                            pdata = json.load(fh)
                        pdata["invertir_dir"] = dict(estado_maquina["invertir_dir"])
                        with open(ruta_p, "w", encoding="utf-8") as fh:
                            json.dump(pdata, fh, indent=4, ensure_ascii=False)
                except Exception:
                    pass

    elif accion == "intercambiar_ejes_xy":
        actual = bool(estado_maquina.get("intercambiar_xy", False))
        nuevo = bool(data["intercambiar"]) if "intercambiar" in data else (not actual)
        estado_maquina["intercambiar_xy"] = nuevo
        txt = "INTERCAMBIADOS (X=Mesa móvil, Y=Puente)" if nuevo else "ESTÁNDAR (X=Puente fijo, Y=Placa móvil)"
        estado_maquina["ultimo_mensaje"] = f"Mapeo de Cinemática XY: {txt}."
        if estado_maquina.get("perfil_activo"):
            try:
                ruta_p = os.path.join(CARPETA_PERFILES, f"{estado_maquina['perfil_activo']}.json")
                if os.path.exists(ruta_p):
                    with open(ruta_p, "r", encoding="utf-8") as fh:
                        pdata = json.load(fh)
                    pdata["intercambiar_xy"] = nuevo
                    with open(ruta_p, "w", encoding="utf-8") as fh:
                        json.dump(pdata, fh, indent=4, ensure_ascii=False)
            except Exception:
                pass

    elif accion == "configurar_hard_limits":
        activar = bool(data.get("activar", not estado_maquina.get("hard_limits_activos", False)))
        estado_maquina["hard_limits_activos"] = activar
        enviar_comando_raw_serial(f"LIMITS,{1 if activar else 0}")
        estado_maquina["ultimo_mensaje"] = (
            f"Protección Hard Limits en movimiento: {'ACTIVADA (Detiene pasos si toca switch)' if activar else 'DESACTIVADA (Modo seguro contra ruido EMI para grabado laser)'}."
        )

    elif accion == "definir_dimensiones_mm":
        escala = max(0.01, float(estado_maquina["pasos_por_mm"]))
        if "limite_max_x" in data and "limite_max_y" in data:
            lim_x = max(50, int(round(float(data.get("limite_max_x", estado_maquina["limite_max_x"])))))
            lim_y = max(50, int(round(float(data.get("limite_max_y", estado_maquina["limite_max_y"])))))
            estado_maquina["limite_max_x"] = lim_x
            estado_maquina["limite_max_y"] = lim_y
            ancho_mm = round(lim_x / escala, 2)
            alto_mm = round(lim_y / escala, 2)
        else:
            ancho_mm = max(5.0, float(data.get("ancho_mm", 160.0)))
            alto_mm = max(5.0, float(data.get("alto_mm", 120.0)))
            alto_z_mm = max(5.0, float(data.get("alto_z_mm", 40.0)))
            estado_maquina["limite_max_x"] = int(round(ancho_mm * escala))
            estado_maquina["limite_max_y"] = int(round(alto_mm * escala))
            estado_maquina["limite_max_z"] = int(round(alto_z_mm * escala))
        estado_maquina["limite_fijado"] = True
        estado_maquina["ultimo_mensaje"] = (
            f"Zona de trabajo sincronizada a {ancho_mm:.1f} x {alto_mm:.1f} mm "
            f"({estado_maquina['limite_max_x']} x {estado_maquina['limite_max_y']} pulsos)."
        )

    elif accion == "sincronizar_parada":
        px = int(round(float(data.get("pos_x", estado_maquina["pos_x"]))))
        py = int(round(float(data.get("pos_y", estado_maquina["pos_y"]))))
        pz = int(round(float(data.get("pos_z", estado_maquina["pos_z"]))))
        estado_maquina["pos_x"] = px
        estado_maquina["pos_y"] = py
        estado_maquina["pos_z"] = pz
        estado_maquina["motor_real_x"] = px
        estado_maquina["motor_real_y"] = py
        estado_maquina["motor_real_z"] = pz
        estado_maquina["laser"]["activo"] = False
        estado_maquina["laser"]["modo_emision"] = "OFF"
        enviar_comando_raw_serial("LASER,OFF")
        if estado_maquina["ena"]["modo"] == "AUTO":
            estado_maquina["ena"]["X"] = False
            estado_maquina["ena"]["Y"] = False
            estado_maquina["ena"]["Z"] = False
            enviar_comando_raw_serial("ENA,ALL,0")
        estado_maquina["historial"].append([px, py])
        estado_maquina["ultimo_mensaje"] = f"Parada ejecutada. Laser en 0.0W y bobinas en reposo (0.0 A) en ({px}, {py}, {pz}) pulsos."

    elif accion == "limpiar_rastro":
        estado_maquina["historial"] = [[estado_maquina["pos_x"], estado_maquina["pos_y"]]]
        estado_maquina["ultimo_mensaje"] = "Historial de trayectoria reiniciado."

    elif accion == "configurar_switches":
        nuevos_sw = data.get("switches", {})
        for k in ("S1", "S2", "S3", "S4", "S5", "S6"):
            if k in nuevos_sw:
                estado_maquina["switches"][k] = bool(nuevos_sw[k])
        recalcular_driver_desde_switches(actualizar_escala=True)

        sw = estado_maquina["switches"]
        s_txt = " ".join([f"{k}:{'ON' if sw[k] else 'OFF'}" for k in ("S1", "S2", "S3", "S4", "S5", "S6")])
        if estado_maquina["microstep"] == "NC":
            estado_maquina["ultimo_mensaje"] = f"Alerta [{s_txt}] -> Estado NC (Driver deshabilitado, ENA en corte 0.0A)"
        else:
            nota_ahorro = (
                " | Corte ENA en reposo activo (0.0A sin mover)"
                if estado_maquina["ena"]["modo"] == "AUTO"
                else ""
            )
            estado_maquina["ultimo_mensaje"] = (
                f"Switches [{s_txt}] -> Microstep {estado_maquina['microstep']} "
                f"({estado_maquina['pulse_rev']} P/rev) | {estado_maquina['current_a']}A (PK {estado_maquina['pk_current_a']}A){nota_ahorro}"
            )

    elif accion == "actualizar_ajustes":
        if "pasos_por_mm" in data:
            try:
                val = float(data["pasos_por_mm"])
                if val > 0:
                    estado_maquina["pasos_por_mm"] = val
                    if estado_maquina["pulse_rev"] > 0:
                        estado_maquina["mm_por_rev"] = round(estado_maquina["pulse_rev"] / val, 2)
            except ValueError:
                pass
        if "velocidad_hz" in data:
            try:
                vhz = int(float(data["velocidad_hz"]))
                estado_maquina["velocidad_hz"] = max(50, min(4000, vhz))
                enviar_comando_raw_serial(f"SPEED,{estado_maquina['velocidad_hz']}")
            except ValueError:
                pass
        if "bloquear_limites" in data:
            estado_maquina["bloquear_limites"] = bool(data["bloquear_limites"])
        if "autocalibrar_inicio" in data:
            estado_maquina["autocalibrar_inicio"] = bool(data["autocalibrar_inicio"])
            estado_maquina["ultimo_mensaje"] = (
                "Auto-Calibración por microswitches en cada inicio: ACTIVADA."
                if estado_maquina["autocalibrar_inicio"]
                else "Auto-Calibración por microswitches en cada inicio: DESACTIVADA."
            )
        if "usar_z_dibujo" in data:
            estado_maquina["usar_z_dibujo"] = bool(data["usar_z_dibujo"])
            estado_txt = "ACTIVADO (Baja a Contacto Papel / Sube a Home Z)" if estado_maquina["usar_z_dibujo"] else "DESACTIVADO (Solo movimiento 2D X+Y)"
            estado_maquina["ultimo_mensaje"] = f"Control de Eje Z en Estudio de Dibujo: {estado_txt}."
        if "z_home_pulsos" in data:
            try:
                estado_maquina["z_home_pulsos"] = int(round(float(data["z_home_pulsos"])))
            except (ValueError, TypeError):
                pass
        if "limite_max_z" in data:
            try:
                estado_maquina["limite_max_z"] = int(round(float(data["limite_max_z"])))
                estado_maquina["limite_z_fijado"] = True
            except (ValueError, TypeError):
                pass
        if "modo_simulacion" in data:
            querer_sim = bool(data["modo_simulacion"])
            if not querer_sim and not estado_maquina["conectado"]:
                estado_maquina["modo_simulacion"] = True
                estado_maquina["error_puerto"] = (
                    f"No se puede desactivar Simulación porque el puerto {estado_maquina['puerto']} no está conectado."
                )
                return jsonify(construir_respuesta_estado(
                    ok=False,
                    error=estado_maquina["error_puerto"]
                ))
            estado_maquina["modo_simulacion"] = querer_sim
            estado_maquina["error_puerto"] = None
            if estado_maquina["modo_simulacion"]:
                estado_maquina["ultimo_mensaje"] = "Modo Simulación Virtual activado."
            else:
                estado_maquina["ultimo_mensaje"] = f"Modo Hardware Serial activo en {estado_maquina['puerto']}."

    return jsonify(construir_respuesta_estado(ok=True))


@app.route("/api/export", methods=["GET"])
def api_export():
    escala = max(0.001, float(estado_maquina["pasos_por_mm"]))
    lim_x = estado_maquina["limite_max_x"] if estado_maquina["limite_fijado"] else estado_maquina["pos_x"]
    lim_y = estado_maquina["limite_max_y"] if estado_maquina["limite_fijado"] else estado_maquina["pos_y"]
    lim_z = estado_maquina["limite_max_z"] if estado_maquina["limite_fijado"] else estado_maquina["pos_z"]

    sw = estado_maquina["switches"]
    reporte = {
        "id": estado_maquina.get("perfil_activo", "configuracion_exportada"),
        "nombre": f"Perfil Exportado ({estado_maquina['microstep']}x - {estado_maquina['current_a']}A)",
        "proyecto": "Especificación de Estación de Trabajo CNC - Motores NEMA v2.0",
        "fecha_exportacion": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "switches": dict(sw),
        "ena_modo": estado_maquina["ena"]["modo"],
        "velocidad_hz": estado_maquina["velocidad_hz"],
        "pasos_por_mm": escala,
        "mm_por_rev": estado_maquina["mm_por_rev"],
        "limite_fijado": estado_maquina["limite_fijado"],
        "limite_max_x": lim_x,
        "limite_max_y": lim_y,
        "limite_max_z": lim_z,
        "bloquear_limites": estado_maquina["bloquear_limites"],
        "autocalibrar_inicio": estado_maquina.get("autocalibrar_inicio", True),
        "puerto": estado_maquina["puerto"],
        "configuracion_driver_dip": {
            "switches": {k: ("ON" if sw[k] else "OFF") for k in ("S1", "S2", "S3", "S4", "S5", "S6")},
            "tabla_1_microstep": {
                "micro_step": estado_maquina["microstep"],
                "pulse_rev": estado_maquina["pulse_rev"],
                "grados_por_pulso": estado_maquina["grados_por_pulso"]
            },
            "tabla_2_current": {
                "current_a": estado_maquina["current_a"],
                "pk_current_a": estado_maquina["pk_current_a"],
                "modo_enable_ena": estado_maquina["ena"]["modo"],
                "corriente_reposo_a": 0.0 if estado_maquina["ena"]["modo"] in ("AUTO", "FREE") else estado_maquina["current_a"]
            },
            "velocidad_operacion_hz": estado_maquina["velocidad_hz"]
        },
        "comunicacion": {
            "puerto_serial": estado_maquina["puerto"],
            "baud_rate": estado_maquina["baud_rate"],
            "modo_simulacion": estado_maquina["modo_simulacion"],
            "posicion_sincronizada": estado_maquina["posicion_sincronizada"]
        },
        "calibracion": {
            "calibrado_completado": estado_maquina["limite_fijado"],
            "relacion_pasos_por_mm": escala,
            "origen_pulsos": {"x": 0, "y": 0, "z": 0},
            "limites_maximos_pulsos": {"x": lim_x, "y": lim_y, "z": lim_z},
            "centro_trabajo_pulsos": {"x": lim_x // 2, "y": lim_y // 2}
        },
        "espacio_trabajo_final_mm": {
            "ancho_x_mm": round(abs(lim_x) / escala, 2),
            "fondo_y_mm": round(abs(lim_y) / escala, 2),
            "altura_z_mm": round(abs(lim_z) / escala, 2),
            "area_util_cm2": round(((abs(lim_x) / escala) * (abs(lim_y) / escala)) / 100.0, 2),
            "margen_seguro_90_mm": {
                "ancho_x_mm": round((abs(lim_x) / escala) * 0.9, 2),
                "fondo_y_mm": round((abs(lim_y) / escala) * 0.9, 2)
            }
        }
    }

    contenido = json.dumps(reporte, indent=4, ensure_ascii=False)
    return Response(
        contenido,
        mimetype="application/json",
        headers={"Content-Disposition": "attachment;filename=especificacion_estacion_cnc.json"}
    )


@app.route("/api/laser", methods=["POST"])
def api_laser():
    """
    Controla el Modulo Laser de Diodo de 5W Opticos:
    - Cambio de modo de herramienta del Estudio ('dibujo' <-> 'laser')
    - Armado / Desarmado de seguridad ('LASER,ARM,1' / 'LASER,ARM,0')
    - Apagado inmediato de emergencia ('LASER,OFF')
    - Puntero de enfoque de baja potencia ('LASER,FOCUS,<pwm>')
    - Disparo de pulso de prueba temporalizado ('LASER,PULSE,<pwm>,<ms>')
    - Calibracion de punto focal en Eje Z ('fijar_z_foco')
    - Presets de materiales para 5W y configuracion de potencia/velocidad/pasadas
    """
    data = request.get_json(silent=True) or {}
    accion = str(data.get("accion", "configurar")).strip().lower()
    lsr = estado_maquina["laser"]
    recalcular_metricas_laser()

    if accion == "cambiar_herramienta":
        nuevo_modo = str(data.get("modo_herramienta", "dibujo")).strip().lower()
        if nuevo_modo not in ("dibujo", "laser"):
            return jsonify(construir_respuesta_estado(ok=False, error="Modo de herramienta invalido.")), 400
        estado_maquina["modo_herramienta"] = nuevo_modo
        if nuevo_modo == "dibujo":
            lsr["activo"] = False
            lsr["emitiendo"] = False
            lsr["en_foco"] = False
            lsr["pwm_actual"] = 0
            lsr["watts_actuales"] = 0.0
            lsr["modo_emision"] = "OFF"
            enviar_comando_raw_serial("LASER,OFF")
            estado_maquina["ultimo_mensaje"] = (
                "Estudio cambiado a MODO DIBUJO (Pluma / Plumon con Eje Z). Modulo Laser 5W en corte seguro (0.0 W)."
            )
        else:
            estado_maquina["ultimo_mensaje"] = (
                f"Estudio cambiado a MODO LASER 5W ({lsr['potencia_pct']}% = {lsr['potencia_watts']:.2f}W | "
                f"Grabado: {lsr['velocidad_grabado_hz']} Hz, Viaje: {lsr['velocidad_viaje_hz']} Hz)."
            )
        return jsonify(construir_respuesta_estado(ok=True))

    if accion in ("pwr", "set_pwm", "potencia"):
        pwm_val = int(data.get("pwm", 0))
        pwm_val = max(0, min(255, pwm_val))
        if pwm_val <= 0:
            lsr["activo"] = False
            lsr["emitiendo"] = False
            lsr["en_foco"] = False
            lsr["emision_manual_continua"] = False
            lsr["pwm_actual"] = 0
            lsr["watts_actuales"] = 0.0
            lsr["modo_emision"] = "OFF"
            enviar_comando_raw_serial("LASER,OFF")
            return jsonify(construir_respuesta_estado(ok=True, pwm=0))
        else:
            if not lsr.get("armado", False):
                enviar_comando_raw_serial("LASER,OFF")
                return jsonify(construir_respuesta_estado(ok=True, pwm=0, aviso="Simulación en seco: Laser no armado"))
            lsr["activo"] = True
            lsr["emitiendo"] = True
            lsr["en_foco"] = False
            lsr["pwm_actual"] = pwm_val
            lsr["watts_actuales"] = round((pwm_val / 255.0) * 5.0, 2)
            lsr["modo_emision"] = "TRABAJO"
            enviar_comando_raw_serial("LASER,ARM,1")
            enviar_comando_raw_serial(f"LASER,PWR,{pwm_val}")
            return jsonify(construir_respuesta_estado(ok=True, pwm=pwm_val))

    if accion == "armar":
        armar = bool(data.get("armado", not lsr["armado"]))
        lsr["armado"] = armar
        if not armar:
            lsr["activo"] = False
            lsr["emitiendo"] = False
            lsr["en_foco"] = False
            lsr["pwm_actual"] = 0
            lsr["watts_actuales"] = 0.0
            lsr["modo_emision"] = "OFF"
            enviar_comando_raw_serial("LASER,ARM,0")
            enviar_comando_raw_serial("LASER,OFF")
            estado_maquina["ultimo_mensaje"] = "Seguridad Laser 5W: Modulo DESARMADO y bloqueado en 0.00 W (PWM 0)."
        else:
            enviar_comando_raw_serial("LASER,ARM,1")
            estado_maquina["ultimo_mensaje"] = (
                "Seguridad Laser 5W: Modulo ARMADO y listo para pruebas de enfoque, pulso o grabado CNC."
            )
        return jsonify(construir_respuesta_estado(ok=True))

    if accion == "apagar":
        lsr["activo"] = False
        lsr["emitiendo"] = False
        lsr["en_foco"] = False
        lsr["emision_manual_continua"] = False
        lsr["pwm_actual"] = 0
        lsr["watts_actuales"] = 0.0
        lsr["modo_emision"] = "OFF"
        if data.get("desarmar", False):
            lsr["armado"] = False
            enviar_comando_raw_serial("LASER,ARM,0")
        enviar_comando_raw_serial("LASER,OFF")
        estado_maquina["ultimo_mensaje"] = "Corte inmediato ejecutado: Haz Laser 5W apagado (0.00 W / PWM 0)."
        return jsonify(construir_respuesta_estado(ok=True))

    if accion == "manual":
        # Control Manual directo del Laser 5W (3 entradas: VCC 12V, GND, PWM)
        if "jog_con_laser" in data:
            lsr["jog_con_laser"] = bool(data["jog_con_laser"])

        if "potencia_manual_pct" in data:
            try:
                lsr["potencia_manual_pct"] = max(0.0, min(100.0, round(float(data["potencia_manual_pct"]), 1)))
            except (ValueError, TypeError):
                pass
        elif "delta_pct" in data:
            try:
                lsr["potencia_manual_pct"] = max(
                    0.0,
                    min(100.0, round(float(lsr.get("potencia_manual_pct", 25.0)) + float(data["delta_pct"]), 1))
                )
            except (ValueError, TypeError):
                pass

        recalcular_metricas_laser()

        # Determinar si debe encender, apagar o mantener el estado actual de emision manual
        if "encender" in data:
            encender_man = bool(data["encender"])
        else:
            encender_man = bool(lsr.get("activo") and lsr.get("modo_emision") == "MANUAL")

        if not encender_man or lsr["potencia_manual_pwm"] <= 0:
            estaba_activo = bool(lsr.get("activo"))
            lsr["activo"] = False
            lsr["emitiendo"] = False
            lsr["en_foco"] = False
            lsr["emision_manual_continua"] = False
            lsr["pwm_actual"] = 0
            lsr["watts_actuales"] = 0.0
            lsr["modo_emision"] = "OFF"
            if estaba_activo or ("encender" in data and not data["encender"]):
                enviar_comando_raw_serial("LASER,OFF")
                estado_maquina["ultimo_mensaje"] = (
                    f"Control Manual Laser 5W: Salida en 0.00 W (Potencia manual preseleccionada: "
                    f"{lsr['potencia_manual_pct']}% = {lsr['potencia_manual_watts']:.2f} W | PWM {lsr['potencia_manual_pwm']}/255)."
                )
            else:
                modo_jog_txt = "ACTIVO" if lsr["jog_con_laser"] else "INACTIVO"
                estado_maquina["ultimo_mensaje"] = (
                    f"Control Manual Laser 5W ajustado a {lsr['potencia_manual_pct']}% "
                    f"({lsr['potencia_manual_watts']:.2f} W | PWM {lsr['potencia_manual_pwm']}/255) | Jog X/Y con Laser: {modo_jog_txt}."
                )
            return jsonify(construir_respuesta_estado(ok=True))

        if not lsr["armado"]:
            msg = "Seguridad Laser 5W: Primero activa 'Armar Sistema Laser 5W' para emitir manualmente."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        pwm_man = lsr["potencia_manual_pwm"]
        watts_man = lsr["potencia_manual_watts"]
        enviar_comando_raw_serial("LASER,ARM,1")
        enviar_comando_raw_serial(f"LASER,PWR,{pwm_man}")
        lsr["activo"] = True
        lsr["emitiendo"] = True
        lsr["en_foco"] = False
        lsr["emision_manual_continua"] = True
        lsr["pwm_actual"] = pwm_man
        lsr["watts_actuales"] = watts_man
        lsr["modo_emision"] = "MANUAL"
        estado_maquina["ultimo_mensaje"] = (
            f"Control Manual Laser 5W EMITIENDO EN VIVO: {lsr['potencia_manual_pct']}% "
            f"({watts_man:.2f} W | PWM {pwm_man}/255 a 5000 Hz)."
        )
        return jsonify(construir_respuesta_estado(ok=True))

    if accion == "foco":
        encender = bool(data.get("activo", data.get("encender", not (lsr["activo"] and lsr["modo_emision"] == "FOCUS"))))
        if "potencia_foco_pct" in data:
            try:
                lsr["potencia_foco_pct"] = max(1.0, min(12.0, round(float(data["potencia_foco_pct"]), 1)))
            except (ValueError, TypeError):
                pass
        recalcular_metricas_laser()
        if not encender:
            lsr["activo"] = False
            lsr["emitiendo"] = False
            lsr["en_foco"] = False
            lsr["pwm_actual"] = 0
            lsr["watts_actuales"] = 0.0
            lsr["modo_emision"] = "OFF"
            enviar_comando_raw_serial("LASER,OFF")
            estado_maquina["ultimo_mensaje"] = "Puntero de enfoque Laser 5W apagado (0.00 W)."
            return jsonify(construir_respuesta_estado(ok=True))

        if not lsr["armado"]:
            msg = "Seguridad Laser 5W: Primero activa 'Armar Laser 5W' antes de encender el puntero de enfoque."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        pwm_foco = lsr["potencia_foco_pwm"]
        watts_foco = round((pwm_foco / 255.0) * 5.0, 2)
        enviar_comando_raw_serial("LASER,ARM,1")
        enviar_comando_raw_serial(f"LASER,FOCUS,{pwm_foco}")
        lsr["activo"] = True
        lsr["emitiendo"] = True
        lsr["en_foco"] = True
        lsr["pwm_actual"] = pwm_foco
        lsr["watts_actuales"] = watts_foco
        lsr["modo_emision"] = "FOCUS"
        estado_maquina["ultimo_mensaje"] = (
            f"Puntero de Enfoque Laser 5W ENCENDIDO al {lsr['potencia_foco_pct']}% (~{watts_foco:.2f} W, PWM {pwm_foco}/255). "
            f"Ajusta la lente o el Eje Z; cuenta con apagado automatico de seguridad."
        )
        return jsonify(construir_respuesta_estado(ok=True))

    if accion == "pulso_prueba":
        if not lsr["armado"]:
            msg = "Seguridad Laser 5W: Primero activa 'Armar Laser 5W' antes de disparar un pulso de prueba."
            estado_maquina["ultimo_mensaje"] = msg
            return jsonify(construir_respuesta_estado(ok=False, error=msg))

        pct_raw = data.get("potencia_prueba_pct", data.get("potencia_pct", lsr.get("potencia_prueba_pct", 20.0)))
        pct_pulso = max(1.0, min(100.0, round(float(pct_raw), 1)))
        dur_ms = max(20, min(5000, int(round(float(data.get("duracion_ms", lsr.get("pulso_prueba_ms", 250)))))))
        lsr["potencia_prueba_pct"] = pct_pulso
        lsr["pulso_prueba_ms"] = dur_ms
        lsr["duracion_pulso_ms"] = dur_ms
        pwm_pulso = max(1, min(255, int(round((pct_pulso / 100.0) * 255))))
        watts_pulso = round((pct_pulso / 100.0) * 5.0, 2)
        energia_joules = round(watts_pulso * (dur_ms / 1000.0), 3)

        enviar_comando_raw_serial("LASER,ARM,1")
        enviar_comando_raw_serial(f"LASER,PULSE,{pwm_pulso},{dur_ms}")
        lsr["activo"] = True
        lsr["emitiendo"] = True
        lsr["en_foco"] = False
        lsr["pwm_actual"] = pwm_pulso
        lsr["watts_actuales"] = watts_pulso
        lsr["modo_emision"] = "PULSE"
        estado_maquina["ultimo_mensaje"] = (
            f"Pulso de prueba Laser 5W disparado: {pct_pulso}% ({watts_pulso:.2f} W | PWM {pwm_pulso}/255) "
            f"durante {dur_ms} ms (Energia: {energia_joules:.3f} J). Auto-apagado a 0.00 W al concluir."
        )
        return jsonify(construir_respuesta_estado(
            ok=True,
            pulso_prueba={
                "potencia_pct": pct_pulso,
                "potencia_pwm": pwm_pulso,
                "potencia_watts": watts_pulso,
                "duracion_ms": dur_ms,
                "energia_joules": energia_joules
            }
        ))

    if accion == "fijar_z_foco":
        lsr["z_foco_pulsos"] = int(estado_maquina["pos_z"])
        lsr["z_foco_fijado"] = True
        lsr["usar_z_foco"] = True
        escala = max(0.01, float(estado_maquina["pasos_por_mm"]))
        mm_foco = round(lsr["z_foco_pulsos"] / escala, 2)
        estado_maquina["ultimo_mensaje"] = (
            f"Altura Focal optima del Laser 5W registrada en Z = {lsr['z_foco_pulsos']} pulsos ({mm_foco:.2f} mm)."
        )
        return jsonify(construir_respuesta_estado(ok=True))

    if accion == "aplicar_preset":
        clave = str(data.get("preset", "")).strip()
        if clave not in PRESETS_LASER_5W:
            return jsonify(construir_respuesta_estado(ok=False, error="Preset de material no encontrado.")), 400
        pr = PRESETS_LASER_5W[clave]
        lsr["preset_material"] = clave
        lsr["material_preset"] = clave
        lsr["modo_operacion"] = pr["modo_operacion"]
        lsr["potencia_pct"] = pr["potencia_pct"]
        lsr["velocidad_grabado_hz"] = pr["velocidad_grabado_hz"]
        lsr["velocidad_viaje_hz"] = pr["velocidad_viaje_hz"]
        lsr["pasadas"] = pr["pasadas"]
        lsr["spot_mm"] = pr["spot_mm"]
        recalcular_metricas_laser()
        estado_maquina["ultimo_mensaje"] = (
            f"Preset Laser 5W aplicado: {pr['nombre']} -> {lsr['potencia_pct']}% ({lsr['potencia_watts']:.2f}W), "
            f"Grabado {lsr['velocidad_grabado_hz']} Hz, Viaje {lsr['velocidad_viaje_hz']} Hz, {lsr['pasadas']} pasada(s)."
        )
        return jsonify(construir_respuesta_estado(ok=True))

    # Accion "configurar": actualizar parametros del laser de 5W
    if "modo_operacion" in data and data["modo_operacion"] in ("grabado_linea", "grabado_relleno", "grabado_tonal", "corte"):
        lsr["modo_operacion"] = data["modo_operacion"]
    if "potencia_pct" in data:
        try:
            lsr["potencia_pct"] = max(0.0, min(100.0, round(float(data["potencia_pct"]), 1)))
        except (ValueError, TypeError):
            pass
    if "potencia_foco_pct" in data:
        try:
            lsr["potencia_foco_pct"] = max(1.0, min(12.0, round(float(data["potencia_foco_pct"]), 1)))
        except (ValueError, TypeError):
            pass
    if "potencia_prueba_pct" in data:
        try:
            lsr["potencia_prueba_pct"] = max(1.0, min(100.0, round(float(data["potencia_prueba_pct"]), 1)))
        except (ValueError, TypeError):
            pass
    if "pulso_prueba_ms" in data or "duracion_pulso_ms" in data:
        try:
            ms_val = data.get("pulso_prueba_ms", data.get("duracion_pulso_ms", 250))
            lsr["pulso_prueba_ms"] = max(20, min(5000, int(round(float(ms_val)))))
            lsr["duracion_pulso_ms"] = lsr["pulso_prueba_ms"]
        except (ValueError, TypeError):
            pass
    if "velocidad_grabado_hz" in data:
        try:
            vg_in = int(round(float(data["velocidad_grabado_hz"])))
            if vg_in >= 600:
                vg_in = 180
            lsr["velocidad_grabado_hz"] = max(25, min(500, vg_in))
        except (ValueError, TypeError):
            pass
    if "velocidad_viaje_hz" in data:
        try:
            vv_in = int(round(float(data["velocidad_viaje_hz"])))
            if vv_in > 1500:
                vv_in = 500
            lsr["velocidad_viaje_hz"] = max(100, min(1500, vv_in))
        except (ValueError, TypeError):
            pass
    if "pasadas" in data:
        try:
            lsr["pasadas"] = max(1, min(20, int(round(float(data["pasadas"])))))
        except (ValueError, TypeError):
            pass
    if "pausa_enfriamiento_ms" in data:
        try:
            lsr["pausa_enfriamiento_ms"] = max(0, min(10000, int(round(float(data["pausa_enfriamiento_ms"])))))
        except (ValueError, TypeError):
            pass
    if "spot_mm" in data:
        try:
            lsr["spot_mm"] = max(0.05, min(2.0, round(float(data["spot_mm"]), 2)))
        except (ValueError, TypeError):
            pass
    if "z_foco_pulsos" in data:
        try:
            lsr["z_foco_pulsos"] = int(round(float(data["z_foco_pulsos"])))
        except (ValueError, TypeError):
            pass
    if "usar_z_foco" in data:
        lsr["usar_z_foco"] = bool(data["usar_z_foco"])
    if "z_paso_pasada_pulsos" in data:
        try:
            lsr["z_paso_pasada_pulsos"] = max(-2000, min(2000, int(round(float(data["z_paso_pasada_pulsos"])))))
        except (ValueError, TypeError):
            pass
    if "compensacion_diagonal" in data:
        lsr["compensacion_diagonal"] = bool(data["compensacion_diagonal"])
    if "balance_haz_xy_pct" in data:
        try:
            lsr["balance_haz_xy_pct"] = max(-35.0, min(35.0, round(float(data["balance_haz_xy_pct"]), 1)))
        except (ValueError, TypeError):
            pass
    if "proteccion_esquinas" in data:
        lsr["proteccion_esquinas"] = bool(data["proteccion_esquinas"])
    if "evitar_doble_quemado" in data:
        lsr["evitar_doble_quemado"] = bool(data["evitar_doble_quemado"])

    recalcular_metricas_laser()
    estado_maquina["ultimo_mensaje"] = (
        f"Parametros Laser 5W actualizados: {lsr['potencia_pct']}% ({lsr['potencia_watts']:.2f}W / PWM {lsr['potencia_pwm']}), "
        f"Vel. Grabado {lsr['velocidad_grabado_hz']} Hz, Viaje {lsr['velocidad_viaje_hz']} Hz, {lsr['pasadas']} pasada(s)."
    )
    return jsonify(construir_respuesta_estado(ok=True))


@app.route("/api/process_image", methods=["POST"])
def api_process_image():
    """
    Procesa una imagen en base64 utilizando el motor OpenCV + LaserGRBL en Python
    y devuelve los trazos vectoriales / tramados en coordenadas de pixel junto con la mascara binaria.
    """
    data = request.get_json(silent=True) or {}
    img_b64 = data.get("imagen_base64", "")
    opciones = data.get("opciones", {}) or {}
    if not img_b64:
        return jsonify({"ok": False, "error": "No se recibió la imagen a procesar."}), 400
    try:
        resultado = procesar_imagen_opencv(img_b64, opciones)
        return jsonify(resultado)
    except Exception as e:
        return jsonify({"ok": False, "error": f"Error en motor OpenCV: {e}"}), 500



def iniciar_servidor(abrir_navegador=True, puerto_web=5000):
    url = f"http://127.0.0.1:{puerto_web}"
    print("=" * 65)
    print(f" [SERVIDOR ACTIVO] Calibración y Dibujo CNC NEMA v2.0 en: {url}")
    print("=" * 65)
    if abrir_navegador:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=puerto_web, debug=False)


if __name__ == "__main__":
    iniciar_servidor(abrir_navegador=True, puerto_web=5000)
