/*
 * ============================================================================
 * CONTROLADOR CNC 3 EJES + MODULO LASER 5W PWM (ESP32)
 * PUENTE FIJO X / PLACA MOVIL Y + GESTION ENA + INTERPOLACION 2D + LASER 5W
 * ============================================================================
 * ESQUEMA COMPLETO DE PINES GPIO DEL ESP32 (CONFIGURADO EXCLUSIVAMENTE EN SKETCH):
 *
 *  1. MOTORES PASO A PASO (DRIVERS TB6600 / DM542 / SIMILAR):
 *     - EJE X (Puente Fijo) : DIR = GPIO 26 | STEP = GPIO 27 | ENA+ = GPIO 25 (ENA- a GND)
 *     - EJE Y (Placa Movil) : DIR = GPIO 14 | STEP = GPIO 12 | ENA+ = GPIO 13 (ENA- a GND)
 *     - EJE Z (Actuador)    : DIR = GPIO 18 | STEP = GPIO 19 | ENA+ = GPIO 21 (ENA- a GND)
 *
 *  2. MICROINTERRUPTORES (SWITCHES CON PALANCA DE LAMINA Y RODAJA 5A 125Vca):
 *     - Cableado requerido  : Terminal COM -> GND del ESP32
 *                             Terminal NO (Normalmente Abierto) -> Pin GPIO del ESP32
 *     - Configuracion GPIO  : INPUT_PULLUP interno activo (Reposo = HIGH, Presionado = LOW)
 *     - ENDSTOP X (Inf-Izq) : GPIO 32 (Limite cero X en esquina inferior izquierda)
 *     - ENDSTOP Y (Inf-Izq) : GPIO 33 (Limite cero Y en esquina inferior izquierda)
 *     - EJE Z (Sin Switch)  : Calibracion manual independiente (endstopZHabilitado = false)
 *
 *  3. MODULO LASER DE DIODO DE 5W OPTICOS (3 ENTRADAS: VCC 12V, GND, PWM):
 *     - Cable a utilizar    : USAR EL CABLE CON 2 SALIDAS DE GND COMPARTIDO (Cable en "Y"):
 *                             * Conector al Laser (3 pines): [VCC 12V] [GND] [PWM]
 *                             * Salida 1 (Alimentacion 2 hilos): VCC (+12V) y GND -> Fuente de 12V DC
 *                             * Salida 2 (Control 2 hilos)     : PWM -> GPIO 23 del ESP32
 *                                      
    
                              GND -> Pin GND del ESP32 (Tierra comun)
 *     - Por que usar ese    : El laser se alimenta con 12V DC pero recibe la senal PWM logica
 *                             desde el ESP32. El segundo GND une la referencia de tierra entre
 *                             la fuente de 12V y el ESP32 sin meter 12V al microcontrolador.
 *     - Frecuencia PWM      : 5000 Hz (5 kHz), Resolucion 8 bits (0 = 0.0W, 255 = 5.0W 100%)
 *     - Protecciones        : Armado logico obligatorio (LASER,ARM,1), control manual directo
 *                             (LASER,PWR,<0..255>), corte automatico al terminar cada trazo
 *                             (Modo Dinamico M2L), corte por microswitches y watchdog de foco.
 * ============================================================================
 */

// --- PINES EJE X (PUENTE FIJO) ---
const int dirX  = 26;
const int stepX = 27;
const int enaX  = 25; // ENA+ Driver X (ENA- a GND)

// --- PINES EJE Y (PLACA MOVIL) ---
const int dirY  = 14;
const int stepY = 12;
const int enaY  = 13; // ENA+ Driver Y (ENA- a GND)

// --- PINES EJE Z (ACTUADOR / ALTURA FOCAL) ---
const int dirZ  = 18;
const int stepZ = 19;
const int enaZ  = 21; // ENA+ Driver Z (ENA- a GND)

// --- PINES MICROINTERRUPTORES DE FIN DE CARRERA (COM a GND, NO a GPIO) ---
const int endstopX = 32; // Limite inferior izquierdo Eje X (Home X = 0)
const int endstopY = 33; // Limite inferior izquierdo Eje Y (Home Y = 0)
const int endstopZ = 22; // Pin reservado para Eje Z (desactivado mientras no se instale switch en Z)

// --- PINES MODULO LASER DE 5W (CONTROL PWM / TTL Y BLOQUEO DE SEGURIDAD) ---
const int pinLaserPWM    = 23; // Salida PWM (0..255) hacia entrada TTL/PWM del modulo laser 5W
const int pinLaserEnable = 4;  // Salida auxiliar de habilitacion (HIGH cuando el laser esta armado)
const int FREQ_LASER_HZ  = 5000;
const int CANAL_PWM_LASER = 0;
const int BITS_PWM_LASER  = 8; // Rango 0..255

