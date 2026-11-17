# cnclaser

Sistema de control, simulación y grabado para grabadora/cortadora láser y plotter CNC basado en ESP32, Flask y WebGL/Canvas.

## Características

- Interfaz de escritorio con tema oscuro tipo Inkscape/Adobe.
- Control manual de ejes y cabezal láser de 5W (PWM modulable).
- Simulación 2D en tiempo real con zoom interactivo y escala adaptativa.
- Importación y discretización de vectores SVG (Inkscape, curvas Bézier cúbicas/cuadráticas adaptativas mediante De Casteljau).
- Grabado rasterizado (*Raster PWM Engraving*) con modulación de potencia por línea para escala de grises.
- Comunicación serial fluida con firmware ESP32.
