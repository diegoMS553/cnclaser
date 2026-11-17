"""
Punto de entrada para la Versión 2.0 Web (Flask) del Calibrador y Simulador CNC de Motores NEMA.
Ejecuta el servidor Flask y abre automáticamente la interfaz en el navegador.
"""
from app import app, iniciar_servidor

if __name__ == "__main__":
    iniciar_servidor(abrir_navegador=True, puerto_web=5000)