// El Eje Z no utiliza microswitch por el momento (calibracion manual independiente)
bool endstopZHabilitado = false;

// Polaridad de los microswitches (true = COM a GND y NO a GPIO, se activa en LOW al presionar rodaja)
bool endstopActivoEnBajo = true;

// Hard limits durante movimiento (false por defecto para evitar bloqueos/perdida de pasos por ruido EMI del laser o pines flotantes)
// Los microswitches SIEMPRE se usan de forma segura y completa durante AUTOHOME y HOME_AXIS.
bool hardLimitsEnMovimiento = false;

// Direcciones fisicas por defecto hacia los microswitches para Auto-Calibracion (X e Y):
// - X (Puente fijo)  : 0 mueve hacia la izquierda (buscando endstopX)
// - Y (Placa movil)  : 1 mueve hacia el origen inferior (invertido por cinematica de placa movil)
int dirFisicaHomeX = 0;
int dirFisicaHomeY = 1;
int dirFisicaHomeZ = 1;

// Parametros de seguridad para la rutina de Auto-Calibracion (Homing)
const long MAX_PASOS_HOME_XY = 25000;
const long MAX_PASOS_HOME_Z  = 10000;
const int  PASOS_RETROCESO_HOME = 40; // Libera suavemente la rodaja tras el toque

// Si deseas que el ESP32 ejecute el buscador fisico apenas recibe alimentacion
// incluso antes de abrir el software web, cambia esta variable a true:
bool autocalibrarAlEncenderESP32 = false;

// Polaridad de ENA (true = LOW habilita el motor y HIGH corta corriente; false = inverso)
bool enaActivoEnBajo = true;

// Tiempo de pulso por defecto (1000 us HIGH + 1000 us LOW = 500 Hz)
int delayPulsoUs = 1000;

// Estado de habilitacion de cada motor
bool motorHabilitadoX = false;
bool motorHabilitadoY = false;
bool motorHabilitadoZ = false;

// Modo Auto-Reposo: corta corriente a 0.0A tras 2 segundos sin recibir comandos
bool modoAutoReposo = true;
unsigned long ultimoMovimientoMs = 0;
const unsigned long TIEMPO_REPOSO_MS = 2000;

// --- ESTADO Y SEGURIDAD DEL MODULO LASER 5W ---
bool laserArmado = false;             // Enclave de seguridad: si es false, el PWM se fuerza a 0
int  laserPwmActual = 0;              // Nivel PWM activo (0..255)
bool laserEnModoFoco = false;         // Indica si esta encendido el puntero de enfoque en reposo
unsigned long inicioModoFocoMs = 0;   // Marca de tiempo para apagado automatico de seguridad del foco
const unsigned long MAX_TIEMPO_FOCO_MS = 20000; // Maximo 20s continuos en modo foco sin movimiento
const int MAX_PWM_FOCO_SEGURO = 30;   // Limite de seguridad para modo foco (~11% de 5W)

// Contadores internos de posicion
long posX = 0;
long posY = 0;
long posZ = 0;

// --- FUNCIONES DE CONTROL PWM DEL LASER 5W (COMPATIBLE CON ESP32 CORE 2.X Y 3.X) ---
void inicializarHardwareLaser() {
  pinMode(pinLaserEnable, OUTPUT);
  digitalWrite(pinLaserEnable, LOW);
  pinMode(pinLaserPWM, OUTPUT);
  digitalWrite(pinLaserPWM, LOW);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  ledcAttach(pinLaserPWM, FREQ_LASER_HZ, BITS_PWM_LASER);
  ledcWrite(pinLaserPWM, 0);
#else
  ledcSetup(CANAL_PWM_LASER, FREQ_LASER_HZ, BITS_PWM_LASER);
  ledcAttachPin(pinLaserPWM, CANAL_PWM_LASER);
  ledcWrite(CANAL_PWM_LASER, 0);
#endif
  laserPwmActual = 0;
}

void escribirPwmLaser(int valorPwm) {
  int pwmSeguro = 0;
  if (laserArmado && valorPwm > 0) {
    pwmSeguro = constrain(valorPwm, 0, 255);
  }
  laserPwmActual = pwmSeguro;
  digitalWrite(pinLaserEnable, (laserArmado && pwmSeguro > 0) ? HIGH : LOW);

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  ledcWrite(pinLaserPWM, pwmSeguro);
#else
  ledcWrite(CANAL_PWM_LASER, pwmSeguro);
#endif
}

void apagarLaserInmediato() {
  laserEnModoFoco = false;
  escribirPwmLaser(0);
}

