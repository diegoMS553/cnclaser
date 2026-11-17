import tkinter as tk
from tkinter import messagebox
import serial
import threading
import time

PUERTO = 'COM3' # Ajusta a tu puerto real
BAUD_RATE = 115200

# Variables de posición
pos_x = 0
pos_y = 0
limite_max_x = 0
limite_max_y = 0

try:
    puerto_serial = serial.Serial(PUERTO, BAUD_RATE, timeout=1)
    time.sleep(2)
except Exception as e:
    puerto_serial = None
    print(f"Error de conexión: {e}")

def enviar_comando(eje, dir_int, modificador_posicion):
    global pos_x, pos_y
    if not puerto_serial:
        return

    pasos = int(var_pasos.get())
    
    # Bloquear botones durante el movimiento
    estado_botones("disabled")
    lbl_estado.config(text=f"Moviendo Eje {eje}...", fg="blue")

    # Actualizar coordenadas lógicas
    if eje == 'X':
        pos_x += (pasos * modificador_posicion)
    elif eje == 'Y':
        pos_y += (pasos * modificador_posicion)

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
    lbl_coords.config(text=f"X: {pos_x} | Y: {pos_y}")
    lbl_estado.config(text="Listo", fg="green")

def estado_botones(estado):
    btn_y_mas.config(state=estado)
    btn_y_menos.config(state=estado)
    btn_x_mas.config(state=estado)
    btn_x_menos.config(state=estado)

def fijar_cero():
    global pos_x, pos_y
    pos_x = 0
    pos_y = 0
    lbl_coords.config(text=f"X: {pos_x} | Y: {pos_y}")
    lbl_estado.config(text="Punto Cero (Origen) Establecido", fg="purple")

def fijar_limite():
    global limite_max_x, limite_max_y
    limite_max_x = pos_x
    limite_max_y = pos_y
    lbl_limites.config(text=f"Área útil: {limite_max_x}x{limite_max_y} pasos")
    lbl_estado.config(text="Límites guardados", fg="purple")

# --- INTERFAZ GRÁFICA ---
ventana = tk.Tk()
ventana.title("Calibración CNC")
ventana.geometry("400x450")

tk.Label(ventana, text="Panel de Calibración Cartesiana", font=("Arial", 14, "bold")).pack(pady=10)

# Coordenadas
lbl_coords = tk.Label(ventana, text="X: 0 | Y: 0", font=("Consolas", 16, "bold"), fg="darkred")
lbl_coords.pack()

lbl_limites = tk.Label(ventana, text="Área útil: No definida", font=("Arial", 10))
lbl_limites.pack(pady=5)

# Selector de pasos (Resolución)
frame_pasos = tk.Frame(ventana)
frame_pasos.pack(pady=10)
tk.Label(frame_pasos, text="Pasos por clic:").pack(side=tk.LEFT)
var_pasos = tk.StringVar(value="100")
opciones_pasos = ["10", "100", "500", "1000"]
tk.OptionMenu(frame_pasos, var_pasos, *opciones_pasos).pack(side=tk.LEFT, padx=5)

# Controles de dirección (Cruceta)
frame_cruceta = tk.Frame(ventana)
frame_cruceta.pack(pady=10)

# En el ESP32: 1 suele ser hacia adelante/derecha, 0 hacia atrás/izquierda (ajusta si giran al revés)
btn_y_mas = tk.Button(frame_cruceta, text="Y+ (Arriba)", width=12, command=lambda: enviar_comando('Y', 1, 1))
btn_y_mas.grid(row=0, column=1, pady=5)

btn_x_menos = tk.Button(frame_cruceta, text="X- (Izquierda)", width=12, command=lambda: enviar_comando('X', 0, -1))
btn_x_menos.grid(row=1, column=0, padx=5)

btn_x_mas = tk.Button(frame_cruceta, text="X+ (Derecha)", width=12, command=lambda: enviar_comando('X', 1, 1))
btn_x_mas.grid(row=1, column=2, padx=5)

btn_y_menos = tk.Button(frame_cruceta, text="Y- (Abajo)", width=12, command=lambda: enviar_comando('Y', 0, -1))
btn_y_menos.grid(row=2, column=1, pady=5)

# Botones de Calibración
frame_calib = tk.Frame(ventana)
frame_calib.pack(pady=15)
tk.Button(frame_calib, text="Fijar Cero (0,0)", bg="lightgreen", command=fijar_cero).pack(side=tk.LEFT, padx=10)
tk.Button(frame_calib, text="Fijar Límite Máximo", bg="orange", command=fijar_limite).pack(side=tk.LEFT, padx=10)

lbl_estado = tk.Label(ventana, text="Conectado" if puerto_serial else "Sin conexión Serial", fg="green" if puerto_serial else "red")
lbl_estado.pack(pady=10)

ventana.mainloop()