import tkinter as tk
from tkinter import ttk, messagebox
import serial
import threading
import time

PUERTO = 'COM3' # Ajusta a tu puerto real
BAUD_RATE = 115200

pos_x, pos_y, pos_z = 0, 0, 0
limite_max_x, limite_max_y = 0, 0

try:
    puerto_serial = serial.Serial(PUERTO, BAUD_RATE, timeout=1)
    time.sleep(2)
except Exception as e:
    puerto_serial = None
    print(f"Error de conexión: {e}")

def enviar_comando(eje, dir_int, modificador_posicion):
    global pos_x, pos_y, pos_z
    if not puerto_serial:
        return

    try:
        pasos = int(var_pasos.get())
    except ValueError:
        return

    estado_botones("disabled")
    lbl_estado.config(text=f"Moviendo Eje {eje}...", foreground="blue")

    # Actualizar coordenadas lógicas
    if eje == 'X': pos_x += (pasos * modificador_posicion)
    elif eje == 'Y': pos_y += (pasos * modificador_posicion)
    elif eje == 'Z': pos_z += (pasos * modificador_posicion)

    threading.Thread(target=esperar_respuesta, args=(eje, pasos, dir_int), daemon=True).start()

def esperar_respuesta(eje, pasos, dir_int):
    comando = f"{eje},{pasos},{dir_int}\n"
    puerto_serial.write(comando.encode('utf-8'))
    
    while True:
        if puerto_serial.in_waiting > 0:
            respuesta = puerto_serial.readline().decode('utf-8').strip()
            if respuesta == "OK":
                ventana.after(0, actualizar_interfaz)
                break

def actualizar_interfaz():
    estado_botones("normal")
    lbl_coords_xy.config(text=f"X: {pos_x} | Y: {pos_y}")
    lbl_coords_z.config(text=f"Z: {pos_z}")
    lbl_estado.config(text="Listo", foreground="green")

def estado_botones(estado):
    for btn in [btn_y_mas, btn_y_menos, btn_x_mas, btn_x_menos, btn_z_mas, btn_z_menos]:
        btn.config(state=estado)

def fijar_cero():
    global pos_x, pos_y, pos_z
    pos_x, pos_y, pos_z = 0, 0, 0
    actualizar_interfaz()
    lbl_estado.config(text="Origen (0,0,0) Establecido", foreground="purple")

def fijar_limite():
    global limite_max_x, limite_max_y
    limite_max_x, limite_max_y = pos_x, pos_y
    lbl_limites.config(text=f"Área útil XY: {limite_max_x} x {limite_max_y} pasos")
    lbl_estado.config(text="Límites guardados", foreground="purple")

# --- CONSTRUCCIÓN DE LA VENTANA ---
ventana = tk.Tk()
ventana.title("Controlador CNC Láser")
ventana.geometry("480x500")
ventana.resizable(False, False)

estilo = ttk.Style()
estilo.theme_use('clam')

# Encabezado
ttk.Label(ventana, text="Panel de Calibración Cartesiana", font=("Arial", 14, "bold")).pack(pady=10)

# Selector de pasos (Resolución)
frame_pasos = ttk.Frame(ventana)
frame_pasos.pack(pady=5)
ttk.Label(frame_pasos, text="Pasos por clic:").pack(side=tk.LEFT, padx=5)
var_pasos = tk.StringVar(value="100")
ttk.Combobox(frame_pasos, textvariable=var_pasos, values=["10", "50", "100", "500", "1000"], width=8, state="readonly").pack(side=tk.LEFT)

# --- CONTENEDOR PRINCIPAL DE CONTROLES ---
frame_controles = ttk.Frame(ventana)
frame_controles.pack(pady=10, fill=tk.X, padx=20)

# Panel XY (Plano de trabajo)
frame_xy = ttk.LabelFrame(frame_controles, text="Desplazamiento Láser (X, Y)")
frame_xy.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=5, pady=5)

btn_y_mas = ttk.Button(frame_xy, text="Y+ (Fondo)", command=lambda: enviar_comando('Y', 1, 1))
btn_y_mas.grid(row=0, column=1, pady=5, padx=5)
btn_x_menos = ttk.Button(frame_xy, text="X- (Izq)", command=lambda: enviar_comando('X', 0, -1))
btn_x_menos.grid(row=1, column=0, pady=5, padx=5)
btn_x_mas = ttk.Button(frame_xy, text="X+ (Der)", command=lambda: enviar_comando('X', 1, 1))
btn_x_mas.grid(row=1, column=2, pady=5, padx=5)
btn_y_menos = ttk.Button(frame_xy, text="Y- (Frente)", command=lambda: enviar_comando('Y', 0, -1))
btn_y_menos.grid(row=2, column=1, pady=5, padx=5)

# Panel Z (Actuador)
frame_z = ttk.LabelFrame(frame_controles, text="Actuador (Z)")
frame_z.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=5, pady=5)

btn_z_mas = ttk.Button(frame_z, text="Z+ (Subir)", command=lambda: enviar_comando('Z', 1, 1))
btn_z_mas.pack(pady=15, padx=10)
btn_z_menos = ttk.Button(frame_z, text="Z- (Bajar)", command=lambda: enviar_comando('Z', 0, -1))
btn_z_menos.pack(pady=15, padx=10)

# --- PANEL DE ESTADO Y COORDENADAS ---
frame_estado = ttk.LabelFrame(ventana, text="Estado de la Máquina")
frame_estado.pack(fill=tk.X, padx=20, pady=10)

lbl_coords_xy = ttk.Label(frame_estado, text="X: 0 | Y: 0", font=("Consolas", 14, "bold"), foreground="#B22222")
lbl_coords_xy.pack(pady=2)
lbl_coords_z = ttk.Label(frame_estado, text="Z: 0", font=("Consolas", 12, "bold"), foreground="#4682B4")
lbl_coords_z.pack(pady=2)

lbl_limites = ttk.Label(frame_estado, text="Área útil XY: No definida", font=("Arial", 10))
lbl_limites.pack(pady=2)

lbl_estado = ttk.Label(ventana, text="Conectado" if puerto_serial else "Sin conexión Serial", foreground="green" if puerto_serial else "red", font=("Arial", 11, "bold"))
lbl_estado.pack(pady=5)

# --- BOTONES DE CALIBRACIÓN ---
frame_calib = ttk.Frame(ventana)
frame_calib.pack(pady=10)

ttk.Button(frame_calib, text="Fijar Cero (0,0,0)", command=fijar_cero).pack(side=tk.LEFT, padx=10)
ttk.Button(frame_calib, text="Fijar Límite XY", command=fijar_limite).pack(side=tk.LEFT, padx=10)

ventana.mainloop()