int nivelHabilitado() {
  return enaActivoEnBajo ? LOW : HIGH;
}

int nivelDeshabilitado() {
  return enaActivoEnBajo ? HIGH : LOW;
}

void establecerEnableMotor(char eje, bool habilitar) {
  int nivelPin = habilitar ? nivelHabilitado() : nivelDeshabilitado();
  if (eje == 'X') {
    digitalWrite(enaX, nivelPin);
    motorHabilitadoX = habilitar;
  } else if (eje == 'Y') {
    digitalWrite(enaY, nivelPin);
    motorHabilitadoY = habilitar;
  } else if (eje == 'Z') {
    digitalWrite(enaZ, nivelPin);
    motorHabilitadoZ = habilitar;
  }
}

void establecerEnableTodos(bool habilitar) {
  establecerEnableMotor('X', habilitar);
  establecerEnableMotor('Y', habilitar);
  establecerEnableMotor('Z', habilitar);
}

// --- LECTURA RAPIDA Y LECTURA CON FILTRO ANTI-REBOTE (DEBOUNCE) DE MICROSWITCHES ---
bool finCarreraPresionado(int pinEndstop) {
  int nivelActivo = endstopActivoEnBajo ? LOW : HIGH;
  return (digitalRead(pinEndstop) == nivelActivo);
}

bool finCarreraPresionadoDebounce(int pinEndstop) {
  int nivelActivo = endstopActivoEnBajo ? LOW : HIGH;
  if (digitalRead(pinEndstop) == nivelActivo) {
    delayMicroseconds(1200); // Filtro contra rebote solo en busqueda de Home
    return (digitalRead(pinEndstop) == nivelActivo);
  }
  return false;
}

// --- AUTO-CALIBRACION DE UN EJE INDIVIDUAL HASTA TOCAR SU MICROSWITCH ---
bool autocalibrarEjeIndividual(char eje, int dirHaciaSwitch, long maxPasos) {
  // Por seguridad, siempre apagar el laser antes de buscar los microswitches
  apagarLaserInmediato();

  if (eje == 'Z' && !endstopZHabilitado) {
    return false; // Switch Z desactivado: el Eje Z se calibra manualmente
  }

  int pinDir  = (eje == 'X') ? dirX  : (eje == 'Y') ? dirY  : dirZ;
  int pinStep = (eje == 'X') ? stepX : (eje == 'Y') ? stepY : stepZ;
  int pinSw   = (eje == 'X') ? endstopX : (eje == 'Y') ? endstopY : endstopZ;

  establecerEnableMotor(eje, true);
  delay(5);

  // Fase 1: Avanzar hacia el microswitch hasta que la rodaja cierre el contacto
  digitalWrite(pinDir, dirHaciaSwitch);
  delayMicroseconds(15);

  bool detectado = false;
  for (long i = 0; i < maxPasos; i++) {
    if (finCarreraPresionadoDebounce(pinSw)) {
      detectado = true;
      break;
    }
    if (Serial.available() > 0) {
      String cmd = Serial.peek() == 'S' ? Serial.readStringUntil('\n') : "";
      cmd.trim();
      if (cmd.equalsIgnoreCase("STOP")) {
        apagarLaserInmediato();
        return false;
      }
    }
    digitalWrite(pinStep, HIGH);
    delayMicroseconds(delayPulsoUs);
    digitalWrite(pinStep, LOW);
    delayMicroseconds(delayPulsoUs);
  }

  // Fase 2: Retroceder unos pasos en sentido opuesto para liberar la palanca/rodaja
  if (detectado) {
    int dirOpuesta = (dirHaciaSwitch == 1) ? 0 : 1;
    digitalWrite(pinDir, dirOpuesta);
    delayMicroseconds(15);
    for (int r = 0; r < PASOS_RETROCESO_HOME; r++) {
      digitalWrite(pinStep, HIGH);
      delayMicroseconds(delayPulsoUs);
      digitalWrite(pinStep, LOW);
      delayMicroseconds(delayPulsoUs);
    }
  }

  if (eje == 'X') posX = 0;
  else if (eje == 'Y') posY = 0;
  else if (eje == 'Z') posZ = 0;

  ultimoMovimientoMs = millis();
  return detectado;
}

