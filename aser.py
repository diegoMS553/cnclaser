import tkinter as tk
import serial
import time
import threading

# Configuración del puerto serie. 
# En Windows suele ser 'COM3', 'COM4', etc. En Linux '/dev/ttyUSB0'
PUERTO = 'COM3' 
BAUDIOS = 115200

# Inicialización de la conexión serie
try:
    esp32 = serial.Serial(PUERTO, BAUDIOS, timeout=1)
    time.sleep(2)  # Espera a que el ESP32 se reinicie tras abrir el puerto
    print("Conexión serial establecida.")
except Exception as e:
    print(f"Error abriendo puerto: {e}")
    esp32 = None

def enviar_comando(poder):
    """Envía el comando de potencia al ESP32 con el formato 'P<valor>\n'"""
    if esp32 and esp32.is_open:
        comando = f"P{int(poder)}\n"
        esp32.write(comando.encode('utf-8'))

def apagar_laser():
    """Lleva el control a 0 y apaga el láser inmediatamente"""
    slider_potencia.set(0)
    enviar_comando(0)

def pulso_enfoque():
    """Emite un pulso de baja potencia (aprox 10%) durante medio segundo para enfocar"""
    enviar_comando(25) 
    # Usa after de Tkinter para apagar el láser después de 500 ms sin bloquear la interfaz
    ventana.after(500, apagar_laser)

# Creación de la ventana principal
ventana = tk.Tk()
ventana.title("Prueba de Láser 40W (PWM)")
ventana.geometry("350x200")
ventana.configure(padx=20, pady=20)

tk.Label(ventana, text="Potencia del Láser (0-255)", font=("Arial", 10, "bold")).pack()

# Slider para control de potencia
slider_potencia = tk.Scale(
    ventana, 
    from_=0, 
    to=255, 
    orient='horizontal', 
    length=300,
    command=enviar_comando # Se ejecuta cada vez que mueves el deslizador
)
slider_potencia.pack(pady=10)

# Botones de control
frame_botones = tk.Frame(ventana)
frame_botones.pack(fill='x')

btn_pulso = tk.Button(frame_botones, text="Pulso Enfoque (10%)", bg="orange", command=pulso_enfoque)
btn_pulso.pack(side='left', expand=True, fill='x', padx=5)

btn_apagar = tk.Button(frame_botones, text="APAGAR LÁSER", bg="red", fg="white", font=("Arial", 10, "bold"), command=apagar_laser)
btn_apagar.pack(side='right', expand=True, fill='x', padx=5)

# Al cerrar la ventana, asegura que el láser se apague y se libere el puerto
def on_closing():
    apagar_laser()
    if esp32 and esp32.is_open:
        esp32.close()
    ventana.destroy()

ventana.protocol("WM_DELETE_WINDOW", on_closing)
ventana.mainloop()