// --- FUNCION PRINCIPAL DE AUTO-CALIBRACION DE INICIO (SOLO EJES X, Y EN LIMITE INF-IZQ) ---
void autocalibrarHomeCompleto(int dirHX, int dirHY, int dirHZ, bool reportarSerial) {
  apagarLaserInmediato();

  bool okZ = false;
  if (endstopZHabilitado) {
    okZ = autocalibrarEjeIndividual('Z', dirHZ, MAX_PASOS_HOME_Z);
  }

  // Mover X e Y simultaneamente hacia la esquina inferior izquierda
  establecerEnableMotor('X', true);
  establecerEnableMotor('Y', true);
  delay(5);

  digitalWrite(dirX, dirHX);
  digitalWrite(dirY, dirHY);
  delayMicroseconds(15);

  bool xTocado = finCarreraPresionadoDebounce(endstopX);
  bool yTocado = finCarreraPresionadoDebounce(endstopY);

  for (long i = 0; i < MAX_PASOS_HOME_XY; i++) {
    if (!xTocado && finCarreraPresionadoDebounce(endstopX)) xTocado = true;
    if (!yTocado && finCarreraPresionadoDebounce(endstopY)) yTocado = true;
    if (xTocado && yTocado) break;

    if (Serial.available() > 0) {
      String cmd = Serial.peek() == 'S' ? Serial.readStringUntil('\n') : "";
      cmd.trim();
      if (cmd.equalsIgnoreCase("STOP")) break;
    }

    if (!xTocado) digitalWrite(stepX, HIGH);
    if (!yTocado) digitalWrite(stepY, HIGH);
    delayMicroseconds(delayPulsoUs);

    if (!xTocado) digitalWrite(stepX, LOW);
    if (!yTocado) digitalWrite(stepY, LOW);
    delayMicroseconds(delayPulsoUs);
  }

  // Liberar suavemente las rodajas de X e Y tras tocar los limites inferiores izquierdos
  int dirOpX = (dirHX == 1) ? 0 : 1;
  int dirOpY = (dirHY == 1) ? 0 : 1;
  digitalWrite(dirX, dirOpX);
  digitalWrite(dirY, dirOpY);
  delayMicroseconds(15);

  for (int r = 0; r < PASOS_RETROCESO_HOME; r++) {
    if (xTocado) digitalWrite(stepX, HIGH);
    if (yTocado) digitalWrite(stepY, HIGH);
    delayMicroseconds(delayPulsoUs);
    if (xTocado) digitalWrite(stepX, LOW);
    if (yTocado) digitalWrite(stepY, LOW);
    delayMicroseconds(delayPulsoUs);
  }

  posX = 0;
  posY = 0;
  if (endstopZHabilitado) posZ = 0;
  ultimoMovimientoMs = millis();

  if (reportarSerial) {
    Serial.print("OK,AUTOHOME,X:0,Y:0,Z:"); Serial.print(posZ);
    Serial.print(",SWX:"); Serial.print(xTocado ? 1 : 0);
    Serial.print(",SWY:"); Serial.print(yTocado ? 1 : 0);
    Serial.print(",SWZ:"); Serial.println(okZ ? 1 : 0);
  }
}

// --- MOVIMIENTO SIMULTANEO 2D (ALGORITMO DE BRESENHAM X + Y CON SOPORTE LASER DINAMICO) ---
void moverSimultaneoXYLaser(long pasosX, int dirXVal, long pasosY, int dirYVal, int pwmSegmento, int delayUsPersonalizado, bool cortarLaserAlFinal) {
  long totalPasos = max(pasosX, pasosY);
  if (totalPasos <= 0) {
    if (cortarLaserAlFinal) apagarLaserInmediato();
    return;
  }

  int delayActivoUs = (delayUsPersonalizado >= 40 && delayUsPersonalizado <= 20000)
                      ? delayUsPersonalizado
                      : delayPulsoUs;

  bool despertar = false;
  if (pasosX > 0 && !motorHabilitadoX) despertar = true;
  if (pasosY > 0 && !motorHabilitadoY) despertar = true;

  if (pasosX > 0) establecerEnableMotor('X', true);
  if (pasosY > 0) establecerEnableMotor('Y', true);
  if (despertar) {
    delay(5);
  }

  if (pasosX > 0) digitalWrite(dirX, dirXVal);
  if (pasosY > 0) digitalWrite(dirY, dirYVal);
  delayMicroseconds(15);

  // Si se solicito potencia de laser (pwmSegmento >= 0), ajustarla justo al iniciar el movimiento
  if (pwmSegmento >= 0) {
    laserEnModoFoco = false;
    escribirPwmLaser(pwmSegmento);
  }

  long errX = 0;
  long errY = 0;
  long ejecutadosX = 0;
  long ejecutadosY = 0;

  for (long i = 0; i < totalPasos; i++) {
    // Proteccion por microswitch activa solo si hardLimitsEnMovimiento es true (evita bloqueos por ruido EMI durante grabado)
    bool xBloqueado = false;
    bool yBloqueado = false;
    if (hardLimitsEnMovimiento) {
      xBloqueado = (dirXVal == dirFisicaHomeX) && finCarreraPresionado(endstopX);
      yBloqueado = (dirYVal == dirFisicaHomeY) && finCarreraPresionado(endstopY);
    }

    bool pulsoX = false;
    bool pulsoY = false;

    if (pasosX > 0 && !xBloqueado) {
      errX += pasosX;
      if (errX * 2 >= totalPasos) {
        errX -= totalPasos;
        pulsoX = true;
        ejecutadosX++;
      }
    } else if (xBloqueado) {
      posX = 0;
    }

    if (pasosY > 0 && !yBloqueado) {
      errY += pasosY;
      if (errY * 2 >= totalPasos) {
        errY -= totalPasos;
        pulsoY = true;
        ejecutadosY++;
      }
    } else if (yBloqueado) {
      posY = 0;
    }

    if (!pulsoX && !pulsoY && xBloqueado && yBloqueado) {
      apagarLaserInmediato();
      break;
    }

    if (pulsoX) digitalWrite(stepX, HIGH);
    if (pulsoY) digitalWrite(stepY, HIGH);
    delayMicroseconds(delayActivoUs);

    if (pulsoX) digitalWrite(stepX, LOW);
    if (pulsoY) digitalWrite(stepY, LOW);
    delayMicroseconds(delayActivoUs);
  }

  // Modo dinamico seguro (tipo M4 de LaserGRBL): apaga el haz al terminar el segmento
  // para evitar quemaduras en las esquinas mientras llega el siguiente comando serial
  if (cortarLaserAlFinal) {
    apagarLaserInmediato();
  }

  long signoX = (dirXVal == 1) ? 1 : -1;
  long signoY = (dirYVal == 1) ? 1 : -1;
  posX += (ejecutadosX * signoX);
  posY += (ejecutadosY * signoY);
  ultimoMovimientoMs = millis();
}

void moverSimultaneoXY(long pasosX, int dirXVal, long pasosY, int dirYVal) {
  moverSimultaneoXYLaser(pasosX, dirXVal, pasosY, dirYVal, -1, delayPulsoUs, false);
}

void setup() {
  Serial.begin(115200);

  pinMode(dirX, OUTPUT); pinMode(stepX, OUTPUT); pinMode(enaX, OUTPUT);
  pinMode(dirY, OUTPUT); pinMode(stepY, OUTPUT); pinMode(enaY, OUTPUT);
  pinMode(dirZ, OUTPUT); pinMode(stepZ, OUTPUT); pinMode(enaZ, OUTPUT);

  // Inicializar el modulo laser de 5W en estado seguro (0.0W y desarmado)
  inicializarHardwareLaser();

  // Configurar microinterruptores de palanca y rodaja X e Y con resistencia pull-up interna
  pinMode(endstopX, INPUT_PULLUP);
  pinMode(endstopY, INPUT_PULLUP);
  if (endstopZHabilitado) {
    pinMode(endstopZ, INPUT_PULLUP);
  }

  digitalWrite(stepX, LOW);
  digitalWrite(stepY, LOW);
  digitalWrite(stepZ, LOW);

  // Iniciar con motores en reposo (0.0A)
  establecerEnableTodos(false);

  if (autocalibrarAlEncenderESP32) {
    delay(300);
    autocalibrarHomeCompleto(dirFisicaHomeX, dirFisicaHomeY, dirFisicaHomeZ, false);
    establecerEnableTodos(false);
  }
}

void loop() {
  // Watchdog de seguridad del Laser 5W: si esta en modo Foco estatico y supera el tiempo maximo, se apaga
  if (laserEnModoFoco && laserPwmActual > 0) {
    if (millis() - inicioModoFocoMs >= MAX_TIEMPO_FOCO_MS) {
      apagarLaserInmediato();
    }
  }

  // Corte automatico de corriente de motores tras 2 segundos sin recibir comandos de movimiento
  if (modoAutoReposo && (motorHabilitadoX || motorHabilitadoY || motorHabilitadoZ)) {
    if (millis() - ultimoMovimientoMs >= TIEMPO_REPOSO_MS) {
      establecerEnableTodos(false);
    }
  }

  if (Serial.available() > 0) {
    String comando = Serial.readStringUntil('\n');
    comando.trim();
    if (comando.length() == 0) return;

    // 0. Parada inmediata de emergencia: "STOP"
    if (comando.equalsIgnoreCase("STOP")) {
      apagarLaserInmediato();
      laserArmado = false;
      establecerEnableTodos(false);
      Serial.println("OK,STOP");
      return;
    }

    // 1. Consulta de estado: "STATUS" (Incluye microswitches, laser PWM, estado armado y B2D:1)
    if (comando.equalsIgnoreCase("STATUS")) {
      Serial.print("OK,X:"); Serial.print(posX);
      Serial.print(",Y:");   Serial.print(posY);
      Serial.print(",Z:");   Serial.print(posZ);
      Serial.print(",ENAX:"); Serial.print(motorHabilitadoX ? 1 : 0);
      Serial.print(",ENAY:"); Serial.print(motorHabilitadoY ? 1 : 0);
      Serial.print(",ENAZ:"); Serial.print(motorHabilitadoZ ? 1 : 0);
      Serial.print(",SWX:");  Serial.print(finCarreraPresionado(endstopX) ? 1 : 0);
      Serial.print(",SWY:");  Serial.print(finCarreraPresionado(endstopY) ? 1 : 0);
      Serial.print(",SWZ:");  Serial.print((endstopZHabilitado && finCarreraPresionado(endstopZ)) ? 1 : 0);
      Serial.print(",POL:");  Serial.print(enaActivoEnBajo ? "LOW" : "HIGH");
      Serial.print(",LSR:");  Serial.print(laserPwmActual);
      Serial.print(",ARM:");  Serial.print(laserArmado ? 1 : 0);
      Serial.print(",HL:");   Serial.print(hardLimitsEnMovimiento ? 1 : 0);
      Serial.println(",B2D:1");
      return;
    }

    // 2. Comandos del Modulo Laser de 5W:
    //    - "LASER,ARM,1" o "LASER,ARM,0"
    //    - "LASER,OFF"
    //    - "LASER,FOCUS,<pwm>"
    //    - "LASER,PULSE,<pwm>,<duracionMs>"
    //    - "LASER,PWR,<pwm>"
    if (comando.startsWith("LASER,")) {
      int c1 = comando.indexOf(',');
      int c2 = comando.indexOf(',', c1 + 1);
      String sub = (c2 > c1) ? comando.substring(c1 + 1, c2) : comando.substring(c1 + 1);
      sub.toUpperCase();

      if (sub == "OFF") {
        apagarLaserInmediato();
        Serial.println("OK,LASER,OFF");
        return;
      }

      if (sub == "ARM" && c2 > c1) {
        int valArm = comando.substring(c2 + 1).toInt();
        laserArmado = (valArm == 1);
        if (!laserArmado) {
          apagarLaserInmediato();
        }
        Serial.print("OK,LASER,ARM:");
        Serial.println(laserArmado ? 1 : 0);
        return;
      }

      if (sub == "FOCUS" && c2 > c1) {
        int pwmFoco = comando.substring(c2 + 1).toInt();
        if (!laserArmado || pwmFoco <= 0) {
          apagarLaserInmediato();
          Serial.println("OK,LASER,FOCUS:0");
        } else {
          int pwmSeg = constrain(pwmFoco, 1, MAX_PWM_FOCO_SEGURO);
          laserEnModoFoco = true;
          inicioModoFocoMs = millis();
          escribirPwmLaser(pwmSeg);
          Serial.print("OK,LASER,FOCUS:");
          Serial.println(pwmSeg);
        }
        return;
      }

      if (sub == "PULSE" && c2 > c1) {
        int c3 = comando.indexOf(',', c2 + 1);
        int pwmPulso = (c3 > c2) ? comando.substring(c2 + 1, c3).toInt() : comando.substring(c2 + 1).toInt();
        int durMs = (c3 > c2) ? comando.substring(c3 + 1).toInt() : 200;
        durMs = constrain(durMs, 10, 3000);
        if (!laserArmado) {
          apagarLaserInmediato();
          Serial.println("ERR,LASER_DESARMADO");
          return;
        }
        laserEnModoFoco = false;
        escribirPwmLaser(constrain(pwmPulso, 1, 255));
        delay(durMs);
        apagarLaserInmediato();
        Serial.print("OK,LASER,PULSE,PWM:");
        Serial.print(constrain(pwmPulso, 1, 255));
        Serial.print(",MS:");
        Serial.println(durMs);
        return;
      }

      if (sub == "PWR" && c2 > c1) {
        int pwmVal = comando.substring(c2 + 1).toInt();
        laserEnModoFoco = false;
        escribirPwmLaser(pwmVal);
        Serial.print("OK,LASER,PWR:");
        Serial.println(laserPwmActual);
        return;
      }
    }

    // 3. Reinicio de origen cero: "ZERO" (X, Y) o "ZERO_Z" (Eje Z manual)
    if (comando.equalsIgnoreCase("ZERO")) {
      posX = 0; posY = 0;
      Serial.println("OK");
      return;
    }
    if (comando.equalsIgnoreCase("ZERO_Z")) {
      posZ = 0;
      Serial.println("OK");
      return;
    }

    // 4. Auto-calibracion de microswitches (Ejes X, Y en limite inferior izquierdo):
    if (comando.startsWith("AUTOHOME")) {
      int c1 = comando.indexOf(',');
      if (c1 > 0) {
        int c2 = comando.indexOf(',', c1 + 1);
        int c3 = comando.indexOf(',', c2 + 1);
        if (c2 > c1) {
          dirFisicaHomeX = comando.substring(c1 + 1, c2).toInt();
          if (c3 > c2) {
            dirFisicaHomeY = comando.substring(c2 + 1, c3).toInt();
            dirFisicaHomeZ = comando.substring(c3 + 1).toInt();
          } else {
            dirFisicaHomeY = comando.substring(c2 + 1).toInt();
          }
        }
      }
      autocalibrarHomeCompleto(dirFisicaHomeX, dirFisicaHomeY, dirFisicaHomeZ, true);
      return;
    }

    // 5. Auto-calibracion de un solo eje con su microswitch:
    if (comando.startsWith("HOME_AXIS,")) {
      int c1 = comando.indexOf(',');
      int c2 = comando.indexOf(',', c1 + 1);
      if (c1 > 0 && c2 > c1) {
        char ejeH = toupper(comando.substring(c1 + 1, c2).charAt(0));
        int dirH = comando.substring(c2 + 1).toInt();
        long maxP = (ejeH == 'Z') ? MAX_PASOS_HOME_Z : MAX_PASOS_HOME_XY;
        bool okSw = autocalibrarEjeIndividual(ejeH, dirH, maxP);
        Serial.print("OK,HOME_AXIS,");
        Serial.print(ejeH);
        Serial.print(",SW:");
        Serial.println(okSw ? 1 : 0);
        return;
      }
    }

    // 5.5. Control de Hard Limits en movimiento: "LIMITS,1" o "LIMITS,0"
    if (comando.startsWith("LIMITS,")) {
      int val = comando.substring(7).toInt();
      hardLimitsEnMovimiento = (val == 1);
      Serial.print("OK,LIMITS:");
      Serial.println(hardLimitsEnMovimiento ? 1 : 0);
      return;
    }

    // 6. Velocidad de pulso: "SPEED,<hz>" (actualiza delayPulsoUs en el ESP32)
    if (comando.startsWith("SPEED,")) {
      int hz = comando.substring(6).toInt();
      if (hz >= 50 && hz <= 10000) {
        delayPulsoUs = constrain((int)(500000L / hz), 50, 10000);
      }
      Serial.println("OK");
      return;
    }

    // 7. Comandos ENA: "ENA,POL,LOW", "ENA,POL,HIGH", "ENA,MODE,AUTO", "ENA,MODE,HOLD", "ENA,ALL,0"
    if (comando.startsWith("ENA,")) {
      int c1 = comando.indexOf(',');
      int c2 = comando.lastIndexOf(',');
      if (c1 > 0 && c2 > c1) {
        String objetivo = comando.substring(c1 + 1, c2);
        String valorStr = comando.substring(c2 + 1);
        objetivo.toUpperCase();
        valorStr.toUpperCase();

        if (objetivo == "POL") {
          enaActivoEnBajo = (valorStr == "LOW" || valorStr == "0");
          establecerEnableMotor('X', motorHabilitadoX);
          establecerEnableMotor('Y', motorHabilitadoY);
          establecerEnableMotor('Z', motorHabilitadoZ);
          Serial.println("OK");
          return;
        }

        if (objetivo == "MODE") {
          modoAutoReposo = (valorStr == "AUTO" || valorStr == "1");
          if (modoAutoReposo) {
            establecerEnableTodos(false);
          } else {
            establecerEnableTodos(true);
          }
          Serial.println("OK");
          return;
        }

        bool activar = (valorStr == "1" || valorStr == "ON");
        if (objetivo == "ALL") {
          if (!activar) apagarLaserInmediato();
          establecerEnableTodos(activar);
        } else if (objetivo.length() == 1) {
          establecerEnableMotor(objetivo.charAt(0), activar);
        }
        ultimoMovimientoMs = millis();
        Serial.println("OK");
        return;
      }
    }

    // 8. Comando de movimiento simultaneo 2D con Modulacion Laser Dinamica (Modo Laser 5W):
    //    Formato: "M2L,<pasosX>,<dirX>,<pasosY>,<dirY>,<pwmLaser0a255>,<delayPulsoUs>"
    if (comando.startsWith("M2L,")) {
      int c1 = comando.indexOf(',');
      int c2 = comando.indexOf(',', c1 + 1);
      int c3 = comando.indexOf(',', c2 + 1);
      int c4 = comando.indexOf(',', c3 + 1);
      int c5 = comando.indexOf(',', c4 + 1);
      int c6 = comando.indexOf(',', c5 + 1);
      if (c1 > 0 && c2 > c1 && c3 > c2 && c4 > c3 && c5 > c4) {
        long pasosX = comando.substring(c1 + 1, c2).toInt();
        int dirXVal = comando.substring(c2 + 1, c3).toInt();
        long pasosY = comando.substring(c3 + 1, c4).toInt();
        int dirYVal = comando.substring(c4 + 1, c5).toInt();
        int pwmSeg  = (c6 > c5) ? comando.substring(c5 + 1, c6).toInt() : comando.substring(c5 + 1).toInt();
        int dUs     = (c6 > c5) ? comando.substring(c6 + 1).toInt() : delayPulsoUs;

        moverSimultaneoXYLaser(pasosX, dirXVal, pasosY, dirYVal, pwmSeg, dUs, true);
        Serial.println("OK,M2L");
        return;
      }
    }

    // 9. Comando de movimiento simultaneo 2D estandar (X + Y al mismo tiempo):
    //    Formato: "M2,<pasosX>,<dirX>,<pasosY>,<dirY>"
    if (comando.startsWith("M2,")) {
      int c1 = comando.indexOf(',');
      int c2 = comando.indexOf(',', c1 + 1);
      int c3 = comando.indexOf(',', c2 + 1);
      int c4 = comando.indexOf(',', c3 + 1);
      if (c1 > 0 && c2 > c1 && c3 > c2 && c4 > c3) {
        long pasosX = comando.substring(c1 + 1, c2).toInt();
        int dirXVal = comando.substring(c2 + 1, c3).toInt();
        long pasosY = comando.substring(c3 + 1, c4).toInt();
        int dirYVal = comando.substring(c4 + 1).toInt();

        moverSimultaneoXY(pasosX, dirXVal, pasosY, dirYVal);
        Serial.println("OK,M2");
        return;
      }
    }

    // 10. Comando de movimiento individual: "EJE,PASOS,DIR" (ej. "X,100,1")
    int primeraComa = comando.indexOf(',');
    int segundaComa = comando.lastIndexOf(',');

    if (primeraComa > 0 && segundaComa > primeraComa) {
      char eje = toupper(comando.charAt(0));
      int pasos = comando.substring(primeraComa + 1, segundaComa).toInt();
      int dir = comando.substring(segundaComa + 1).toInt();

      int pinDirAUsar  = (eje == 'X') ? dirX  : (eje == 'Y') ? dirY  : dirZ;
      int pinStepAUsar = (eje == 'X') ? stepX : (eje == 'Y') ? stepY : stepZ;
      int pinSwAUsar   = (eje == 'X') ? endstopX : (eje == 'Y') ? endstopY : endstopZ;
      int dirHomeEje   = (eje == 'X') ? dirFisicaHomeX : (eje == 'Y') ? dirFisicaHomeY : dirFisicaHomeZ;
      bool yaEstabaHabilitado = (eje == 'X') ? motorHabilitadoX : (eje == 'Y') ? motorHabilitadoY : motorHabilitadoZ;

      establecerEnableMotor(eje, true);
      if (!yaEstabaHabilitado) {
        delay(5);
      }

      digitalWrite(pinDirAUsar, dir);
      delayMicroseconds(10);

      long pasosEjecutados = 0;
      bool tieneSwitchActivo = hardLimitsEnMovimiento && ((eje == 'X') || (eje == 'Y') || (eje == 'Z' && endstopZHabilitado));
      for (int i = 0; i < pasos; i++) {
        // Si el eje tiene microswitch habilitado y avanza hacia el limite, detiene el eje y fija 0
        if (tieneSwitchActivo && dir == dirHomeEje && finCarreraPresionado(pinSwAUsar)) {
          if (eje == 'X') posX = 0;
          else if (eje == 'Y') posY = 0;
          else if (eje == 'Z') posZ = 0;
          apagarLaserInmediato();
          break;
        }
        digitalWrite(pinStepAUsar, HIGH);
        delayMicroseconds(delayPulsoUs);
        digitalWrite(pinStepAUsar, LOW);
        delayMicroseconds(delayPulsoUs);
        pasosEjecutados++;
      }

      long signo = (dir == 1) ? 1 : -1;
      if (eje == 'X') posX += (pasosEjecutados * signo);
      else if (eje == 'Y') posY += (pasosEjecutados * signo);
      else if (eje == 'Z') posZ += (pasosEjecutados * signo);

      ultimoMovimientoMs = millis();
      Serial.println("OK");
    }
  }
}
