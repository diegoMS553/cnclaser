// --- ESTADO DEL CLIENTE Y ANIMACIÓN FÍSICA SINCRONIZADA CON ENA+/ENA- ---
let estado = {
    pos_x: 0,
    pos_y: 0,
    pos_z: 0,
    motor_real_x: 0,
    motor_real_y: 0,
    motor_real_z: 0,
    posicion_sincronizada: true,
    mm_x: 0,
    mm_y: 0,
    mm_z: 0,
    angulo_x: 0,
    angulo_y: 0,
    angulo_z: 0,
    limite_fijado: true,
    limite_max_x: 12800,
    limite_max_y: 9600,
    limite_max_z: 400,
    z_home_pulsos: 0,
    origen_z_fijado: true,
    limite_z_fijado: true,
    usar_z_dibujo: false,
    autocalibrar_inicio: true,
    endstops: { X: true, Y: true, Z: false, autohome_completado: false },
    limite_mm_x: 160.0,
    limite_mm_y: 120.0,
    limite_mm_z: 40.0,
    perfil_activo: "estacion_estandar_16x",
    perfiles_disponibles: [],
    switches: { S1: false, S2: false, S3: true, S4: true, S5: false, S6: false },
    ena: { X: false, Y: false, Z: false, modo: "AUTO" },
    invertir_dir: { X: false, Y: true, Z: false },
    amperaje_reposo: { X: 0.0, Y: 0.0, Z: 0.0 },
    microstep: "16",
    pulse_rev: 3200,
    grados_por_pulso: 0.1125,
    current_a: 2.0,
    pk_current_a: 2.2,
    velocidad_hz: 500,
    rpm_estimadas: 9.4,
    pasos_por_mm: 80.0,
    bloquear_limites: false,
    modo_simulacion: true,
    conectado: false,
    puerto: "COM3",
    modo_herramienta: "dibujo",
    laser: {
        potencia_nominal_w: 5.0,
        potencia_nominal_mw: 5000,
        armado: false,
        emitiendo: false,
        en_foco: false,
        modo_operacion: "grabado_linea",
        preset_material: "madera_grabado_fino",
        potencia_pct: 35.0,
        potencia_pwm: 89,
        potencia_watts: 1.75,
        potencia_foco_pct: 3.0,
        potencia_foco_pwm: 8,
        potencia_manual_pct: 25.0,
        potencia_manual_pwm: 64,
        potencia_manual_watts: 1.25,
        emision_manual_continua: false,
        jog_con_laser: false,
        potencia_prueba_pct: 20.0,
        pulso_prueba_ms: 250,
        velocidad_grabado_hz: 900,
        velocidad_viaje_hz: 2200,
        pasadas: 1,
        pausa_enfriamiento_ms: 0,
        z_foco_pulsos: 0,
        z_foco_fijado: true,
        usar_z_foco: false,
        frecuencia_pwm_hz: 5000,
        pwm_actual: 0,
        watts_actuales: 0.0
    },
    presets_laser_5w: {},
    historial: [[0, 0]],
    validaciones: { nivel: "ok", items: [] }
};

let anim = {
    x: 0,
    y: 0,
    z: 0,
    ang_x: 0,
    ang_y: 0,
    ang_z: 0,
    enMovimiento: false,
    ejeEnMovimiento: null,
    laserActivoEnTrazo: false,
    laserPwmEnTrazo: 0,
    cancelarSolicitado: false,
    autohomeEjecutadoEnSesion: false
};

// --- ESTADO DEL MINI SOFTWARE DE DIBUJO CNC ---
let dibujo = {
    herramienta: "freehand", // "select", "freehand", "line", "rect", "circle", "triangle", "polyline"
    figuras: [],             // [{ id, tipo, nombre, trazos: [ [[x,y], ...], ... ] }]  (cada trazo = lapiz abajo)
    seleccion: null,         // null | { tipo: "figura", id } | { tipo: "imagen" }
    arrastre: null,          // Estado temporal al mover / escalar con el mouse
    imagen: null,            // Imagen de fondo cargada para mapear a trazos
    vistaPrevia: null,       // Resultado del mapeo de imagen (en pixeles de la imagen procesada)
    trazoActivo: false,
    puntoInicioMM: null,
    puntoActualMM: null,
    puntosTempMM: [],
    cursorMM: { x: 0, y: 0, dentro: false },
    ejecutando: false,
    pausado: false,
    figuraEjecutandoIdx: -1,
    geometria: { x0: 60, y0: 40, w: 400, h: 300, anchoMM: 160, altoMM: 120 }
};

window.addEventListener("DOMContentLoaded", () => {
    configurarEventosUI();
    configurarEventosLienzoSim();
    configurarEventosLienzoDibujo();
    configurarEventosNavegador();
    configurarUIDescritorio();
    ajustarTamanoCanvases();
    cargarEstadoInicial();
    requestAnimationFrame(bucleRenderizado);
});

window.addEventListener("resize", () => {
    ajustarTamanoCanvases();
    dibujarBlueprint();
});

function configurarEventosUI() {
    const inputPasos = document.getElementById("input-pasos");
    const sliderPasos = document.getElementById("slider-pasos");
    const inputPasosMM = document.getElementById("input-pasos-mm");
    const inputVelHz = document.getElementById("input-velocidad-hz");

    document.querySelectorAll(".chip[data-steps]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".chip[data-steps]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            inputPasos.value = btn.dataset.steps;
            if (sliderPasos) sliderPasos.value = btn.dataset.steps;
            actualizarAvancePreview();
        });
    });

    if (sliderPasos) {
        sliderPasos.addEventListener("input", (e) => {
            inputPasos.value = e.target.value;
            sincronizarChipActivo(e.target.value);
            actualizarAvancePreview();
        });
    }

    inputPasos.addEventListener("input", (e) => {
        if (sliderPasos) sliderPasos.value = Math.min(3200, Math.max(10, e.target.value));
        sincronizarChipActivo(e.target.value);
        actualizarAvancePreview();
    });

    if (inputVelHz) {
        inputVelHz.addEventListener("change", async (e) => {
            const vhz = Math.max(50, Math.min(20000, parseInt(e.target.value, 10) || 1000));
            e.target.value = vhz;
            actualizarAvancePreview();
            await enviarAjustes({ velocidad_hz: vhz });
            actualizarEstadisticasDibujo();
        });
    }

    inputPasosMM.addEventListener("change", async (e) => {
        const val = parseFloat(e.target.value) || 80;
        actualizarAvancePreview();
        await enviarAjustes({ pasos_por_mm: val });
    });

    document.getElementById("chk-simulacion").addEventListener("change", async (e) => {
        await enviarAjustes({ modo_simulacion: e.target.checked });
    });

    document.getElementById("chk-soft-limits").addEventListener("change", async (e) => {
        await enviarAjustes({ bloquear_limites: e.target.checked });
    });

    document.getElementById("btn-refresh-ports").addEventListener("click", cargarEstadoInicial);
    document.getElementById("btn-connect").addEventListener("click", alternarConexionSerial);

    // Control por Teclado
    window.addEventListener("keydown", (e) => {
        if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

        if (e.key === "Escape") {
            if (dibujo.herramienta === "polyline" && dibujo.puntosTempMM.length > 0) {
                finalizarPolilineaActiva();
            } else {
                paroEmergencia();
            }
            return;
        }

        // Tecla Supr / Delete: eliminar la figura o imagen seleccionada en el Estudio de Dibujo
        if ((e.key === "Delete" || e.key === "Backspace") && document.getElementById("view-drawing")?.classList.contains("active")) {
            if (dibujo.seleccion) {
                e.preventDefault();
                eliminarSeleccion();
            }
            return;
        }

        // Solo usar flechas para mover motores cuando está activa la vista de control manual
        if (!document.getElementById("view-sim").classList.contains("active")) return;

        const mapaTeclas = {
            "ArrowUp": { eje: "Y", dir: 1, btn: "btn-y-plus" },
            "ArrowDown": { eje: "Y", dir: 0, btn: "btn-y-minus" },
            "ArrowLeft": { eje: "X", dir: 0, btn: "btn-x-minus" },
            "ArrowRight": { eje: "X", dir: 1, btn: "btn-x-plus" },
            "PageUp": { eje: "Z", dir: 1, btn: "btn-z-plus" },
            "PageDown": { eje: "Z", dir: 0, btn: "btn-z-minus" }
        };

        if (mapaTeclas[e.key]) {
            e.preventDefault();
            const cfg = mapaTeclas[e.key];
            const el = document.getElementById(cfg.btn);
            if (el) {
                el.classList.add("pressed");
                setTimeout(() => el.classList.remove("pressed"), 140);
            }
            moverEje(cfg.eje, cfg.dir);
        }
    });
}

function sincronizarChipActivo(valor) {
    document.querySelectorAll(".chip").forEach(b => {
        b.classList.toggle("active", b.dataset.steps === String(valor));
    });
}

function actualizarAvancePreview() {
    const pasos = parseFloat(document.getElementById("input-pasos").value) || 0;
    const rel = parseFloat(document.getElementById("input-pasos-mm").value) || 1;
    const vhz = parseFloat(document.getElementById("input-velocidad-hz")?.value) || 1000;
    const mm = pasos / Math.max(0.01, rel);
    const seg = pasos / Math.max(50, vhz);

    document.getElementById("lbl-avance-mm").textContent = `${mm.toFixed(2)} mm (${seg.toFixed(2)}s)`;

    const pRev = estado.pulse_rev || 3200;
    const rpm = estado.pulse_rev > 0 ? ((vhz / pRev) * 60).toFixed(1) : "0.0";
    const lblRpm = document.getElementById("lbl-rpm-calc");
    if (lblRpm) {
        lblRpm.textContent = `${rpm} RPM - Tiempo real segun pulsos`;
    }
}

// ==========================================================================
// GESTIÓN DE PERFILES (CARPETA PERFILES/, CARGAR, GUARDAR, IMPORTAR, ELIMINAR)
// ==========================================================================
async function cargarPerfilSeleccionado() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const sel = document.getElementById("select-profile");
    if (!sel || !sel.value) return;

    const res = await fetch("/api/profiles/load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.value })
    });
    const data = await res.json();
    sincronizarEstado(data);
    dibujarBlueprint();
}

async function guardarPerfilActual(modoGuardado) {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const inputNombre = document.getElementById("input-profile-name");
    const selectProfile = document.getElementById("select-profile");
    const nombre = inputNombre ? inputNombre.value.trim() : "";

    if (modoGuardado === "nuevo" && !nombre) {
        mostrarMensajeConsola("Escribe un nombre en el campo de texto para guardar el nuevo perfil.", true);
        if (inputNombre) inputNombre.focus();
        return;
    }

    const res = await fetch("/api/profiles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            modo_guardado: modoGuardado,
            id: selectProfile ? selectProfile.value : estado.perfil_activo,
            nombre: nombre
        })
    });
    const data = await res.json();
    if (inputNombre && modoGuardado === "nuevo" && data.ok) {
        inputNombre.value = "";
    }
    sincronizarEstado(data);
}

async function importarArchivoPerfil(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    try {
        const texto = await file.text();
        const jsonConfig = JSON.parse(texto);
        const res = await fetch("/api/profiles/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                filename: file.name,
                config: jsonConfig
            })
        });
        const data = await res.json();
        sincronizarEstado(data);
        dibujarBlueprint();
    } catch (err) {
        mostrarMensajeConsola("Error al leer el archivo JSON importado. Verifica que sea un JSON valido.", true);
    } finally {
        event.target.value = "";
    }
}

async function eliminarPerfilSeleccionado() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const sel = document.getElementById("select-profile");
    if (!sel || !sel.value) return;

    const res = await fetch("/api/profiles/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sel.value })
    });
    const data = await res.json();
    sincronizarEstado(data);
    if (!data.ok && data.error) {
        mostrarMensajeConsola(data.error, true);
    }
}

// ==========================================================================
// GESTIÓN DE ENABLE (ENA+ / ENA-) POR MOTOR Y GLOBAL
// ==========================================================================
async function cambiarModoEna(modo) {
    if (anim.enMovimiento) return;
    const res = await fetch("/api/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo })
    });
    const data = await res.json();
    sincronizarEstado(data);
    dibujarBlueprint();
}

async function alternarPolaridadEna() {
    if (anim.enMovimiento) return;
    const res = await fetch("/api/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polaridad: "TOGGLE" })
    });
    const data = await res.json();
    sincronizarEstado(data);
}

async function alternarEnaMotor(eje) {
    if (anim.enMovimiento) return;
    if (estado.ena.modo !== "HOLD") {
        await fetch("/api/enable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modo: "HOLD" })
        });
    }
    const res = await fetch("/api/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eje })
    });
    const data = await res.json();
    sincronizarEstado(data);
}

async function alternarDireccionMotor(eje) {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const res = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            accion: "invertir_direccion_eje",
            eje: eje
        })
    });
    const data = await res.json();
    sincronizarEstado(data);
}

// ==========================================================================
// GESTIÓN DE DIP SWITCHES (S1 - S6) Y TABLAS 1 Y 2
// ==========================================================================
async function alternarSwitch(claveSwitch) {
    if (anim.enMovimiento) return;
    const nuevoValor = !estado.switches[claveSwitch];
    const nuevosSwitches = { ...estado.switches, [claveSwitch]: nuevoValor };
    await enviarConfiguracionSwitches(nuevosSwitches);
}

async function aplicarFilaMicrostep(s1, s2, s3) {
    if (anim.enMovimiento) return;
    const nuevosSwitches = { ...estado.switches, S1: s1, S2: s2, S3: s3 };
    await enviarConfiguracionSwitches(nuevosSwitches);
}

async function aplicarFilaCorriente(s4, s5, s6) {
    if (anim.enMovimiento) return;
    const nuevosSwitches = { ...estado.switches, S4: s4, S5: s5, S6: s6 };
    await enviarConfiguracionSwitches(nuevosSwitches);
}

async function enviarConfiguracionSwitches(switchesObj) {
    const res = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            accion: "configurar_switches",
            switches: switchesObj
        })
    });
    const data = await res.json();
    sincronizarEstado(data);
    dibujarBlueprint();
}

// ==========================================================================
// COMUNICACIÓN REST Y VALIDACIÓN A PRUEBA DE ERRORES
// ==========================================================================
async function cargarEstadoInicial() {
    try {
        const res = await fetch("/api/state");
        const data = await res.json();
        sincronizarEstado(data, true);
        if (data.autocalibrar_inicio && !anim.autohomeEjecutadoEnSesion) {
            anim.autohomeEjecutadoEnSesion = true;
            await ejecutarAutoCalibracionMicroswitches("ALL", true);
        }
    } catch (err) {
        mostrarMensajeConsola("Error de enlace con el servidor local Flask.", true);
    }
}

async function ejecutarAutoCalibracionMicroswitches(eje = "ALL", esInicioAutomatico = false) {
    if (anim.enMovimiento || dibujo.ejecutando) return false;

    const etiqueta = eje === "ALL"
        ? (esInicioAutomatico ? "Auto-Calibracion Inicial (Switches X, Y)" : "Auto-Calibracion Microswitches (X, Y)")
        : `Homing Microswitch Eje ${eje}`;

    mostrarMensajeConsola(`${etiqueta}: Buscando microinterruptores de palanca y rodaja en X, Y...`);

    anim.enMovimiento = true;
    anim.ejeEnMovimiento = eje === "ALL" ? "XY" : eje;
    anim.cancelarSolicitado = false;

    try {
        const res = await fetch("/api/autohome", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eje })
        });
        const data = await res.json();

        if (!data.ok) {
            sincronizarEstado(data);
            mostrarMensajeConsola(data.error || "No se pudo completar la auto-calibracion por microswitches.", true);
            return false;
        }

        if (eje === "ALL" || eje === "X") actualizarIndicadorEnaEnMovimiento("X", true);
        if (eje === "ALL" || eje === "Y") actualizarIndicadorEnaEnMovimiento("Y", true);

        await animarTransicionFisica(data, etiqueta);
        sincronizarEstado(data, true);
        dibujarBlueprint();
        return true;
    } catch (err) {
        mostrarMensajeConsola("Error de comunicacion durante la auto-calibracion por microswitches.", true);
        return false;
    } finally {
        anim.enMovimiento = false;
        anim.ejeEnMovimiento = null;
    }
}

async function alternarAutoCalibrarInicio(activo) {
    await enviarAjustes({ autocalibrar_inicio: Boolean(activo) });
}

async function validarPosicionMotor() {
    if (anim.enMovimiento) return;
    mostrarMensajeConsola("Verificando sincronia de posicion y estado ENA con el ESP32...");
    const res = await fetch("/api/verify_position", { method: "POST" });
    const data = await res.json();
    sincronizarEstado(data, true);
    if (!data.ok && data.error) {
        mostrarMensajeConsola(data.error, true);
    }
}

async function paroEmergencia() {
    dibujo.ejecutando = false;
    dibujo.pausado = false;
    dibujo.figuraEjecutandoIdx = -1;
    anim.laserActivoEnTrazo = false;
    anim.laserPwmEnTrazo = 0;
    const boxDraw = document.getElementById("drawing-progress-box");
    if (boxDraw) boxDraw.classList.add("hidden");
    actualizarProgresoDibujoUI(0, 0, "Detenido por usuario", null, false);

    await apagarLaserEmergencia(true);

    if (!anim.enMovimiento) {
        await cambiarModoEna("FREE");
        return;
    }
    anim.cancelarSolicitado = true;
}

async function alternarConexionSerial() {
    if (anim.enMovimiento) return;
    const puerto = document.getElementById("select-port").value;
    const accion = estado.conectado ? "desconectar" : "conectar";
    mostrarMensajeConsola(`${accion === "conectar" ? "Validando puerto " + puerto : "Cerrando puerto serial"}...`);

    const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, puerto })
    });
    const data = await res.json();
    sincronizarEstado(data);
    if (!data.ok && data.error) {
        mostrarMensajeConsola(`Aviso: No se encontro controlador en ${puerto}. Proteccion en Simulacion activa.`, true);
    } else if (accion === "conectar" && data.conectado && estado.autocalibrar_inicio) {
        await ejecutarAutoCalibracionMicroswitches("ALL", true);
    }
}

async function enviarAjustes(ajustes) {
    const res = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "actualizar_ajustes", ...ajustes })
    });
    const data = await res.json();
    sincronizarEstado(data);
    if (!data.ok && data.error) {
        mostrarMensajeConsola(data.error, true);
    }
}

async function moverEje(eje, dir_int, pasosPersonalizados = null, etiquetaAccion = null) {
    if (anim.enMovimiento) return false;

    const pasos = pasosPersonalizados !== null
        ? pasosPersonalizados
        : parseInt(document.getElementById("input-pasos").value, 10) || 100;

    if (pasos <= 0) return true;

    // Si es un movimiento manual de X o Y y esta activo "Mover Motores X/Y con Laser Manual",
    // ejecuta el movimiento sincronizado encendiendo el laser a la potencia manual configurada
    const ls = estado.laser || {};
    if (pasosPersonalizados === null && (eje === "X" || eje === "Y") && ls.jog_con_laser && ls.armado && (ls.potencia_manual_pwm || 0) > 0) {
        const signo = dir_int === 1 ? 1 : -1;
        const destX = eje === "X" ? estado.pos_x + pasos * signo : estado.pos_x;
        const destY = eje === "Y" ? estado.pos_y + pasos * signo : estado.pos_y;
        const vhzMan = parseInt(document.getElementById("input-velocidad-hz")?.value || estado.velocidad_hz || 500, 10);
        return await moverSimultaneoXY(
            destX,
            destY,
            `Jog Manual ${eje}${signo > 0 ? "+" : "-"} + Laser ${(ls.potencia_manual_watts || 1.25).toFixed(2)}W`,
            {
                laser_activo: true,
                laser_pwm: ls.potencia_manual_pwm || 64,
                velocidad_hz: vhzMan
            }
        );
    }

    anim.enMovimiento = true;
    anim.ejeEnMovimiento = eje;
    anim.cancelarSolicitado = false;

    const signo = dir_int === 1 ? 1 : -1;
    const inv = Boolean(estado.invertir_dir && estado.invertir_dir[eje]);
    const dirMotor = inv ? -signo : signo;
    const prevX = anim.x, prevY = anim.y, prevZ = anim.z;
    const destPredX = eje === "X" ? estado.pos_x + pasos * signo : estado.pos_x;
    const destPredY = eje === "Y" ? estado.pos_y + pasos * signo : estado.pos_y;
    const destPredZ = eje === "Z" ? estado.pos_z + pasos * signo : estado.pos_z;
    const vHzEst = Math.max(50, Number(estado.velocidad_hz || 500));
    const durPredMs = Math.max(16, (pasos / vHzEst) * 1000);
    const predData = {
        pos_x: destPredX,
        pos_y: destPredY,
        pos_z: destPredZ,
        movimiento: {
            eje,
            pasos,
            dir_int,
            duracion_ms: durPredMs,
            grados_giro: pasos * (estado.grados_por_pulso || 0.1125) * dirMotor
        }
    };

    try {
        actualizarIndicadorEnaEnMovimiento(eje, true);
        const fetchPromise = fetch("/api/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eje, pasos, dir_int })
        }).then(r => r.json());

        const animPromise = animarTransicionFisica(predData, etiquetaAccion);
        const [data, completado] = await Promise.all([fetchPromise, animPromise]);
        anim.ejeEnMovimiento = null;

        if (!data.ok) {
            anim.x = prevX; anim.y = prevY; anim.z = prevZ;
            sincronizarEstado(data, true);
            mostrarMensajeConsola(data.error || "Movimiento bloqueado por validacion de seguridad", true);
            return false;
        }

        if (!completado) {
            const resStop = await fetch("/api/calibrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accion: "sincronizar_parada",
                    pos_x: Math.round(anim.x),
                    pos_y: Math.round(anim.y),
                    pos_z: Math.round(anim.z)
                })
            });
            const dataStop = await resStop.json();
            sincronizarEstado(dataStop, true);
            return false;
        }

        sincronizarEstado(data, true);
        return true;
    } catch (err) {
        mostrarMensajeConsola("Error de comunicacion al ejecutar movimiento.", true);
        return false;
    } finally {
        anim.enMovimiento = false;
        anim.ejeEnMovimiento = null;
    }
}

async function moverSimultaneoXY(destX, destY, etiquetaAccion = null, opcionesLaser = null) {
    if (anim.enMovimiento) return false;

    const dx = Math.round(destX) - estado.pos_x;
    const dy = Math.round(destY) - estado.pos_y;
    if (dx === 0 && dy === 0) return true;

    anim.enMovimiento = true;
    anim.ejeEnMovimiento = (dx !== 0 && dy !== 0) ? "XY" : (dx !== 0 ? "X" : "Y");
    anim.cancelarSolicitado = false;
    anim.laserActivoEnTrazo = Boolean(opcionesLaser && opcionesLaser.laser_activo);
    anim.laserPwmEnTrazo = opcionesLaser && opcionesLaser.laser_pwm ? Number(opcionesLaser.laser_pwm) : 0;

    const payload = {
        dest_x: Math.round(destX),
        dest_y: Math.round(destY)
    };
    if (opcionesLaser) {
        payload.laser_activo = Boolean(opcionesLaser.laser_activo);
        payload.laser_pwm = Number(opcionesLaser.laser_pwm || 0);
        if (opcionesLaser.velocidad_hz) {
            payload.velocidad_hz = Number(opcionesLaser.velocidad_hz);
        }
    }

    const prevX = anim.x, prevY = anim.y, prevZ = anim.z;
    const maxPasos = Math.max(Math.abs(dx), Math.abs(dy));
    const vHzEst = Math.max(50, Number((opcionesLaser && opcionesLaser.velocidad_hz) || estado.velocidad_hz || 500));
    const durPredMs = Math.max(16, (maxPasos / vHzEst) * 1000);
    const invX = Boolean(estado.invertir_dir && estado.invertir_dir.X);
    const invY = Boolean(estado.invertir_dir && estado.invertir_dir.Y);
    const predData = {
        pos_x: Math.round(destX),
        pos_y: Math.round(destY),
        pos_z: estado.pos_z,
        movimiento: {
            eje: anim.ejeEnMovimiento,
            pasos: maxPasos,
            dir_int: 1,
            duracion_ms: durPredMs,
            grados_giro_x: dx * (estado.grados_por_pulso || 0.1125) * (invX ? -1 : 1),
            grados_giro_y: dy * (estado.grados_por_pulso || 0.1125) * (invY ? -1 : 1)
        }
    };

    try {
        if (dx !== 0) actualizarIndicadorEnaEnMovimiento("X", true);
        if (dy !== 0) actualizarIndicadorEnaEnMovimiento("Y", true);

        const fetchPromise = fetch("/api/move_xy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        }).then(r => r.json());

        const animPromise = animarTransicionFisica(predData, etiquetaAccion);
        const [data, completado] = await Promise.all([fetchPromise, animPromise]);
        anim.ejeEnMovimiento = null;

        if (!data.ok) {
            anim.x = prevX; anim.y = prevY; anim.z = prevZ;
            sincronizarEstado(data, true);
            mostrarMensajeConsola(data.error || "Movimiento XY bloqueado por validacion de seguridad", true);
            return false;
        }

        if (!completado) {
            await apagarLaserEmergencia(true);
            const resStop = await fetch("/api/calibrate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accion: "sincronizar_parada",
                    pos_x: Math.round(anim.x),
                    pos_y: Math.round(anim.y),
                    pos_z: Math.round(anim.z)
                })
            });
            const dataStop = await resStop.json();
            sincronizarEstado(dataStop, true);
            return false;
        }

        sincronizarEstado(data, true);
        return true;
    } catch (err) {
        mostrarMensajeConsola("Error de comunicacion al ejecutar interpolacion XY simultanea.", true);
        return false;
    } finally {
        anim.enMovimiento = false;
        anim.ejeEnMovimiento = null;
        anim.laserActivoEnTrazo = false;
        anim.laserPwmEnTrazo = 0;
    }
}

function actualizarIndicadorEnaEnMovimiento(eje, activoEnGiro) {
    const key = eje.toLowerCase();
    const btnEna = document.getElementById(`btn-ena-${key}`);
    const lblAmp = document.getElementById(`amp-live-${key}`);
    if (!btnEna || !lblAmp) return;

    if (activoEnGiro) {
        btnEna.textContent = "ENA+ LOW (ACTIVO)";
        btnEna.className = "ena-toggle-btn energized";
        lblAmp.textContent = `${estado.current_a.toFixed(1)} A (En Giro)`;
        lblAmp.className = "amp-active";
    }
}

function animarTransicionFisica(data, etiquetaAccion = null) {
    return new Promise((resolve) => {
        const inicioX = anim.x;
        const inicioY = anim.y;
        const inicioZ = anim.z;
        const inicioAngX = anim.ang_x;
        const inicioAngY = anim.ang_y;
        const inicioAngZ = anim.ang_z;

        const destX = data.pos_x;
        const destY = data.pos_y;
        const destZ = data.pos_z;

        const mov = data.movimiento || { eje: "X", pasos: 100, dir_int: 1, duracion_ms: 250 };
        const deltaGrados = mov.grados_giro !== undefined
            ? mov.grados_giro
            : mov.pasos * (estado.grados_por_pulso || 0.1125) * (mov.dir_int === 1 ? 1 : -1);
        const deltaGradosX = mov.grados_giro_x !== undefined ? mov.grados_giro_x : deltaGrados;
        const deltaGradosY = mov.grados_giro_y !== undefined ? mov.grados_giro_y : deltaGrados;

        const duracionMs = Math.max(16, mov.duracion_ms || 120);
        const t0 = performance.now();

        const boxProg = document.getElementById("motion-progress-box");
        const txtProg = document.getElementById("motion-progress-text");
        if (boxProg) boxProg.classList.remove("hidden");

        const esc = Math.max(0.01, estado.pasos_por_mm);

        function step(ahora) {
            if (anim.cancelarSolicitado) {
                if (boxProg) boxProg.classList.add("hidden");
                resolve(false);
                return;
            }

            const transcurrido = ahora - t0;
            const p = Math.min(1, transcurrido / duracionMs);

            const ease = dibujo.ejecutando
                ? p
                : (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

            anim.x = inicioX + (destX - inicioX) * ease;
            anim.y = inicioY + (destY - inicioY) * ease;
            anim.z = inicioZ + (destZ - inicioZ) * ease;

            if (mov.eje === "XY") {
                anim.ang_x = inicioAngX + deltaGradosX * ease;
                anim.ang_y = inicioAngY + deltaGradosY * ease;
            } else if (mov.eje === "X") {
                anim.ang_x = inicioAngX + deltaGrados * ease;
            } else if (mov.eje === "Y") {
                anim.ang_y = inicioAngY + deltaGrados * ease;
            } else if (mov.eje === "Z") {
                anim.ang_z = inicioAngZ + deltaGrados * ease;
            }

            const pulsosActuales = Math.round(mov.pasos * ease);
            const segRestantes = Math.max(0, (duracionMs - transcurrido) / 1000).toFixed(1);
            const prefijo = etiquetaAccion ? `${etiquetaAccion} | ` : "";
            if (txtProg) {
                txtProg.textContent = `${prefijo}Eje ${mov.eje} [ENA+ LOW | ${estado.current_a}A]: ${pulsosActuales} / ${mov.pasos} pulsos (${segRestantes}s restantes)`;
            }

            document.getElementById("dro-x-steps").textContent = `${Math.round(anim.x)} pulsos`;
            document.getElementById("dro-y-steps").textContent = `${Math.round(anim.y)} pulsos`;
            document.getElementById("dro-z-steps").textContent = `${Math.round(anim.z)} pulsos`;
            document.getElementById("dro-x-mm").innerHTML = `${(anim.x / esc).toFixed(2)} <small>mm</small>`;
            document.getElementById("dro-y-mm").innerHTML = `${(anim.y / esc).toFixed(2)} <small>mm</small>`;
            document.getElementById("dro-z-mm").innerHTML = `${(anim.z / esc).toFixed(2)} <small>mm</small>`;

            if (p < 1) {
                requestAnimationFrame(step);
            } else {
                if (boxProg) boxProg.classList.add("hidden");
                resolve(true);
            }
        }
        requestAnimationFrame(step);
    });
}

async function accionCalibrar(accion, extra = {}) {
    if (anim.enMovimiento) return;
    const res = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, ...extra })
    });
    const data = await res.json();
    const forzarAnim = accion === "fijar_cero" || accion === "fijar_home_z" || accion === "fijar_limite_z";
    sincronizarEstado(data, forzarAnim);
    if (!data.ok && data.error) {
        mostrarMensajeConsola(data.error, true);
        return false;
    }
    dibujarBlueprint();
    return true;
}

async function alternarUsoZEnDibujo(activo) {
    const chkMain = document.getElementById("chk-enable-z-main");
    const chkDraw = document.getElementById("chk-draw-use-z");
    if (chkMain) chkMain.checked = Boolean(activo);
    if (chkDraw) chkDraw.checked = Boolean(activo);
    await enviarAjustes({ usar_z_dibujo: Boolean(activo) });
}

async function actualizarParametrosZDesdeInputs() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const zHome = parseInt(document.getElementById("input-z-up")?.value ?? "0", 10) || 0;
    const zPapel = parseInt(document.getElementById("input-z-down")?.value ?? "400", 10) || 0;
    await enviarAjustes({ z_home_pulsos: zHome, limite_max_z: zPapel });
}

async function moverZAPosicionCalibrada(objetivo) {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const zHome = parseInt(document.getElementById("input-z-up")?.value ?? estado.z_home_pulsos ?? 0, 10) || 0;
    const zPapel = parseInt(document.getElementById("input-z-down")?.value ?? estado.limite_max_z ?? 0, 10) || 0;
    const destZ = objetivo === "home" ? zHome : zPapel;
    const etq = objetivo === "home"
        ? `Ir a Home Z (Levantado: ${destZ}p)`
        : `Ir a Maximo Z (Contacto Papel: ${destZ}p)`;
    await irAPuntoZPulsos(destZ, etq);
}

async function irAOrigen() {
    if (anim.enMovimiento) return;
    const zHome = estado.z_home_pulsos || 0;
    const dx = -estado.pos_x;
    const dy = -estado.pos_y;
    const dz = zHome - estado.pos_z;

    if (dx === 0 && dy === 0 && dz === 0) {
        mostrarMensajeConsola("Validacion: El motor ya se encuentra en la referencia Origen (0, 0, Home Z).");
        await validarPosicionMotor();
        return;
    }

    mostrarMensajeConsola("Iniciando retorno controlado a Origen: Primero levanta Z a Home Z y luego mueve X+Y al mismo tiempo...");

    if (dz !== 0) {
        const okZ = await moverEje("Z", dz > 0 ? 1 : 0, Math.abs(dz), "Retorno Home Z (Levantado)");
        if (!okZ) return;
    }
    if (dx !== 0 || dy !== 0) {
        const okXY = await moverSimultaneoXY(0, 0, "Retorno Home XY");
        if (!okXY) return;
    }

    await validarPosicionMotor();
    mostrarMensajeConsola("Retorno a Origen (0, 0, Home Z) completado. Motores en reposo ENA (0.0 A).");
}

async function recorrerPerimetro() {
    if (anim.enMovimiento) return;
    if (!estado.limite_fijado || (estado.limite_max_x === 0 || estado.limite_max_y === 0)) {
        mostrarMensajeConsola("Error de validacion: Primero fija el Origen (0,0,0) y el Limite Maximo (X, Y) antes de probar el perimetro.", true);
        return;
    }

    mostrarMensajeConsola("Ejecutando recorrido perimetral a velocidad fisica controlada...");
    const xm = estado.limite_max_x;
    const ym = estado.limite_max_y;
    const esquinas = [[0, 0], [xm, 0], [xm, ym], [0, ym], [0, 0]];

    for (let i = 0; i < esquinas.length; i++) {
        const [tx, ty] = esquinas[i];
        const etq = `Perimetro (${i + 1}/${esquinas.length})`;
        const dx = tx - estado.pos_x;
        if (dx !== 0) {
            const ok = await moverEje("X", dx > 0 ? 1 : 0, Math.abs(dx), etq);
            if (!ok) return;
        }
        const dy = ty - estado.pos_y;
        if (dy !== 0) {
            const ok = await moverEje("Y", dy > 0 ? 1 : 0, Math.abs(dy), etq);
            if (!ok) return;
        }
    }
    await validarPosicionMotor();
    mostrarMensajeConsola("Validacion perimetral finalizada. Motores en reposo ENA (0.0 A).");
}

async function abrirEstudioDibujo() {
    if (!estado.limite_fijado || estado.limite_max_x === 0 || estado.limite_max_y === 0) {
        await accionCalibrar("fijar_limite", { usar_demo_si_cero: true });
    }
    cambiarVista("drawing");
}

async function abrirEstudioEnModo(herramienta) {
    await cambiarModoHerramientaEstudio(herramienta);
    await abrirEstudioDibujo();
    if (herramienta === "laser") {
        activarTabDock("drawing", "run");
    }
}

// ==========================================================================
// MODULO LASER DE DIODO 5W (PWM 0..255, PRUEBA DE FUNCIONAMIENTO Y CALIBRACION)
// ==========================================================================
let _timerPulsoLaserUI = null;

async function enviarAccionLaser(accion, extra = {}) {
    try {
        const res = await fetch("/api/laser", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion, ...extra })
        });
        const data = await res.json();
        sincronizarEstado(data);
        if (!data.ok && data.error) {
            mostrarMensajeConsola(data.error, true);
            return null;
        }
        return data;
    } catch (err) {
        mostrarMensajeConsola("Error de comunicacion con el controlador Laser 5W.", true);
        return null;
    }
}

async function cambiarModoHerramientaEstudio(herramienta) {
    if (dibujo.ejecutando) return;
    const modo = herramienta === "laser" ? "laser" : "dibujo";
    await enviarAccionLaser("cambiar_herramienta", { modo_herramienta: modo });
    actualizarEstadisticasDibujo();
}

async function alternarArmadoLaser(armado) {
    const chkSim = document.getElementById("chk-laser-armed-sim");
    const chkDraw = document.getElementById("chk-laser-armed-draw");
    if (chkSim) chkSim.checked = Boolean(armado);
    if (chkDraw) chkDraw.checked = Boolean(armado);
    await enviarAccionLaser("armar", { armado: Boolean(armado) });
}

async function apagarLaserEmergencia(silencioso = false) {
    if (_timerPulsoLaserUI) {
        clearTimeout(_timerPulsoLaserUI);
        _timerPulsoLaserUI = null;
    }
    anim.laserActivoEnTrazo = false;
    anim.laserPwmEnTrazo = 0;
    try {
        const res = await fetch("/api/laser", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accion: "apagar" })
        });
        const data = await res.json();
        sincronizarEstado(data);
        if (!silencioso) {
            mostrarMensajeConsola("Laser 5W apagado inmediatamente (0.00 W | PWM 0).");
        }
    } catch (_) {}
}

async function alternarPunteroFocoLaser() {
    if (dibujo.ejecutando) return;
    const ls = estado.laser || {};
    const nuevoEstadoFoco = !Boolean(ls.en_foco);
    const focoPct = parseFloat(
        document.getElementById("input-laser-focus-pct-sim")?.value
        || document.getElementById("input-laser-focus-pct-draw")?.value
        || ls.potencia_foco_pct
        || 3.0
    );
    await enviarAccionLaser("foco", {
        activo: nuevoEstadoFoco,
        potencia_foco_pct: focoPct
    });
}

// --- FUNCIONES DE CONTROL MANUAL DIRECTO DEL LASER 5W (COMO EN LOS MOTORES) ---
let _gatilloManualActivo = false;

function previsualizarSliderManualLaser(pctVal) {
    const pct = Math.max(0, Math.min(100, parseFloat(pctVal) || 0));
    const pwm = Math.round((pct / 100.0) * 255);
    const watts = ((pct / 100.0) * 5.0).toFixed(2);
    const inp = document.getElementById("input-laser-manual-pct");
    const sld = document.getElementById("slider-laser-manual-pct");
    const lbl = document.getElementById("lbl-laser-manual-inline");
    if (inp && document.activeElement !== inp) inp.value = pct;
    if (sld && document.activeElement !== sld) sld.value = pct;
    if (lbl) lbl.textContent = `${pct.toFixed(0)}% (${watts} W | PWM ${pwm})`;
}

async function fijarPotenciaManualLaser(pctVal) {
    if (dibujo.ejecutando) return;
    const pct = Math.max(0, Math.min(100, parseFloat(pctVal) || 0));
    previsualizarSliderManualLaser(pct);
    if (pct === 0) {
        await enviarAccionLaser("manual", { potencia_manual_pct: 0, encender: false });
    } else {
        await enviarAccionLaser("manual", { potencia_manual_pct: pct });
    }
}

async function ajustarPotenciaManualPaso(deltaPct) {
    if (dibujo.ejecutando) return;
    await enviarAccionLaser("manual", { delta_pct: deltaPct });
}

async function alternarEmisionManualLaser() {
    if (dibujo.ejecutando) return;
    const ls = estado.laser || {};
    const encender = !Boolean(ls.emision_manual_continua);
    const pctActual = parseFloat(document.getElementById("input-laser-manual-pct")?.value ?? ls.potencia_manual_pct ?? 25);
    await enviarAccionLaser("manual", {
        potencia_manual_pct: pctActual > 0 ? pctActual : 25,
        encender: encender
    });
}

async function iniciarGatilloManualLaser() {
    if (dibujo.ejecutando || _gatilloManualActivo) return;
    const ls = estado.laser || {};
    if (!ls.armado) {
        mostrarMensajeConsola("Seguridad Laser 5W: Primero activa 'Armar Sistema Laser 5W' para usar el gatillo manual.", true);
        return;
    }
    _gatilloManualActivo = true;
    const pctActual = parseFloat(document.getElementById("input-laser-manual-pct")?.value ?? ls.potencia_manual_pct ?? 25);
    await enviarAccionLaser("manual", {
        potencia_manual_pct: pctActual > 0 ? pctActual : 25,
        encender: true
    });
}

async function soltarGatilloManualLaser() {
    if (!_gatilloManualActivo) return;
    _gatilloManualActivo = false;
    await apagarLaserEmergencia(true);
    mostrarMensajeConsola("Gatillo manual liberado: Laser 5W en corte seguro (0.00 W | PWM 0).");
}

async function alternarJogConLaserManual(activo) {
    await enviarAccionLaser("manual", { jog_con_laser: Boolean(activo) });
}

function fijarPulsoRapidoLaser(ms) {
    const elSim = document.getElementById("input-laser-pulse-ms-sim");
    if (elSim) elSim.value = ms;
    actualizarConfiguracionLaserDesdeUI("sim");
}

function fijarPotenciaRapidaLaser(pct) {
    sincronizarSliderPotenciaLaser(pct);
    actualizarConfiguracionLaserDesdeUI("draw");
}

function sincronizarSliderPotenciaLaser(pctVal) {
    const pct = Math.max(0, Math.min(100, parseFloat(pctVal) || 0));
    const pwm = Math.round((pct / 100.0) * 255);
    const watts = ((pct / 100.0) * 5.0).toFixed(2);
    const rng = document.getElementById("range-laser-power-pct");
    const inp = document.getElementById("input-laser-power-pct");
    const lbl = document.getElementById("lbl-laser-power-inline");
    if (rng && document.activeElement !== rng) rng.value = pct;
    if (inp && document.activeElement !== inp) inp.value = pct;
    if (lbl) lbl.textContent = `${pct.toFixed(0)}% (${watts} W | PWM ${pwm})`;
}

async function dispararPulsoPruebaLaser(origen = "sim") {
    if (dibujo.ejecutando || anim.enMovimiento) return;
    const ls = estado.laser || {};
    if (!ls.armado) {
        mostrarMensajeConsola("Seguridad Laser 5W: Primero activa 'Armar Sistema Laser 5W' antes de disparar un pulso de prueba.", true);
        return;
    }

    const pct = origen === "draw"
        ? (parseFloat(document.getElementById("input-laser-power-pct")?.value) || ls.potencia_pct || 25)
        : (parseFloat(document.getElementById("input-laser-test-pct-sim")?.value) || ls.potencia_prueba_pct || 20);
    const duracionMs = parseInt(document.getElementById("input-laser-pulse-ms-sim")?.value || ls.pulso_prueba_ms || 250, 10);

    const pwm = Math.round((Math.max(1, Math.min(100, pct)) / 100.0) * 255);
    anim.laserActivoEnTrazo = true;
    anim.laserPwmEnTrazo = pwm;

    const data = await enviarAccionLaser("pulso_prueba", {
        potencia_prueba_pct: pct,
        duracion_ms: duracionMs
    });

    if (_timerPulsoLaserUI) clearTimeout(_timerPulsoLaserUI);
    _timerPulsoLaserUI = setTimeout(() => {
        anim.laserActivoEnTrazo = false;
        anim.laserPwmEnTrazo = 0;
        if (estado.laser) {
            estado.laser.emitiendo = false;
            estado.laser.en_foco = false;
            estado.laser.pwm_actual = 0;
            estado.laser.watts_actuales = 0.0;
            sincronizarUILaser5W();
        }
    }, Math.max(80, duracionMs));

    return data;
}

async function fijarPuntoFocalZLaser() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    await enviarAccionLaser("fijar_z_foco");
}

async function irAPuntoFocalZLaser() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const zFoco = parseInt(
        document.getElementById("input-laser-z-focus-draw")?.value
        ?? document.getElementById("input-laser-z-focus-sim")?.value
        ?? estado.laser?.z_foco_pulsos
        ?? 0,
        10
    ) || 0;
    await irAPuntoZPulsos(zFoco, `Posicionando Punto Focal Laser 5W (Z=${zFoco}p)`);
}

async function aplicarPresetMaterialLaser(presetKey) {
    if (dibujo.ejecutando) return;
    await enviarAccionLaser("aplicar_preset", { preset: presetKey });
    actualizarEstadisticasDibujo();
}

async function cambiarSubModoLaser(modoOperacion) {
    if (dibujo.ejecutando) return;
    let pasadasSugeridas = parseInt(document.getElementById("input-laser-passes")?.value || "1", 10);
    if (modoOperacion === "corte" && pasadasSugeridas < 2) {
        pasadasSugeridas = 2;
    } else if (modoOperacion !== "corte" && pasadasSugeridas > 1 && estado.laser?.modo_operacion === "corte") {
        pasadasSugeridas = 1;
    }
    await enviarAccionLaser("configurar", {
        modo_operacion: modoOperacion,
        pasadas: pasadasSugeridas
    });
    actualizarEstadisticasDibujo();
}

async function actualizarConfiguracionLaserDesdeUI(origen = "draw") {
    if (dibujo.ejecutando) return;
    const ls = estado.laser || {};

    const potenciaPct = origen === "draw"
        ? parseFloat(document.getElementById("input-laser-power-pct")?.value ?? ls.potencia_pct ?? 35)
        : (ls.potencia_pct ?? 35);

    const focoPct = origen === "sim"
        ? parseFloat(document.getElementById("input-laser-focus-pct-sim")?.value ?? ls.potencia_foco_pct ?? 3)
        : parseFloat(document.getElementById("input-laser-focus-pct-draw")?.value ?? ls.potencia_foco_pct ?? 3);

    const pruebaPct = parseFloat(document.getElementById("input-laser-test-pct-sim")?.value ?? ls.potencia_prueba_pct ?? 20);
    const pulsoMs = parseInt(document.getElementById("input-laser-pulse-ms-sim")?.value ?? ls.pulso_prueba_ms ?? 250, 10);

    const zFoco = origen === "sim"
        ? parseInt(document.getElementById("input-laser-z-focus-sim")?.value ?? ls.z_foco_pulsos ?? 0, 10)
        : parseInt(document.getElementById("input-laser-z-focus-draw")?.value ?? ls.z_foco_pulsos ?? 0, 10);

    const velGrabado = parseInt(document.getElementById("input-laser-speed-work")?.value ?? ls.velocidad_grabado_hz ?? 900, 10);
    const velViaje = parseInt(document.getElementById("input-laser-speed-travel")?.value ?? ls.velocidad_viaje_hz ?? 2200, 10);
    const pasadas = parseInt(document.getElementById("input-laser-passes")?.value ?? ls.pasadas ?? 1, 10);
    const pausaMs = parseInt(document.getElementById("input-laser-cool-ms")?.value ?? ls.pausa_enfriamiento_ms ?? 0, 10);
    const usarZFoco = Boolean(document.getElementById("chk-laser-use-z-focus")?.checked ?? ls.usar_z_foco);
    const modoOp = document.getElementById("select-laser-operation-mode")?.value || ls.modo_operacion || "grabado_linea";

    await enviarAccionLaser("configurar", {
        modo_operacion: modoOp,
        potencia_pct: potenciaPct,
        potencia_foco_pct: focoPct,
        potencia_prueba_pct: pruebaPct,
        pulso_prueba_ms: pulsoMs,
        velocidad_grabado_hz: velGrabado,
        velocidad_viaje_hz: velViaje,
        pasadas: pasadas,
        pausa_enfriamiento_ms: pausaMs,
        z_foco_pulsos: zFoco,
        usar_z_foco: usarZFoco
    });
    actualizarEstadisticasDibujo();
}

async function probarEncuadreLaserPerimetral() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const esc = Math.max(0.01, estado.pasos_por_mm);
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();

    // Calcular caja envolvente de las figuras del lienzo, o usar el 80% de la mesa si esta vacio
    const todos = [];
    dibujo.figuras.forEach(f => trazosDeFigura(f).forEach(t => todos.push(t)));
    let x0 = anchoMM * 0.1, y0 = altoMM * 0.1, x1 = anchoMM * 0.9, y1 = altoMM * 0.9;
    if (todos.length > 0) {
        const c = cajaDeTrazos(todos);
        x0 = Math.max(0, c.x);
        y0 = Math.max(0, c.y);
        x1 = Math.min(anchoMM, c.x + c.w);
        y1 = Math.min(altoMM, c.y + c.h);
    }

    const ls = estado.laser || {};
    const usarGuia = Boolean(ls.armado && ls.en_foco);
    const pwmGuia = usarGuia ? (ls.potencia_foco_pwm || 8) : 0;
    const velViaje = ls.velocidad_viaje_hz || 2000;

    mostrarMensajeConsola(
        `Encuadre Laser 5W: Recorriendo rectangulo envolvente (${x0.toFixed(1)}, ${y0.toFixed(1)}) -> (${x1.toFixed(1)}, ${y1.toFixed(1)} mm) ${usarGuia ? "con puntero foco" : "en seco (0W)"}...`
    );

    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    for (let i = 0; i < pts.length; i++) {
        const px = Math.round(pts[i][0] * esc);
        const py = Math.round(pts[i][1] * esc);
        const ok = await moverSimultaneoXY(px, py, `Encuadre Laser (${i + 1}/${pts.length})`, {
            laser_activo: usarGuia,
            laser_pwm: pwmGuia,
            velocidad_hz: velViaje
        });
        if (!ok) break;
    }
    if (!usarGuia) {
        await apagarLaserEmergencia(true);
    }
    mostrarMensajeConsola("Prueba de encuadre perimetral Laser 5W finalizada.");
}

function generarPatronCalibracionLaser5W() {
    if (dibujo.ejecutando) return;
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();

    // Genera una matriz de 5 bloques de calibracion (20%, 40%, 60%, 80%, 100% de 5W) con trama progresiva y marco de foco
    const margenX = Math.max(8, anchoMM * 0.12);
    const margenY = Math.max(8, altoMM * 0.18);
    const dispW = Math.max(30, anchoMM - margenX * 2);
    const dispH = Math.max(20, Math.min(45, altoMM - margenY * 2));
    const niveles = [20, 40, 60, 80, 100];
    const gap = dispW * 0.03;
    const boxW = (dispW - gap * (niveles.length - 1)) / niveles.length;
    const boxH = Math.min(boxW * 1.15, dispH * 0.65);
    const baseY = Number(((altoMM - boxH) / 2).toFixed(2));

    // Regla de enfoque optico (lineas de precision a distintos pasos)
    const trazosRegla = [];
    const reglaY = Number(Math.max(4, baseY - 6).toFixed(2));
    trazosRegla.push([
        [Number(margenX.toFixed(2)), reglaY],
        [Number((margenX + dispW).toFixed(2)), reglaY]
    ]);
    for (let i = 0; i <= 10; i++) {
        const tx = Number((margenX + (dispW / 10) * i).toFixed(2));
        const th = (i % 5 === 0) ? 3.5 : 2.0;
        trazosRegla.push([[tx, reglaY], [tx, Number(Math.max(1, reglaY - th).toFixed(2))]]);
    }
    agregarFiguraAlDibujo("Regla de Enfoque Optico 5W", [], {
        tipo: "calibracion_laser",
        trazos: trazosRegla
    });

    // Cajas de escala de densidad/potencia 5W
    niveles.forEach((pct, idx) => {
        const bx0 = Number((margenX + idx * (boxW + gap)).toFixed(2));
        const by0 = baseY;
        const bx1 = Number((bx0 + boxW).toFixed(2));
        const by1 = Number((by0 + boxH).toFixed(2));
        const trazosCaja = [
            [[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1], [bx0, by0]]
        ];
        // Lineas internas proporcionales al nivel para evaluar quemado y kerf del diodo 5W
        const numLineas = 2 + idx * 2;
        for (let k = 1; k <= numLineas; k++) {
            const ly = Number((by0 + (boxH / (numLineas + 1)) * k).toFixed(2));
            const dirPar = k % 2 === 0;
            trazosCaja.push(dirPar ? [[bx1, ly], [bx0, ly]] : [[bx0, ly], [bx1, ly]]);
        }
        const watts = ((pct / 100) * 5.0).toFixed(1);
        agregarFiguraAlDibujo(`Calibracion 5W [${pct}% = ${watts}W]`, [], {
            tipo: "calibracion_laser",
            trazos: trazosCaja,
            seleccionar: idx === niveles.length - 1
        });
    });

    mostrarMensajeConsola("Patron de Calibracion Laser 5W generado en el lienzo (Regla de Enfoque + 5 Bloques de Densidad/Potencia).");
}

function sincronizarUILaser5W() {
    const modoHerramienta = estado.modo_herramienta === "laser" ? "laser" : "dibujo";
    const esLaser = modoHerramienta === "laser";
    const ls = estado.laser || {};

    // Botones de cambio de modo en el Estudio de Dibujo
    document.getElementById("btn-mode-tool-dibujo")?.classList.toggle("active", !esLaser);
    document.getElementById("btn-mode-tool-laser")?.classList.toggle("active", esLaser);

    const pillModo = document.getElementById("studio-tool-mode-pill");
    if (pillModo) {
        pillModo.textContent = esLaser
            ? `MODO LASER 5W (${(ls.potencia_watts || 0).toFixed(2)}W | PWM ${ls.potencia_pwm || 0})`
            : "MODO DIBUJO (PLUMA / EJE Z)";
        pillModo.className = esLaser ? "active-config-pill amber" : "active-config-pill cyan";
    }
    const topBadge = document.getElementById("top-tool-mode-badge");
    const topText = document.getElementById("top-tool-mode-text");
    if (topBadge && topText) {
        topBadge.className = esLaser ? "top-tool-badge laser" : "top-tool-badge dibujo";
        topText.textContent = esLaser
            ? `MODO: LASER 5W (${(ls.potencia_watts || 0).toFixed(2)}W)`
            : "MODO: DIBUJO (PLUMA)";
    }

    const panelLaserDraw = document.getElementById("card-laser-studio-panel");
    if (panelLaserDraw) {
        panelLaserDraw.style.display = esLaser ? "block" : "none";
    }

    const panelZDraw = document.getElementById("panel-draw-z-controls");
    if (panelZDraw) {
        panelZDraw.style.display = esLaser ? "none" : "flex";
    }

    const btnRun = document.getElementById("btn-run-drawing");
    if (btnRun) {
        const spanTxt = btnRun.querySelector("span");
        if (spanTxt) {
            spanTxt.textContent = esLaser
                ? `Ejecutar Trabajo en Laser 5W (${(ls.potencia_pct || 0).toFixed(0)}% = ${(ls.potencia_watts || 0).toFixed(2)}W)`
                : "Ejecutar Dibujo en Motores (X, Y, Z)";
        }
        btnRun.classList.toggle("laser-run-btn", esLaser);
    }

    // Checkboxes de armado
    const armado = Boolean(ls.armado);
    const chkArmSim = document.getElementById("chk-laser-armed-sim");
    const chkArmDraw = document.getElementById("chk-laser-armed-draw");
    if (chkArmSim) chkArmSim.checked = armado;
    if (chkArmDraw) chkArmDraw.checked = armado;

    // Estado en vivo del haz
    const emitiendo = Boolean(ls.emitiendo) || anim.laserActivoEnTrazo;
    const enFoco = Boolean(ls.en_foco);
    const pwmVivo = anim.laserActivoEnTrazo ? anim.laserPwmEnTrazo : (ls.pwm_actual || 0);
    const wattsVivos = ((pwmVivo / 255.0) * 5.0);

    const textoEstado = !armado
        ? "DESARMADO (0.00 W)"
        : (emitiendo
            ? (enFoco ? `EN FOCO (${wattsVivos.toFixed(2)} W)` : `EMITIENDO (${wattsVivos.toFixed(2)} W | PWM ${pwmVivo})`)
            : "ARMADO EN ESPERA (0.00 W)");

    ["laser-sim-state-badge", "laser-draw-state-badge"].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = textoEstado;
        el.className = "Displacement-badge laser-state-pill " + (!armado ? "disarmed" : (emitiendo ? "firing" : "armed"));
    });

    const pct = Number(ls.potencia_pct ?? 35);
    const wattsCfg = Number(ls.potencia_watts ?? ((pct / 100) * 5.0));
    const pwmCfg = Number(ls.potencia_pwm ?? Math.round((pct / 100) * 255));

    const manPct = Number(ls.potencia_manual_pct ?? 25);
    const manWatts = Number(ls.potencia_manual_watts ?? ((manPct / 100) * 5.0));
    const manPwm = Number(ls.potencia_manual_pwm ?? Math.round((manPct / 100) * 255));
    const manContinua = Boolean(ls.emision_manual_continua);

    const simWatts = document.getElementById("laser-sim-watts-readout");
    const simPwm = document.getElementById("laser-sim-pwm-readout");
    const simLive = document.getElementById("laser-sim-live-readout");
    const simFocusZ = document.getElementById("laser-sim-focus-z-readout");
    if (simWatts) simWatts.textContent = `${manWatts.toFixed(2)} W (${manPct.toFixed(0)}% Manual)`;
    if (simPwm) simPwm.textContent = `PWM Manual: ${manPwm} / 255 | Max: 5.00 W`;
    if (simLive) {
        simLive.textContent = emitiendo ? `${wattsVivos.toFixed(2)} W (ACTIVO)` : "0.00 W (APAGADO)";
        simLive.className = emitiendo ? "ro-val rose" : "ro-val cyan";
    }
    if (simFocusZ) simFocusZ.textContent = `Foco Z: ${ls.z_foco_pulsos || 0} pulsos | 5000 Hz`;

    previsualizarSliderManualLaser(manPct);

    const btnManToggle = document.getElementById("btn-laser-manual-toggle");
    if (btnManToggle) {
        const dirEl = btnManToggle.querySelector(".pad-dir");
        const subEl = btnManToggle.querySelector(".pad-sub");
        if (dirEl && subEl) {
            dirEl.textContent = manContinua ? "APAGAR CW" : "CONTINUO";
            subEl.textContent = manContinua ? `${manWatts.toFixed(2)} W Activo` : "Encender / Off";
        } else {
            btnManToggle.textContent = manContinua
                ? `Apagar Emision Manual (${manWatts.toFixed(2)} W Activo)`
                : "Encender Manualmente (Continuo)";
        }
        btnManToggle.classList.toggle("active-focus-btn", manContinua);
    }

    const chkJogLaser = document.getElementById("chk-laser-manual-jog-sync");
    if (chkJogLaser) chkJogLaser.checked = Boolean(ls.jog_con_laser);

    // Actualizar tarjeta 4 de la barra de actuadores (LASER 5W 12V / 3 PINES)
    const btnStripArm = document.getElementById("btn-strip-laser-arm");
    if (btnStripArm) {
        btnStripArm.textContent = armado ? "ARMADO (12V)" : "DESARMADO";
        btnStripArm.className = armado ? "ena-toggle-btn energized" : "ena-toggle-btn disabled-free";
    }
    const btnStripMan = document.getElementById("btn-strip-laser-manual");
    if (btnStripMan) {
        btnStripMan.textContent = emitiendo ? `PWM: ${pwmVivo} (ON)` : "PWM: OFF (0W)";
        btnStripMan.className = emitiendo ? "ena-toggle-btn energized" : "ena-toggle-btn idle";
    }
    const elStripPct = document.getElementById("laser-strip-manual-pct");
    const elStripPwm = document.getElementById("laser-strip-manual-pwm");
    const elStripLive = document.getElementById("laser-strip-live-watts");
    if (elStripPct) elStripPct.textContent = `${manPct.toFixed(0)}%`;
    if (elStripPwm) elStripPwm.textContent = `PWM ${manPwm}/255`;
    if (elStripLive) {
        elStripLive.textContent = emitiendo
            ? `${wattsVivos.toFixed(2)} W (Emitiendo)`
            : "0.00 W (Reposo)";
        elStripLive.className = emitiendo ? "amp-active" : "amp-idle";
    }

    const drawWatts = document.getElementById("laser-draw-watts-readout");
    const drawPwm = document.getElementById("laser-draw-pwm-readout");
    const drawSpeeds = document.getElementById("laser-draw-speeds-readout");
    const drawPasses = document.getElementById("laser-draw-passes-readout");
    if (drawWatts) drawWatts.textContent = `${wattsCfg.toFixed(2)} W (${pct.toFixed(0)}%)`;
    if (drawPwm) drawPwm.textContent = `PWM: ${pwmCfg} / 255 | Max: 5000 mW`;
    if (drawSpeeds) drawSpeeds.textContent = `${ls.velocidad_grabado_hz || 900} / ${ls.velocidad_viaje_hz || 2200} Hz`;
    if (drawPasses) {
        const pCount = ls.pasadas || 1;
        drawPasses.textContent = `${pCount} ${pCount === 1 ? "pasada" : "pasadas"} | Viaje en 0.00 W`;
    }

    sincronizarSliderPotenciaLaser(pct);

    // Sincronizar inputs numéricos sin pisar el foco del usuario
    const setValIfIdle = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el && val !== undefined) el.value = val;
    };
    setValIfIdle("input-laser-focus-pct-sim", ls.potencia_foco_pct ?? 3);
    setValIfIdle("input-laser-focus-pct-draw", ls.potencia_foco_pct ?? 3);
    setValIfIdle("input-laser-test-pct-sim", ls.potencia_prueba_pct ?? 20);
    setValIfIdle("input-laser-pulse-ms-sim", ls.pulso_prueba_ms ?? 250);
    setValIfIdle("input-laser-z-focus-sim", ls.z_foco_pulsos ?? 0);
    setValIfIdle("input-laser-z-focus-draw", ls.z_foco_pulsos ?? 0);
    setValIfIdle("input-laser-speed-work", ls.velocidad_grabado_hz ?? 900);
    setValIfIdle("input-laser-speed-travel", ls.velocidad_viaje_hz ?? 2200);
    setValIfIdle("input-laser-passes", ls.pasadas ?? 1);
    setValIfIdle("input-laser-cool-ms", ls.pausa_enfriamiento_ms ?? 0);

    const lblTestW = document.getElementById("lbl-laser-test-watts-sim");
    if (lblTestW) {
        const wTest = (((ls.potencia_prueba_pct ?? 20) / 100.0) * 5.0).toFixed(2);
        lblTestW.textContent = `${wTest} W`;
    }

    const chkZFoco = document.getElementById("chk-laser-use-z-focus");
    if (chkZFoco) chkZFoco.checked = Boolean(ls.usar_z_foco);

    const selSubModo = document.getElementById("select-laser-operation-mode");
    if (selSubModo && ls.modo_operacion && document.activeElement !== selSubModo) {
        selSubModo.value = ls.modo_operacion;
    }
    const descSubModos = {
        grabado_linea: "Traza cada vector o dibujo en 1 pasada continua modulando el haz de 5W y apagando a 0W en desplazamientos.",
        grabado_relleno: "Optimizado para barridos densos Line2Line, Crosshatch y rellenos de contorno sin sobre-quemar esquinas.",
        grabado_tonal: "Ideal para mapas de puntos e imagenes procesadas con Dithering Floyd-Steinberg / Atkinson o XDoG.",
        corte: "Ejecuta multiples pasadas de alta potencia (hasta 5.00W) sobre el mismo vector para cortar el material."
    };
    const lblSubDesc = document.getElementById("lbl-laser-submode-desc");
    if (lblSubDesc) {
        lblSubDesc.textContent = descSubModos[ls.modo_operacion] || descSubModos.grabado_linea;
    }

    const selPreset = document.getElementById("select-laser-preset");
    if (selPreset && ls.preset_material && document.activeElement !== selPreset) {
        selPreset.value = ls.preset_material;
    }
    const lblPresetDesc = document.getElementById("lbl-laser-preset-desc");
    if (lblPresetDesc && estado.presets_laser_5w && ls.preset_material && estado.presets_laser_5w[ls.preset_material]) {
        const pInfo = estado.presets_laser_5w[ls.preset_material];
        lblPresetDesc.textContent = `${pInfo.nombre}: ${pInfo.descripcion}`;
    }

    ["btn-laser-focus-sim", "btn-laser-focus-draw"].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const dirEl = btn.querySelector(".pad-dir");
        const subEl = btn.querySelector(".pad-sub");
        if (dirEl && subEl) {
            dirEl.textContent = enFoco ? "FOCO ACTIVO" : "FOCO GUIA";
            subEl.textContent = enFoco ? "Clic para Apagar" : "Alinear Lente";
        } else {
            btn.textContent = enFoco ? "Apagar Puntero Foco (Activo)" : "Encender Puntero Foco";
        }
        btn.classList.toggle("active-focus-btn", enFoco);
    });
}

async function abrirDisenoFinal() {
    if (!estado.limite_fijado) {
        if (estado.pos_x === 0 || estado.pos_y === 0) {
            await accionCalibrar("fijar_limite", { usar_demo_si_cero: true });
        } else {
            await accionCalibrar("fijar_limite");
        }
    }
    cambiarVista("blueprint");
}

function cambiarVista(vista) {
    document.getElementById("tab-btn-sim")?.classList.toggle("active", vista === "sim");
    document.getElementById("tab-btn-drawing")?.classList.toggle("active", vista === "drawing");
    document.getElementById("tab-btn-blueprint")?.classList.toggle("active", vista === "blueprint");

    document.getElementById("view-sim")?.classList.toggle("active", vista === "sim");
    document.getElementById("view-drawing")?.classList.toggle("active", vista === "drawing");
    document.getElementById("view-blueprint")?.classList.toggle("active", vista === "blueprint");

    // Sincronizar barra de control contextual, toolbox izquierdo y dock derecho de escritorio
    document.getElementById("cb-group-sim")?.classList.toggle("active", vista === "sim");
    document.getElementById("cb-group-drawing")?.classList.toggle("active", vista === "drawing");
    document.getElementById("cb-group-blueprint")?.classList.toggle("active", vista === "blueprint");

    document.getElementById("toolbox-sim")?.classList.toggle("active", vista === "sim");
    document.getElementById("toolbox-drawing")?.classList.toggle("active", vista === "drawing");
    document.getElementById("toolbox-blueprint")?.classList.toggle("active", vista === "blueprint");

    const dock = document.getElementById("desktop-inspector-dock");
    if (dock) {
        if (vista === "blueprint") {
            dock.style.display = "none";
        } else {
            dock.style.display = "";
            document.getElementById("dock-panel-sim")?.classList.toggle("active", vista === "sim");
            document.getElementById("dock-panel-drawing")?.classList.toggle("active", vista === "drawing");
        }
    }

    setTimeout(() => {
        ajustarTamanoCanvases();
        if (vista === "blueprint") {
            dibujarBlueprint();
        }
        if (vista === "drawing") {
            actualizarEstadisticasDibujo();
            actualizarPanelSeleccion();
            actualizarPanelImagen();
            actualizarPanelNavegador();
        }
    }, 20);
}

// ==========================================================================
// MINI SOFTWARE DE DIBUJO CNC (EVENTOS DE MOUSE, FIGURAS Y EJECUCIÓN)
// ==========================================================================
function seleccionarHerramientaDibujo(herramienta) {
    if (dibujo.herramienta === "polyline" && dibujo.puntosTempMM.length > 1) {
        finalizarPolilineaActiva();
    }
    dibujo.herramienta = herramienta;
    dibujo.trazoActivo = false;
    dibujo.puntosTempMM = [];
    dibujo.arrastre = null;

    ["select", "pan", "freehand", "line", "rect", "circle", "triangle", "polyline", "measure"].forEach(t => {
        document.getElementById(`tool-${t}`)?.classList.toggle("active", t === herramienta);
    });
    document.getElementById("btn-finish-poly")?.classList.toggle("hidden", herramienta !== "polyline");
    const cv = document.getElementById("canvas-drawing");
    if (cv) cv.style.cursor = herramienta === "pan" ? "grab" : (herramienta === "select" ? "default" : "crosshair");
}

function obtenerLimitesMesaMM() {
    const esc = Math.max(0.01, estado.pasos_por_mm);
    const limX = Math.abs(estado.limite_max_x) > 0 ? Math.abs(estado.limite_max_x) : 8400;
    const limY = Math.abs(estado.limite_max_y) > 0 ? Math.abs(estado.limite_max_y) : 7900;
    return {
        anchoMM: Math.max(1.0, limX / esc),
        altoMM: Math.max(1.0, limY / esc),
        limPulsosX: limX,
        limPulsosY: limY,
        escala: esc
    };
}

function ajustarFigurasANuevaZona(nuevoAnchoMM, nuevoAltoMM) {
    const prevW = dibujo.ultimoAnchoMM;
    const prevH = dibujo.ultimoAltoMM;
    dibujo.ultimoAnchoMM = nuevoAnchoMM;
    dibujo.ultimoAltoMM = nuevoAltoMM;

    if (!prevW || !prevH) return;
    if (Math.abs(prevW - nuevoAnchoMM) < 0.05 && Math.abs(prevH - nuevoAltoMM) < 0.05) return;

    const rx = nuevoAnchoMM / Math.max(0.1, prevW);
    const ry = nuevoAltoMM / Math.max(0.1, prevH);
    dibujo.figuras.forEach(fig => {
        fig.trazos = trazosDeFigura(fig).map(tr => tr.map(pt => {
            const nx = Number(Math.max(0, Math.min(nuevoAnchoMM, pt[0] * rx)).toFixed(2));
            const ny = Number(Math.max(0, Math.min(nuevoAltoMM, pt[1] * ry)).toFixed(2));
            return pt.length > 2 ? [nx, ny, pt[2]] : [nx, ny];
        }));
        delete fig.puntosMM;
    });
    if (dibujo.imagen) {
        const r = dibujo.imagen.rect;
        dibujo.imagen.rect = { x: r.x * rx, y: r.y * ry, w: r.w * rx, h: r.h * ry };
        actualizarPanelImagen();
    }
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
}

function pantallaAMilimetrosDibujo(clientX, clientY) {
    const canvas = document.getElementById("canvas-drawing");
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top) * scaleY;
    const g = dibujo.geometria;

    let xMM = ((px - g.x0) / Math.max(1, g.w)) * g.anchoMM;
    let yMM = ((g.y0 + g.h - py) / Math.max(1, g.h)) * g.altoMM;

    const dentro = xMM >= 0 && xMM <= g.anchoMM && yMM >= 0 && yMM <= g.altoMM;
    xMM = Math.max(0, Math.min(g.anchoMM, xMM));
    yMM = Math.max(0, Math.min(g.altoMM, yMM));

    const snapActivo = document.getElementById("chk-draw-snap")?.checked;
    const pasoSnap = parseFloat(document.getElementById("select-draw-snap-mm")?.value || "1");
    if (snapActivo && dibujo.herramienta !== "freehand" && pasoSnap > 0) {
        xMM = Math.round(xMM / pasoSnap) * pasoSnap;
        yMM = Math.round(yMM / pasoSnap) * pasoSnap;
        xMM = Math.max(0, Math.min(g.anchoMM, xMM));
        yMM = Math.max(0, Math.min(g.altoMM, yMM));
    }

    return {
        x: Number(xMM.toFixed(2)),
        y: Number(yMM.toFixed(2)),
        dentro
    };
}

function configurarEventosLienzoDibujo() {
    const canvas = document.getElementById("canvas-drawing");
    if (!canvas) return;

    canvas.addEventListener("mousemove", (e) => {
        dibujo.cursorCanvas = canvasDesdeEvento(e);
        if (moverPanSiActivo(e)) return;
        const pt = pantallaAMilimetrosDibujo(e.clientX, e.clientY);
        dibujo.cursorMM = pt;

        const esc = Math.max(0.01, estado.pasos_por_mm);
        const lblMM = document.getElementById("draw-cursor-mm");
        const lblSteps = document.getElementById("draw-cursor-steps");
        if (lblMM) lblMM.textContent = `X: ${pt.x.toFixed(1)} mm, Y: ${pt.y.toFixed(1)} mm`;
        if (lblSteps) lblSteps.textContent = `(${Math.round(pt.x * esc)}, ${Math.round(pt.y * esc)} pulsos)`;

        if (dibujo.herramienta === "select") {
            moverArrastreSeleccion(e);
            return;
        }

        if (!dibujo.trazoActivo) return;
        dibujo.puntoActualMM = [pt.x, pt.y];

        if (dibujo.herramienta === "measure") {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const d = Math.hypot(dx, dy);
            const ang = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1);
            const pulsos = Math.round(d * Math.max(0.01, estado.pasos_por_mm || 80));
            mostrarMensajeConsola(`Medicion: ${d.toFixed(2)} mm (${pulsos} pulsos) | dX=${dx.toFixed(2)} mm, dY=${dy.toFixed(2)} mm | Angulo=${ang} deg`);
            return;
        }

        if (dibujo.herramienta === "freehand") {
            const lista = dibujo.puntosTempMM;
            const { anchoMM, altoMM } = obtenerLimitesMesaMM();
            const pasoMin = Math.max(0.2, Math.min(anchoMM, altoMM) * 0.012);
            if (lista.length === 0) {
                lista.push([pt.x, pt.y]);
            } else {
                const [ux, uy] = lista[lista.length - 1];
                const dist = Math.hypot(pt.x - ux, pt.y - uy);
                if (dist >= pasoMin) {
                    lista.push([pt.x, pt.y]);
                }
            }
        }
    });

    canvas.addEventListener("mousedown", (e) => {
        if (iniciarPanSiCorresponde(e)) return;
        if (e.button !== 0 || dibujo.ejecutando || anim.enMovimiento) return;

        // Ignorar clics sobre las reglas
        const cc = canvasDesdeEvento(e);
        if (cc.x < vistaDibujo.area.x || cc.y < vistaDibujo.area.y) return;

        if (dibujo.herramienta === "select") {
            iniciarArrastreSeleccion(e);
            return;
        }

        const pt = pantallaAMilimetrosDibujo(e.clientX, e.clientY);

        if (dibujo.herramienta === "polyline") {
            dibujo.trazoActivo = true;
            dibujo.puntosTempMM.push([pt.x, pt.y]);
            dibujo.puntoActualMM = [pt.x, pt.y];
            return;
        }

        dibujo.trazoActivo = true;
        dibujo.puntoInicioMM = [pt.x, pt.y];
        dibujo.puntoActualMM = [pt.x, pt.y];
        if (dibujo.herramienta === "measure") {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const d = Math.hypot(dx, dy);
            const ang = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1);
            const pulsos = Math.round(d * Math.max(0.01, estado.pasos_por_mm || 80));
            mostrarMensajeConsola(`Medicion: ${d.toFixed(2)} mm (${pulsos} pulsos) | dX=${dx.toFixed(2)} mm, dY=${dy.toFixed(2)} mm | Angulo=${ang} deg`);
            return;
        }

        if (dibujo.herramienta === "freehand") {
            dibujo.puntosTempMM = [[pt.x, pt.y]];
        }
    });

    window.addEventListener("mouseup", () => {
        if (finalizarPanSiActivo()) return;
        if (dibujo.arrastre) {
            finalizarArrastreSeleccion();
            return;
        }
        if (!dibujo.trazoActivo || dibujo.herramienta === "polyline") return;
        dibujo.trazoActivo = false;

        if (!dibujo.puntoInicioMM || !dibujo.puntoActualMM) return;
        const [x1, y1] = dibujo.puntoInicioMM;
        const [x2, y2] = dibujo.puntoActualMM;

        if (dibujo.herramienta === "measure") {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const d = Math.hypot(dx, dy);
            const ang = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1);
            const pulsos = Math.round(d * Math.max(0.01, estado.pasos_por_mm || 80));
            mostrarMensajeConsola(`Medicion: ${d.toFixed(2)} mm (${pulsos} pulsos) | dX=${dx.toFixed(2)} mm, dY=${dy.toFixed(2)} mm | Angulo=${ang} deg`);
            return;
        }

        if (dibujo.herramienta === "freehand") {
            if (dibujo.puntosTempMM.length === 1 && Math.hypot(x2 - x1, y2 - y1) > 0.1) {
                dibujo.puntosTempMM.push([x2, y2]);
            }
            if (dibujo.puntosTempMM.length >= 2) {
                agregarFiguraAlDibujo("Trazo Libre", [...dibujo.puntosTempMM]);
            }
            dibujo.puntosTempMM = [];
            return;
        }

        const { anchoMM, altoMM } = obtenerLimitesMesaMM();
        const umbralMin = Math.max(0.2, Math.min(anchoMM, altoMM) * 0.01);
        const dist = Math.hypot(x2 - x1, y2 - y1);
        if (dist < umbralMin) return;

        if (dibujo.herramienta === "line") {
            agregarFiguraAlDibujo(`Linea (${dist.toFixed(1)} mm)`, [[x1, y1], [x2, y2]]);
        } else if (dibujo.herramienta === "rect") {
            const w = Math.abs(x2 - x1);
            const h = Math.abs(y2 - y1);
            if (w >= umbralMin && h >= umbralMin) {
                agregarFiguraAlDibujo(
                    `Rectangulo (${w.toFixed(1)}x${h.toFixed(1)} mm)`,
                    [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]
                );
            }
        } else if (dibujo.herramienta === "triangle") {
            const minX = Math.min(x1, x2);
            const maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2);
            const maxY = Math.max(y1, y2);
            const midX = Number(((minX + maxX) / 2).toFixed(2));
            agregarFiguraAlDibujo(
                `Triangulo (${(maxX - minX).toFixed(1)}x${(maxY - minY).toFixed(1)} mm)`,
                [[minX, minY], [maxX, minY], [midX, maxY], [minX, minY]]
            );
        } else if (dibujo.herramienta === "circle") {
            const radio = dist;
            const segmentos = 36;
            const pts = [];
            for (let i = 0; i <= segmentos; i++) {
                const ang = (i / segmentos) * Math.PI * 2;
                const cx = Math.max(0, Math.min(anchoMM, x1 + Math.cos(ang) * radio));
                const cy = Math.max(0, Math.min(altoMM, y1 + Math.sin(ang) * radio));
                pts.push([Number(cx.toFixed(2)), Number(cy.toFixed(2))]);
            }
            agregarFiguraAlDibujo(`Circulo (R=${radio.toFixed(1)} mm)`, pts);
        }
    });

    canvas.addEventListener("dblclick", () => {
        if (dibujo.herramienta === "polyline") {
            finalizarPolilineaActiva();
        }
    });
}

function finalizarPolilineaActiva() {
    if (dibujo.puntosTempMM.length >= 2) {
        agregarFiguraAlDibujo(`Polilinea (${dibujo.puntosTempMM.length} pts)`, [...dibujo.puntosTempMM]);
    }
    dibujo.puntosTempMM = [];
    dibujo.trazoActivo = false;
}

function agregarFiguraAlDibujo(nombreBase, puntosMM, opciones = {}) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const trazos = Array.isArray(opciones.trazos) ? opciones.trazos : [puntosMM];
    dibujo.figuras.push({
        id,
        tipo: opciones.tipo || "vector",
        nombre: `${nombreBase}`,
        trazos
    });
    if (opciones.seleccionar) {
        dibujo.seleccion = { tipo: "figura", id };
    }
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
    return id;
}

function eliminarFiguraDibujo(id) {
    if (dibujo.ejecutando) return;
    dibujo.figuras = dibujo.figuras.filter(f => f.id !== id);
    if (dibujo.seleccion && dibujo.seleccion.tipo === "figura" && dibujo.seleccion.id === id) {
        dibujo.seleccion = null;
    }
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
}

function deshacerUltimoTrazo() {
    if (dibujo.ejecutando) return;
    if (dibujo.puntosTempMM.length > 0) {
        dibujo.puntosTempMM = [];
        dibujo.trazoActivo = false;
        return;
    }
    const quitada = dibujo.figuras.pop();
    if (quitada && dibujo.seleccion && dibujo.seleccion.id === quitada.id) dibujo.seleccion = null;
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
}

function limpiarLienzoDibujo() {
    if (dibujo.ejecutando) return;
    dibujo.figuras = [];
    dibujo.puntosTempMM = [];
    dibujo.trazoActivo = false;
    if (dibujo.seleccion && dibujo.seleccion.tipo === "figura") dibujo.seleccion = null;
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
}

function cargarPlantillaDibujoDemo() {
    if (dibujo.ejecutando) return;
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const cx = Number((anchoMM / 2).toFixed(2));
    const cy = Number((altoMM / 2).toFixed(2));
    const w = Number((anchoMM * 0.5).toFixed(2));
    const h = Number((altoMM * 0.5).toFixed(2));
    const x0 = Number((cx - w / 2).toFixed(2));
    const y0 = Number((cy - h / 2).toFixed(2));
    const x1 = Number((cx + w / 2).toFixed(2));
    const y1 = Number((cy + h / 2).toFixed(2));

    agregarFiguraAlDibujo(`Marco Exterior (${w.toFixed(0)}x${h.toFixed(0)} mm)`, [
        [x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]
    ]);

    const r = Math.min(w, h) * 0.28;
    const ptsCirc = [];
    for (let i = 0; i <= 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        ptsCirc.push([
            Number((cx + Math.cos(a) * r).toFixed(2)),
            Number((cy + Math.sin(a) * r).toFixed(2))
        ]);
    }
    agregarFiguraAlDibujo(`Circulo Central (R=${r.toFixed(1)} mm)`, ptsCirc);
}

async function aplicarDimensionesMesaDesdeDibujo() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const ancho = Math.max(5, parseFloat(document.getElementById("input-draw-width-mm")?.value || "160"));
    const alto = Math.max(5, parseFloat(document.getElementById("input-draw-height-mm")?.value || "120"));
    await accionCalibrar("definir_dimensiones_mm", { ancho_mm: ancho, alto_mm: alto });
    actualizarEstadisticasDibujo();
}

async function aplicarDimensionesPulsosDesdeDibujo() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    const limX = Math.max(50, parseInt(document.getElementById("input-draw-width-steps")?.value || "8400", 10));
    const limY = Math.max(50, parseInt(document.getElementById("input-draw-height-steps")?.value || "7900", 10));
    await accionCalibrar("definir_dimensiones_mm", { limite_max_x: limX, limite_max_y: limY });
    actualizarEstadisticasDibujo();
}

function renderizarListaFigurasDibujo() {
    const cont = document.getElementById("drawing-shapes-list");
    const pill = document.getElementById("draw-count-pill");
    if (!cont) return;

    if (pill) pill.textContent = `${dibujo.figuras.length} ${dibujo.figuras.length === 1 ? "figura" : "figuras"}`;

    if (dibujo.figuras.length === 0) {
        cont.innerHTML = `<div class="empty-shapes-msg">Dibuja en el lienzo con el mouse usando Trazo Libre, Linea, Rectangulo, Circulo o Triangulo.</div>`;
        return;
    }

    cont.innerHTML = "";
    dibujo.figuras.forEach((fig, idx) => {
        const div = document.createElement("div");
        const trazos = trazosDeFigura(fig);
        const seleccionada = dibujo.seleccion && dibujo.seleccion.tipo === "figura" && dibujo.seleccion.id === fig.id;
        const caja = cajaDeTrazos(trazos);
        const fuera = figuraFueraDeZona(fig);
        div.className = "shape-item-row"
            + (dibujo.figuraEjecutandoIdx === idx ? " executing" : "")
            + (seleccionada ? " selected" : "")
            + (fuera ? " out-of-zone" : "");
        let tramos = 0;
        trazos.forEach(t => { tramos += Math.max(0, t.length - 1); });
        div.innerHTML = `
            <div class="shape-item-info">
                <strong>#${idx + 1} ${fig.nombre}</strong>
                <small>Pos: (${caja.x.toFixed(1)}, ${caja.y.toFixed(1)} mm) | Tam: ${caja.w.toFixed(1)} x ${caja.h.toFixed(1)} mm</small>
                <small>${trazos.length} ${trazos.length === 1 ? "trazo" : "trazos"} | ${tramos} tramos${fuera ? " | FUERA DE ZONA" : ""}</small>
            </div>
            <button class="shape-del-btn" onclick="event.stopPropagation(); eliminarFiguraDibujo(${fig.id})">Quitar</button>
        `;
        div.addEventListener("click", () => seleccionarFiguraPorId(fig.id));
        cont.appendChild(div);
    });
}

// Estima segmentos, distancias, levantamientos de Z o modulaciones Laser 5W y tiempo real de ejecucion (mm)
function estimarTrabajoTrazos(listaTrazos) {
    const esc = Math.max(0.01, estado.pasos_por_mm);
    const esLaser = estado.modo_herramienta === "laser";
    const ls = estado.laser || {};
    const vhzTrabajo = esLaser
        ? Math.max(50, ls.velocidad_grabado_hz || 900)
        : Math.max(50, estado.velocidad_hz || 1000);
    const vhzViaje = esLaser
        ? Math.max(100, ls.velocidad_viaje_hz || 2200)
        : vhzTrabajo;
    const pasadas = esLaser ? Math.max(1, parseInt(ls.pasadas || 1, 10)) : 1;
    const usarZ = !esLaser && Boolean(document.getElementById("chk-draw-use-z")?.checked ?? estado.usar_z_dibujo);
    const zArriba = parseInt(document.getElementById("input-z-up")?.value ?? "0", 10) || 0;
    const zAbajo = parseInt(document.getElementById("input-z-down")?.value ?? "400", 10) || 0;
    const SEG_MIN = 0.09;      // Duracion minima de cada movimiento (animacion / ESP32)
    const SEG_COM = 0.03;      // Latencia aproximada de comunicacion por comando

    let segmentos = 0, distTrazo = 0, distViaje = 0, segPorPasada = 0, cx = estado.pos_x / esc, cy = estado.pos_y / esc;
    listaTrazos.forEach(tr => {
        if (!tr || tr.length < 2) return;
        const dV = Math.hypot(tr[0][0] - cx, tr[0][1] - cy);
        distViaje += dV;
        segPorPasada += Math.max(SEG_MIN, (dV * esc) / vhzViaje) + SEG_COM;
        if (usarZ) segPorPasada += 2 * (Math.max(SEG_MIN, Math.abs(zAbajo - zArriba) / vhzTrabajo) + SEG_COM);
        for (let i = 1; i < tr.length; i++) {
            const d = Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]);
            segmentos++;
            distTrazo += d;
            segPorPasada += Math.max(SEG_MIN, (d * esc) / vhzTrabajo) + SEG_COM;
        }
        cx = tr[tr.length - 1][0];
        cy = tr[tr.length - 1][1];
    });
    const segTotales = segPorPasada * pasadas + ((pasadas - 1) * ((ls.pausa_enfriamiento_ms || 0) / 1000.0));
    return {
        segmentos: segmentos * pasadas,
        distTrazo: distTrazo * pasadas,
        distViaje: distViaje * pasadas,
        levantamientos: listaTrazos.length * pasadas,
        segundos: segTotales,
        pulsos: Math.round((distTrazo + distViaje) * pasadas * esc),
        vhz: vhzTrabajo,
        vhzViaje,
        pasadas,
        esLaser,
        usarZ
    };
}

function formatearDuracion(seg) {
    if (seg < 60) return `${seg.toFixed(1)} s`;
    const m = Math.floor(seg / 60);
    const s = Math.round(seg % 60);
    if (m < 60) return `${m} min ${s} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function actualizarEstadisticasDibujo() {
    const todos = [];
    dibujo.figuras.forEach(fig => trazosDeFigura(fig).forEach(t => todos.push(t)));
    const est = estimarTrabajoTrazos(todos);

    const elSeg = document.getElementById("draw-stat-segments");
    const elDist = document.getElementById("draw-stat-dist");
    const elTime = document.getElementById("draw-stat-time");
    const elSpd = document.getElementById("draw-stat-speed");

    if (elSeg) elSeg.textContent = `${est.segmentos} tramos${est.pasadas > 1 ? ` (${est.pasadas}x)` : ""}`;
    if (elDist) {
        elDist.textContent = `${est.esLaser ? "Grabado" : "Trazo"}: ${est.distTrazo.toFixed(1)} mm | Viaje: ${est.distViaje.toFixed(1)} mm | ${est.levantamientos} trazos`;
    }
    if (elTime) elTime.textContent = formatearDuracion(est.segundos);
    if (elSpd) {
        if (est.esLaser) {
            const ls = estado.laser || {};
            elSpd.textContent = `Laser 5W: ${(ls.potencia_watts || 1.75).toFixed(2)}W (${(ls.potencia_pct || 35).toFixed(0)}%) | ${est.vhz}/${est.vhzViaje} Hz`;
        } else {
            elSpd.textContent = `A ${est.vhz} Hz (${est.pulsos} pulsos${est.usarZ ? `, ${est.levantamientos * 2} mov. Z` : ""})`;
        }
    }
}

async function irAPuntoXYPulsos(destX, destY, etiqueta, opcionesLaser = null) {
    const dx = Math.round(destX) - estado.pos_x;
    const dy = Math.round(destY) - estado.pos_y;
    if (dx === 0 && dy === 0) return true;

    const okXY = await moverSimultaneoXY(Math.round(destX), Math.round(destY), etiqueta, opcionesLaser);
    if (!okXY || !dibujo.ejecutando) return false;
    return true;
}

async function irAPuntoZPulsos(destZ, etiqueta) {
    const dz = destZ - estado.pos_z;
    if (dz === 0) return true;
    return await moverEje("Z", dz > 0 ? 1 : 0, Math.abs(dz), etiqueta);
}

async function ejecutarDibujoEnMaquina() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    if (dibujo.figuras.length === 0) {
        mostrarMensajeConsola("Dibuja al menos una figura o trazo en el lienzo antes de ejecutar.", true);
        return;
    }

    if (!estado.limite_fijado || estado.limite_max_x === 0 || estado.limite_max_y === 0) {
        await accionCalibrar("fijar_limite", { usar_demo_si_cero: true });
    }

    // Validacion a prueba de errores: ninguna figura puede salir de la zona calibrada
    const fueraZona = dibujo.figuras.filter(f => figuraFueraDeZona(f));
    if (fueraZona.length > 0) {
        mostrarMensajeConsola(
            `Ejecucion bloqueada: ${fueraZona.length} figura(s) salen de la zona calibrada (${fueraZona.map(f => f.nombre).join(", ")}). Seleccionala y usa "Ajustar a Zona" o reduce su tamano.`,
            true
        );
        return;
    }

    const esc = Math.max(0.01, estado.pasos_por_mm);
    const esLaser = estado.modo_herramienta === "laser";
    const ls = estado.laser || {};

    const boxDraw = document.getElementById("drawing-progress-box");
    const txtDraw = document.getElementById("drawing-progress-text");

    // Calcular total de tramos de dibujo para la barra de progreso en vivo
    let tramosPorPasada = 0;
    for (const fig of dibujo.figuras) {
        for (const pts of trazosDeFigura(fig)) {
            if (pts && pts.length >= 2) tramosPorPasada += (pts.length - 1);
        }
    }
    const inicioEjecucionMs = performance.now();

    // =========================================================================
    // MODO LASER 5W (PWM 0..255 + APAGADO 0W EN VIAJES + MULTIPASADA)
    // =========================================================================
    if (esLaser) {
        const armado = Boolean(ls.armado);
        const pct = Number(ls.potencia_pct ?? 35);
        const pwmTrabajo = armado ? Number(ls.potencia_pwm ?? Math.round((pct / 100) * 255)) : 0;
        const wattsTrabajo = armado ? Number(ls.potencia_watts ?? ((pct / 100) * 5.0)) : 0.0;
        const velGrabado = Math.max(50, parseInt(ls.velocidad_grabado_hz || 900, 10));
        const velViaje = Math.max(100, parseInt(ls.velocidad_viaje_hz || 2200, 10));
        const totalPasadas = Math.max(1, parseInt(ls.pasadas || 1, 10));
        const pausaMs = Math.max(0, parseInt(ls.pausa_enfriamiento_ms || 0, 10));
        const usarZFoco = Boolean(ls.usar_z_foco);
        const zFoco = parseInt(ls.z_foco_pulsos || 0, 10);

        const totalTramos = Math.max(1, tramosPorPasada * totalPasadas);
        let tramosHechos = 0;

        dibujo.ejecutando = true;
        dibujo.pausado = false;
        if (boxDraw) boxDraw.classList.remove("hidden");
        actualizarProgresoDibujoUI(0, totalTramos, "Iniciando Laser 5W...", inicioEjecucionMs, true);

        mostrarMensajeConsola(
            `Iniciando Trabajo Laser 5W [${ls.modo_operacion || "grabado_linea"}]: ${wattsTrabajo.toFixed(2)}W (${pct.toFixed(0)}% | PWM ${pwmTrabajo}/255)${armado ? "" : " [SIMULACION EN SECO 0W - DESARMADO]"} | ${totalPasadas} pasada(s)...`
        );

        // Asegurar laser en 0W antes de posicionar
        await apagarLaserEmergencia(true);

        // Opcional: posicionar Z en el Punto Focal calibrado antes de iniciar
        if (usarZFoco && estado.pos_z !== zFoco) {
            if (txtDraw) txtDraw.textContent = `Posicionando Eje Z en Punto Focal Laser 5W (${zFoco} pulsos)...`;
            const okZFoco = await irAPuntoZPulsos(zFoco, `Punto Focal Z (${zFoco}p)`);
            if (!okZFoco || !dibujo.ejecutando) {
                dibujo.ejecutando = false;
                if (boxDraw) boxDraw.classList.add("hidden");
                await apagarLaserEmergencia(true);
                return;
            }
        }

        pasadasLoop:
        for (let p = 1; p <= totalPasadas; p++) {
            if (!dibujo.ejecutando) break;
            const etqPasada = totalPasadas > 1 ? ` [Pasada ${p}/${totalPasadas}]` : "";

            for (let i = 0; i < dibujo.figuras.length; i++) {
                if (!dibujo.ejecutando) break pasadasLoop;
                dibujo.figuraEjecutandoIdx = i;
                renderizarListaFigurasDibujo();

                const fig = dibujo.figuras[i];
                const trazos = trazosDeFigura(fig);

                for (let k = 0; k < trazos.length; k++) {
                    if (!dibujo.ejecutando) break pasadasLoop;
                    const pts = trazos[k];
                    if (!pts || pts.length < 2) continue;
                    const infoTrazo = trazos.length > 1 ? ` trazo ${k + 1}/${trazos.length}` : "";

                    // 1. Viaje rapido al inicio del trazo con Laser APAGADO (0.00 W / PWM 0)
                    const iniX = Math.round(pts[0][0] * esc);
                    const iniY = Math.round(pts[0][1] * esc);
                    if (txtDraw) {
                        txtDraw.textContent = `Viaje 0.00W${etqPasada} -> Inicio de #${i + 1} ${fig.nombre}${infoTrazo} (${velViaje} Hz)...`;
                    }
                    const okIni = await irAPuntoXYPulsos(iniX, iniY, `Viaje 0W #${i + 1}${infoTrazo}`, {
                        laser_activo: false,
                        laser_pwm: 0,
                        velocidad_hz: velViaje
                    });
                    if (!okIni || !dibujo.ejecutando) break pasadasLoop;

                    // 2. Recorrer los segmentos del trazo modulando el Laser 5W (M2L sincronizado / Raster PWM por linea)
                    for (let j = 1; j < pts.length; j++) {
                        if (!(await esperarSiPausadoDibujo())) break pasadasLoop;
                        const px = Math.round(pts[j][0] * esc);
                        const py = Math.round(pts[j][1] * esc);
                        const tieneMod = pts[j].length > 2 && pts[j][2] !== undefined && pts[j][2] !== null;

                        let segActivo = armado && pwmTrabajo > 0;
                        let pwmSeg = pwmTrabajo;
                        let wattsSeg = wattsTrabajo;
                        let velSeg = velGrabado;

                        if (tieneMod) {
                            const modPct = Number(pts[j][2]);
                            if (modPct <= 0.1) {
                                segActivo = false;
                                pwmSeg = 0;
                                wattsSeg = 0.0;
                                velSeg = velViaje;
                            } else {
                                pwmSeg = armado ? Math.max(1, Math.min(255, Math.round((modPct / 100.0) * 255))) : 0;
                                wattsSeg = (pwmSeg / 255.0) * 5.0;
                                segActivo = armado && pwmSeg > 0;
                            }
                        }

                        const etq = `Laser ${wattsSeg.toFixed(2)}W (PWM ${pwmSeg})${etqPasada} #${i + 1}${infoTrazo} (${j}/${pts.length - 1})`;
                        if (txtDraw) {
                            txtDraw.textContent = `${etq} -> X:${pts[j][0].toFixed(1)}mm, Y:${pts[j][1].toFixed(1)}mm (${velSeg} Hz)`;
                        }
                        const okSeg = await irAPuntoXYPulsos(px, py, etq, {
                            laser_activo: segActivo,
                            laser_pwm: pwmSeg,
                            velocidad_hz: velSeg
                        });
                        if (!okSeg || !dibujo.ejecutando) break pasadasLoop;
                        tramosHechos++;
                        actualizarProgresoDibujoUI(tramosHechos, totalTramos, `Laser ${etqPasada} #${i + 1}`, inicioEjecucionMs, true);
                    }
                }
            }

            if (p < totalPasadas && pausaMs > 0 && dibujo.ejecutando) {
                await apagarLaserEmergencia(true);
                if (txtDraw) txtDraw.textContent = `Enfriamiento entre pasadas (${p}/${totalPasadas}): esperando ${pausaMs} ms con Laser 0W...`;
                await new Promise(r => setTimeout(r, pausaMs));
            }
        }

        await apagarLaserEmergencia(true);
        const completadoLaser = dibujo.ejecutando;
        dibujo.ejecutando = false;
        dibujo.pausado = false;
        dibujo.figuraEjecutandoIdx = -1;
        if (boxDraw) boxDraw.classList.add("hidden");
        actualizarProgresoDibujoUI(completadoLaser ? totalTramos : tramosHechos, totalTramos, completadoLaser ? "Trabajo Laser completado" : "Detenido", inicioEjecucionMs, false);
        renderizarListaFigurasDibujo();
        await validarPosicionMotor();
        if (completadoLaser) {
            mostrarMensajeConsola("Trabajo Laser 5W completado. Diodo apagado (0.00 W | PWM 0) y motores en reposo ENA.");
        }
        return;
    }

    // =========================================================================
    // MODO DIBUJO TRADICIONAL (PLUMA / PLUMON CON EJE Z ARRIBA Y ABAJO)
    // =========================================================================
    const usarZ = Boolean(document.getElementById("chk-draw-use-z")?.checked ?? estado.usar_z_dibujo);
    const zArriba = parseInt(document.getElementById("input-z-up")?.value ?? estado.z_home_pulsos ?? "0", 10) || 0;
    const zAbajo = parseInt(document.getElementById("input-z-down")?.value ?? estado.limite_max_z ?? "400", 10) || 0;
    const totalTramos = Math.max(1, tramosPorPasada);
    let tramosHechos = 0;

    dibujo.ejecutando = true;
    dibujo.pausado = false;
    if (boxDraw) boxDraw.classList.remove("hidden");
    actualizarProgresoDibujoUI(0, totalTramos, "Iniciando dibujo...", inicioEjecucionMs, true);

    const infoModoZ = usarZ
        ? `con Eje Z activo (Home Z=${zArriba}p levantado -> Maximo Z=${zAbajo}p contacto papel)`
        : "con Eje Z desactivado (Solo movimiento 2D X+Y)";
    mostrarMensajeConsola(`Iniciando ejecucion de dibujo CNC ${infoModoZ}...`);

    figurasLoop:
    for (let i = 0; i < dibujo.figuras.length; i++) {
        if (!dibujo.ejecutando) break;
        dibujo.figuraEjecutandoIdx = i;
        renderizarListaFigurasDibujo();

        const fig = dibujo.figuras[i];
        const trazos = trazosDeFigura(fig);

        for (let k = 0; k < trazos.length; k++) {
            if (!dibujo.ejecutando) break figurasLoop;
            const pts = trazos[k];
            if (!pts || pts.length < 2) continue;
            const infoTrazo = trazos.length > 1 ? ` trazo ${k + 1}/${trazos.length}` : "";

            // 1. Subir Z a Home Z (Levantado) para viajar sin rayar el papel hasta el inicio del trazo
            if (usarZ) {
                if (txtDraw) txtDraw.textContent = `Subiendo Eje Z a Home Z levantado (${zArriba} pulsos)...`;
                const okZUp = await irAPuntoZPulsos(zArriba, `Home Z Viaje Figura ${i + 1}${infoTrazo}`);
                if (!okZUp || !dibujo.ejecutando) break figurasLoop;
            }

            // 2. Desplazarse al inicio del trazo (X + Y al mismo tiempo)
            const iniX = Math.round(pts[0][0] * esc);
            const iniY = Math.round(pts[0][1] * esc);
            if (txtDraw) txtDraw.textContent = `Posicionando X+Y en inicio de #${i + 1} ${fig.nombre}${infoTrazo}...`;
            const okIni = await irAPuntoXYPulsos(iniX, iniY, `Posicionando #${i + 1}${infoTrazo}`);
            if (!okIni || !dibujo.ejecutando) break figurasLoop;

            // 3. Bajar Z a Maximo Z (Contacto Lapiz/Plumon con Papel) para iniciar el trazo
            let zAbajoActivo = false;
            const primerSegBlanco = pts[1] && pts[1].length > 2 && Number(pts[1][2]) <= 0.1;
            if (usarZ && !primerSegBlanco) {
                if (txtDraw) txtDraw.textContent = `Bajando Eje Z a Maximo Z - Contacto Papel (${zAbajo} pulsos)...`;
                const okZDown = await irAPuntoZPulsos(zAbajo, `Contacto Papel Z Figura ${i + 1}${infoTrazo}`);
                if (!okZDown || !dibujo.ejecutando) break figurasLoop;
                zAbajoActivo = true;
            }

            // 4. Recorrer todos los puntos del trazo con interpolación 2D simultánea
            for (let j = 1; j < pts.length; j++) {
                if (!(await esperarSiPausadoDibujo())) break figurasLoop;
                const tieneMod = pts[j].length > 2 && pts[j][2] !== undefined && pts[j][2] !== null;
                if (usarZ && tieneMod) {
                    const esHuecoBlanco = Number(pts[j][2]) <= 0.1;
                    if (esHuecoBlanco && zAbajoActivo) {
                        const okZUpSeg = await irAPuntoZPulsos(zArriba, `Salto Blanco Z Figura ${i + 1}${infoTrazo}`);
                        if (!okZUpSeg || !dibujo.ejecutando) break figurasLoop;
                        zAbajoActivo = false;
                    } else if (!esHuecoBlanco && !zAbajoActivo) {
                        const okZDownSeg = await irAPuntoZPulsos(zAbajo, `Contacto Z Figura ${i + 1}${infoTrazo}`);
                        if (!okZDownSeg || !dibujo.ejecutando) break figurasLoop;
                        zAbajoActivo = true;
                    }
                }
                const px = Math.round(pts[j][0] * esc);
                const py = Math.round(pts[j][1] * esc);
                const etq = `Trazando #${i + 1}${infoTrazo} (${j}/${pts.length - 1})`;
                if (txtDraw) {
                    txtDraw.textContent = `${etq} [Simultaneo X+Y] -> X:${pts[j][0].toFixed(1)}mm (${px}p), Y:${pts[j][1].toFixed(1)}mm (${py}p)`;
                }
                const okSeg = await irAPuntoXYPulsos(px, py, etq);
                if (!okSeg || !dibujo.ejecutando) break figurasLoop;
                tramosHechos++;
                actualizarProgresoDibujoUI(tramosHechos, totalTramos, `Trazando #${i + 1} ${fig.nombre}`, inicioEjecucionMs, true);
            }
        }

        // 5. Al terminar la figura, levantar el lápiz/plumón de vuelta a Home Z (0)
        if (dibujo.ejecutando && usarZ) {
            if (txtDraw) txtDraw.textContent = `Levantando Eje Z a Home Z (${zArriba} pulsos) al finalizar #${i + 1}...`;
            const okZEndFig = await irAPuntoZPulsos(zArriba, `Fin Figura ${i + 1} -> Home Z`);
            if (!okZEndFig || !dibujo.ejecutando) break;
        }
    }

    if (dibujo.ejecutando && usarZ) {
        await irAPuntoZPulsos(zArriba, "Retorno final a Home Z (Levantado)");
    }

    const completadoDibujo = dibujo.ejecutando;
    dibujo.ejecutando = false;
    dibujo.pausado = false;
    dibujo.figuraEjecutandoIdx = -1;
    if (boxDraw) boxDraw.classList.add("hidden");
    actualizarProgresoDibujoUI(completadoDibujo ? totalTramos : tramosHechos, totalTramos, completadoDibujo ? "Dibujo completado" : "Detenido", inicioEjecucionMs, false);
    renderizarListaFigurasDibujo();
    await validarPosicionMotor();
    if (completadoDibujo) {
        mostrarMensajeConsola("Ejecucion del dibujo completada. Motores en reposo ENA (0.0 A).");
    }
}

function dibujarEstudioDibujo() {
    const canvas = document.getElementById("canvas-drawing");
    if (!canvas) return;
    const parentRect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 0, height: 0 };
    if (parentRect.width > 50 && parentRect.height > 50) {
        const targetW = Math.floor(parentRect.width);
        const targetH = Math.floor(parentRect.height);
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }
    }
    if (canvas.width < 50) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const { anchoMM, altoMM, limPulsosX, limPulsosY, escala } = obtenerLimitesMesaMM();

    // Area visible (descontando las reglas estilo Photoshop) y factor base "Ajustar a Zona"
    const V = vistaDibujo;
    const reglaL = V.reglas ? REGLA_IZQ_PX : 0;
    const reglaT = V.reglas ? REGLA_SUP_PX : 0;
    const areaX = reglaL, areaY = reglaT, areaW = w - reglaL, areaH = h - reglaT;
    const padX = 40;
    const padY = 34;
    const dispW = Math.max(120, areaW - padX * 2);
    const dispH = Math.max(100, areaH - padY * 2);
    const factorBase = Math.min(dispW / anchoMM, dispH / altoMM);
    V.factorBase = factorBase;

    // Si cambia el tamano de la zona, recentrar la vista
    if (V.cx === null || V.zonaClave !== `${anchoMM.toFixed(2)}x${altoMM.toFixed(2)}`) {
        V.zonaClave = `${anchoMM.toFixed(2)}x${altoMM.toFixed(2)}`;
        V.cx = anchoMM / 2;
        V.cy = altoMM / 2;
    }

    const factor = factorBase * V.zoom;
    const mesaW = anchoMM * factor;
    const mesaH = altoMM * factor;
    const areaCx = areaX + areaW / 2;
    const areaCy = areaY + areaH / 2;
    const x0 = areaCx - V.cx * factor;
    const y1 = areaCy + V.cy * factor;
    const y0 = y1 - mesaH;
    const x1 = x0 + mesaW;

    dibujo.geometria = { x0, y0, w: mesaW, h: mesaH, anchoMM, altoMM };
    V.area = { x: areaX, y: areaY, w: areaW, h: areaH };

    const aCanvas = (xmm, ymm) => [
        x0 + xmm * factor,
        y1 - ymm * factor
    ];

    // Fondo exterior (mesa fuera de la zona)
    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, w, h);

    // Todo el contenido del lienzo queda recortado al area visible (sin invadir las reglas)
    ctx.save();
    ctx.beginPath();
    ctx.rect(areaX, areaY, areaW, areaH);
    ctx.clip();

    // Fondo de mesa de trabajo calibrada (Placa Móvil Y / Puente Fijo X)
    ctx.fillStyle = "#0d0f15";
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.fillRect(x0, y0, mesaW, mesaH);
    ctx.strokeRect(x0, y0, mesaW, mesaH);

    // Etiqueta de Home (0,0) en Esquina Inferior Izquierda
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(x0, y1, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("HOME (0,0)", x0 + 10, y1 - 8);

    // Cuadrícula milimétrica adaptativa (se densifica al hacer zoom)
    if (V.cuadricula) {
        const paso = pasoReglaMM(factor, 34);
        const pasoMenor = paso / 5;
        const visX0 = Math.max(0, (areaX - x0) / factor);
        const visX1 = Math.min(anchoMM, (areaX + areaW - x0) / factor);
        const visY0 = Math.max(0, (y1 - (areaY + areaH)) / factor);
        const visY1 = Math.min(altoMM, (y1 - areaY) / factor);
        const trazarLineas = (p, color) => {
            if (p * factor < 6) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let gxm = Math.ceil(visX0 / p) * p; gxm <= visX1 + 1e-9; gxm += p) {
                const gx = Math.round(x0 + gxm * factor) + 0.5;
                ctx.moveTo(gx, Math.max(y0, areaY)); ctx.lineTo(gx, Math.min(y1, areaY + areaH));
            }
            for (let gym = Math.ceil(visY0 / p) * p; gym <= visY1 + 1e-9; gym += p) {
                const gy = Math.round(y1 - gym * factor) + 0.5;
                ctx.moveTo(Math.max(x0, areaX), gy); ctx.lineTo(Math.min(x1, areaX + areaW), gy);
            }
            ctx.stroke();
        };
        trazarLineas(pasoMenor, "rgba(255, 255, 255, 0.025)");
        trazarLineas(paso, "rgba(255, 255, 255, 0.07)");
    }

    // Margen seguro 90%
    const mx = mesaW * 0.05;
    const my = mesaH * 0.05;
    ctx.save();
    ctx.strokeStyle = "rgba(16, 185, 129, 0.35)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x0 + mx, y0 + my, mesaW - 2 * mx, mesaH - 2 * my);
    ctx.restore();

    // Imagen de fondo cargada (referencia para mapear o calcar a mano)
    if (dibujo.imagen && dibujo.imagen.visible) {
        const r = dibujo.imagen.rect;
        const [ix0, iy0] = aCanvas(r.x, r.y + r.h);
        const iw = r.w * factor;
        const ih = r.h * factor;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, mesaW, mesaH);
        ctx.clip();
        ctx.globalAlpha = dibujo.imagen.opacidad;
        if (dibujo.imagen.mostrarMascara && dibujo.vistaPrevia && dibujo.vistaPrevia.mascaraCanvas) {
            ctx.fillStyle = "#f3f4f6";
            ctx.fillRect(ix0, iy0, iw, ih);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(dibujo.vistaPrevia.mascaraCanvas, ix0, iy0, iw, ih);
        } else {
            ctx.drawImage(dibujo.imagen.img, ix0, iy0, iw, ih);
        }
        ctx.restore();
    }

    // Rastro real del cabezal CNC en el lienzo de dibujo
    if (Array.isArray(estado.historial) && estado.historial.length > 1) {
        ctx.save();
        ctx.strokeStyle = "rgba(6, 182, 212, 0.45)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        estado.historial.forEach(([hxPul, hyPul], i) => {
            const [sx, sy] = aCanvas(hxPul / escala, hyPul / escala);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        });
        const [actSx, actSy] = aCanvas(anim.x / escala, anim.y / escala);
        ctx.lineTo(actSx, actSy);
        ctx.stroke();
        ctx.restore();
    }

    // Dibujar figuras confirmadas
    const grosorRealPx = V.grosorReal
        ? Math.max(0.6, (parseFloat(document.getElementById("input-img-pen")?.value || "0.5") || 0.5) * factor)
        : null;

    function trazarPolilineasTonal(listaTrazos, colorHex, anchoBase, mostrarHuecos) {
        const esModulado = listaTrazos.some(t => t.length > 1 && t[1] && t[1].length > 2);
        if (!esModulado) {
            ctx.strokeStyle = colorHex;
            ctx.lineWidth = anchoBase;
            ctx.beginPath();
            listaTrazos.forEach(pts => {
                pts.forEach(([px, py], i) => {
                    const [sx, sy] = aCanvas(px, py);
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                });
            });
            ctx.stroke();
            return;
        }
        listaTrazos.forEach(pts => {
            for (let j = 1; j < pts.length; j++) {
                const pA = pts[j - 1];
                const pB = pts[j];
                const pwr = pB.length > 2 && pB[2] !== undefined ? Number(pB[2]) : 100;
                const [sxA, syA] = aCanvas(pA[0], pA[1]);
                const [sxB, syB] = aCanvas(pB[0], pB[1]);
                if (pwr <= 0.1) {
                    if (mostrarHuecos) {
                        ctx.save();
                        ctx.globalAlpha = 0.25;
                        ctx.strokeStyle = "#f43f5e";
                        ctx.lineWidth = 0.6;
                        ctx.setLineDash([2, 2]);
                        ctx.beginPath();
                        ctx.moveTo(sxA, syA);
                        ctx.lineTo(sxB, syB);
                        ctx.stroke();
                        ctx.restore();
                    }
                    continue;
                }
                const ratio = Math.max(0.05, Math.min(1.0, pwr / 100.0));
                ctx.globalAlpha = Math.max(0.16, Math.min(1.0, 0.15 + ratio * 0.85));
                ctx.strokeStyle = colorHex;
                ctx.lineWidth = Math.max(0.55, anchoBase * (0.45 + 0.75 * ratio));
                ctx.beginPath();
                ctx.moveTo(sxA, syA);
                ctx.lineTo(sxB, syB);
                ctx.stroke();
            }
        });
        ctx.globalAlpha = 1.0;
    }

    dibujo.figuras.forEach((fig, idx) => {
        const trazos = trazosDeFigura(fig);
        if (trazos.length === 0) return;

        ctx.save();
        const enEjecucion = dibujo.figuraEjecutandoIdx === idx;
        const fuera = figuraFueraDeZona(fig);
        const colorHex = enEjecucion ? "#f59e0b" : (fuera ? "#f43f5e" : (V.grosorReal ? "#e5e7eb" : "#10b981"));
        const multi = trazos.length > 20;
        const anchoBase = grosorRealPx !== null ? grosorRealPx : (enEjecucion ? 3 : (multi ? 1.4 : 2.2));
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        trazarPolilineasTonal(trazos, colorHex, anchoBase, V.orden);

        // Nodos (puntos de coordenadas) de cada trazo: utiles al hacer zoom para revisar el mapa
        if (V.nodos) {
            ctx.fillStyle = "#fbbf24";
            const r = V.zoom >= 3 ? 2.2 : 1.4;
            trazos.forEach(pts => pts.forEach(([px, py]) => {
                const [sx, sy] = aCanvas(px, py);
                if (sx < areaX - 3 || sx > areaX + areaW + 3 || sy < areaY - 3 || sy > areaY + areaH + 3) return;
                ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
            }));
        }

        // Punto de inicio de figura
        const p0 = trazos[0][0];
        const [s0x, s0y] = aCanvas(p0[0], p0[1]);
        ctx.fillStyle = "#06b6d4";
        ctx.beginPath();
        ctx.arc(s0x, s0y, multi ? 3 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    });

    // Orden de trazado: viajes en vacio entre trazos (lapiz arriba) y numeracion de figuras
    if (V.orden && dibujo.figuras.length > 0) {
        ctx.save();
        ctx.strokeStyle = "rgba(244, 63, 94, 0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        let prev = [anim.x / escala, anim.y / escala];
        dibujo.figuras.forEach(fig => trazosDeFigura(fig).forEach(t => {
            const [ax, ay] = aCanvas(prev[0], prev[1]);
            const [bx, by] = aCanvas(t[0][0], t[0][1]);
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            prev = t[t.length - 1];
        }));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "700 11px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        dibujo.figuras.forEach((fig, idx) => {
            const t = trazosDeFigura(fig);
            if (!t.length) return;
            const [sx, sy] = aCanvas(t[0][0][0], t[0][0][1]);
            ctx.fillStyle = "#0d0f15";
            ctx.fillRect(sx + 5, sy - 16, 22, 14);
            ctx.fillStyle = "#f43f5e";
            ctx.fillText(`${idx + 1}`, sx + 8, sy - 5);
        });
        ctx.restore();
    }

    // Vista previa del mapeo de imagen (todavia no agregada al dibujo)
    const trazosPrevia = obtenerTrazosVistaPreviaMM();
    if (trazosPrevia.length > 0) {
        ctx.save();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        const verViajes = Boolean(document.getElementById("chk-img-show-travel")?.checked);
        trazarPolilineasTonal(trazosPrevia, "#f59e0b", 1.3, verViajes);
        if (verViajes) {
            ctx.strokeStyle = "rgba(244, 63, 94, 0.45)";
            ctx.lineWidth = 0.8;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            for (let i = 1; i < trazosPrevia.length; i++) {
                const a = trazosPrevia[i - 1][trazosPrevia[i - 1].length - 1];
                const b = trazosPrevia[i][0];
                const [ax, ay] = aCanvas(a[0], a[1]);
                const [bx, by] = aCanvas(b[0], b[1]);
                ctx.moveTo(ax, ay);
                ctx.lineTo(bx, by);
            }
            ctx.stroke();
        }
        ctx.restore();
    }

    // Caja de seleccion con manijas de escala
    const cajaSel = cajaDeSeleccion();
    if (cajaSel) {
        const [sx0, sy0] = aCanvas(cajaSel.x, cajaSel.y + cajaSel.h);
        const [sx1, sy1] = aCanvas(cajaSel.x + cajaSel.w, cajaSel.y);
        ctx.save();
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(sx0 - 4, sy0 - 4, (sx1 - sx0) + 8, (sy1 - sy0) + 8);
        ctx.setLineDash([]);
        ctx.fillStyle = "#0d0f15";
        ctx.strokeStyle = "#38bdf8";
        obtenerManijasCanvas(cajaSel).forEach(m => {
            ctx.fillRect(m.x - 5, m.y - 5, 10, 10);
            ctx.strokeRect(m.x - 5, m.y - 5, 10, 10);
        });
        ctx.fillStyle = "#38bdf8";
        ctx.font = "600 10.5px 'JetBrains Mono', monospace";
        ctx.textAlign = "left";
        ctx.fillText(`${cajaSel.w.toFixed(1)} x ${cajaSel.h.toFixed(1)} mm`, sx0 - 4, sy0 - 10);
        ctx.restore();
    }

    // Dibujar figura en curso (previsualización en vivo mientras se arrastra el mouse)
    if (dibujo.trazoActivo) {
        ctx.save();
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);

        if ((dibujo.herramienta === "freehand" || dibujo.herramienta === "polyline") && dibujo.puntosTempMM.length > 0) {
            ctx.beginPath();
            dibujo.puntosTempMM.forEach(([px, py], i) => {
                const [sx, sy] = aCanvas(px, py);
                if (i === 0) ctx.moveTo(sx, sy);
                else ctx.lineTo(sx, sy);
            });
            if (dibujo.herramienta === "polyline" && dibujo.puntoActualMM) {
                const [cx, cy] = aCanvas(dibujo.puntoActualMM[0], dibujo.puntoActualMM[1]);
                ctx.lineTo(cx, cy);
            }
            ctx.stroke();
        } else if (dibujo.puntoInicioMM && dibujo.puntoActualMM) {
            const [x1m, y1m] = dibujo.puntoInicioMM;
            const [x2m, y2m] = dibujo.puntoActualMM;
            const [sx1, sy1] = aCanvas(x1m, y1m);
            const [sx2, sy2] = aCanvas(x2m, y2m);

            if (dibujo.herramienta === "line") {
                ctx.beginPath();
                ctx.moveTo(sx1, sy1);
                ctx.lineTo(sx2, sy2);
                ctx.stroke();
            } else if (dibujo.herramienta === "rect") {
                ctx.strokeRect(
                    Math.min(sx1, sx2),
                    Math.min(sy1, sy2),
                    Math.abs(sx2 - sx1),
                    Math.abs(sy2 - sy1)
                );
            } else if (dibujo.herramienta === "triangle") {
                const minX = Math.min(sx1, sx2);
                const maxX = Math.max(sx1, sx2);
                const minY = Math.min(sy1, sy2);
                const maxY = Math.max(sy1, sy2);
                ctx.beginPath();
                ctx.moveTo(minX, maxY);
                ctx.lineTo(maxX, maxY);
                ctx.lineTo((minX + maxX) / 2, minY);
                ctx.closePath();
                ctx.stroke();
            } else if (dibujo.herramienta === "circle") {
                const rMM = Math.hypot(x2m - x1m, y2m - y1m);
                const rPx = rMM * factor;
                ctx.beginPath();
                ctx.arc(sx1, sy1, rPx, 0, Math.PI * 2);
                ctx.stroke();
            } else if (dibujo.herramienta === "measure") {
                const dx = x2m - x1m;
                const dy = y2m - y1m;
                const distMM = Math.hypot(dx, dy);
                const pulsos = Math.round(distMM * Math.max(0.01, estado.pasos_por_mm || 80));
                const ang = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1);
                ctx.strokeStyle = "#f59e0b";
                ctx.lineWidth = 1.6;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                ctx.moveTo(sx1, sy1);
                ctx.lineTo(sx2, sy2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = "#f59e0b";
                ctx.beginPath(); ctx.arc(sx1, sy1, 3.5, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(sx2, sy2, 3.5, 0, Math.PI * 2); ctx.fill();

                const lbl = `${distMM.toFixed(2)} mm (${pulsos} p) | ${ang} deg`;
                ctx.font = "600 11px 'JetBrains Mono', monospace";
                const tw = ctx.measureText(lbl).width + 12;
                const mx = (sx1 + sx2) / 2;
                const my = (sy1 + sy2) / 2 - 14;
                ctx.fillStyle = "rgba(24, 24, 27, 0.92)";
                ctx.strokeStyle = "#f59e0b";
                ctx.fillRect(mx - tw / 2, my - 11, tw, 18);
                ctx.strokeRect(mx - tw / 2, my - 11, tw, 18);
                ctx.fillStyle = "#fde68a";
                ctx.textAlign = "center";
                ctx.fillText(lbl, mx, my + 2);
            }
        }
        ctx.restore();
    }

    // Mostrar posición actual del cabezal CNC (o haz Laser 5W) dentro del lienzo de dibujo
    const headMM_X = anim.x / escala;
    const headMM_Y = anim.y / escala;
    const [hx, hy] = aCanvas(headMM_X, headMM_Y);
    const laserEmitiendo = Boolean((estado.laser && estado.laser.emitiendo) || anim.laserActivoEnTrazo);

    if (laserEmitiendo) {
        ctx.save();
        const grad = ctx.createRadialGradient(hx, hy, 1, hx, hy, 16);
        grad.addColorStop(0, "rgba(56, 189, 248, 0.95)");
        grad.addColorStop(0.45, "rgba(244, 63, 94, 0.65)");
        grad.addColorStop(1, "rgba(244, 63, 94, 0.0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(hx, hy, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    ctx.fillStyle = laserEmitiendo ? "#38bdf8" : (anim.enMovimiento ? "#f59e0b" : "#ededef");
    ctx.strokeStyle = laserEmitiendo ? "#f43f5e" : "#090a0d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hx, hy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Fin del recorte del area visible
    ctx.restore();

    // Reglas superior e izquierda (mm) estilo Photoshop con la posicion del cursor
    if (V.reglas) {
        dibujarReglasDibujo(ctx, w, h, x0, y1, factor, anchoMM, altoMM);
    }

    // Encabezado flotante: zona, perfil, modo de herramienta (Pluma Z vs Laser 5W) y zoom (siempre visible)
    const esModoLaser = estado.modo_herramienta === "laser";
    const lsInfo = estado.laser || {};
    const modoHerrTxt = esModoLaser
        ? `LASER 5W [${(lsInfo.potencia_watts || 1.75).toFixed(2)}W (${(lsInfo.potencia_pct || 35).toFixed(0)}%) | ${lsInfo.armado ? "ARMADO" : "DESARMADO"}]`
        : (estado.usar_z_dibujo
            ? `PLUMA Z ACTIVO (Home:${estado.z_home_pulsos || 0}p -> Papel:${estado.limite_max_z}p)`
            : "PLUMA Z DESACTIVADO (Solo 2D X+Y)");
    const txtInfo = `ZONA [${estado.perfil_activo}]: ${limPulsosX}x${limPulsosY}p (${anchoMM.toFixed(1)}x${altoMM.toFixed(1)} mm) | ${modoHerrTxt} | ZOOM ${Math.round(V.zoom * 100)}%`;
    ctx.font = "600 10.5px 'JetBrains Mono', monospace";
    const anchoTxt = ctx.measureText(txtInfo).width;
    ctx.fillStyle = "rgba(9, 10, 13, 0.82)";
    ctx.fillRect(areaX + 8, h - 26, anchoTxt + 16, 19);
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "left";
    ctx.fillText(txtInfo, areaX + 16, h - 12);

    // Panel Navegador (miniatura). Se refresca cada pocos cuadros para no recargar el render.
    V.cuadro = (V.cuadro + 1) % 4;
    if (V.cuadro === 0 || V.arrastrePan || V.arrastreNav) {
        dibujarNavegadorDibujo();
    }
}

// ==========================================================================
// ZOOM, DESPLAZAMIENTO, REGLAS Y NAVEGADOR DEL ESTUDIO DE DIBUJO (ESTILO PHOTOSHOP)
// ==========================================================================
const REGLA_SUP_PX = 22;
const REGLA_IZQ_PX = 46;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 40;
const PX_POR_MM_PANTALLA = 96 / 25.4; // Tamano real aproximado en un monitor estandar

let vistaDibujo = {
    zoom: 1,
    cx: null,               // Centro de la vista en mm (X)
    cy: null,               // Centro de la vista en mm (Y)
    factorBase: 1,
    zonaClave: "",
    area: { x: 0, y: 0, w: 0, h: 0 },
    reglas: true,
    cuadricula: true,
    nodos: false,
    orden: false,
    grosorReal: false,
    arrastrePan: null,
    arrastreNav: false,
    espacio: false,
    cuadro: 0
};

// Elige un paso "bonito" (1, 2, 5 x 10^n mm) para que las marcas queden separadas al menos minPx
function pasoReglaMM(factor, minPx) {
    const crudo = minPx / Math.max(1e-6, factor);
    const pot = Math.pow(10, Math.floor(Math.log10(crudo)));
    for (const m of [1, 2, 5, 10]) {
        if (m * pot >= crudo) return m * pot;
    }
    return 10 * pot;
}

function formatearMM(v, paso) {
    const dec = paso >= 1 ? 0 : (paso >= 0.1 ? 1 : 2);
    return v.toFixed(dec);
}

function dibujarReglasDibujo(ctx, w, h, x0, y1, factor, anchoMM, altoMM) {
    const paso = pasoReglaMM(factor, 60);
    const sub = paso / 10;
    ctx.save();
    ctx.fillStyle = "#14161d";
    ctx.fillRect(0, 0, w, REGLA_SUP_PX);
    ctx.fillRect(0, 0, REGLA_IZQ_PX, h);
    ctx.strokeStyle = "#2a2e3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, REGLA_SUP_PX + 0.5); ctx.lineTo(w, REGLA_SUP_PX + 0.5);
    ctx.moveTo(REGLA_IZQ_PX + 0.5, 0); ctx.lineTo(REGLA_IZQ_PX + 0.5, h);
    ctx.stroke();

    ctx.font = "9.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#8b93a3";
    ctx.strokeStyle = "#4b5263";

    // Regla superior (X)
    const xIni = (REGLA_IZQ_PX - x0) / factor;
    const xFin = (w - x0) / factor;
    ctx.beginPath();
    for (let v = Math.ceil(xIni / sub) * sub; v <= xFin; v += sub) {
        const sx = Math.round(x0 + v * factor) + 0.5;
        const k = Math.round(v / sub);
        const largo = k % 10 === 0 ? 12 : (k % 5 === 0 ? 7 : 4);
        if (sub * factor < 3 && k % 5 !== 0) continue;
        ctx.moveTo(sx, REGLA_SUP_PX); ctx.lineTo(sx, REGLA_SUP_PX - largo);
        if (k % 10 === 0) {
            ctx.textAlign = "left";
            ctx.fillText(formatearMM(v, paso), sx + 3, 10);
        }
    }
    ctx.stroke();

    // Regla izquierda (Y, crece hacia arriba)
    const yIni = (y1 - h) / factor;
    const yFin = (y1 - REGLA_SUP_PX) / factor;
    ctx.beginPath();
    ctx.textAlign = "right";
    for (let v = Math.ceil(yIni / sub) * sub; v <= yFin; v += sub) {
        const sy = Math.round(y1 - v * factor) + 0.5;
        const k = Math.round(v / sub);
        const largo = k % 10 === 0 ? 12 : (k % 5 === 0 ? 7 : 4);
        if (sub * factor < 3 && k % 5 !== 0) continue;
        ctx.moveTo(REGLA_IZQ_PX, sy); ctx.lineTo(REGLA_IZQ_PX - largo, sy);
        if (k % 10 === 0) {
            ctx.fillText(formatearMM(v, paso), REGLA_IZQ_PX - 14, sy + 3);
        }
    }
    ctx.stroke();

    // Zona calibrada resaltada en las reglas
    ctx.fillStyle = "rgba(6, 182, 212, 0.18)";
    ctx.fillRect(Math.max(REGLA_IZQ_PX, x0), REGLA_SUP_PX - 3, Math.max(0, Math.min(w, x0 + anchoMM * factor) - Math.max(REGLA_IZQ_PX, x0)), 3);
    const yTop = y1 - altoMM * factor;
    ctx.fillRect(REGLA_IZQ_PX - 3, Math.max(REGLA_SUP_PX, yTop), 3, Math.max(0, Math.min(h, y1) - Math.max(REGLA_SUP_PX, yTop)));

    // Indicador de la posicion del cursor en ambas reglas
    if (dibujo.cursorCanvas) {
        const c = dibujo.cursorCanvas;
        ctx.strokeStyle = "#f59e0b";
        ctx.beginPath();
        if (c.x > REGLA_IZQ_PX) { ctx.moveTo(c.x + 0.5, 0); ctx.lineTo(c.x + 0.5, REGLA_SUP_PX); }
        if (c.y > REGLA_SUP_PX) { ctx.moveTo(0, c.y + 0.5); ctx.lineTo(REGLA_IZQ_PX, c.y + 0.5); }
        ctx.stroke();
    }

    // Esquina: unidad
    ctx.fillStyle = "#14161d";
    ctx.fillRect(0, 0, REGLA_IZQ_PX, REGLA_SUP_PX);
    ctx.fillStyle = "#06b6d4";
    ctx.textAlign = "center";
    ctx.fillText("mm", REGLA_IZQ_PX / 2, 14);
    ctx.restore();
}

function limitarCentroVista() {
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const V = vistaDibujo;
    // Permitir desplazarse un poco mas alla de la zona, pero sin perderla de vista
    const margenX = Math.max(anchoMM * 0.5, 10);
    const margenY = Math.max(altoMM * 0.5, 10);
    V.cx = Math.max(-margenX * 0.5, Math.min(anchoMM + margenX * 0.5, V.cx));
    V.cy = Math.max(-margenY * 0.5, Math.min(altoMM + margenY * 0.5, V.cy));
}

// Zoom manteniendo fijo el punto de pantalla (cx, cy) indicado (por defecto el centro del area)
function establecerZoomDibujo(nuevoZoom, puntoCanvas = null) {
    const V = vistaDibujo;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nuevoZoom));
    if (V.cx === null) { V.zoom = z; actualizarPanelNavegador(); return; }
    const a = V.area;
    const areaCx = a.x + a.w / 2;
    const areaCy = a.y + a.h / 2;
    if (puntoCanvas) {
        const fAnt = V.factorBase * V.zoom;
        const fNue = V.factorBase * z;
        // mm bajo el cursor antes del zoom
        const mx = V.cx + (puntoCanvas.x - areaCx) / fAnt;
        const my = V.cy - (puntoCanvas.y - areaCy) / fAnt;
        V.cx = mx - (puntoCanvas.x - areaCx) / fNue;
        V.cy = my + (puntoCanvas.y - areaCy) / fNue;
    }
    V.zoom = z;
    limitarCentroVista();
    actualizarPanelNavegador();
}

function zoomPasoDibujo(direccion) {
    const niveles = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 40];
    const z = vistaDibujo.zoom;
    let destino;
    if (direccion > 0) destino = niveles.find(n => n > z + 1e-6) ?? ZOOM_MAX;
    else destino = [...niveles].reverse().find(n => n < z - 1e-6) ?? ZOOM_MIN;
    establecerZoomDibujo(destino);
}

function ajustarVistaAZona() {
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    vistaDibujo.zoom = 1;
    vistaDibujo.cx = anchoMM / 2;
    vistaDibujo.cy = altoMM / 2;
    actualizarPanelNavegador();
}

function zoomTamanoReal() {
    establecerZoomDibujo(PX_POR_MM_PANTALLA / Math.max(1e-6, vistaDibujo.factorBase));
}

function enfocarCajaMM(caja, margen = 0.12) {
    if (!caja) return;
    const V = vistaDibujo;
    const a = V.area;
    const w = Math.max(caja.w, 1);
    const h = Math.max(caja.h, 1);
    const fObjetivo = Math.min((a.w * (1 - margen * 2)) / w, (a.h * (1 - margen * 2)) / h);
    V.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fObjetivo / Math.max(1e-6, V.factorBase)));
    V.cx = caja.x + caja.w / 2;
    V.cy = caja.y + caja.h / 2;
    limitarCentroVista();
    actualizarPanelNavegador();
}

function zoomASeleccion() {
    const caja = cajaDeSeleccion();
    if (!caja) {
        mostrarMensajeConsola("No hay seleccion: usa la herramienta Seleccionar o haz clic en una figura de la lista.", true);
        return;
    }
    enfocarCajaMM(caja);
}

function zoomATodosLosTrazos() {
    const todos = [];
    dibujo.figuras.forEach(f => trazosDeFigura(f).forEach(t => todos.push(t)));
    obtenerTrazosVistaPreviaMM().forEach(t => todos.push(t));
    if (todos.length === 0) {
        mostrarMensajeConsola("No hay trazos en el lienzo para encuadrar.", true);
        return;
    }
    enfocarCajaMM(cajaDeTrazos(todos));
}

function desplazarVistaDibujo(dxMM, dyMM) {
    vistaDibujo.cx += dxMM;
    vistaDibujo.cy += dyMM;
    limitarCentroVista();
    actualizarPanelNavegador();
}

// Control deslizante logaritmico: 0..1000 -> ZOOM_MIN..ZOOM_MAX
function zoomDesdeSlider(valor) {
    const t = Math.max(0, Math.min(1000, parseFloat(valor) || 0)) / 1000;
    const z = Math.exp(Math.log(ZOOM_MIN) + t * (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN)));
    establecerZoomDibujo(z);
}

function sliderDesdeZoom(z) {
    return Math.round(((Math.log(z) - Math.log(ZOOM_MIN)) / (Math.log(ZOOM_MAX) - Math.log(ZOOM_MIN))) * 1000);
}

function aplicarZoomDesdeInput() {
    const v = parseFloat(document.getElementById("input-nav-zoom")?.value);
    if (Number.isFinite(v) && v > 0) establecerZoomDibujo(v / 100);
    else actualizarPanelNavegador();
}

function aplicarCentroDesdeInputs() {
    const vx = parseFloat(document.getElementById("input-nav-cx")?.value);
    const vy = parseFloat(document.getElementById("input-nav-cy")?.value);
    if (Number.isFinite(vx)) vistaDibujo.cx = vx;
    if (Number.isFinite(vy)) vistaDibujo.cy = vy;
    limitarCentroVista();
    actualizarPanelNavegador();
}

function alternarOpcionVista(opcion, activo) {
    if (opcion in vistaDibujo) vistaDibujo[opcion] = Boolean(activo);
}

function actualizarPanelNavegador() {
    const V = vistaDibujo;
    const pct = Math.round(V.zoom * 100);
    const badge = document.getElementById("nav-zoom-badge");
    if (badge) badge.textContent = `${pct}%`;
    const slider = document.getElementById("range-nav-zoom");
    if (slider && document.activeElement !== slider) slider.value = sliderDesdeZoom(V.zoom);
    const inp = document.getElementById("input-nav-zoom");
    if (inp && document.activeElement !== inp) inp.value = pct;
    const icx = document.getElementById("input-nav-cx");
    const icy = document.getElementById("input-nav-cy");
    if (icx && document.activeElement !== icx && V.cx !== null) icx.value = V.cx.toFixed(1);
    if (icy && document.activeElement !== icy && V.cy !== null) icy.value = V.cy.toFixed(1);

    const lblEsc = document.getElementById("nav-scale-info");
    if (lblEsc) {
        const pxmm = V.factorBase * V.zoom;
        const a = V.area;
        const visW = a.w / Math.max(1e-6, pxmm);
        const visH = a.h / Math.max(1e-6, pxmm);
        lblEsc.textContent = `${pxmm.toFixed(2)} px/mm | Area visible: ${visW.toFixed(1)} x ${visH.toFixed(1)} mm`;
    }
}

// Geometria del minimapa: ajusta la zona completa dentro del canvas del navegador
function geometriaNavegador(canvas) {
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const pad = 10;
    const f = Math.min((canvas.width - pad * 2) / anchoMM, (canvas.height - pad * 2) / altoMM);
    const ox = (canvas.width - anchoMM * f) / 2;
    const oy = (canvas.height - altoMM * f) / 2;
    return {
        f, ox, oy, anchoMM, altoMM,
        aNav: (x, y) => [ox + x * f, oy + (altoMM - y) * f],
        aMM: (px, py) => [(px - ox) / f, altoMM - (py - oy) / f]
    };
}

function dibujarNavegadorDibujo() {
    const canvas = document.getElementById("canvas-navigator");
    if (!canvas || !canvas.offsetParent) return;
    const r = canvas.getBoundingClientRect();
    const tw = Math.max(60, Math.floor(r.width));
    const th = Math.max(60, Math.floor(r.height));
    if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; }
    const ctx = canvas.getContext("2d");
    const G = geometriaNavegador(canvas);
    const V = vistaDibujo;

    ctx.fillStyle = "#07080b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const [zx0, zy0] = G.aNav(0, G.altoMM);
    ctx.fillStyle = "#0d0f15";
    ctx.fillRect(zx0, zy0, G.anchoMM * G.f, G.altoMM * G.f);
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 1;
    ctx.strokeRect(zx0 + 0.5, zy0 + 0.5, G.anchoMM * G.f, G.altoMM * G.f);

    if (dibujo.imagen && dibujo.imagen.visible) {
        const ri = dibujo.imagen.rect;
        const [ix, iy] = G.aNav(ri.x, ri.y + ri.h);
        ctx.globalAlpha = dibujo.imagen.opacidad;
        ctx.drawImage(dibujo.imagen.img, ix, iy, ri.w * G.f, ri.h * G.f);
        ctx.globalAlpha = 1;
    }

    const trazarLista = (lista, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        lista.forEach(t => t.forEach(([x, y], i) => {
            const [sx, sy] = G.aNav(x, y);
            if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }));
        ctx.stroke();
    };
    dibujo.figuras.forEach(f => trazarLista(trazosDeFigura(f), figuraFueraDeZona(f) ? "#f43f5e" : "#10b981"));
    trazarLista(obtenerTrazosVistaPreviaMM(), "#f59e0b");

    // Rectangulo del area visible del lienzo principal
    const pxmm = V.factorBase * V.zoom;
    if (V.cx !== null && pxmm > 0) {
        const a = V.area;
        const visW = a.w / pxmm, visH = a.h / pxmm;
        const [vx, vy] = G.aNav(V.cx - visW / 2, V.cy + visH / 2);
        ctx.fillStyle = "rgba(244, 63, 94, 0.08)";
        ctx.fillRect(vx, vy, visW * G.f, visH * G.f);
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(vx, vy, visW * G.f, visH * G.f);
    }
}

function configurarEventosNavegador() {
    const nav = document.getElementById("canvas-navigator");
    if (nav) {
        const centrarEn = (e) => {
            const r = nav.getBoundingClientRect();
            const px = (e.clientX - r.left) * (nav.width / Math.max(1, r.width));
            const py = (e.clientY - r.top) * (nav.height / Math.max(1, r.height));
            const [mx, my] = geometriaNavegador(nav).aMM(px, py);
            vistaDibujo.cx = mx;
            vistaDibujo.cy = my;
            limitarCentroVista();
            actualizarPanelNavegador();
        };
        nav.addEventListener("mousedown", (e) => { vistaDibujo.arrastreNav = true; centrarEn(e); });
        window.addEventListener("mousemove", (e) => { if (vistaDibujo.arrastreNav) centrarEn(e); });
        window.addEventListener("mouseup", () => { vistaDibujo.arrastreNav = false; });
        nav.addEventListener("wheel", (e) => {
            e.preventDefault();
            establecerZoomDibujo(vistaDibujo.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
        }, { passive: false });
    }

    const canvas = document.getElementById("canvas-drawing");
    if (!canvas) return;

    // Rueda del mouse: zoom centrado en el cursor
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        const c = canvasDesdeEvento(e);
        const factorRueda = Math.pow(1.0015, -e.deltaY);
        establecerZoomDibujo(vistaDibujo.zoom * factorRueda, c);
    }, { passive: false });

    canvas.addEventListener("mouseleave", () => { dibujo.cursorCanvas = null; });

    // Evitar el menu contextual / autoscroll del boton central sobre el lienzo
    canvas.addEventListener("auxclick", (e) => { if (e.button === 1) e.preventDefault(); });

    // Paneles laterales plegables (clic en el encabezado), como en Photoshop
    document.querySelectorAll("#view-drawing .inspector-card-head").forEach(head => {
        head.classList.add("collapsible");
        head.addEventListener("click", (e) => {
            if (e.target.closest("button, input, select, label, a")) return;
            head.parentElement.classList.toggle("collapsed");
        });
    });

    // Barra espaciadora: mano temporal para desplazar
    window.addEventListener("keydown", (e) => {
        if (!document.getElementById("view-drawing")?.classList.contains("active")) return;
        if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
        if (e.code === "Space") {
            e.preventDefault();
            if (!vistaDibujo.espacio) {
                vistaDibujo.espacio = true;
                canvas.style.cursor = "grab";
            }
        } else if (e.key === "+" || e.key === "=") {
            zoomPasoDibujo(1);
        } else if (e.key === "-" || e.key === "_") {
            zoomPasoDibujo(-1);
        } else if (e.key === "0") {
            ajustarVistaAZona();
        } else if (e.key === "1") {
            zoomTamanoReal();
        } else if (e.key.toLowerCase() === "h") {
            seleccionarHerramientaDibujo("pan");
        } else if (e.key.toLowerCase() === "v") {
            seleccionarHerramientaDibujo("select");
        }
    });
    window.addEventListener("keyup", (e) => {
        if (e.code === "Space" && vistaDibujo.espacio) {
            vistaDibujo.espacio = false;
            canvas.style.cursor = dibujo.herramienta === "pan" ? "grab" : (dibujo.herramienta === "select" ? "default" : "crosshair");
        }
    });
}

// Devuelve true si el evento inicia un desplazamiento (mano / boton central / espacio)
function iniciarPanSiCorresponde(e) {
    const esPan = e.button === 1 || (e.button === 0 && (dibujo.herramienta === "pan" || vistaDibujo.espacio));
    if (!esPan) return false;
    e.preventDefault();
    vistaDibujo.arrastrePan = { x: e.clientX, y: e.clientY, cx: vistaDibujo.cx, cy: vistaDibujo.cy };
    const canvas = document.getElementById("canvas-drawing");
    if (canvas) canvas.style.cursor = "grabbing";
    return true;
}

function moverPanSiActivo(e) {
    const p = vistaDibujo.arrastrePan;
    if (!p) return false;
    const canvas = document.getElementById("canvas-drawing");
    const r = canvas.getBoundingClientRect();
    const escalaCss = canvas.width / Math.max(1, r.width);
    const f = vistaDibujo.factorBase * vistaDibujo.zoom;
    vistaDibujo.cx = p.cx - ((e.clientX - p.x) * escalaCss) / f;
    vistaDibujo.cy = p.cy + ((e.clientY - p.y) * escalaCss) / f;
    limitarCentroVista();
    actualizarPanelNavegador();
    return true;
}

function finalizarPanSiActivo() {
    if (!vistaDibujo.arrastrePan) return false;
    vistaDibujo.arrastrePan = null;
    const canvas = document.getElementById("canvas-drawing");
    if (canvas) {
        canvas.style.cursor = (dibujo.herramienta === "pan" || vistaDibujo.espacio)
            ? "grab"
            : (dibujo.herramienta === "select" ? "default" : "crosshair");
    }
    return true;
}

// ==========================================================================
// ACTUALIZACIÓN DE LA BARRA DE VALIDACIÓN, PERFILES, ENA+/ENA-, HUD Y SWITCHES
// ==========================================================================
function sincronizarEstado(data, forzarPosicionAnim = false) {
    estado = { ...estado, ...data };

    if (forzarPosicionAnim) {
        anim.x = estado.pos_x;
        anim.y = estado.pos_y;
        anim.z = estado.pos_z;
    }

    // 0. Actualizar selector de perfiles
    const selProfile = document.getElementById("select-profile");
    const descPill = document.getElementById("profile-desc-text");
    if (selProfile && Array.isArray(estado.perfiles_disponibles)) {
        selProfile.innerHTML = "";
        let perfilActualObj = null;
        estado.perfiles_disponibles.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = p.nombre || p.id;
            if (p.id === estado.perfil_activo) {
                opt.selected = true;
                perfilActualObj = p;
            }
            selProfile.appendChild(opt);
        });
        if (descPill) {
            descPill.textContent = perfilActualObj && perfilActualObj.descripcion
                ? perfilActualObj.descripcion
                : `Archivo activo: perfiles/${estado.perfil_activo}.json`;
        }
    }

    // 1. Actualizar controles de modo ENA+/ENA- (AUTO, HOLD, FREE)
    if (estado.ena) {
        const modoEna = estado.ena.modo || "AUTO";
        const polEna = estado.ena.polaridad || "LOW";
        document.getElementById("btn-ena-auto")?.classList.toggle("active", modoEna === "AUTO");
        document.getElementById("btn-ena-hold")?.classList.toggle("active", modoEna === "HOLD");
        document.getElementById("btn-ena-free")?.classList.toggle("active", modoEna === "FREE");
        const btnPol = document.getElementById("btn-ena-pol");
        if (btnPol) {
            btnPol.textContent = `Polaridad: ${polEna}`;
            btnPol.classList.toggle("active", polEna === "HIGH");
        }
        const trigEna = document.getElementById("btn-ena-dropdown-trigger");
        const lblEnaCompact = document.getElementById("lbl-ena-compact");
        if (trigEna) {
            trigEna.className = "ena-dropdown-trigger " + (modoEna === "HOLD" ? "hold" : (modoEna === "FREE" ? "free" : "auto"));
        }
        if (lblEnaCompact) {
            lblEnaCompact.textContent = `ENA: ${modoEna === "FREE" ? "OFF" : modoEna} (${polEna})`;
        }

        ["X", "Y", "Z"].forEach(eje => {
            const key = eje.toLowerCase();
            const energizado = Boolean(estado.ena[eje]);
            const btnEna = document.getElementById(`btn-ena-${key}`);
            const lblAmp = document.getElementById(`amp-live-${key}`);

            if (btnEna && lblAmp) {
                if (modoEna === "FREE") {
                    btnEna.textContent = "ENA+ HIGH (LIBRE)";
                    btnEna.className = "ena-toggle-btn disabled-free";
                    lblAmp.textContent = "0.0 A (Cortado)";
                    lblAmp.className = "amp-idle";
                } else if (energizado) {
                    btnEna.textContent = "ENA+ LOW (HOLD)";
                    btnEna.className = "ena-toggle-btn energized";
                    lblAmp.textContent = `${estado.current_a.toFixed(1)} A (Retencion)`;
                    lblAmp.className = "amp-active";
                } else {
                    btnEna.textContent = "ENA+ HIGH (AUTO)";
                    btnEna.className = "ena-toggle-btn idle";
                    lblAmp.textContent = "0.0 A (Reposo)";
                    lblAmp.className = "amp-idle";
                }
            }

            const btnDir = document.getElementById(`btn-dir-${key}`);
            if (btnDir && estado.invertir_dir) {
                const inv = Boolean(estado.invertir_dir[eje]);
                btnDir.textContent = inv ? "DIR: Invertido" : "DIR: Normal";
                btnDir.className = inv ? "ena-toggle-btn energized" : "ena-toggle-btn idle";
            }
        });
    }

    // 2. Actualizar Banner de Validación A Prueba de Errores
    if (estado.validaciones) {
        const banner = document.getElementById("validation-banner");
        const icon = document.getElementById("val-icon");
        const title = document.getElementById("val-title");
        const detail = document.getElementById("val-detail");
        const syncPill = document.getElementById("sync-status-pill");

        const nivel = estado.validaciones.nivel || "ok";
        const principal = (estado.validaciones.items && estado.validaciones.items[0]) || {
            titulo: "Sistema validado",
            detalle: "Operacion nominal."
        };

        banner.className = `validation-banner ${nivel}`;
        icon.textContent = nivel === "error" ? "ERR" : (nivel === "warn" ? "WARN" : "OK");
        title.textContent = principal.titulo;
        detail.textContent = principal.detalle;

        if (estado.posicion_sincronizada) {
            syncPill.textContent = `Motor Sincronizado (${estado.pos_x}, ${estado.pos_y}, ${estado.pos_z})`;
            syncPill.className = "sync-pill synced";
        } else {
            syncPill.textContent = "Sincronia Motor: Requiere Validacion";
            syncPill.className = "sync-pill unsynced";
        }
    }

    // 3. Sincronizar visualmente el banco de DIP Switches (S1 - S6)
    if (estado.switches) {
        ["S1", "S2", "S3", "S4", "S5", "S6"].forEach(swKey => {
            const activo = Boolean(estado.switches[swKey]);
            const slotEl = document.getElementById(`slot-sw-${swKey}`);
            const lblEl = document.getElementById(`lbl-sw-${swKey}`);
            if (slotEl) slotEl.classList.toggle("on", activo);
            if (lblEl) {
                lblEl.textContent = activo ? "ON" : "OFF";
                lblEl.style.color = activo ? "#10b981" : "#6b7280";
            }
        });

        const s1 = String(Boolean(estado.switches.S1));
        const s2 = String(Boolean(estado.switches.S2));
        const s3 = String(Boolean(estado.switches.S3));
        document.querySelectorAll("#tabla-microstep tbody tr").forEach(tr => {
            const match = tr.dataset.s1 === s1 && tr.dataset.s2 === s2 && tr.dataset.s3 === s3;
            tr.classList.toggle("active-row", match);
        });

        const s4 = String(Boolean(estado.switches.S4));
        const s5 = String(Boolean(estado.switches.S5));
        const s6 = String(Boolean(estado.switches.S6));
        document.querySelectorAll("#tabla-corriente tbody tr").forEach(tr => {
            const match = tr.dataset.s4 === s4 && tr.dataset.s5 === s5 && tr.dataset.s6 === s6;
            tr.classList.toggle("active-row", match);
        });
    }

    // 4. Actualizar textos decodificados de las Tablas 1 y 2
    const roMs = document.getElementById("ro-microstep");
    const roPr = document.getElementById("ro-pulserev");
    const hudMs = document.getElementById("hud-driver-ms");
    const hudPulse = document.getElementById("hud-driver-pulse");
    const tbl1Sum = document.getElementById("tbl1-active-summary");

    if (estado.microstep === "NC") {
        roMs.textContent = "Estado: NC (Inactivo)";
        roMs.className = "ro-val rose";
        roPr.textContent = "Pulse/rev: NC (Deshabilitado)";
        hudMs.textContent = "DRIVER NC";
        hudMs.className = "calib-badge danger";
        hudPulse.innerHTML = `NC <small>Sin salida</small>`;
        if (tbl1Sum) tbl1Sum.textContent = "NC (Deshabilitado)";
    } else {
        roMs.textContent = `Microstep: ${estado.microstep}`;
        roMs.className = "ro-val cyan";
        roPr.textContent = `${estado.pulse_rev} Pulse/rev | ${estado.grados_por_pulso} deg/pulso`;
        hudMs.textContent = `MICROSTEP ${estado.microstep}`;
        hudMs.className = "calib-badge calibrated";
        hudPulse.innerHTML = `${estado.pulse_rev} <small>P/rev</small>`;
        if (tbl1Sum) tbl1Sum.textContent = `Microstep ${estado.microstep} (${estado.pulse_rev})`;
    }

    const ampReposoTxt = (estado.ena && estado.ena.modo !== "HOLD") ? "0.0A" : `${estado.current_a.toFixed(1)}A`;
    document.getElementById("ro-current").textContent = `Current: ${estado.current_a.toFixed(1)} A`;
    document.getElementById("ro-pkcurrent").textContent = `PK: ${estado.pk_current_a.toFixed(1)} A | Reposo: ${ampReposoTxt}`;
    document.getElementById("hud-driver-curr").innerHTML = `<b>${estado.current_a.toFixed(1)} A</b> (Reposo: ${ampReposoTxt})`;
    const tbl2Sum = document.getElementById("tbl2-active-summary");
    if (tbl2Sum) tbl2Sum.textContent = `${estado.current_a.toFixed(1)} A (PK ${estado.pk_current_a.toFixed(1)} A)`;

    const degTxt = estado.microstep === "NC" ? "NC" : `${estado.grados_por_pulso} deg`;
    ["badge-step-x", "badge-step-y", "badge-step-z"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = degTxt;
    });

    const inputPasosMM = document.getElementById("input-pasos-mm");
    if (inputPasosMM && document.activeElement !== inputPasosMM) {
        inputPasosMM.value = estado.pasos_por_mm;
    }

    const inputVelHz = document.getElementById("input-velocidad-hz");
    if (inputVelHz && document.activeElement !== inputVelHz) {
        inputVelHz.value = estado.velocidad_hz;
    }

    const selectPort = document.getElementById("select-port");
    if (data.puertos_disponibles) {
        selectPort.innerHTML = "";
        data.puertos_disponibles.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            if (p === estado.puerto) opt.selected = true;
            selectPort.appendChild(opt);
        });
    }

    const pill = document.getElementById("status-pill");
    const pillTxt = document.getElementById("status-pill-text");
    const btnConn = document.getElementById("btn-connect");

    document.getElementById("chk-simulacion").checked = estado.modo_simulacion;
    document.getElementById("chk-soft-limits").checked = estado.bloquear_limites;

    const chkAutoStart = document.getElementById("chk-autohome-startup");
    if (chkAutoStart) chkAutoStart.checked = Boolean(estado.autocalibrar_inicio);

    const zHomeVal = estado.z_home_pulsos !== undefined ? estado.z_home_pulsos : 0;
    const swX = (estado.endstops && estado.endstops.X) || estado.pos_x === 0;
    const swY = (estado.endstops && estado.endstops.Y) || estado.pos_y === 0;
    const swZ = (estado.endstops && estado.endstops.Z) || estado.pos_z === zHomeVal;

    const elSwX = document.getElementById("lbl-sw-endstop-x");
    const elSwY = document.getElementById("lbl-sw-endstop-y");
    const elSwZ = document.getElementById("lbl-sw-endstop-z");
    if (elSwX) {
        elSwX.textContent = swX ? "ACCIONADO (Home 0)" : "LIBRE";
        elSwX.style.color = swX ? "#10b981" : "#9ca3af";
    }
    if (elSwY) {
        elSwY.textContent = swY ? "ACCIONADO (Home 0)" : "LIBRE";
        elSwY.style.color = swY ? "#10b981" : "#9ca3af";
    }
    if (elSwZ) {
        const enHomeZ = estado.pos_z === zHomeVal;
        elSwZ.textContent = enHomeZ ? `MANUAL (En Home: ${zHomeVal}p)` : `MANUAL (Pos: ${estado.pos_z}p)`;
        elSwZ.style.color = enHomeZ ? "#06b6d4" : "#9ca3af";
    }

    const usarZ = Boolean(estado.usar_z_dibujo);
    const chkZMain = document.getElementById("chk-enable-z-main");
    const chkZDraw = document.getElementById("chk-draw-use-z");
    if (chkZMain) chkZMain.checked = usarZ;
    if (chkZDraw) chkZDraw.checked = usarZ;

    const zPapelVal = estado.limite_max_z !== undefined ? estado.limite_max_z : 400;
    const inZUp = document.getElementById("input-z-up");
    const inZDown = document.getElementById("input-z-down");
    if (inZUp && document.activeElement !== inZUp) inZUp.value = zHomeVal;
    if (inZDown && document.activeElement !== inZDown) inZDown.value = zPapelVal;

    const lblZCalib = document.getElementById("lbl-z-calib-summary");
    if (lblZCalib) {
        lblZCalib.textContent = `Home Z: ${zHomeVal}p | Papel: ${zPapelVal}p (${usarZ ? "Z Activo" : "Z Inactivo"})`;
        lblZCalib.className = usarZ ? "active-config-pill emerald" : "active-config-pill cyan";
    }

    const lblDrawZMode = document.getElementById("lbl-draw-z-mode");
    if (lblDrawZMode) {
        lblDrawZMode.textContent = usarZ
            ? `Activo: Sube a Home Z (${zHomeVal} pulsos) al viajar y baja a Contacto Papel (${zPapelVal} pulsos) al dibujar.`
            : "Desactivado: El Estudio de Dibujo solo movera X e Y simultaneamente sin mover el Eje Z.";
    }

    if (estado.conectado && !estado.modo_simulacion) {
        pill.className = "status-badge connected";
        pillTxt.textContent = `Hardware (${estado.puerto})`;
        btnConn.textContent = "Desconectar";
    } else {
        pill.className = "status-badge sim";
        pillTxt.textContent = "Simulacion Virtual";
        btnConn.textContent = estado.conectado ? "Desconectar" : "Conectar";
    }

    document.getElementById("dro-x-steps").textContent = `${estado.pos_x} pulsos`;
    document.getElementById("dro-y-steps").textContent = `${estado.pos_y} pulsos`;
    document.getElementById("dro-z-steps").textContent = `${estado.pos_z} pulsos`;

    document.getElementById("dro-x-mm").innerHTML = `${estado.mm_x.toFixed(2)} <small>mm</small>`;
    document.getElementById("dro-y-mm").innerHTML = `${estado.mm_y.toFixed(2)} <small>mm</small>`;
    document.getElementById("dro-z-mm").innerHTML = `${estado.mm_z.toFixed(2)} <small>mm</small>`;

    const refMaxX = Math.max(1000, Math.abs(estado.limite_max_x));
    const refMaxY = Math.max(1000, Math.abs(estado.limite_max_y));
    const refMaxZ = Math.max(500, Math.abs(estado.limite_max_z));

    document.getElementById("bar-x").style.width = `${Math.min(100, (Math.abs(estado.pos_x) / refMaxX) * 100)}%`;
    document.getElementById("bar-y").style.width = `${Math.min(100, (Math.abs(estado.pos_y) / refMaxY) * 100)}%`;
    document.getElementById("bar-z").style.width = `${Math.min(100, Math.max(5, ((estado.pos_z + refMaxZ) / (2 * refMaxZ)) * 100))}%`;

    document.getElementById("motor-x-steps").textContent = estado.pos_x;
    document.getElementById("motor-y-steps").textContent = estado.pos_y;
    document.getElementById("motor-z-steps").textContent = estado.pos_z;

    document.getElementById("motor-x-angle").textContent = `${Math.round(((anim.ang_x % 360) + 360) % 360)} deg`;
    document.getElementById("motor-y-angle").textContent = `${Math.round(((anim.ang_y % 360) + 360) % 360)} deg`;
    document.getElementById("motor-z-angle").textContent = `${Math.round(((anim.ang_z % 360) + 360) % 360)} deg`;

    if (estado.limite_fijado) {
        document.getElementById("lbl-area-pasos").textContent =
            `${estado.limite_mm_x.toFixed(1)} x ${estado.limite_mm_y.toFixed(1)} mm (${Math.abs(estado.limite_max_x)}x${Math.abs(estado.limite_max_y)})`;
    } else {
        document.getElementById("lbl-area-pasos").textContent = "Sin fijar aun";
    }

    const limX = Math.abs(estado.limite_max_x) > 0 ? Math.abs(estado.limite_max_x) : Math.max(Math.abs(estado.pos_x), (estado.pulse_rev || 3200) * 3);
    const limY = Math.abs(estado.limite_max_y) > 0 ? Math.abs(estado.limite_max_y) : Math.max(Math.abs(estado.pos_y), (estado.pulse_rev || 3200) * 2);
    const limZ = Math.abs(estado.limite_max_z) > 0 ? Math.abs(estado.limite_max_z) : Math.abs(estado.pos_z);
    const esc = Math.max(0.01, estado.pasos_por_mm);
    const mmX = limX / esc;
    const mmY = limY / esc;
    const mmZ = limZ / esc;
    const areaCm2 = (mmX * mmY) / 100.0;

    ajustarFigurasANuevaZona(mmX, mmY);

    const pillDrawProf = document.getElementById("draw-profile-pill");
    if (pillDrawProf) {
        const pObj = Array.isArray(estado.perfiles_disponibles)
            ? estado.perfiles_disponibles.find(p => p.id === estado.perfil_activo)
            : null;
        pillDrawProf.textContent = `Perfil: ${pObj ? (pObj.nombre || pObj.id) : estado.perfil_activo} (${limX}x${limY}p)`;
    }

    const badgeDraw = document.getElementById("draw-workspace-badge");
    if (badgeDraw) badgeDraw.textContent = `${mmX.toFixed(1)} x ${mmY.toFixed(1)} mm (${limX}x${limY}p)`;

    const inDrawStepsW = document.getElementById("input-draw-width-steps");
    const inDrawStepsH = document.getElementById("input-draw-height-steps");
    if (inDrawStepsW && document.activeElement !== inDrawStepsW) inDrawStepsW.value = limX;
    if (inDrawStepsH && document.activeElement !== inDrawStepsH) inDrawStepsH.value = limY;

    const inDrawW = document.getElementById("input-draw-width-mm");
    const inDrawH = document.getElementById("input-draw-height-mm");
    if (inDrawW && document.activeElement !== inDrawW) inDrawW.value = Number(mmX.toFixed(1));
    if (inDrawH && document.activeElement !== inDrawH) inDrawH.value = Number(mmY.toFixed(1));

    document.getElementById("kpi-x-mm").textContent = `${mmX.toFixed(2)} mm`;
    document.getElementById("kpi-x-steps").textContent = `${limX} pulsos (${(mmX / 10).toFixed(2)} cm)`;

    document.getElementById("kpi-y-mm").textContent = `${mmY.toFixed(2)} mm`;
    document.getElementById("kpi-y-steps").textContent = `${limY} pulsos (${(mmY / 10).toFixed(2)} cm)`;

    document.getElementById("kpi-z-mm").textContent = `${mmZ.toFixed(2)} mm`;
    document.getElementById("kpi-z-steps").textContent = `${limZ} pulsos`;

    document.getElementById("kpi-area-cm2").textContent = `${areaCm2.toFixed(2)} cm2`;
    document.getElementById("kpi-safe-mm").textContent = `Zona 90%: ${(mmX * 0.9).toFixed(1)} x ${(mmY * 0.9).toFixed(1)} mm`;

    if (data.ultimo_mensaje) {
        mostrarMensajeConsola(data.ultimo_mensaje, estado.microstep === "NC");
    }
    sincronizarUILaser5W();
    actualizarAvancePreview();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    actualizarPanelImagen();
    actualizarEstadisticasEnergiaDrawer();
}

function mostrarMensajeConsola(msg, esAlerta = false) {
    const banner = document.getElementById("console-msg");
    const dot = document.getElementById("console-dot");
    if (banner) {
        banner.textContent = msg;
        banner.style.color = esAlerta ? "#fbbf24" : "#9ca3af";
    }
    if (dot) dot.style.background = esAlerta ? "#f59e0b" : "#10b981";

    const hist = document.getElementById("console-log-history");
    if (hist && msg) {
        const ahora = new Date();
        const ts = ahora.toTimeString().slice(0, 8);
        const line = document.createElement("div");
        line.className = "console-log-line" + (esAlerta ? " alert" : "");
        line.innerHTML = `<span class="log-ts">[${ts}]</span>`;
        line.appendChild(document.createTextNode(msg));
        hist.appendChild(line);
        while (hist.children.length > 120) {
            hist.removeChild(hist.firstChild);
        }
        hist.scrollTop = hist.scrollHeight;
    }
}

function ajustarTamanoCanvases() {
    ["canvas-sim", "canvas-drawing", "canvas-blueprint"].forEach(id => {
        const canvas = document.getElementById(id);
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
            canvas.width = rect.width;
            canvas.height = rect.height;
        }
    });
}

function bucleRenderizado() {
    dibujarSimulacionViva();
    dibujarEstudioDibujo();

    const xEnergizado = anim.ejeEnMovimiento === "X" || anim.ejeEnMovimiento === "XY" || (estado.ena && estado.ena.X);
    const yEnergizado = anim.ejeEnMovimiento === "Y" || anim.ejeEnMovimiento === "XY" || (estado.ena && estado.ena.Y);
    const zEnergizado = anim.ejeEnMovimiento === "Z" || (estado.ena && estado.ena.Z);

    dibujarMotorNema("canvas-motor-x", anim.ang_x, "#06b6d4", xEnergizado);
    dibujarMotorNema("canvas-motor-y", anim.ang_y, "#10b981", yEnergizado);
    dibujarMotorNema("canvas-motor-z", anim.ang_z, "#6366f1", zEnergizado);
    dibujarActuadorLaser5W("canvas-laser-5w");
    requestAnimationFrame(bucleRenderizado);
}

// ==========================================================================
// 1. SIMULACIÓN CINEMÁTICA EN VIVO: CNC DE PUENTE FIJO EN X Y PLACA MÓVIL EN Y
// ==========================================================================
function dibujarSimulacionViva() {
    const canvas = document.getElementById("canvas-sim");
    if (!canvas) return;
    const parentRect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 0, height: 0 };
    if (parentRect.width > 50 && parentRect.height > 50) {
        const tw = Math.floor(parentRect.width);
        const th = Math.floor(parentRect.height);
        if (canvas.width !== tw || canvas.height !== th) {
            canvas.width = tw;
            canvas.height = th;
        }
    }
    if (canvas.width < 50) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const padLeft = 52;
    const padTop = 34;
    const padBottom = 24;
    const zColWidth = 84;

    const chasisW = Math.max(180, w - padLeft - zColWidth - 20);
    const chasisH = Math.max(180, h - padTop - padBottom);
    const x0 = padLeft;
    const y0 = padTop;
    const x1 = x0 + chasisW;
    const y1 = y0 + chasisH;

    const minX = Math.min(0, estado.limite_max_x, Math.floor(anim.x));
    const minY = Math.min(0, estado.limite_max_y, Math.floor(anim.y));
    const maxX = Math.max(1200, Math.abs(estado.limite_max_x) * 1.04, Math.abs(Math.ceil(anim.x)) + 160);
    const maxY = Math.max(1000, Math.abs(estado.limite_max_y) * 1.04, Math.abs(Math.ceil(anim.y)) + 160);

    const rangoX = Math.max(100, maxX - minX);
    const rangoY = Math.max(100, maxY - minY);

    // 1. BASTIDOR BASE DEL CNC Y RIELES LINEALES FIJOS DEL EJE Y
    ctx.fillStyle = "#08090d";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(x0, y0, chasisW, chasisH);
    ctx.strokeRect(x0, y0, chasisH > 0 ? chasisW : 0, chasisH);

    const invY = estado.invertir_dir && estado.invertir_dir.Y;
    ctx.fillStyle = "#9ca3af";
    ctx.font = "600 10.5px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("ARQUITECTURA: PUENTE FIJO X + PLACA MOVIL Y", x0 + 4, y0 - 12);
    ctx.textAlign = "right";
    ctx.fillStyle = invY ? "#10b981" : "#f59e0b";
    ctx.fillText(
        `HOME (0,0) INF. IZQ. | ${invY ? "DIR Y: INVERTIDO (PLACA)" : "DIR Y: NORMAL"}`,
        x1 - 4,
        y0 - 12
    );

    // Recortar y aplicar zoom/pan UNICAMENTE dentro del recuadro de simulacion
    const invZ = 1 / Math.max(0.45, vistaSim.zoom);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 1, y0 + 1, chasisW - 2, chasisH - 2);
    ctx.clip();
    ctx.translate(w / 2 + vistaSim.panX, h / 2 + vistaSim.panY);
    ctx.scale(vistaSim.zoom, vistaSim.zoom);
    ctx.translate(-w / 2, -h / 2);

    // 2. GEOMETRIA ISOTROPICA 1:1 ADAPTADA AL TAMANO REAL DEL LIENZO
    // Aprovechamos hasta el 94% de la altura total de recorrido (2 * 0.47 * chasisH)
    // manteniendo una escala 1:1 exacta en X e Y segun el lienzo disponible.
    const margenLateralMax = 30;
    const maxPlacaW = Math.max(120, chasisW - margenLateralMax * 2);
    const maxPlacaH = Math.max(100, chasisH * 0.475);
    const pxPerPulse = Math.min(maxPlacaW / rangoX, maxPlacaH / rangoY);
    const placaW = Math.max(100, rangoX * pxPerPulse);
    const placaH = Math.max(80, rangoY * pxPerPulse);
    const placaX0 = x0 + (chasisW - placaW) / 2;
    const placaX1 = placaX0 + placaW;

    // Rieles lineales verticales y husillo central ajustados al ancho de la cama
    const rielIzqX = placaX0 + placaW * 0.18;
    const rielDerX = placaX0 + placaW * 0.82;
    const husilloX = placaX0 + placaW * 0.50;

    [rielIzqX, rielDerX].forEach(rx => {
        ctx.fillStyle = "#161922";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
        ctx.lineWidth = 1;
        ctx.fillRect(rx - 5, y0 + 8, 10, chasisH - 16);
        ctx.strokeRect(rx - 5, y0 + 8, 10, chasisH - 16);
    });

    // Husillo central Y con textura de rosca
    ctx.fillStyle = "#12151e";
    ctx.fillRect(husilloX - 4, y0 + 8, 8, chasisH - 16);
    ctx.strokeStyle = "rgba(16, 185, 129, 0.25)";
    ctx.lineWidth = 1;
    for (let sy = y0 + 12; sy < y1 - 12; sy += 6) {
        ctx.beginPath();
        ctx.moveTo(husilloX - 4, sy);
        ctx.lineTo(husilloX + 4, sy + 2);
        ctx.stroke();
    }

    // Posicion vertical fija del Puente X centrada para aprovechar todo el recorrido Y
    const puenteY = Math.round(y0 + chasisH * 0.50);

    // Fraccion de recorrido actual en Y (0 = Home inferior, 1 = Limite superior Y_max)
    const fracY = Math.max(-0.15, Math.min(1.15, (anim.y - minY) / rangoY));

    const placaBottomY = puenteY + fracY * placaH;
    const placaTopY = placaBottomY - placaH;

    // Conversion isotropica de coordenada logica (px, py) sobre la Placa Movil a pantalla:
    const aPlaca = (px, py) => {
        const sx = placaX0 + (px - minX) * pxPerPulse;
        const sy = placaBottomY - (py - minY) * pxPerPulse;
        return [sx, sy];
    };

    // Pernos de esquina del bastidor CNC de aluminio (escalados con invZ)
    [[x0 + 8 * invZ, y0 + 8 * invZ], [x1 - 8 * invZ, y0 + 8 * invZ], [x0 + 8 * invZ, y1 - 8 * invZ], [x1 - 8 * invZ, y1 - 8 * invZ]].forEach(([bx, by]) => {
        ctx.fillStyle = "#2d323e";
        ctx.beginPath();
        ctx.arc(bx, by, 3.5 * invZ, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#525866";
        ctx.lineWidth = Math.max(0.4, 1 * invZ);
        ctx.stroke();
    });

    // Recortar el dibujo de la Placa Móvil dentro del bastidor del CNC
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 + 2, y0 + 2, chasisW - 4, chasisH - 4);
    ctx.clip();

    // Rodamientos lineales de la Placa Móvil sobre los rieles Y (escalados con invZ)
    const rodW = 16 * invZ;
    const rodH = 20 * invZ;
    [rielIzqX, rielDerX].forEach(rx => {
        ctx.fillStyle = "#10b981";
        ctx.fillRect(rx - rodW / 2, placaTopY + 8 * invZ, rodW, rodH);
        ctx.fillRect(rx - rodW / 2, placaBottomY - 8 * invZ - rodH, rodW, rodH);
    });

    // Sombra y cuerpo de la Placa Movil Y (Cama metalica de aluminio)
    const esModoLaserSim = estado.modo_herramienta === "laser";
    ctx.fillStyle = "#181c24";
    ctx.strokeStyle = anim.ejeEnMovimiento === "Y" ? "#10b981" : "rgba(148, 163, 184, 0.55)";
    ctx.lineWidth = Math.max(0.6, (anim.ejeEnMovimiento === "Y" ? 2.2 : 1.5) * invZ);
    ctx.fillRect(placaX0, placaTopY, placaW, placaH);
    ctx.strokeRect(placaX0, placaTopY, placaW, placaH);

    // Ranuras T-Slot sutiles de la cama de aluminio
    ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
    ctx.lineWidth = Math.max(0.35, 1 * invZ);
    for (let ry = placaTopY + 14; ry < placaBottomY - 10; ry += 18) {
        ctx.beginPath();
        ctx.moveTo(placaX0 + 4, ry);
        ctx.lineTo(placaX1 - 4, ry);
        ctx.stroke();
    }

    const [ox, oy] = aPlaca(0, 0);

    // Material de trabajo sobre la placa: Papel blanco con pinzas (Dibujo) o Tablero MDF/Madera (Laser 5W)
    const [lxMat, lyMat] = estado.limite_fijado
        ? aPlaca(Math.abs(estado.limite_max_x), Math.abs(estado.limite_max_y))
        : [placaX1 - 12, placaTopY + 12];
    const matX = Math.min(ox, lxMat);
    const matY = Math.min(oy, lyMat);
    const matW = Math.max(40, Math.abs(lxMat - ox));
    const matH = Math.max(40, Math.abs(lyMat - oy));

    if (esModoLaserSim) {
        // Tablero de Madera / MDF para Laser 5W
        ctx.fillStyle = "#5c4028";
        ctx.fillRect(matX, matY, matW, matH);
        ctx.strokeStyle = "rgba(245, 158, 11, 0.65)";
        ctx.lineWidth = Math.max(0.5, 1.4 * invZ);
        ctx.strokeRect(matX, matY, matW, matH);
        // Veta sutil de madera
        ctx.strokeStyle = "rgba(38, 22, 10, 0.25)";
        ctx.lineWidth = Math.max(0.35, 1 * invZ);
        for (let vy = matY + 7; vy < matY + matH - 4; vy += 9) {
            ctx.beginPath();
            ctx.moveTo(matX + 2, vy);
            ctx.lineTo(matX + matW - 2, vy + ((vy % 18 === 0) ? 2 : -1));
            ctx.stroke();
        }
    } else {
        // Hoja de Papel blanca/marfil con sombra y pinzas metalicas en las esquinas
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        ctx.fillRect(matX + 3 * invZ, matY + 3 * invZ, matW, matH);
        ctx.fillStyle = "#eef2f6";
        ctx.fillRect(matX, matY, matW, matH);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
        ctx.lineWidth = Math.max(0.45, 1.2 * invZ);
        ctx.strokeRect(matX, matY, matW, matH);

        // Pinzas sujetadoras metalicas en las 4 esquinas del papel (escaladas con invZ)
        const pzW = 11 * invZ;
        const pzH = 7 * invZ;
        ctx.fillStyle = "#64748b";
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = Math.max(0.4, 1 * invZ);
        [
            [matX - 2 * invZ, matY - 2 * invZ],
            [matX + matW - pzW + 2 * invZ, matY - 2 * invZ],
            [matX - 2 * invZ, matY + matH - pzH + 2 * invZ],
            [matX + matW - pzW + 2 * invZ, matY + matH - pzH + 2 * invZ]
        ].forEach(([cxp, cyp]) => {
            ctx.fillRect(cxp, cyp, pzW, pzH);
            ctx.strokeRect(cxp, cyp, pzW, pzH);
        });
    }

    // Cuadricula milimetrica adaptativa segun el nivel de zoom aplicado
    const divs = vistaSim.zoom >= 3.2 ? 32 : (vistaSim.zoom >= 1.8 ? 16 : 8);
    for (let i = 1; i < divs; i++) {
        const gx = matX + (matW / divs) * i;
        const gy = (matY + matH) - (matH / divs) * i;

        ctx.strokeStyle = esModoLaserSim ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.07)";
        ctx.lineWidth = Math.max(0.25, 0.9 * invZ);
        ctx.beginPath();
        ctx.moveTo(gx, matY); ctx.lineTo(gx, matY + matH);
        ctx.moveTo(matX, gy); ctx.lineTo(matX + matW, gy);
        ctx.stroke();
    }

    // Etiqueta adherida a la Placa Movil Y (escalada proporcionalmente al zoom)
    ctx.fillStyle = esModoLaserSim ? "#fbbf24" : "#38bdf8";
    ctx.font = `600 ${(9.5 * invZ).toFixed(2)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "right";
    ctx.fillText(
        `${esModoLaserSim ? "MDF / MADERA LASER 5W" : "PAPEL DIBUJO"} [Y: ${Math.round(anim.y)} p]`,
        placaX1 - 6 * invZ,
        placaTopY + 12 * invZ
    );

    // Si hay figuras en el Estudio de Dibujo CNC, mostrarlas sobre el material
    const esc = Math.max(0.01, estado.pasos_por_mm);
    if (dibujo && Array.isArray(dibujo.figuras) && dibujo.figuras.length > 0) {
        ctx.save();
        ctx.strokeStyle = esModoLaserSim ? "rgba(251, 191, 36, 0.48)" : "rgba(37, 99, 235, 0.42)";
        ctx.lineWidth = Math.max(0.45, 1.4 * invZ);
        dibujo.figuras.forEach(fig => {
            trazosDeFigura(fig).forEach(pts => {
                if (!pts || pts.length < 2) return;
                ctx.beginPath();
                pts.forEach((pt, idx) => {
                    const [sx, sy] = aPlaca(pt[0] * esc, pt[1] * esc);
                    const esHueco = pt.length > 2 && pt[2] !== undefined && Number(pt[2]) <= 0.1;
                    if (idx === 0 || esHueco) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                });
                ctx.stroke();
            });
        });
        ctx.restore();
    }

    // Rastro ejecutado sobre el material (quemado oscuro en madera o tinta en papel)
    if (estado.historial && estado.historial.length > 0) {
        ctx.save();
        const pwmRatio = Math.max(0.25, ((estado.laser?.potencia_pct || 35) / 100));
        ctx.strokeStyle = esModoLaserSim
            ? `rgba(22, 12, 5, ${Math.min(0.95, 0.45 + pwmRatio * 0.5)})`
            : "#1d4ed8";
        ctx.lineWidth = Math.max(0.6, (esModoLaserSim ? (1.4 + pwmRatio * 1.4) : 2.0) * invZ);
        ctx.beginPath();
        estado.historial.forEach(([hx, hy], idx) => {
            const [sx, sy] = aPlaca(hx, hy);
            if (idx === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
        });
        const [ax, ay] = aPlaca(anim.x, anim.y);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.restore();
    }

    // Punto HOME (0,0) en la Esquina Inferior Izquierda de la Placa Movil Y
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(2.5, 5.5 * invZ), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#090a0d";
    ctx.lineWidth = Math.max(0.5, 1.5 * invZ);
    ctx.stroke();

    ctx.fillStyle = "#10b981";
    ctx.font = `600 ${(10 * invZ).toFixed(2)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "left";
    ctx.fillText("HOME (0,0) ESQ. INF. IZQ.", ox + 9 * invZ, oy - 7 * invZ);

    ctx.restore(); // Fin del clip de la Placa Móvil Y

    // 3. PUENTE FIJO EN EL EJE X AJUSTADO A LA CAMA Y AUTO-AJUSTADO AL ZOOM
    const puentePad = Math.max(8 * invZ, Math.min(20 * invZ, placaW * 0.045));
    const colW = Math.max(8 * invZ, Math.min(16 * invZ, placaW * 0.04));
    const colH = Math.max(24 * invZ, Math.min(44 * invZ, placaH * 0.16));
    const bridgeX0 = placaX0 - puentePad;
    const bridgeX1 = placaX1 + puentePad;
    const bridgeW = bridgeX1 - bridgeX0;

    // Eslabones / columnas laterales del puente acopladas a los bordes de la cama
    ctx.fillStyle = "#1e2230";
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = Math.max(0.6, 1.6 * invZ);
    ctx.fillRect(bridgeX0 - colW + 2 * invZ, puenteY - colH / 2, colW, colH);
    ctx.strokeRect(bridgeX0 - colW + 2 * invZ, puenteY - colH / 2, colW, colH);
    ctx.fillRect(bridgeX1 - 2 * invZ, puenteY - colH / 2, colW, colH);
    ctx.strokeRect(bridgeX1 - 2 * invZ, puenteY - colH / 2, colW, colH);

    // Vigas transversales del Puente Fijo X ajustadas a la cama y al zoom
    const vigaH = 20 * invZ;
    ctx.fillStyle = "rgba(23, 27, 38, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.lineWidth = Math.max(0.5, 1.4 * invZ);
    ctx.fillRect(bridgeX0, puenteY - vigaH / 2, bridgeW, vigaH);
    ctx.strokeRect(bridgeX0, puenteY - vigaH / 2, bridgeW, vigaH);

    // Rieles lineales horizontales dentro del Puente Fijo X
    ctx.strokeStyle = "rgba(6, 182, 212, 0.65)";
    ctx.lineWidth = Math.max(0.5, 1.3 * invZ);
    ctx.beginPath();
    ctx.moveTo(bridgeX0 + 2 * invZ, puenteY - 4.5 * invZ);
    ctx.lineTo(bridgeX1 - 2 * invZ, puenteY - 4.5 * invZ);
    ctx.moveTo(bridgeX0 + 2 * invZ, puenteY + 4.5 * invZ);
    ctx.lineTo(bridgeX1 - 2 * invZ, puenteY + 4.5 * invZ);
    ctx.stroke();

    ctx.fillStyle = "#06b6d4";
    ctx.font = `600 ${(9.5 * invZ).toFixed(2)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = "left";
    ctx.fillText("PUENTE FIJO EJE X", bridgeX0 + 4 * invZ, puenteY - (vigaH / 2 + 4 * invZ));

    // Microinterruptores físicos (Palanca de lámina y rodaja) en Límite Inferior Izquierdo (X=0, Y=0)
    const swXActivo = Math.round(anim.x) === 0;
    const swYActivo = Math.round(anim.y) === 0;

    // Microswitch X en el extremo izquierdo del Puente Fijo X
    ctx.fillStyle = swXActivo ? "#10b981" : "#1f2433";
    ctx.strokeStyle = swXActivo ? "#34d399" : "#6b7280";
    ctx.lineWidth = Math.max(0.5, 1.3 * invZ);
    ctx.fillRect(placaX0 - 16 * invZ, puenteY - 7 * invZ, 11 * invZ, 14 * invZ);
    ctx.strokeRect(placaX0 - 16 * invZ, puenteY - 7 * invZ, 11 * invZ, 14 * invZ);
    ctx.beginPath();
    ctx.arc(placaX0 - 3.5 * invZ, puenteY, 3 * invZ, 0, Math.PI * 2);
    ctx.fill();

    // Microswitch Y en el tope inferior izquierdo de referencia del bastidor Y
    ctx.fillStyle = swYActivo ? "#10b981" : "#1f2433";
    ctx.strokeStyle = swYActivo ? "#34d399" : "#6b7280";
    ctx.fillRect(placaX0 - 5 * invZ, puenteY + 14 * invZ, 14 * invZ, 9 * invZ);
    ctx.strokeRect(placaX0 - 5 * invZ, puenteY + 14 * invZ, 14 * invZ, 9 * invZ);
    ctx.beginPath();
    ctx.arc(placaX0 + 2 * invZ, puenteY + 12 * invZ, 3 * invZ, 0, Math.PI * 2);
    ctx.fill();

    // Posición horizontal del Carro X sobre el Puente Fijo X (cy es siempre puenteY)
    const [cx] = aPlaca(anim.x, anim.y);
    const cy = puenteY;
    const laserSimVivo = Boolean((estado.laser && estado.laser.emitiendo) || anim.laserActivoEnTrazo);
    const pwmVivoSim = anim.laserActivoEnTrazo ? (anim.laserPwmEnTrazo || 128) : (estado.laser?.pwm_actual || 0);

    // Carro lineal con 4 rodamientos sobre el Puente Fijo X (auto-ajustado al zoom)
    const carHalf = 15 * invZ;
    ctx.fillStyle = "#1f2430";
    ctx.strokeStyle = estado.microstep === "NC" ? "#f43f5e" : "#94a3b8";
    ctx.lineWidth = Math.max(0.5, 1.5 * invZ);
    ctx.fillRect(cx - carHalf, cy - carHalf, carHalf * 2, carHalf * 2);
    ctx.strokeRect(cx - carHalf, cy - carHalf, carHalf * 2, carHalf * 2);
    ctx.fillStyle = "#64748b";
    const rSize = 3.5 * invZ;
    const rOff = 12 * invZ;
    [[-rOff, -rOff], [rOff - rSize, -rOff], [-rOff, rOff - rSize], [rOff - rSize, rOff - rSize]].forEach(([oxr, oyr]) => {
        ctx.fillRect(cx + oxr, cy + oyr, rSize, rSize);
    });

    if (esModoLaserSim) {
        // CABEZAL MODULO LASER 5W (Auto-ajustado al zoom)
        ctx.fillStyle = "#0f172a";
        ctx.strokeStyle = "#38bdf8";
        ctx.lineWidth = Math.max(0.5, 1.4 * invZ);
        ctx.fillRect(cx - 10 * invZ, cy - 12 * invZ, 20 * invZ, 22 * invZ);
        ctx.strokeRect(cx - 10 * invZ, cy - 12 * invZ, 20 * invZ, 22 * invZ);
        // Aletas de disipacion
        ctx.strokeStyle = "rgba(56, 189, 248, 0.5)";
        ctx.lineWidth = Math.max(0.35, 0.9 * invZ);
        for (let f = -6; f <= 6; f += 3) {
            const fx = cx + f * invZ;
            ctx.beginPath(); ctx.moveTo(fx, cy - 10 * invZ); ctx.lineTo(fx, cy + 4 * invZ); ctx.stroke();
        }
        // Ventilador superior girando si armado/emitiendo
        const fanAng = (estado.laser?.armado || laserSimVivo) ? (performance.now() * 0.015) : 0;
        ctx.save();
        ctx.translate(cx, cy - 3 * invZ);
        ctx.rotate(fanAng);
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = Math.max(0.45, 1.2 * invZ);
        ctx.beginPath();
        ctx.moveTo(-4.5 * invZ, 0); ctx.lineTo(4.5 * invZ, 0);
        ctx.moveTo(0, -4.5 * invZ); ctx.lineTo(0, 4.5 * invZ);
        ctx.stroke();
        ctx.restore();

        // Cono optico y destello focal en el material
        if (laserSimVivo) {
            const pNorm = Math.max(0.2, pwmVivoSim / 255);
            ctx.save();
            const conoGrad = ctx.createLinearGradient(cx, cy + 10 * invZ, cx, cy);
            conoGrad.addColorStop(0, `rgba(56, 189, 248, ${0.45 * pNorm})`);
            conoGrad.addColorStop(1, "rgba(167, 139, 250, 0.92)");
            ctx.fillStyle = conoGrad;
            ctx.beginPath();
            ctx.moveTo(cx - 4.5 * invZ, cy + 10 * invZ);
            ctx.lineTo(cx + 4.5 * invZ, cy + 10 * invZ);
            ctx.lineTo(cx + 1.2 * invZ, cy);
            ctx.lineTo(cx - 1.2 * invZ, cy);
            ctx.closePath();
            ctx.fill();

            // Destello focal
            const rHalo = (10 + pNorm * 12) * invZ;
            const gradSim = ctx.createRadialGradient(cx, cy, 0.5 * invZ, cx, cy, rHalo);
            gradSim.addColorStop(0, "rgba(255, 255, 255, 0.98)");
            gradSim.addColorStop(0.25, "rgba(56, 189, 248, 0.92)");
            gradSim.addColorStop(0.65, "rgba(245, 158, 11, 0.45)");
            gradSim.addColorStop(1, "rgba(245, 158, 11, 0.0)");
            ctx.fillStyle = gradSim;
            ctx.beginPath();
            ctx.arc(cx, cy, rHalo, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = laserSimVivo ? "#ffffff" : "#38bdf8";
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, 3 * invZ), 0, Math.PI * 2); ctx.fill();
    } else {
        // CABEZAL PORTA-PLUMON / LAPIZ (Auto-ajustado al zoom)
        const zHomeRefP = estado.z_home_pulsos !== undefined ? estado.z_home_pulsos : 0;
        const zPapelRefP = estado.limite_max_z !== undefined && estado.limite_max_z !== zHomeRefP ? estado.limite_max_z : 400;
        const zSpan = Math.max(1, Math.abs(zPapelRefP - zHomeRefP));
        const zFrac = Math.max(0, Math.min(1, Math.abs(anim.z - zHomeRefP) / zSpan));
        const offsetElev = (1 - zFrac) * 5.5 * invZ;

        // Sombra sobre el papel cuando la pluma esta levantada
        ctx.fillStyle = `rgba(15, 23, 42, ${0.28 * (1 - zFrac * 0.5)})`;
        ctx.beginPath();
        ctx.ellipse(cx + offsetElev + 2 * invZ, cy + offsetElev + 2 * invZ, 6.5 * invZ, 4.5 * invZ, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cuerpo del porta-plumon y punta
        ctx.fillStyle = "#1e293b";
        ctx.strokeStyle = zFrac > 0.85 ? "#10b981" : "#38bdf8";
        ctx.lineWidth = Math.max(0.5, 1.5 * invZ);
        ctx.beginPath();
        ctx.arc(cx, cy - offsetElev, 9 * invZ, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = zFrac > 0.85 ? "#1d4ed8" : "#38bdf8";
        ctx.beginPath();
        ctx.arc(cx, cy - offsetElev, 4 * invZ, 0, Math.PI * 2);
        ctx.fill();
    }

    // Etiqueta flotante de coordenadas sobre el cabezal (auto-ajustada al zoom)
    const tagTxt = `X:${(anim.x / esc).toFixed(1)} | Y:${(anim.y / esc).toFixed(1)} mm`;
    ctx.font = `600 ${(10.5 * invZ).toFixed(2)}px 'JetBrains Mono', monospace`;
    const tw = ctx.measureText(tagTxt).width + 12 * invZ;
    const th = 18 * invZ;
    const ty = cy - 22 * invZ - th;
    ctx.fillStyle = "rgba(17, 18, 22, 0.94)";
    ctx.strokeStyle = "rgba(6, 182, 212, 0.5)";
    ctx.lineWidth = Math.max(0.5, 1 * invZ);
    ctx.fillRect(cx - tw / 2, ty, tw, th);
    ctx.strokeRect(cx - tw / 2, ty, tw, th);

    ctx.fillStyle = "#f3f4f6";
    ctx.textAlign = "center";
    ctx.fillText(tagTxt, cx, ty + th * 0.7);

    ctx.restore(); // Fin de zoom/pan y recorte del recuadro de simulacion

    // 4. COLUMNA LATERAL DEL EJE Z (FIJA, SIN ZOOM NI DESPLAZAMIENTO)
    const zx0 = x1 + 26;
    const zw = 48;
    ctx.fillStyle = "#0d0e13";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(zx0, y0, zw, chasisH);
    ctx.strokeRect(zx0, y0, zw, chasisH);

    ctx.fillStyle = "#9ca3af";
    ctx.font = "600 10.5px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("EJE Z", zx0 + zw / 2, y0 - 10);

    const zHomeRef = estado.z_home_pulsos !== undefined ? estado.z_home_pulsos : 0;
    const zPapelRef = estado.limite_max_z !== undefined && estado.limite_max_z !== zHomeRef ? estado.limite_max_z : 400;
    const swZActivo = Math.round(anim.z) === zHomeRef;

    // Referencia Manual Superior del Eje Z (Home Z = 0, sin microswitch fisico)
    const zyTop = y0 + 18;
    ctx.save();
    ctx.strokeStyle = swZActivo ? "#10b981" : "#06b6d4";
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(zx0 + 4, zyTop);
    ctx.lineTo(zx0 + zw - 4, zyTop);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = swZActivo ? "#10b981" : "#06b6d4";
    ctx.font = "600 8.5px 'JetBrains Mono', monospace";
    ctx.fillText("HOME Z", zx0 + zw / 2, y0 + 12);

    // Línea inferior de Contacto Lápiz/Plumón con Papel (Máximo Z)
    const zyBottom = y1 - 18;
    ctx.save();
    ctx.strokeStyle = "#f59e0b";
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(zx0 + 4, zyBottom);
    ctx.lineTo(zx0 + zw - 4, zyBottom);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#f59e0b";
    ctx.font = "600 8.5px 'JetBrains Mono', monospace";
    ctx.fillText("PAPEL", zx0 + zw / 2, y1 - 5);

    // Mapeo visual de Z entre Home Superior (zyTop + 14) y Contacto Papel Inferior (zyBottom - 12)
    const spanZ = Math.max(1, Math.abs(zPapelRef - zHomeRef));
    const avanceHaciaPapel = Math.abs(anim.z - zHomeRef) / spanZ;
    const zFrac = Math.max(0, Math.min(1, avanceHaciaPapel));
    const zyMin = zyTop + 14;
    const zyMax = zyBottom - 12;
    const zyPos = zyMin + zFrac * Math.max(10, zyMax - zyMin);

    ctx.fillStyle = swZActivo ? "#10b981" : "#6366f1";
    ctx.strokeStyle = "#e0e7ff";
    ctx.lineWidth = 1.5;
    ctx.fillRect(zx0 + 5, zyPos - 10, zw - 10, 20);
    ctx.strokeRect(zx0 + 5, zyPos - 10, zw - 10, 20);

    ctx.fillStyle = "#ffffff";
    ctx.font = "600 10px 'JetBrains Mono', monospace";
    ctx.fillText(`${Math.round(anim.z)}`, zx0 + zw / 2, zyPos + 3);
}

// ==========================================================================
// 2. DIALES VECTORIALES DE ACTUADORES NEMA CON ESTADO ENA
// ==========================================================================
function dibujarMotorNema(canvasId, anguloGrados, colorAcento, bobinaEnergizada) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#15171e";
    ctx.strokeStyle = bobinaEnergizada ? "#fbbf24" : "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = bobinaEnergizada ? 2 : 1.5;
    ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.strokeRect(6, 6, w - 12, h - 12);

    const pts = [[14, 14], [w - 14, 14], [14, h - 14], [w - 14, h - 14]];
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    pts.forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    const colorFinal = estado.microstep === "NC" ? "#f43f5e" : colorAcento;

    ctx.fillStyle = "#090a0d";
    ctx.strokeStyle = colorFinal;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(cx, cy, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const rad = (anguloGrados * Math.PI) / 180;
    const rx = cx + Math.cos(rad) * 17;
    const ry = cy + Math.sin(rad) * 17;

    ctx.strokeStyle = colorFinal;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.fillStyle = bobinaEnergizada ? "#fbbf24" : "#f3f4f6";
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
}

function dibujarActuadorLaser5W(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    const ls = estado.laser || {};
    const armado = Boolean(ls.armado);
    const emitiendo = Boolean(ls.emitiendo) || anim.laserActivoEnTrazo;
    const pwmVivo = anim.laserActivoEnTrazo ? anim.laserPwmEnTrazo : (ls.pwm_actual || 0);
    const manPct = Number(ls.potencia_manual_pct ?? 25);
    const fracMan = Math.max(0, Math.min(1, manPct / 100.0));

    ctx.clearRect(0, 0, w, h);

    // Chasis de aluminio con aletas disipadoras del modulo laser 5W (12V)
    ctx.fillStyle = "#15171e";
    ctx.strokeStyle = emitiendo ? "#f43f5e" : (armado ? "#fbbf24" : "rgba(255, 255, 255, 0.16)");
    ctx.lineWidth = emitiendo ? 2.2 : 1.5;
    ctx.fillRect(6, 6, w - 12, h - 12);
    ctx.strokeRect(6, 6, w - 12, h - 12);

    // Aletas disipadoras horizontales sutiles
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let yFin = 12; yFin <= h - 12; yFin += 8) {
        ctx.beginPath();
        ctx.moveTo(9, yFin);
        ctx.lineTo(w - 9, yFin);
        ctx.stroke();
    }

    // Lente colimadora central
    ctx.fillStyle = "#090a0d";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Arco de ciclo util PWM preseleccionado
    ctx.strokeStyle = emitiendo ? "#38bdf8" : "#f59e0b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 21, -Math.PI / 2, -Math.PI / 2 + fracMan * Math.PI * 2);
    ctx.stroke();

    // Haz optico central (450nm azul/violeta brillante al emitir)
    if (emitiendo && pwmVivo > 0) {
        const radioHalo = 8 + (pwmVivo / 255.0) * 11;
        const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, radioHalo);
        grad.addColorStop(0, "#e0f2fe");
        grad.addColorStop(0.45, "#38bdf8");
        grad.addColorStop(1, "rgba(244, 63, 94, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radioHalo, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.fillStyle = armado ? "#fbbf24" : "#4b5563";
        ctx.beginPath();
        ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ==========================================================================
// 3. PLANO TÉCNICO CAD DEL ESPACIO DE TRABAJO FINAL
// ==========================================================================
function dibujarBlueprint() {
    const canvas = document.getElementById("canvas-blueprint");
    if (!canvas || canvas.width < 50) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = "#090b10";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    const pRev = estado.pulse_rev || 3200;
    const limX = estado.limite_fijado && estado.limite_max_x !== 0 ? Math.abs(estado.limite_max_x) : Math.max(Math.abs(estado.pos_x), pRev * 3);
    const limY = estado.limite_fijado && estado.limite_max_y !== 0 ? Math.abs(estado.limite_max_y) : Math.max(Math.abs(estado.pos_y), pRev * 2);
    const limZ = estado.limite_fijado ? Math.abs(estado.limite_max_z) : Math.abs(estado.pos_z);
    const esc = Math.max(0.01, estado.pasos_por_mm);

    const anchoMM = limX / esc;
    const altoMM = limY / esc;
    const zMM = limZ / esc;

    const maxDrawW = w - 370;
    const maxDrawH = h - 140;
    const scale = Math.min(maxDrawW / limX, maxDrawH / limY) * 0.85;

    const rectW = Math.max(200, limX * scale);
    const rectH = Math.max(150, limY * scale);

    const rx0 = 100;
    const ry0 = (h - rectH) / 2 - 10;
    const rx1 = rx0 + rectW;
    const ry1 = ry0 + rectH;

    ctx.fillStyle = "rgba(6, 182, 212, 0.05)";
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;
    ctx.fillRect(rx0, ry0, rectW, rectH);
    ctx.strokeRect(rx0, ry0, rectW, rectH);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
        const gx = rx0 + (rectW / 10) * i;
        const gy = ry0 + (rectH / 10) * i;
        ctx.beginPath();
        ctx.moveTo(gx, ry0); ctx.lineTo(gx, ry1);
        ctx.moveTo(rx0, gy); ctx.lineTo(rx1, gy);
        ctx.stroke();
    }

    const mx = rectW * 0.05;
    const my = rectH * 0.05;
    ctx.save();
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx0 + mx, ry0 + my, rectW - 2 * mx, rectH - 2 * my);
    ctx.restore();

    ctx.fillStyle = "#10b981";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText(
        `ZONA OPERATIVA SEGURA (90%): ${(anchoMM * 0.9).toFixed(1)} x ${(altoMM * 0.9).toFixed(1)} mm`,
        rx0 + mx + 10,
        ry0 + my + 18
    );

    const cx = (rx0 + rx1) / 2;
    const cy = (ry0 + ry1) / 2;
    const tipoMuestra = document.getElementById("select-pieza-prueba")?.value || "all";

    if (tipoMuestra === "all" || tipoMuestra === "rect") {
        const pw = rectW * 0.46;
        const ph = rectH * 0.46;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx - pw / 2, cy - ph / 2, pw, ph);

        const holeOff = 12;
        [
            [cx - pw / 2 + holeOff, cy - ph / 2 + holeOff],
            [cx + pw / 2 - holeOff, cy - ph / 2 + holeOff],
            [cx - pw / 2 + holeOff, cy + ph / 2 - holeOff],
            [cx + pw / 2 - holeOff, cy + ph / 2 - holeOff]
        ].forEach(([hx, hy]) => {
            ctx.beginPath();
            ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            ctx.stroke();
        });
    }

    if (tipoMuestra === "all" || tipoMuestra === "circle") {
        const rad = Math.min(rectW, rectH) * 0.18;
        ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Si hay figuras creadas en el Estudio de Dibujo, mostrarlas en el Plano CAD
    if ((tipoMuestra === "all" || tipoMuestra === "drawing") && dibujo.figuras.length > 0) {
        ctx.save();
        ctx.strokeStyle = "#06b6d4";
        ctx.lineWidth = 2;
        dibujo.figuras.forEach(fig => {
            trazosDeFigura(fig).forEach(pts => {
                ctx.beginPath();
                pts.forEach(([px, py], i) => {
                    const sx = rx0 + (px / anchoMM) * rectW;
                    const sy = ry1 - (py / altoMM) * rectH;
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                });
                ctx.stroke();
            });
        });
        ctx.restore();
    }

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy);
    ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12);
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(
        `CENTRO (${(anchoMM / 2).toFixed(1)}, ${(altoMM / 2).toFixed(1)} mm)`,
        cx,
        cy + 24
    );

    ctx.fillStyle = "#10b981";
    ctx.beginPath(); ctx.arc(rx0, ry1, 6, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = "left";
    ctx.fillText("HOME (0, 0)", rx0 + 10, ry1 - 10);

    ctx.fillStyle = "#f59e0b";
    ctx.beginPath(); ctx.arc(rx1, ry0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = "right";
    ctx.fillText(`MAX (${limX}, ${limY})`, rx1 - 8, ry0 - 10);

    dibujarCota(
        ctx, rx0, ry1 + 38, rx1, ry1 + 38,
        `X: ${anchoMM.toFixed(2)} mm (${limX} pulsos)`
    );

    dibujarCotaVertical(
        ctx, rx0 - 38, ry0, ry1,
        `Y: ${altoMM.toFixed(2)} mm (${limY} pulsos)`
    );

    const bx = w - 255;
    const by = 28;
    const bw = 220;
    const bh = h - 56;

    ctx.fillStyle = "#111216";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);

    const sw = estado.switches || {};
    const sw13 = `S1:${sw.S1 ? 'ON' : 'OFF'} S2:${sw.S2 ? 'ON' : 'OFF'} S3:${sw.S3 ? 'ON' : 'OFF'}`;
    const sw46 = `S4:${sw.S4 ? 'ON' : 'OFF'} S5:${sw.S5 ? 'ON' : 'OFF'} S6:${sw.S6 ? 'ON' : 'OFF'}`;
    const modoEna = (estado.ena && estado.ena.modo) || "AUTO";

    const filas = [
        { t: "ESPECIFICACION DE ESTACION", c: "#f3f4f6", f: "600 11.5px Inter, sans-serif" },
        { t: estado.limite_fijado ? "[CALIBRACION VALIDADA]" : "[SIMULACION PRELIMINAR]", c: estado.limite_fijado ? "#10b981" : "#f59e0b", f: "600 10.5px 'JetBrains Mono'" },
        { t: "-------------------------", c: "#262934", f: "10px 'JetBrains Mono'" },
        { t: `PERFIL: ${estado.perfil_activo}`, c: "#06b6d4", f: "600 10px 'JetBrains Mono'" },
        { t: sw13, c: "#06b6d4", f: "10.5px 'JetBrains Mono'" },
        { t: `Microstep: ${estado.microstep} (${estado.pulse_rev} P/rev)`, c: "#e5e7eb", f: "10.5px 'JetBrains Mono'" },
        { t: sw46, c: "#10b981", f: "10.5px 'JetBrains Mono'" },
        { t: `Giro: ${estado.current_a}A | Modo ENA: ${modoEna}`, c: "#e5e7eb", f: "10.5px 'JetBrains Mono'" },
        { t: "-------------------------", c: "#262934", f: "10px 'JetBrains Mono'" },
        { t: "RECORRIDO EN PULSOS:", c: "#9ca3af", f: "600 10.5px 'JetBrains Mono'" },
        { t: `Eje X : ${limX} pulsos`, c: "#06b6d4", f: "600 11px 'JetBrains Mono'" },
        { t: `Eje Y : ${limY} pulsos`, c: "#10b981", f: "600 11px 'JetBrains Mono'" },
        { t: `Eje Z : ${limZ} pulsos`, c: "#818cf8", f: "600 11px 'JetBrains Mono'" },
        { t: "-------------------------", c: "#262934", f: "10px 'JetBrains Mono'" },
        { t: "COTAS GEOMETRICAS (MM):", c: "#9ca3af", f: "600 10.5px 'JetBrains Mono'" },
        { t: `Ancho X : ${anchoMM.toFixed(2)} mm`, c: "#f3f4f6", f: "11px 'JetBrains Mono'" },
        { t: `Fondo Y : ${altoMM.toFixed(2)} mm`, c: "#f3f4f6", f: "11px 'JetBrains Mono'" },
        { t: `Altura Z: ${zMM.toFixed(2)} mm`, c: "#f3f4f6", f: "11px 'JetBrains Mono'" },
        { t: `Area    : ${((anchoMM * altoMM) / 100).toFixed(2)} cm2`, c: "#fbbf24", f: "600 11.5px 'JetBrains Mono'" }
    ];

    ctx.textAlign = "left";
    let ty = by + 26;
    filas.forEach(item => {
        ctx.fillStyle = item.c;
        ctx.font = item.f;
        ctx.fillText(item.t, bx + 14, ty);
        ty += 22;
    });
}

function dibujarCota(ctx, x0, y, x1, _y, texto) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(x0, y - 28); ctx.lineTo(x0, y + 6);
    ctx.moveTo(x1, y - 28); ctx.lineTo(x1, y + 6);
    ctx.moveTo(x0, y); ctx.lineTo(x1, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x0 + 7, y - 3.5); ctx.lineTo(x0 + 7, y + 3.5); ctx.closePath();
    ctx.moveTo(x1, y); ctx.lineTo(x1 - 7, y - 3.5); ctx.lineTo(x1 - 7, y + 3.5); ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#f3f4f6";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(texto, (x0 + x1) / 2, y - 8);
}

function dibujarCotaVertical(ctx, x, y0, y1, texto) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(x - 6, y0); ctx.lineTo(x + 28, y0);
    ctx.moveTo(x - 6, y1); ctx.lineTo(x + 28, y1);
    ctx.moveTo(x, y0); ctx.lineTo(x, y1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, y0); ctx.lineTo(x - 3.5, y0 + 7); ctx.lineTo(x + 3.5, y0 + 7); ctx.closePath();
    ctx.moveTo(x, y1); ctx.lineTo(x - 3.5, y1 - 7); ctx.lineTo(x + 3.5, y1 - 7); ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(x - 12, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#f3f4f6";
    ctx.font = "600 11px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(texto, 0, 0);
    ctx.restore();
}

function descargarPlanoPNG() {
    dibujarBlueprint();
    const canvas = document.getElementById("canvas-blueprint");
    const enlace = document.createElement("a");
    enlace.download = "especificacion_estacion_cnc.png";
    enlace.href = canvas.toDataURL("image/png");
    enlace.click();
}


// ==========================================================================
// ESTUDIO DE DIBUJO: GEOMETRIA, SELECCION Y TRANSFORMACION (MOVER / ESCALAR)
// ==========================================================================
function trazosDeFigura(fig) {
    if (!fig) return [];
    if (Array.isArray(fig.trazos)) return fig.trazos.filter(t => Array.isArray(t) && t.length >= 2);
    if (Array.isArray(fig.puntosMM) && fig.puntosMM.length >= 2) return [fig.puntosMM];
    return [];
}

function cajaDeTrazos(trazos) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    trazos.forEach(t => t.forEach(([x, y]) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }));
    if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function figuraFueraDeZona(fig) {
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const c = cajaDeTrazos(trazosDeFigura(fig));
    const tol = 0.01;
    return c.x < -tol || c.y < -tol || c.x + c.w > anchoMM + tol || c.y + c.h > altoMM + tol;
}

function figuraSeleccionada() {
    if (!dibujo.seleccion || dibujo.seleccion.tipo !== "figura") return null;
    return dibujo.figuras.find(f => f.id === dibujo.seleccion.id) || null;
}

function cajaDeSeleccion() {
    if (!dibujo.seleccion) return null;
    if (dibujo.seleccion.tipo === "imagen") {
        return dibujo.imagen ? { ...dibujo.imagen.rect } : null;
    }
    const fig = figuraSeleccionada();
    return fig ? cajaDeTrazos(trazosDeFigura(fig)) : null;
}

function aCanvasDibujo(xmm, ymm) {
    const g = dibujo.geometria;
    return [
        g.x0 + (xmm / Math.max(0.001, g.anchoMM)) * g.w,
        g.y0 + g.h - (ymm / Math.max(0.001, g.altoMM)) * g.h
    ];
}

function canvasDesdeEvento(e) {
    const canvas = document.getElementById("canvas-drawing");
    const rect = canvas.getBoundingClientRect();
    return {
        x: (e.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)),
        y: (e.clientY - rect.top) * (canvas.height / Math.max(1, rect.height))
    };
}

function mmDesdeCanvasLibre(c) {
    const g = dibujo.geometria;
    return {
        x: ((c.x - g.x0) / Math.max(1, g.w)) * g.anchoMM,
        y: ((g.y0 + g.h - c.y) / Math.max(1, g.h)) * g.altoMM
    };
}

function obtenerManijasCanvas(caja) {
    const esquinas = [
        { nombre: "sw", x: caja.x, y: caja.y, ancla: [caja.x + caja.w, caja.y + caja.h] },
        { nombre: "se", x: caja.x + caja.w, y: caja.y, ancla: [caja.x, caja.y + caja.h] },
        { nombre: "nw", x: caja.x, y: caja.y + caja.h, ancla: [caja.x + caja.w, caja.y] },
        { nombre: "ne", x: caja.x + caja.w, y: caja.y + caja.h, ancla: [caja.x, caja.y] }
    ];
    return esquinas.map(m => {
        const [cx, cy] = aCanvasDibujo(m.x, m.y);
        // Desplazar la manija 4 px hacia fuera para coincidir con el recuadro dibujado
        const ox = m.nombre.includes("w") ? -4 : 4;
        const oy = m.nombre.includes("n") ? -4 : 4;
        return { nombre: m.nombre, x: cx + ox, y: cy + oy, ancla: m.ancla };
    });
}

function distanciaPuntoSegmento(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const L2 = vx * vx + vy * vy;
    let t = L2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

function buscarFiguraEnPunto(mm, tolMM) {
    for (let i = dibujo.figuras.length - 1; i >= 0; i--) {
        const fig = dibujo.figuras[i];
        const trazos = trazosDeFigura(fig);
        const c = cajaDeTrazos(trazos);
        if (mm.x < c.x - tolMM || mm.x > c.x + c.w + tolMM || mm.y < c.y - tolMM || mm.y > c.y + c.h + tolMM) continue;
        // Figuras de imagen (muchos trazos): basta con hacer clic dentro de su caja
        if (fig.tipo === "imagen") return fig;
        for (const t of trazos) {
            for (let j = 1; j < t.length; j++) {
                if (distanciaPuntoSegmento(mm.x, mm.y, t[j - 1][0], t[j - 1][1], t[j][0], t[j][1]) <= tolMM) return fig;
            }
        }
    }
    return null;
}

function copiaOriginalSeleccion() {
    if (!dibujo.seleccion) return null;
    if (dibujo.seleccion.tipo === "imagen") return dibujo.imagen ? { ...dibujo.imagen.rect } : null;
    const fig = figuraSeleccionada();
    return fig ? trazosDeFigura(fig).map(t => t.map(p => (p.length > 2 ? [p[0], p[1], p[2]] : [p[0], p[1]]))) : null;
}

// Mapea la seleccion desde su caja original hacia una nueva caja (mover / escalar)
function aplicarCajaASeleccion(original, cajaOrig, nueva) {
    if (!dibujo.seleccion || !original) return;
    if (dibujo.seleccion.tipo === "imagen") {
        if (dibujo.imagen) dibujo.imagen.rect = { x: nueva.x, y: nueva.y, w: Math.max(0.5, nueva.w), h: Math.max(0.5, nueva.h) };
        return;
    }
    const fig = figuraSeleccionada();
    if (!fig) return;
    const sx = cajaOrig.w > 1e-6 ? nueva.w / cajaOrig.w : 1;
    const sy = cajaOrig.h > 1e-6 ? nueva.h / cajaOrig.h : 1;
    fig.trazos = original.map(t => t.map(pt => {
        const nx = Number((nueva.x + (pt[0] - cajaOrig.x) * sx).toFixed(3));
        const ny = Number((nueva.y + (pt[1] - cajaOrig.y) * sy).toFixed(3));
        return pt.length > 2 ? [nx, ny, pt[2]] : [nx, ny];
    }));
    delete fig.puntosMM;
}

function seleccionarFiguraPorId(id) {
    if (dibujo.ejecutando) return;
    dibujo.seleccion = { tipo: "figura", id };
    if (dibujo.herramienta !== "select") seleccionarHerramientaDibujo("select");
    renderizarListaFigurasDibujo();
    actualizarPanelSeleccion();
}

function seleccionarImagenDeFondo() {
    if (!dibujo.imagen) return;
    dibujo.seleccion = { tipo: "imagen" };
    if (dibujo.herramienta !== "select") seleccionarHerramientaDibujo("select");
    renderizarListaFigurasDibujo();
    actualizarPanelSeleccion();
}

function iniciarArrastreSeleccion(e) {
    const c = canvasDesdeEvento(e);
    const mm = mmDesdeCanvasLibre(c);
    const g = dibujo.geometria;
    const tolMM = 7 / Math.max(0.0001, g.w / g.anchoMM);
    const cajaActual = cajaDeSeleccion();

    // 1. Manijas de escala de la seleccion actual
    if (cajaActual) {
        const manija = obtenerManijasCanvas(cajaActual).find(m => Math.abs(c.x - m.x) <= 8 && Math.abs(c.y - m.y) <= 8);
        if (manija) {
            dibujo.arrastre = { modo: "escalar", ancla: manija.ancla, cajaInicial: cajaActual, original: copiaOriginalSeleccion() };
            return;
        }
    }

    // 2. Figura bajo el cursor
    const fig = buscarFiguraEnPunto(mm, tolMM);
    if (fig) {
        dibujo.seleccion = { tipo: "figura", id: fig.id };
    } else if (cajaActual && mm.x >= cajaActual.x && mm.x <= cajaActual.x + cajaActual.w && mm.y >= cajaActual.y && mm.y <= cajaActual.y + cajaActual.h) {
        // Mantener la seleccion actual al hacer clic dentro de su caja
    } else if (dibujo.imagen && dibujo.imagen.visible) {
        const r = dibujo.imagen.rect;
        if (mm.x >= r.x && mm.x <= r.x + r.w && mm.y >= r.y && mm.y <= r.y + r.h) {
            dibujo.seleccion = { tipo: "imagen" };
        } else {
            dibujo.seleccion = null;
        }
    } else {
        dibujo.seleccion = null;
    }

    renderizarListaFigurasDibujo();
    actualizarPanelSeleccion();
    const caja = cajaDeSeleccion();
    if (caja) {
        dibujo.arrastre = { modo: "mover", inicioMM: mm, cajaInicial: caja, original: copiaOriginalSeleccion() };
    }
}

function moverArrastreSeleccion(e) {
    const canvas = document.getElementById("canvas-drawing");
    const c = canvasDesdeEvento(e);
    const mm = mmDesdeCanvasLibre(c);
    const a = dibujo.arrastre;

    if (!a) {
        if (vistaDibujo.espacio) return;
        // Cursor contextual
        const caja = cajaDeSeleccion();
        let cursor = "default";
        if (caja) {
            const m = obtenerManijasCanvas(caja).find(h => Math.abs(c.x - h.x) <= 8 && Math.abs(c.y - h.y) <= 8);
            if (m) cursor = (m.nombre === "nw" || m.nombre === "se") ? "nwse-resize" : "nesw-resize";
            else if (mm.x >= caja.x && mm.x <= caja.x + caja.w && mm.y >= caja.y && mm.y <= caja.y + caja.h) cursor = "move";
        }
        if (canvas) canvas.style.cursor = cursor;
        return;
    }

    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const ci = a.cajaInicial;
    const snapActivo = document.getElementById("chk-draw-snap")?.checked;
    const pasoSnap = parseFloat(document.getElementById("select-draw-snap-mm")?.value || "1");

    if (a.modo === "mover") {
        let nx = ci.x + (mm.x - a.inicioMM.x);
        let ny = ci.y + (mm.y - a.inicioMM.y);
        if (snapActivo && pasoSnap > 0) {
            nx = Math.round(nx / pasoSnap) * pasoSnap;
            ny = Math.round(ny / pasoSnap) * pasoSnap;
        }
        // Mantener dentro de la zona calibrada cuando la seleccion cabe en ella
        if (ci.w <= anchoMM) nx = Math.max(0, Math.min(anchoMM - ci.w, nx));
        if (ci.h <= altoMM) ny = Math.max(0, Math.min(altoMM - ci.h, ny));
        aplicarCajaASeleccion(a.original, ci, { x: nx, y: ny, w: ci.w, h: ci.h });
    } else if (a.modo === "escalar") {
        const [ax, ay] = a.ancla;
        let px = Math.max(0, Math.min(anchoMM, mm.x));
        let py = Math.max(0, Math.min(altoMM, mm.y));
        let nw = Math.abs(px - ax);
        let nh = Math.abs(py - ay);
        const proporcional = document.getElementById("chk-sel-proportional")?.checked !== false;
        if (proporcional) {
            const s = Math.max(
                ci.w > 1e-6 ? nw / ci.w : 0,
                ci.h > 1e-6 ? nh / ci.h : 0
            );
            nw = ci.w * s;
            nh = ci.h * s;
        }
        nw = ci.w > 1e-6 ? Math.max(0.5, nw) : 0;
        nh = ci.h > 1e-6 ? Math.max(0.5, nh) : 0;
        const nx = px < ax ? ax - nw : ax;
        const ny = py < ay ? ay - nh : ay;
        aplicarCajaASeleccion(a.original, ci, { x: nx, y: ny, w: nw, h: nh });
    }
    actualizarPanelSeleccion();
}

function finalizarArrastreSeleccion() {
    const eraImagen = dibujo.seleccion && dibujo.seleccion.tipo === "imagen";
    const huboCambio = dibujo.arrastre && JSON.stringify(dibujo.arrastre.cajaInicial) !== JSON.stringify(cajaDeSeleccion());
    dibujo.arrastre = null;
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
    if (eraImagen && huboCambio) {
        actualizarPanelImagen();
        programarMapeoImagen();
    }
}

function despuesDeTransformarSeleccion() {
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    actualizarPanelSeleccion();
    dibujarBlueprint();
    if (dibujo.seleccion && dibujo.seleccion.tipo === "imagen") {
        actualizarPanelImagen();
        programarMapeoImagen();
    }
}

function actualizarPanelSeleccion() {
    const vacio = document.getElementById("sel-empty-msg");
    const cuerpo = document.getElementById("sel-panel-body");
    const lblNombre = document.getElementById("lbl-sel-name");
    const lblAviso = document.getElementById("lbl-sel-warning");
    if (!cuerpo) return;

    const caja = cajaDeSeleccion();
    if (!caja) {
        if (dibujo.seleccion) dibujo.seleccion = null;
        cuerpo.classList.add("hidden");
        vacio?.classList.remove("hidden");
        if (lblNombre) lblNombre.textContent = "Sin seleccion";
        return;
    }
    cuerpo.classList.remove("hidden");
    vacio?.classList.add("hidden");

    const esImagen = dibujo.seleccion.tipo === "imagen";
    const fig = figuraSeleccionada();
    if (lblNombre) lblNombre.textContent = esImagen ? `Imagen de fondo: ${dibujo.imagen.nombre}` : (fig ? fig.nombre : "");

    const asignar = (id, val) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el) el.value = Number(val).toFixed(2);
    };
    asignar("sel-pos-x", caja.x);
    asignar("sel-pos-y", caja.y);
    asignar("sel-width", caja.w);
    asignar("sel-height", caja.h);

    document.querySelectorAll(".sel-only-figure").forEach(el => { el.disabled = esImagen; });

    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const fuera = caja.x < -0.01 || caja.y < -0.01 || caja.x + caja.w > anchoMM + 0.01 || caja.y + caja.h > altoMM + 0.01;
    if (lblAviso) {
        const esc = Math.max(0.01, estado.pasos_por_mm);
        const pulsos = `${Math.round(caja.w * esc)} x ${Math.round(caja.h * esc)} pulsos`;
        lblAviso.textContent = fuera
            ? `FUERA DE ZONA: la seleccion excede ${anchoMM.toFixed(1)} x ${altoMM.toFixed(1)} mm. Usa "Ajustar a Zona" antes de ejecutar.`
            : `Dentro de la zona calibrada (${pulsos}).`;
        lblAviso.className = fuera ? "sel-warning danger" : "sel-warning ok";
    }
}

function aplicarDimensionesSeleccionDesdeInputs(campo) {
    if (dibujo.ejecutando) return;
    const caja = cajaDeSeleccion();
    if (!caja) return;
    const leer = (id, def) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : def;
    };
    let x = leer("sel-pos-x", caja.x);
    let y = leer("sel-pos-y", caja.y);
    let w = Math.max(0, leer("sel-width", caja.w));
    let h = Math.max(0, leer("sel-height", caja.h));
    const proporcional = document.getElementById("chk-sel-proportional")?.checked !== false;

    if (proporcional && caja.w > 1e-6 && caja.h > 1e-6) {
        if (campo === "w") h = caja.h * (w / caja.w);
        if (campo === "h") w = caja.w * (h / caja.h);
    }
    if (caja.w > 1e-6) w = Math.max(0.5, w); else w = 0;
    if (caja.h > 1e-6) h = Math.max(0.5, h); else h = 0;

    aplicarCajaASeleccion(copiaOriginalSeleccion(), caja, { x, y, w, h });
    despuesDeTransformarSeleccion();
}

function escalarSeleccion(factor) {
    if (dibujo.ejecutando) return;
    const caja = cajaDeSeleccion();
    if (!caja) return;
    const cx = caja.x + caja.w / 2;
    const cy = caja.y + caja.h / 2;
    const nw = caja.w * factor;
    const nh = caja.h * factor;
    aplicarCajaASeleccion(copiaOriginalSeleccion(), caja, { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh });
    despuesDeTransformarSeleccion();
}

function centrarSeleccionEnZona() {
    if (dibujo.ejecutando) return;
    const caja = cajaDeSeleccion();
    if (!caja) return;
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    aplicarCajaASeleccion(copiaOriginalSeleccion(), caja, {
        x: (anchoMM - caja.w) / 2, y: (altoMM - caja.h) / 2, w: caja.w, h: caja.h
    });
    despuesDeTransformarSeleccion();
}

// Ajusta la seleccion al area segura (90 % de la zona) conservando la proporcion
function ajustarSeleccionAZona() {
    if (dibujo.ejecutando) return;
    const caja = cajaDeSeleccion();
    if (!caja) return;
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const maxW = anchoMM * 0.9, maxH = altoMM * 0.9;
    const s = Math.min(
        caja.w > 1e-6 ? maxW / caja.w : Infinity,
        caja.h > 1e-6 ? maxH / caja.h : Infinity
    );
    const f = Number.isFinite(s) ? s : 1;
    const nw = caja.w * f, nh = caja.h * f;
    aplicarCajaASeleccion(copiaOriginalSeleccion(), caja, {
        x: (anchoMM - nw) / 2, y: (altoMM - nh) / 2, w: nw, h: nh
    });
    despuesDeTransformarSeleccion();
}

function rotarSeleccion90() {
    if (dibujo.ejecutando) return;
    const fig = figuraSeleccionada();
    if (!fig) return;
    const c = cajaDeTrazos(trazosDeFigura(fig));
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    fig.trazos = trazosDeFigura(fig).map(t => t.map(pt => {
        const nx = Number((cx - (pt[1] - cy)).toFixed(3));
        const ny = Number((cy + (pt[0] - cx)).toFixed(3));
        return pt.length > 2 ? [nx, ny, pt[2]] : [nx, ny];
    }));
    delete fig.puntosMM;
    despuesDeTransformarSeleccion();
}

function espejoSeleccion(eje) {
    if (dibujo.ejecutando) return;
    const fig = figuraSeleccionada();
    if (!fig) return;
    const c = cajaDeTrazos(trazosDeFigura(fig));
    fig.trazos = trazosDeFigura(fig).map(t => t.map(pt => {
        const nx = eje === "h" ? Number((2 * c.x + c.w - pt[0]).toFixed(3)) : pt[0];
        const ny = eje === "h" ? pt[1] : Number((2 * c.y + c.h - pt[1]).toFixed(3));
        return pt.length > 2 ? [nx, ny, pt[2]] : [nx, ny];
    }));
    delete fig.puntosMM;
    despuesDeTransformarSeleccion();
}

function duplicarSeleccion() {
    if (dibujo.ejecutando) return;
    const fig = figuraSeleccionada();
    if (!fig) return;
    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const c = cajaDeTrazos(trazosDeFigura(fig));
    const dx = c.x + c.w + 5 <= anchoMM ? 5 : -Math.min(5, c.x);
    const dy = c.y + c.h + 5 <= altoMM ? 5 : -Math.min(5, c.y);
    const trazos = trazosDeFigura(fig).map(t => t.map(pt => {
        const nx = Number((pt[0] + dx).toFixed(3));
        const ny = Number((pt[1] + dy).toFixed(3));
        return pt.length > 2 ? [nx, ny, pt[2]] : [nx, ny];
    }));
    agregarFiguraAlDibujo(`${fig.nombre} (copia)`, null, { trazos, tipo: fig.tipo, seleccionar: true });
}

function eliminarSeleccion() {
    if (dibujo.ejecutando || !dibujo.seleccion) return;
    if (dibujo.seleccion.tipo === "imagen") {
        quitarImagenMapeo();
        return;
    }
    eliminarFiguraDibujo(dibujo.seleccion.id);
}

// ==========================================================================
// MAPEO DE IMAGEN A COORDENADAS / TRAZOS (USA static/js/image_trace.js)
// ==========================================================================
const PRESETS_CALIDAD_IMAGEN = {
    borrador: { detalle: 1.0, simplificar: 0.40, longitudMin: 1.5 },
    normal: { detalle: 0.5, simplificar: 0.20, longitudMin: 1.0 },
    alta: { detalle: 0.3, simplificar: 0.12, longitudMin: 0.6 },
    maxima: { detalle: 0.2, simplificar: 0.06, longitudMin: 0.4 }
};

let temporizadorMapeo = null;
let tokenPeticionMapeo = 0;
let cacheTrazosPrevia = { clave: "", trazos: [] };

function cargarImagenParaMapeo(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
        mostrarMensajeConsola("El archivo seleccionado no es una imagen (usa PNG, JPG, BMP, GIF o WEBP).", true);
        event.target.value = "";
        return;
    }
    const lector = new FileReader();
    lector.onload = () => {
        const dataUrl = lector.result;
        const img = new Image();
        img.onload = () => {
            const { anchoMM, altoMM } = obtenerLimitesMesaMM();
            const iw = img.naturalWidth, ih = img.naturalHeight;
            const s = Math.min((anchoMM * 0.9) / iw, (altoMM * 0.9) / ih);
            const w = iw * s, h = ih * s;
            dibujo.imagen = {
                img,
                dataUrl,
                nombre: file.name,
                anchoPx: iw,
                altoPx: ih,
                rect: { x: (anchoMM - w) / 2, y: (altoMM - h) / 2, w, h },
                visible: true,
                opacidad: (parseFloat(document.getElementById("range-img-opacity")?.value || "45") / 100),
                mostrarMascara: Boolean(document.getElementById("chk-img-show-mask")?.checked)
            };
            dibujo.vistaPrevia = null;
            document.getElementById("img-map-controls")?.classList.remove("hidden");
            seleccionarImagenDeFondo();
            actualizarPanelImagen();
            mostrarMensajeConsola(`Imagen cargada: ${file.name} (${iw}x${ih} px) ajustada a ${w.toFixed(1)} x ${h.toFixed(1)} mm dentro de la zona.`);
            programarMapeoImagen(true);
        };
        img.onerror = () => mostrarMensajeConsola("No se pudo decodificar la imagen seleccionada.", true);
        img.src = dataUrl;
    };
    lector.readAsDataURL(file);
    event.target.value = "";
}

function quitarImagenMapeo() {
    dibujo.imagen = null;
    dibujo.vistaPrevia = null;
    cacheTrazosPrevia = { clave: "", trazos: [] };
    if (dibujo.seleccion && dibujo.seleccion.tipo === "imagen") dibujo.seleccion = null;
    document.getElementById("img-map-controls")?.classList.add("hidden");
    actualizarPanelImagen();
    actualizarPanelSeleccion();
}

function aplicarPresetCalidadImagen() {
    const preset = PRESETS_CALIDAD_IMAGEN[document.getElementById("select-img-quality")?.value || "normal"];
    if (!preset) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set("input-img-detail", preset.detalle);
    set("input-img-simplify", preset.simplificar);
    set("input-img-minlen", preset.longitudMin);
    programarMapeoImagen();
}

function alternarVisibilidadImagen(visible) {
    if (dibujo.imagen) dibujo.imagen.visible = Boolean(visible);
}

function cambiarOpacidadImagen(valor) {
    const v = Math.max(0, Math.min(100, parseFloat(valor) || 0));
    if (dibujo.imagen) dibujo.imagen.opacidad = v / 100;
    const lbl = document.getElementById("lbl-img-opacity");
    if (lbl) lbl.textContent = `${Math.round(v)} %`;
}

function alternarMascaraImagen(activo) {
    if (dibujo.imagen) dibujo.imagen.mostrarMascara = Boolean(activo);
}

function actualizarEtiquetaUmbral() {
    const v = document.getElementById("range-img-threshold")?.value || "128";
    const lbl = document.getElementById("lbl-img-threshold");
    if (lbl) lbl.textContent = v;

    const b = document.getElementById("range-img-brightness")?.value || "0";
    const lblB = document.getElementById("lbl-img-brightness");
    if (lblB) lblB.textContent = b;

    const c = document.getElementById("range-img-contrast")?.value || "0";
    const lblC = document.getElementById("lbl-img-contrast");
    if (lblC) lblC.textContent = c;
}

function actualizarCamposModoImagen() {
    const modo = document.getElementById("select-img-mode")?.value || "centro";
    const usaRelleno = (
        modo === "relleno" ||
        modo === "line2line" ||
        modo === "contorno_relleno" ||
        modo === "crosshatch" ||
        modo === "raster_pwm"
    );
    const usaDither = modo === "dithering";
    const usaRaster = modo === "raster_pwm";
    document.querySelectorAll(".img-hatch-only").forEach(el => el.classList.toggle("hidden", !usaRelleno));
    document.querySelectorAll(".img-dither-only").forEach(el => el.classList.toggle("hidden", !usaDither));
    document.querySelectorAll(".img-raster-only").forEach(el => el.classList.toggle("hidden", !usaRaster));
}

function leerOpcionesMapeo() {
    const num = (id, def) => {
        const v = parseFloat(document.getElementById(id)?.value);
        return Number.isFinite(v) ? v : def;
    };
    const esc = Math.max(0.01, estado.pasos_por_mm);
    const resolucionMecanicaMM = 1 / esc;
    const r = dibujo.imagen.rect;
    const ladoMM = Math.max(1, r.w, r.h);

    const grosorPunta = Math.max(0.05, num("input-img-pen", 0.5));
    const detalleMM = Math.max(resolucionMecanicaMM, num("input-img-detail", 0.5));
    const resolucionPx = Math.round(Math.max(64, Math.min(900, ladoMM / detalleMM)));
    const pxPorMM = resolucionPx / ladoMM;

    const espaciadoMM = Math.max(grosorPunta * 0.5, num("input-img-spacing", grosorPunta));
    const longitudMinMM = Math.max(0, num("input-img-minlen", 1.0));
    const unir = Boolean(document.getElementById("chk-img-join")?.checked);
    const motor = document.getElementById("select-img-engine")?.value || "opencv";

    const pMinRaster = Math.max(0, Math.min(95, num("input-img-raster-pmin", 12)));
    const pMaxRaster = Math.max(Math.max(5, pMinRaster + 1), Math.min(100, num("input-img-raster-pmax", 85)));

    return {
        motor,
        detalleMM,
        resolucionMecanicaMM,
        pxPorMM,
        grosorPunta,
        opciones: {
            resolucionPx,
            umbral: num("range-img-threshold", 128),
            metodoUmbral: document.getElementById("select-img-thresh-mode")?.value || "global",
            brillo: num("range-img-brightness", 0),
            contraste: num("range-img-contrast", 0),
            clahe: Boolean(document.getElementById("chk-img-clahe")?.checked),
            invertir: Boolean(document.getElementById("chk-img-invert")?.checked),
            filtro: document.getElementById("select-img-filter")?.value || "bilateral",
            suavizado: Math.round(num("select-img-blur", 1)),
            modo: document.getElementById("select-img-mode")?.value || "centro",
            ditherMatrix: document.getElementById("select-img-dither")?.value || "atkinson",
            espaciadoPx: espaciadoMM * pxPorMM,
            anguloRelleno: num("select-img-angle", 45),
            simplificarPx: Math.max(0.25, num("input-img-simplify", 0.2) * pxPorMM),
            suavizadoCurvas: Math.round(num("select-img-smooth", 1)),
            longitudMinPx: longitudMinMM * pxPorMM,
            areaMinPx: Math.pow(Math.max(grosorPunta, longitudMinMM) * pxPorMM * 0.45, 2),
            optimizarOrden: document.getElementById("chk-img-optimize")?.checked !== false,
            unirPx: unir ? grosorPunta * pxPorMM : 0,
            potenciaMinPct: pMinRaster,
            potenciaMaxPct: pMaxRaster,
            nivelesPwm: Math.max(2, Math.min(64, Math.round(num("input-img-raster-levels", 16)))),
            gamma: Math.max(0.3, Math.min(2.5, num("input-img-raster-gamma", 1.0))),
            direccionRaster: document.getElementById("select-img-raster-dir")?.value || "bidireccional",
            saltoBlancoPx: Math.max(0, num("input-img-raster-skip", 1.5)) * pxPorMM
        }
    };
}

function programarMapeoImagen(inmediato = false) {
    if (!dibujo.imagen) return;
    actualizarEtiquetaUmbral();
    actualizarCamposModoImagen();
    clearTimeout(temporizadorMapeo);
    const lbl = document.getElementById("img-map-status");
    const motor = document.getElementById("select-img-engine")?.value || "opencv";
    if (lbl) {
        lbl.textContent = motor === "opencv"
            ? "Procesando con OpenCV + LaserGRBL en el servidor..."
            : "Procesando con algoritmos LaserGRBL en navegador...";
    }
    temporizadorMapeo = setTimeout(ejecutarMapeoImagen, inmediato ? 30 : 280);
}

async function ejecutarMapeoImagen() {
    if (!dibujo.imagen || typeof ImageTrace === "undefined") return;
    const miToken = ++tokenPeticionMapeo;
    try {
        const cfg = leerOpcionesMapeo();
        let res = null;

        if (cfg.motor === "opencv" && dibujo.imagen.dataUrl && typeof ImageTrace.procesarServidorOpenCV === "function") {
            try {
                res = await ImageTrace.procesarServidorOpenCV(dibujo.imagen.dataUrl, cfg.opciones);
            } catch (errServidor) {
                console.warn("Fallo motor OpenCV en servidor, usando motor LaserGRBL en navegador:", errServidor);
                res = ImageTrace.procesar(dibujo.imagen.img, cfg.opciones);
                res.motor = "JS LaserGRBL Local (Respaldo)";
            }
        } else {
            res = ImageTrace.procesar(dibujo.imagen.img, cfg.opciones);
        }

        if (miToken !== tokenPeticionMapeo) return;
        res.id = Date.now();
        res.cfg = cfg;
        dibujo.vistaPrevia = res;
        cacheTrazosPrevia = { clave: "", trazos: [] };
        actualizarPanelImagen();
    } catch (err) {
        console.error(err);
        mostrarMensajeConsola(`Error al mapear la imagen: ${err.message}`, true);
    }
}

function obtenerTrazosVistaPreviaMM() {
    const vp = dibujo.vistaPrevia;
    const im = dibujo.imagen;
    if (!vp || !im) return [];
    const r = im.rect;
    const clave = `${vp.id}|${r.x.toFixed(3)}|${r.y.toFixed(3)}|${r.w.toFixed(3)}|${r.h.toFixed(3)}`;
    if (cacheTrazosPrevia.clave === clave) return cacheTrazosPrevia.trazos;
    const sx = r.w / vp.anchoPx;
    const sy = r.h / vp.altoPx;
    const trazos = vp.trazos.map(t => t.map(pt => {
        const xmm = Number((r.x + pt[0] * sx).toFixed(3));
        const ymm = Number((r.y + r.h - pt[1] * sy).toFixed(3));
        return pt.length > 2 ? [xmm, ymm, pt[2]] : [xmm, ymm];
    }));
    cacheTrazosPrevia = { clave, trazos };
    return trazos;
}

function actualizarPanelImagen() {
    const info = document.getElementById("img-map-info");
    const status = document.getElementById("img-map-status");
    const statsBox = document.getElementById("img-map-stats");
    const btnAdd = document.getElementById("btn-img-add");
    const lblMaq = document.getElementById("img-machine-info");

    const esc = Math.max(0.01, estado.pasos_por_mm);
    if (lblMaq) {
        lblMaq.textContent = `Resolucion mecanica: ${(1 / esc).toFixed(3)} mm por pulso (${esc.toFixed(2)} pulsos/mm, ${estado.pulse_rev || 0} P/rev). El detalle minimo se limita a este valor.`;
    }

    if (!dibujo.imagen) {
        if (info) info.textContent = "Sin imagen cargada. Formatos: PNG, JPG, BMP, GIF, WEBP.";
        if (status) status.textContent = "";
        if (statsBox) statsBox.innerHTML = "";
        if (btnAdd) btnAdd.disabled = true;
        return;
    }

    const r = dibujo.imagen.rect;
    if (info) {
        info.textContent = `${dibujo.imagen.nombre} | ${dibujo.imagen.anchoPx}x${dibujo.imagen.altoPx} px | En zona: ${r.w.toFixed(1)} x ${r.h.toFixed(1)} mm en (${r.x.toFixed(1)}, ${r.y.toFixed(1)})`;
    }

    const vp = dibujo.vistaPrevia;
    if (!vp) {
        if (btnAdd) btnAdd.disabled = true;
        return;
    }

    const trazosMM = obtenerTrazosVistaPreviaMM();
    const est = estimarTrabajoTrazos(trazosMM);
    const cfg = vp.cfg;
    const motorLbl = vp.motor || "OpenCV + LaserGRBL";
    if (status) {
        status.textContent = `[${motorLbl}] Procesado en ${vp.ms} ms a ${vp.anchoPx}x${vp.altoPx} px (detalle ${cfg.detalleMM.toFixed(2)} mm/px).`;
    }

    const avisos = [];
    if (trazosMM.length === 0) avisos.push("No se detectaron trazos: ajusta el Umbral, el Metodo de Umbralizacion o activa Invertir.");
    if (!est.usarZ && trazosMM.length > 1) avisos.push("Eje Z desactivado: los viajes entre trazos tambien marcaran el papel.");
    const esBarrido = ["relleno", "line2line", "crosshatch", "dithering", "raster_pwm"].includes(cfg.opciones.modo);
    if (!esBarrido && cfg.grosorPunta > cfg.detalleMM * 4) avisos.push("La punta es mucho mas gruesa que el detalle elegido: los trazos cercanos se encimaran.");
    if (est.segundos > 3600) avisos.push("Trabajo muy largo: baja la calidad, aumenta la simplificacion o la longitud minima.");
    if (est.segmentos > 25000) avisos.push("Demasiados tramos para enviar por serial: usa calidad Borrador/Normal.");

    if (statsBox) {
        statsBox.innerHTML = `
            <div class="img-stat"><span>TRAZOS (LEVANTAR Z)</span><strong>${trazosMM.length}</strong></div>
            <div class="img-stat"><span>TRAMOS / PUNTOS</span><strong>${est.segmentos} / ${vp.puntos}</strong></div>
            <div class="img-stat"><span>DIST. DIBUJO</span><strong>${est.distTrazo.toFixed(0)} mm</strong></div>
            <div class="img-stat"><span>DIST. VIAJE</span><strong>${est.distViaje.toFixed(0)} mm</strong></div>
            <div class="img-stat wide"><span>TIEMPO ESTIMADO EN MAQUINA</span><strong>${formatearDuracion(est.segundos)}</strong></div>
            ${avisos.map(a => `<div class="img-warning">${a}</div>`).join("")}
        `;
    }
    if (btnAdd) btnAdd.disabled = trazosMM.length === 0;
}

function agregarMapeoAlDibujo() {
    if (dibujo.ejecutando || !dibujo.imagen || !dibujo.vistaPrevia) return;
    const trazos = obtenerTrazosVistaPreviaMM().map(t => t.map(p => (p.length > 2 ? [p[0], p[1], p[2]] : [p[0], p[1]])));
    if (trazos.length === 0) {
        mostrarMensajeConsola("La imagen no genero trazos. Ajusta el umbral, el modo o la calidad.", true);
        return;
    }
    const modoTxt = {
        centro: "Esqueleto",
        canny: "Canny OpenCV",
        xdog: "Boceto XDoG",
        contorno: "Vectorizado LaserGRBL",
        relleno: "Line2Line",
        line2line: "Line2Line",
        contorno_relleno: "Contorno + Line2Line",
        crosshatch: "Cross-Hatching",
        dithering: `Dithering ${dibujo.vistaPrevia.cfg.opciones.ditherMatrix || ""}`.trim(),
        raster_pwm: `Raster PWM (${dibujo.vistaPrevia.cfg.opciones.potenciaMinPct ?? 12}-${dibujo.vistaPrevia.cfg.opciones.potenciaMaxPct ?? 85}%)`
    }[dibujo.vistaPrevia.cfg.opciones.modo] || "Imagen";
    const nombre = `Imagen ${dibujo.imagen.nombre} (${modoTxt}, ${trazos.length} trazos)`;
    agregarFiguraAlDibujo(nombre, null, { trazos, tipo: "imagen", seleccionar: true });

    // Ocultar la vista previa para no duplicar visualmente los trazos
    dibujo.vistaPrevia = null;
    cacheTrazosPrevia = { clave: "", trazos: [] };
    if (document.getElementById("chk-img-hide-after")?.checked) {
        dibujo.imagen.visible = false;
        const chk = document.getElementById("chk-img-visible");
        if (chk) chk.checked = false;
    }
    actualizarPanelImagen();
    mostrarMensajeConsola(`${nombre} agregada al dibujo. Seleccionala para moverla o cambiar su tamano.`);
}

// ==========================================================================
// CONTROLADOR DE INTERFAZ DE ESCRITORIO (MENUS, MODALES, DOCKS Y ATAJOS)
// ==========================================================================
let _modalActivoId = null;
let _modalSnapshot = null;

function configurarUIDescritorio() {
    configurarInfoPopovers();
    configurarParamInfoPopovers();
    // Cerrar menus desplegables al hacer clic fuera
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".menu-root")) {
            cerrarMenusSuperiores();
        }
        if (!e.target.closest("#ena-dropdown-wrap")) {
            cerrarMenuEna();
        }
    });

    // Cambiar entre menus abiertos al pasar el mouse (comportamiento clasico desktop)
    document.querySelectorAll(".menu-root").forEach(root => {
        root.addEventListener("mouseenter", () => {
            const algunoAbierto = document.querySelector(".menu-root.open");
            if (algunoAbierto && algunoAbierto !== root) {
                cerrarMenusSuperiores();
                root.classList.add("open");
            }
        });
    });

    // Atajos globales de escritorio
    document.addEventListener("keydown", (e) => {
        const tag = (e.target?.tagName || "").toUpperCase();
        const editandoTexto = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

        if (e.key === "Escape") {
            if (_modalActivoId) {
                cancelarModal(_modalActivoId);
                return;
            }
            if (document.querySelector(".menu-root.open")) {
                cerrarMenusSuperiores();
                return;
            }
            paroEmergencia();
            return;
        }

        if (e.ctrlKey && e.key.toLowerCase() === "i") {
            e.preventDefault();
            abrirModal("modal-importar-svg");
            return;
        }

        if (editandoTexto) return;

        if (e.key === "F1") { e.preventDefault(); cambiarVista("sim"); }
        else if (e.key === "F2") { e.preventDefault(); cambiarVista("drawing"); }
        else if (e.key === "F3") { e.preventDefault(); cambiarVista("blueprint"); }
        else if (e.key === "Tab") { e.preventDefault(); alternarDockDerecho(); }
        else if (e.key.toLowerCase() === "m") { seleccionarHerramientaDibujo("measure"); }
        else if (e.key.toLowerCase() === "t") { abrirModal("modal-texto-cnc"); }
    });

    // Soporte Drag & Drop para soltar archivos .svg directamente en la ventana
    window.addEventListener("dragover", (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
            e.preventDefault();
        }
    });
    window.addEventListener("drop", (e) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        const f = files[0];
        if (f && (f.name.toLowerCase().endsWith(".svg") || f.type === "image/svg+xml")) {
            e.preventDefault();
            if (typeof procesarArchivoSVGObjeto === "function") {
                procesarArchivoSVGObjeto(f);
            }
        }
    });
}

function alternarMenuSuperior(nombre) {
    const target = document.querySelector(`.menu-root[data-menu="${nombre}"]`);
    if (!target) return;
    const estabaAbierto = target.classList.contains("open");
    cerrarMenusSuperiores();
    if (!estabaAbierto) {
        target.classList.add("open");
    }
}

function cerrarMenusSuperiores() {
    document.querySelectorAll(".menu-root.open").forEach(el => el.classList.remove("open"));
}

function capturarSnapshotModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return null;
    const snap = {
        inputs: {},
        switches: { ...estado.switches },
        softLimits: estado.bloquear_limites,
        autohome: estado.autocalibrar_inicio,
        modoSim: estado.modo_simulacion
    };
    modal.querySelectorAll("input, select").forEach(el => {
        if (!el.id) return;
        snap.inputs[el.id] = el.type === "checkbox" ? el.checked : el.value;
    });
    return snap;
}

function abrirModal(modalId) {
    const backdrop = document.getElementById("modal-backdrop");
    const modal = document.getElementById(modalId);
    if (!backdrop || !modal) return;

    document.querySelectorAll(".desktop-modal").forEach(m => m.classList.add("hidden"));
    _modalActivoId = modalId;
    if (modalId === "modal-calibracion-ejes") {
        const inVelCfg = document.getElementById("input-config-velocidad-hz");
        if (inVelCfg) inVelCfg.value = estado.velocidad_hz || 500;
    }
    _modalSnapshot = capturarSnapshotModal(modalId);

    backdrop.classList.remove("hidden");
    modal.classList.remove("hidden");
}

function cerrarModalSinCambios() {
    document.getElementById("modal-backdrop")?.classList.add("hidden");
    document.querySelectorAll(".desktop-modal").forEach(m => m.classList.add("hidden"));
    _modalActivoId = null;
    _modalSnapshot = null;
}

function cerrarModalSiBackdrop(e) {
    if (e.target && e.target.id === "modal-backdrop" && _modalActivoId) {
        cancelarModal(_modalActivoId);
    }
}

async function cancelarModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal && _modalSnapshot) {
        Object.entries(_modalSnapshot.inputs).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.type === "checkbox") el.checked = Boolean(val);
            else el.value = val;
        });
        if (modalId === "modal-driver-dip" && _modalSnapshot.switches) {
            await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ switches: _modalSnapshot.switches })
            }).then(r => r.json()).then(d => sincronizarEstado(d)).catch(() => {});
        }
    }
    cerrarModalSinCambios();
    mostrarMensajeConsola("Cambios de configuracion cancelados.");
}

async function aplicarModal(modalId) {
    if (modalId === "modal-conexion") {
        const chkSim = document.getElementById("chk-simulacion");
        const chkSoft = document.getElementById("chk-soft-limits");
        const chkAuto = document.getElementById("chk-autohome-startup");
        const payload = {};
        if (chkSim) payload.modo_simulacion = chkSim.checked;
        if (chkSoft) payload.bloquear_limites = chkSoft.checked;
        if (chkAuto) payload.autocalibrar_inicio = chkAuto.checked;

        try {
            const res = await fetch("/api/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            sincronizarEstado(data);
        } catch (err) {
            mostrarMensajeConsola("Error al aplicar configuracion de conexion.", true);
        }
    } else if (modalId === "modal-calibracion-ejes") {
        const inVelCfg = document.getElementById("input-config-velocidad-hz");
        if (inVelCfg) {
            const nuevaVel = Math.max(50, Math.min(4000, parseInt(inVelCfg.value || "500", 10) || 500));
            const inVelMain = document.getElementById("input-velocidad-hz");
            if (inVelMain) inVelMain.value = nuevaVel;
            await enviarAjustes({ velocidad_hz: nuevaVel });
            actualizarAvancePreview();
            actualizarEstadisticasDibujo();
        }
    } else if (modalId === "modal-laser-config") {
        await actualizarConfiguracionLaserDesdeUI("sim");
    } else if (modalId === "modal-texto-cnc") {
        insertarTextoVectorialCNC();
        cerrarModalSinCambios();
        return;
    } else if (modalId === "modal-primitivas-cnc") {
        insertarPrimitivaCNC();
        cerrarModalSinCambios();
        return;
    } else if (modalId === "modal-importar-svg") {
        if (typeof confirmarImportacionSVG === "function" && confirmarImportacionSVG()) {
            cerrarModalSinCambios();
        }
        return;
    }
    cerrarModalSinCambios();
    mostrarMensajeConsola("Configuracion aplicada correctamente.");
}

function activarTabDock(vista, tab) {
    const prefix = vista === "drawing" ? "draw" : "sim";
    const panel = document.getElementById(`dock-panel-${vista}`);
    if (!panel) return;

    // Asegurar que el dock este expandido
    const dock = document.getElementById("desktop-inspector-dock");
    if (dock && dock.classList.contains("collapsed")) {
        dock.classList.remove("collapsed");
        setTimeout(() => ajustarTamanoCanvases(), 30);
    }

    const targetId = `${prefix}-${tab}`;
    panel.querySelectorAll(".dock-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.dockTarget === targetId);
    });
    panel.querySelectorAll(".dock-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === `dock-pane-${targetId}`);
    });
}

function alternarDockDerecho() {
    const dock = document.getElementById("desktop-inspector-dock");
    if (!dock) return;
    dock.classList.toggle("collapsed");
    setTimeout(() => {
        ajustarTamanoCanvases();
        dibujarBlueprint();
    }, 30);
}

function alternarTiraActuadores() {
    const strip = document.getElementById("actuators-dock");
    if (!strip) return;
    strip.classList.toggle("collapsed");
    setTimeout(() => ajustarTamanoCanvases(), 30);
}

// ==========================================================================
// SISTEMA DE AYUDA CONTEXTUAL ('i' INFO POPOVERS) POR APARTADO
// ==========================================================================
const INFO_APARTADOS = {
    jog_motores: {
        titulo: "Posicionamiento Cinematico (Motores X, Y, Z)",
        items: [
            "<b>Pad Direccional X/Y/Z:</b> Mueve manualmente cada eje la cantidad exacta de pulsos configurada.",
            "<b>Pulsos por comando:</b> Define el paso por clic o tecla de flecha (ej. 80 pulsos = 1 mm a 80 p/mm).",
            "<b>Velocidad (Hz):</b> Frecuencia de pulsos enviada al driver; mayor Hz implica mayor rapidez lineal.",
            "<b>Relacion lineal (p/mm):</b> Factor de conversion mecanica entre pulsos del motor y milimetros reales."
        ]
    },
    laser_manual: {
        titulo: "Control Manual Laser 5W (PWM 12V)",
        items: [
            "<b>Llave de Seguridad (Armar):</b> Bloquea o habilita cualquier emision del diodo laser.",
            "<b>Foco Guia:</b> Emite un haz muy tenue (1-12%) para enfocar la lente y ubicar el origen sin quemar.",
            "<b>Continuo / Gatillo / Pulso Test:</b> Permiten disparo sostenido, emision solo al mantener presionado o pulso breve cronometrado.",
            "<b>Activar Laser al Mover X/Y:</b> Enciende el haz a la potencia manual durante desplazamientos manuales X/Y y apaga a 0W al parar."
        ]
    },
    calibracion_ejes: {
        titulo: "Calibracion de Espacio (X, Y) y Altura (Z)",
        items: [
            "<b>Auto-Calibrar Microswitches X, Y:</b> Busca los limites fisicos inferior izquierdo para fijar el origen (0,0).",
            "<b>Home y Limite Maximo XY:</b> Delimitan el area util de trabajo en pulsos y protegen con Soft-Limits.",
            "<b>Home Z y Maximo Z (Papel):</b> Definen la altura segura de viaje (0) y la altura exacta de contacto del lapiz/plumon."
        ]
    },
    navegador: {
        titulo: "Navegador y Opciones de Lienzo",
        items: [
            "<b>Miniatura interactiva:</b> Haz clic o arrastra el recuadro para mover la vista con zoom alto.",
            "<b>Ajustar Zona (0) / 1:1 (1):</b> Encuadra toda el area calibrada o muestra el tamano fisico real.",
            "<b>Capas visuales:</b> Activa o desactiva reglas en mm, cuadricula adaptativa, nodos, orden de viaje y grosor de punta."
        ]
    },
    modo_herramienta: {
        titulo: "Modo de Herramienta del Estudio",
        items: [
            "<b>Dibujo (Pluma / Eje Z):</b> Levanta el eje Z en los viajes y lo baja al contacto con el papel al trazar.",
            "<b>Laser 5W (PWM):</b> Mantiene el laser en 0W durante viajes y modula la potencia (0-255 PWM) en cada trazo."
        ]
    },
    zona_calibrada: {
        titulo: "Zona Calibrada y Control Z del Estudio",
        items: [
            "<b>Max X / Max Y (pulsos y mm):</b> Sincroniza las dimensiones del lienzo con la carrera calibrada de la maquina.",
            "<b>Control de Eje Z al Dibujar:</b> Permite activar o desactivar el movimiento vertical de Z durante el trazado."
        ]
    },
    transformar: {
        titulo: "Transformar Seleccion",
        items: [
            "<b>Posicion X/Y y Ancho/Alto:</b> Ajusta con precision milimetrica la ubicacion y tamano del objeto seleccionado.",
            "<b>Acciones rapidas:</b> Escala proporcionalmente, centra, ajusta al 90% de la zona, rota 90 grados o refleja en espejo."
        ]
    },
    imagen_cv: {
        titulo: "Mapeo de Imagen (OpenCV + LaserGRBL)",
        items: [
            "<b>Tecnica y Calidad:</b> Elige entre Linea Central, Canny, Boceto XDoG, Contornos, Line2Line, Crosshatch o Dithering.",
            "<b>Umbral, Brillo, Contraste y CLAHE:</b> Afinan que detalles oscuros se convierten en trazos vectoriales.",
            "<b>Douglas-Peucker y Spot Removal:</b> Reducen puntos redundantes y eliminan motas pequenas para un trazo mas limpio."
        ]
    },
    laser_estudio: {
        titulo: "Parametros de Grabado y Corte Laser 5W",
        items: [
            "<b>Modo y Material:</b> Preconfigura potencia, velocidad de trabajo, velocidad de viaje y pasadas para cada material.",
            "<b>Auto-Foco Z:</b> Posiciona automaticamente el eje Z en el punto focal optimo antes de iniciar el grabado.",
            "<b>Encuadre Perimetro:</b> Recorre el contorno del trabajo con el puntero guia apagado/tenue para verificar ubicacion."
        ]
    },
    trazos_ejecucion: {
        titulo: "Secuencia de Figuras y Ejecucion",
        items: [
            "<b>Lista de Figuras:</b> Muestra cada vector o imagen mapeada; haz clic para seleccionarla en el lienzo.",
            "<b>Segmentos y Tiempo Estimado:</b> Calcula la distancia total de dibujo y la duracion aproximada segun la velocidad Hz."
        ]
    }
};

function configurarInfoPopovers() {
    const pop = document.getElementById("desktop-info-popover");
    const titleEl = document.getElementById("info-popover-title");
    const bodyEl = document.getElementById("info-popover-body");
    if (!pop || !titleEl || !bodyEl) return;

    let btnActivo = null;

    function cerrarPopover() {
        pop.classList.add("hidden");
        if (btnActivo) btnActivo.classList.remove("active");
        btnActivo = null;
    }

    function abrirPopover(btn) {
        const key = btn.dataset.infoKey;
        const info = INFO_APARTADOS[key];
        if (!info) return;

        if (btnActivo === btn && !pop.classList.contains("hidden")) {
            cerrarPopover();
            return;
        }
        if (btnActivo) btnActivo.classList.remove("active");
        btnActivo = btn;
        btn.classList.add("active");

        titleEl.textContent = info.titulo;
        bodyEl.innerHTML = `<ul>${info.items.map(it => `<li>${it}</li>`).join("")}</ul>`;
        pop.classList.remove("hidden");

        const rect = btn.getBoundingClientRect();
        const popW = pop.offsetWidth || 320;
        const popH = pop.offsetHeight || 160;
        let left = rect.left - popW - 10;
        if (left < 10) left = Math.min(window.innerWidth - popW - 10, rect.right + 10);
        let top = rect.top - 8;
        if (top + popH > window.innerHeight - 10) top = Math.max(10, window.innerHeight - popH - 10);

        pop.style.left = `${Math.round(left)}px`;
        pop.style.top = `${Math.round(top)}px`;
    }

    document.querySelectorAll(".info-tip-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            abrirPopover(btn);
        });
    });

    document.addEventListener("click", (e) => {
        if (!pop.classList.contains("hidden") && !e.target.closest("#desktop-info-popover") && !e.target.closest(".info-tip-btn")) {
            cerrarPopover();
        }
    });
}

// ==========================================================================
// CONTROL DE PAUSA / REANUDACION Y BARRA DE PROGRESO DE DIBUJO EN VIVO
// ==========================================================================
function alternarPausaDibujo() {
    if (!dibujo.ejecutando) return;
    dibujo.pausado = !dibujo.pausado;
    const btnPause = document.getElementById("btn-draw-fab-pause");
    if (btnPause) {
        btnPause.classList.toggle("paused", dibujo.pausado);
        const spanTxt = btnPause.querySelector("span");
        if (spanTxt) spanTxt.textContent = dibujo.pausado ? "Reanudar" : "Pausar";
    }
    const lbl = document.getElementById("draw-progress-label");
    if (lbl && dibujo.pausado) lbl.textContent = "Pausado por usuario";
    if (dibujo.pausado) {
        apagarLaserEmergencia(true);
        mostrarMensajeConsola("Ejecucion pausada. Presiona Reanudar para continuar o Detener para cancelar.");
    } else {
        mostrarMensajeConsola("Reanudando ejecucion del dibujo...");
    }
}

async function esperarSiPausadoDibujo() {
    while (dibujo.pausado && dibujo.ejecutando) {
        await new Promise(r => setTimeout(r, 80));
    }
    return dibujo.ejecutando;
}

function actualizarProgresoDibujoUI(completados, total, etiqueta, inicioMs, enCurso) {
    const pct = total > 0 ? Math.min(100, Math.round((completados / total) * 100)) : 0;
    const fillFab = document.getElementById("draw-progress-bar-fill");
    const pctFab = document.getElementById("draw-progress-pct");
    const lblFab = document.getElementById("draw-progress-label");
    const segsFab = document.getElementById("draw-progress-segs");
    const etaFab = document.getElementById("draw-progress-eta");

    const fillDock = document.getElementById("dock-draw-progress-fill");
    const pctDock = document.getElementById("dock-draw-progress-pct");
    const lblDock = document.getElementById("dock-draw-progress-label");

    if (fillFab) fillFab.style.width = `${pct}%`;
    if (pctFab) pctFab.textContent = `${pct}%`;
    if (lblFab) lblFab.textContent = etiqueta || (enCurso ? "Trazando..." : "Listo para trazar");
    if (segsFab) segsFab.textContent = `${completados} / ${total} tramos`;

    if (fillDock) fillDock.style.width = `${pct}%`;
    if (pctDock) pctDock.textContent = `${pct}%`;
    if (lblDock) lblDock.textContent = etiqueta || "Progreso de ejecucion";

    if (etaFab) {
        if (enCurso && inicioMs && completados > 0 && total > completados) {
            const elapsedSeg = (performance.now() - inicioMs) / 1000;
            const rate = completados / Math.max(0.1, elapsedSeg);
            const remSeg = Math.max(0, (total - completados) / rate);
            etaFab.textContent = `Resta: ${formatearDuracion(remSeg)}`;
        } else {
            etaFab.textContent = enCurso ? "Calculando..." : "--";
        }
    }

    const btnStart = document.getElementById("btn-draw-fab-start");
    const btnPause = document.getElementById("btn-draw-fab-pause");
    if (btnStart) btnStart.disabled = Boolean(enCurso);
    if (btnPause) {
        btnPause.disabled = !enCurso;
        if (!enCurso) {
            btnPause.classList.remove("paused");
            const spanTxt = btnPause.querySelector("span");
            if (spanTxt) spanTxt.textContent = "Pausar";
        }
    }
}

// ==========================================================================
// CONSOLA EXPANDIBLE INFERIOR IZQUIERDA (ESTATUS + CONDICION DE ENERGIA)
// ==========================================================================
function alternarConsolaDrawer() {
    const drawer = document.getElementById("desktop-console-drawer");
    const btn = document.getElementById("btn-toggle-console-drawer");
    const arrow = document.getElementById("lbl-console-drawer-arrow");
    if (!drawer) return;

    const oculto = drawer.classList.toggle("hidden");
    if (btn) btn.classList.toggle("active", !oculto);
    if (arrow) arrow.textContent = oculto ? "▲" : "▼";
    actualizarEstadisticasEnergiaDrawer();
    setTimeout(() => {
        ajustarTamanoCanvases();
        dibujarBlueprint();
    }, 30);
}

function limpiarHistorialConsola() {
    const hist = document.getElementById("console-log-history");
    if (hist) hist.innerHTML = `<div class="console-log-line"><span class="log-ts">[CLEAR]</span> Historial limpiado.</div>`;
}

function actualizarEstadisticasEnergiaDrawer() {
    const elEna = document.getElementById("drawer-ena-mode");
    const elCur = document.getElementById("drawer-current-amp");
    const elAxes = document.getElementById("drawer-axes-power");
    const elLaser = document.getElementById("drawer-laser-power");
    const elArea = document.getElementById("drawer-area-info");

    const enaModo = estado.ena?.modo || "AUTO";
    const amp = Number(estado.current_a ?? 2.0).toFixed(1);
    if (elEna) {
        elEna.textContent = enaModo === "AUTO"
            ? "AUTO (0.0 A Reposo / Energiza al mover)"
            : (enaModo === "HOLD" ? `HOLD (Retencion ${amp} A continua)` : "OFF / FREE (0.0 A Ejes Libres)");
    }
    if (elCur) {
        elCur.textContent = `${amp} A | Microstep ${estado.microstep || 16} (${estado.pulse_rev || 3200} P/rev)`;
    }
    if (elAxes) {
        const sx = estado.ena?.X ? `${amp}A` : "0.0A";
        const sy = estado.ena?.Y ? `${amp}A` : "0.0A";
        const sz = estado.ena?.Z ? `${amp}A` : "0.0A";
        elAxes.textContent = `X: ${sx} | Y: ${sy} | Z: ${sz}`;
    }
    if (elLaser) {
        const ls = estado.laser || {};
        const armTxt = ls.armado ? "ARMADO" : "DESARMADO";
        const watts = Number(ls.watts_actuales || 0).toFixed(2);
        const pwm = ls.pwm_actual || 0;
        elLaser.textContent = `${armTxt} | ${watts} W (PWM ${pwm}/255)`;
    }
    if (elArea) {
        const esc = Math.max(0.01, estado.pasos_por_mm || 80);
        const wMM = (Math.abs(estado.limite_max_x || 8400) / esc).toFixed(1);
        const hMM = (Math.abs(estado.limite_max_y || 7900) / esc).toFixed(1);
        elArea.textContent = `${wMM} x ${hMM} mm (${estado.limite_max_x || 8400} x ${estado.limite_max_y || 7900} p)`;
    }
}

// ==========================================================================
// INFORMACION DETALLADA PARA CADA PARAMETRO EDITABLE ('i' POR PARAMETRO)
// ==========================================================================
const INFO_PARAMETROS = {
    "input-pasos": ["Pulsos por comando", "Cantidad de micropasos enviados en cada clic o pulsacion de flecha. A 80 p/mm, 80 pulsos equivalen a 1 mm real."],
    "input-velocidad-hz": ["Velocidad del motor (Hz)", "Frecuencia de pulsos por segundo. Valores altos mueven mas rapido los ejes; valores bajos dan mayor precision y torque."],
    "input-pasos-mm": ["Relacion lineal (pulsos/mm)", "Factor de calibracion mecanica entre micropasos del motor y milimetros recorridos segun polea y microstepping (S1-S3)."],
    "input-laser-manual-pct": ["Potencia Manual Directa (%)", "Porcentaje de potencia del diodo de 5W (0% = 0W apagado, 100% = 5.0W maximo, PWM 0-255) para pruebas manuales."],
    "chk-laser-manual-jog-sync": ["Activar Laser al Mover X/Y", "Cuando esta activo, al mover manualmente los ejes X o Y se enciende el laser a la potencia manual y se apaga a 0W al detenerse."],
    "input-laser-focus-pct-sim": ["Potencia Guia de Foco (%)", "Nivel muy bajo (1% a 12%) para proyectar un punto visible sobre el material y ajustar el enfoque sin quemar."],
    "input-laser-test-pct-sim": ["Potencia Pulso de Prueba (%)", "Potencia optica utilizada al presionar 'Pulso Test' para verificar la marca sobre el material."],
    "input-laser-pulse-ms-sim": ["Duracion de Pulso (ms)", "Tiempo en milisegundos que el haz permanece encendido durante un disparo breve de prueba."],
    "chk-enable-z-main": ["Activar Eje Z en Estudio de Dibujo", "Activa o desactiva el movimiento vertical del cabezal Z entre trazos (subir a Home Z al viajar, bajar al papel al dibujar)."],
    "input-nav-cx": ["Centro de vista X (mm)", "Coordenada horizontal en milimetros hacia donde apunta el centro del visor de dibujo cuando hay zoom aplicado."],
    "input-nav-cy": ["Centro de vista Y (mm)", "Coordenada vertical en milimetros hacia donde apunta el centro del visor de dibujo."],
    "input-draw-width-steps": ["Limite Maximo X (pulsos)", "Ancho total util del eje X en pulsos del motor. Determina el borde derecho permitido para dibujar."],
    "input-draw-height-steps": ["Limite Maximo Y (pulsos)", "Profundidad total util del eje Y en pulsos del motor. Determina el borde superior permitido para dibujar."],
    "input-draw-width-mm": ["Ancho Equivalente X (mm)", "Ancho del area de trabajo en milimetros reales calculado segun la relacion pulsos/mm."],
    "input-draw-height-mm": ["Fondo Equivalente Y (mm)", "Alto o fondo del area de trabajo en milimetros reales."],
    "chk-draw-use-z": ["Control de Eje Z al Dibujar", "Si esta activo, sube la pluma a Home Z en desplazamientos en vacio y la baja a Max Z al trazar."],
    "input-z-up": ["Home Z (Viaje / Levantado)", "Posicion en pulsos donde el lapiz o plumon queda separado del papel sin manchar durante los viajes."],
    "input-z-down": ["Max Z (Contacto Papel)", "Posicion en pulsos donde la punta toca suavemente el papel para dibujar."],
    "sel-pos-x": ["Posicion X (mm)", "Coordenada horizontal de la esquina inferior izquierda de la figura o imagen seleccionada."],
    "sel-pos-y": ["Posicion Y (mm)", "Coordenada vertical de la esquina inferior izquierda de la figura o imagen seleccionada."],
    "sel-width": ["Ancho de seleccion (mm)", "Tamano horizontal fisico que ocupara la figura o imagen al ejecutarse en la maquina."],
    "sel-height": ["Alto de seleccion (mm)", "Tamano vertical fisico que ocupara la figura o imagen al ejecutarse en la maquina."],
    "select-img-engine": ["Motor de Procesamiento", "OpenCV + LaserGRBL procesa en Python con mayor precision; Local ejecuta algoritmos rapidos directamente en el navegador."],
    "select-img-quality": ["Calidad de Dibujo", "Ajusta automaticamente la resolucion de muestreo y detalle: Borrador es muy rapido, Maxima conserva microdetalles."],
    "select-img-mode": ["Tecnica de Vectorizado / Grabado", "Define como se extraen los trazos: Linea Central (esqueleto), Canny (bordes), XDoG (boceto), Contornos, Line2Line, Crosshatch, Dithering o Raster Engraving (modulacion PWM por lineas)."],
    "select-img-dither": ["Matriz de Dithering", "Algoritmo de trama de puntos para simular tonos grises en fotograbado (Atkinson da mayor contraste; Floyd-Steinberg transiciones suaves)."],
    "input-img-raster-pmin": ["Potencia Min. Raster (%)", "Porcentaje de potencia aplicado en los tonos grises mas claros detectados antes del umbral blanco."],
    "input-img-raster-pmax": ["Potencia Max. Raster (%)", "Porcentaje maximo de potencia aplicado en las zonas mas oscuras (negro puro) durante el escaneo por lineas."],
    "input-img-raster-levels": ["Niveles Tonales PWM", "Numero de escalones discretos de potencia (2 a 64). Mayor cantidad suaviza degradados; menor cantidad compacta tramos y acelera el serial."],
    "input-img-raster-gamma": ["Gamma Tonal", "Curva de respuesta de grises: valores < 1.0 aclaran medios tonos; valores > 1.0 oscurecen sombras y aumentan el quemado."],
    "select-img-raster-dir": ["Direccion de Escaneo Raster", "Bidireccional graba en zig-zag (ida y vuelta, mas rapido); Unidireccional graba siempre en el mismo sentido para eliminar holgura mecanica (backlash)."],
    "input-img-raster-skip": ["Salto en Blanco (mm)", "Huecos blancos mayores a esta longitud cortan la linea y realizan viaje rapido con laser a 0.00 W."],
    "select-img-thresh-mode": ["Metodo de Umbralizacion", "Determina que pixeles se consideran oscuros: Manual usa el slider; Otsu y Adaptativo se ajustan solos a sombras e iluminacion."],
    "range-img-threshold": ["Umbral / Sensibilidad", "Nivel de corte de gris (10-245). Valores altos capturan trazos mas claros; valores bajos solo trazos muy oscuros."],
    "range-img-brightness": ["Brillo de preprocesamiento", "Aclara u oscurece la imagen antes de detectar bordes o umbralizar."],
    "range-img-contrast": ["Contraste de preprocesamiento", "Aumenta o reduce la diferencia entre zonas claras y oscuras para resaltar lineas tenues."],
    "select-img-filter": ["Filtro OpenCV", "Suaviza ruido de la imagen antes de vectorizar: Bilateral conserva bordes nitidos; Mediana elimina puntos sueltos."],
    "select-img-blur": ["Intensidad del Filtro", "Grado de suavizado aplicado. Mayor intensidad elimina texturas de fondo pero puede redondear esquinas."],
    "input-img-pen": ["Grosor de punta (mm)", "Ancho fisico de la punta del plumon o haz laser; ayuda a calcular rellenos y evitar trazos encimados."],
    "input-img-detail": ["Detalle / Tamano de pixel (mm)", "Resolucion espacial de conversion. Menor valor genera mas precision y mas segmentos; mayor valor acelera el trabajo."],
    "input-img-simplify": ["Simplificacion Douglas-Peucker (mm)", "Tolerancia para reducir puntos redundantes en rectas. 0.1-0.3 mm limpia vibraciones sin perder la forma."],
    "select-img-smooth": ["Suavizado Chaikin", "Redondea esquinas poligonales generando curvas organicas mas fluidas en 1 o 2 pasadas."],
    "input-img-minlen": ["Spot Removal (mm)", "Descarta trazos o motas aisladas mas cortas que esta longitud para evitar movimientos innecesarios."],
    "input-img-spacing": ["Separacion Line-to-Line (mm)", "Distancia entre lineas paralelas en modos de relleno o sombreado cruzado."],
    "select-img-angle": ["Angulo de Barrido", "Inclinacion en grados de las lineas de relleno en Line2Line o Cross-Hatching."],
    "range-img-opacity": ["Opacidad de imagen fondo (%)", "Transparencia de la imagen de referencia sobre el lienzo para comparar facilmente contra los trazos generados."],
    "select-laser-operation-mode": ["Modo de Operacion Laser", "Selecciona si el laser trazara contornos vectoriales, rellenos lineales, fotograbado por puntos o corte multipaso."],
    "select-laser-preset": ["Material Preajustado (5W)", "Carga automaticamente potencia, velocidad y pasadas recomendadas para papel, carton, madera, cuero o acrilico."],
    "range-laser-power-pct": ["Potencia de Trabajo (%)", "Porcentaje de potencia PWM (0-100% de 5W) aplicado durante los trazos de grabado o corte."],
    "input-laser-speed-work": ["Velocidad de Grabado (Hz)", "Rapidez de desplazamiento mientras el laser esta emitiendo. Menor velocidad quema mas profundo."],
    "input-laser-speed-travel": ["Velocidad de Viaje (Hz)", "Rapidez de desplazamiento rapido entre trazos con el laser apagado a 0.00 W."],
    "input-laser-passes": ["Numero de Pasadas", "Cantidad de veces que se repite el recorrido completo. Util para cortar madera o carton grueso."],
    "input-laser-cool-ms": ["Pausa entre Pasadas (ms)", "Tiempo de espera con el laser apagado entre cada pasada para enfriar el diodo y el material."],
    "chk-laser-use-z-focus": ["Auto-Foco Z al Iniciar", "Mueve automaticamente el eje Z a la altura focal calibrada antes de comenzar a emitir."],
    "input-laser-z-focus-draw": ["Altura Punto Focal Z (pulsos)", "Altura exacta en pulsos donde el haz del lente de 5W logra el punto mas fino sobre la superficie."],
    "input-laser-focus-pct-draw": ["Potencia Guia Foco (%)", "Porcentaje de potencia tenue para el puntero guia en el estudio de dibujo."],
    "select-svg-pos-mode": ["Escalado y Posicion SVG", "Define como se mapea el lienzo de Inkscape (viewBox/mm) a tu zona calibrada e invierte automaticamente el eje Y."],
    "select-svg-group-mode": ["Agrupacion de Trazos SVG", "Elige si importar todo el archivo como 1 sola figura agrupada o separarlo por capas (<g>) o trayectos individuales."],
    "input-svg-tol": ["Tolerancia De Casteljau (mm)", "Desviacion maxima permitida al discretizar curvas Bezier y arcos elipticos. 0.05-0.12 mm es ideal para 80 pulsos/mm."],
    "input-svg-simplify": ["Simplificacion Douglas-Peucker (mm)", "Elimina vertices colineales redundantes tras discretizar las curvas sin deformar la geometria."],
    "input-svg-hatch-spacing": ["Separacion de Relleno Hatch (mm)", "Distancia entre lineas de barrido cuando se activa el relleno para formas cerradas con atributo fill."]
};

function configurarParamInfoPopovers() {
    const pop = document.getElementById("desktop-info-popover");
    const titleEl = document.getElementById("info-popover-title");
    const bodyEl = document.getElementById("info-popover-body");
    if (!pop || !titleEl || !bodyEl) return;

    Object.entries(INFO_PARAMETROS).forEach(([id, [titulo, desc]]) => {
        const inputEl = document.getElementById(id);
        if (!inputEl) return;

        let targetHost = document.querySelector(`label[for="${id}"]`);
        if (!targetHost && inputEl.type === "checkbox") {
            const safety = inputEl.closest(".safety-toggle");
            if (safety) targetHost = safety.querySelector("strong");
        }
        if (!targetHost || targetHost.querySelector(`.info-tip-btn[data-param-id="${id}"]`)) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "info-tip-btn param-info-btn";
        btn.dataset.paramId = id;
        btn.textContent = "i";
        btn.setAttribute("aria-label", `Info sobre ${titulo}`);
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mismo = pop.dataset.activeParam === id && !pop.classList.contains("hidden");
            if (mismo) {
                pop.classList.add("hidden");
                pop.dataset.activeParam = "";
                btn.classList.remove("active");
                return;
            }
            document.querySelectorAll(".info-tip-btn.active").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            pop.dataset.activeParam = id;
            titleEl.textContent = titulo;
            bodyEl.innerHTML = `<p style="margin:0;">${desc}</p>`;
            pop.classList.remove("hidden");

            const rect = btn.getBoundingClientRect();
            const popW = pop.offsetWidth || 320;
            const popH = pop.offsetHeight || 110;
            let left = rect.left - popW - 8;
            if (left < 10) left = Math.min(window.innerWidth - popW - 10, rect.right + 8);
            let top = rect.top - 8;
            if (top + popH > window.innerHeight - 10) top = Math.max(10, window.innerHeight - popH - 10);
            pop.style.left = `${Math.round(left)}px`;
            pop.style.top = `${Math.round(top)}px`;
        });
        targetHost.appendChild(btn);
    });
}

// ==========================================================================
// DROPDOWN DINAMICO ENA+ Y HERRAMIENTAS AVANZADAS DE ESTUDIO CNC
// ==========================================================================
function alternarMenuEna() {
    const menu = document.getElementById("ena-dropdown-menu");
    const trig = document.getElementById("btn-ena-dropdown-trigger");
    if (!menu || !trig) return;
    const oculto = menu.classList.toggle("hidden");
    if (!oculto) {
        const rect = trig.getBoundingClientRect();
        menu.style.left = `${Math.round(rect.left)}px`;
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
}

function cerrarMenuEna() {
    document.getElementById("ena-dropdown-menu")?.classList.add("hidden");
}

// Fuente vectorial monolineal CNC (coordenadas normalizadas 0..1 en X, 0..1 en Y)
const FUENTE_CNC_STROKE = {
    A: [[[0,0],[0.5,1],[1,0]], [[0.18,0.38],[0.82,0.38]]],
    B: [[[0,0],[0,1],[0.7,1],[0.9,0.85],[0.9,0.62],[0.7,0.5],[0,0.5]], [[0.7,0.5],[0.95,0.38],[0.95,0.12],[0.7,0],[0,0]]],
    C: [[[1,0.85],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0],[0.75,0],[1,0.15]]],
    D: [[[0,0],[0,1],[0.65,1],[1,0.75],[1,0.25],[0.65,0],[0,0]]],
    E: [[[1,1],[0,1],[0,0],[1,0]], [[0,0.5],[0.75,0.5]]],
    F: [[[1,1],[0,1],[0,0]], [[0,0.5],[0.75,0.5]]],
    G: [[[1,0.85],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0],[0.85,0],[1,0.2],[1,0.5],[0.55,0.5]]],
    H: [[[0,0],[0,1]], [[1,0],[1,1]], [[0,0.5],[1,0.5]]],
    I: [[[0.2,1],[0.8,1]], [[0.5,1],[0.5,0]], [[0.2,0],[0.8,0]]],
    J: [[[0.2,1],[0.9,1]], [[0.75,1],[0.75,0.2],[0.5,0],[0.2,0],[0,0.2]]],
    K: [[[0,0],[0,1]], [[1,1],[0,0.45],[1,0]]],
    L: [[[0,1],[0,0],[1,0]]],
    M: [[[0,0],[0,1],[0.5,0.4],[1,1],[1,0]]],
    N: [[[0,0],[0,1],[1,0],[1,1]]],
    O: [[[0.25,0],[0.75,0],[1,0.25],[1,0.75],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0]]],
    P: [[[0,0],[0,1],[0.75,1],[1,0.82],[1,0.62],[0.75,0.48],[0,0.48]]],
    Q: [[[0.25,0],[0.75,0],[1,0.25],[1,0.75],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0]], [[0.6,0.35],[1,0]]],
    R: [[[0,0],[0,1],[0.75,1],[1,0.82],[1,0.62],[0.75,0.48],[0,0.48]], [[0.55,0.48],[1,0]]],
    S: [[[1,0.85],[0.75,1],[0.25,1],[0,0.82],[0,0.62],[0.25,0.5],[0.75,0.5],[1,0.35],[1,0.15],[0.75,0],[0.25,0],[0,0.15]]],
    T: [[[0,1],[1,1]], [[0.5,1],[0.5,0]]],
    U: [[[0,1],[0,0.22],[0.25,0],[0.75,0],[1,0.22],[1,1]]],
    V: [[[0,1],[0.5,0],[1,1]]],
    W: [[[0,1],[0.25,0],[0.5,0.6],[0.75,0],[1,1]]],
    X: [[[0,1],[1,0]], [[0,0],[1,1]]],
    Y: [[[0,1],[0.5,0.5],[1,1]], [[0.5,0.5],[0.5,0]]],
    Z: [[[0,1],[1,1],[0,0],[1,0]]],
    "0": [[[0.25,0],[0.75,0],[1,0.25],[1,0.75],[0.75,1],[0.25,1],[0,0.75],[0,0.25],[0.25,0]], [[0.15,0.15],[0.85,0.85]]],
    "1": [[[0.25,0.75],[0.55,1],[0.55,0]], [[0.2,0],[0.9,0]]],
    "2": [[[0,0.78],[0.25,1],[0.75,1],[1,0.78],[1,0.58],[0,0],[1,0]]],
    "3": [[[0,0.82],[0.25,1],[0.75,1],[1,0.8],[1,0.62],[0.72,0.5],[0.4,0.5]], [[0.72,0.5],[1,0.35],[1,0.18],[0.75,0],[0.25,0],[0,0.18]]],
    "4": [[[0.75,0],[0.75,1],[0,0.32],[1,0.32]]],
    "5": [[[1,1],[0.1,1],[0.05,0.55],[0.75,0.55],[1,0.38],[1,0.15],[0.75,0],[0.2,0],[0,0.15]]],
    "6": [[[0.85,0.9],[0.6,1],[0.25,1],[0,0.72],[0,0.22],[0.25,0],[0.75,0],[1,0.22],[1,0.42],[0.75,0.55],[0,0.55]]],
    "7": [[[0,1],[1,1],[0.35,0]]],
    "8": [[[0.25,0.5],[0.75,0.5],[1,0.68],[1,0.85],[0.75,1],[0.25,1],[0,0.85],[0,0.68],[0.25,0.5],[0,0.32],[0,0.15],[0.25,0],[0.75,0],[1,0.15],[1,0.32],[0.75,0.5]]],
    "9": [[[1,0.45],[0.25,0.45],[0,0.62],[0,0.82],[0.25,1],[0.75,1],[1,0.82],[1,0.22],[0.75,0],[0.2,0]]],
    "-": [[[0.2,0.5],[0.8,0.5]]],
    "+": [[[0.2,0.5],[0.8,0.5]], [[0.5,0.2],[0.5,0.8]]],
    ".": [[[0.45,0],[0.55,0],[0.55,0.08],[0.45,0.08],[0.45,0]]],
    ":": [[[0.45,0.2],[0.55,0.2],[0.55,0.28],[0.45,0.28],[0.45,0.2]], [[0.45,0.65],[0.55,0.65],[0.55,0.73],[0.45,0.73],[0.45,0.65]]],
    "/": [[[0.1,0],[0.9,1]]],
    "_": [[[0,0],[1,0]]],
    "!": [[[0.5,1],[0.5,0.28]], [[0.45,0],[0.55,0],[0.55,0.08],[0.45,0.08],[0.45,0]]]
};

function insertarTextoVectorialCNC() {
    const raw = (document.getElementById("input-cnc-text")?.value || "CNC 5W").toUpperCase();
    const hMM = Math.max(3, Math.min(100, parseFloat(document.getElementById("input-cnc-text-height")?.value || "14") || 14));
    const esp = Math.max(0.8, Math.min(3, parseFloat(document.getElementById("input-cnc-text-spacing")?.value || "1.25") || 1.25));
    const wChar = hMM * 0.62;
    const stepX = wChar * esp;

    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const totalW = Math.max(wChar, (raw.length - 1) * stepX + wChar);
    const startX = Math.max(2, (anchoMM - totalW) / 2);
    const startY = Math.max(2, (altoMM - hMM) / 2);

    const trazos = [];
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        const glifo = FUENTE_CNC_STROKE[ch];
        if (!glifo) continue;
        const ox = startX + i * stepX;
        glifo.forEach(stroke => {
            const pts = stroke.map(([nx, ny]) => [
                Number(Math.min(anchoMM, Math.max(0, ox + nx * wChar)).toFixed(2)),
                Number(Math.min(altoMM, Math.max(0, startY + ny * hMM)).toFixed(2))
            ]);
            if (pts.length >= 2) trazos.push(pts);
        });
    }

    if (trazos.length === 0) {
        mostrarMensajeConsola("El texto no contiene caracteres vectoriales validos.", true);
        return;
    }
    cambiarVista("drawing");
    agregarFiguraAlDibujo(`Texto "${raw}" (${hMM} mm)`, null, { trazos, seleccionar: true });
    seleccionarHerramientaDibujo("select");
    mostrarMensajeConsola(`Texto vectorial "${raw}" insertado (${trazos.length} trazos).`);
}

function insertarPrimitivaCNC() {
    const tipo = document.getElementById("select-cnc-prim-tipo")?.value || "poligono";
    const sizeMM = Math.max(5, Math.min(200, parseFloat(document.getElementById("input-cnc-prim-size")?.value || "40") || 40));
    const n = Math.max(3, Math.min(24, parseInt(document.getElementById("input-cnc-prim-n")?.value || "6", 10) || 6));
    const ratio = Math.max(0.15, Math.min(0.9, parseFloat(document.getElementById("input-cnc-prim-ratio")?.value || "0.45") || 0.45));

    const { anchoMM, altoMM } = obtenerLimitesMesaMM();
    const cx = anchoMM / 2;
    const cy = altoMM / 2;
    const r = Math.min(sizeMM / 2, Math.min(anchoMM, altoMM) * 0.45);
    const trazos = [];
    let nombre = "Primitiva";

    if (tipo === "poligono") {
        nombre = `Poligono ${n} lados (${(r * 2).toFixed(0)} mm)`;
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2 - Math.PI / 2;
            pts.push([Number((cx + Math.cos(a) * r).toFixed(2)), Number((cy + Math.sin(a) * r).toFixed(2))]);
        }
        trazos.push(pts);
    } else if (tipo === "estrella") {
        nombre = `Estrella ${n} puntas (${(r * 2).toFixed(0)} mm)`;
        const pts = [];
        for (let i = 0; i <= n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
            const rad = (i % 2 === 0) ? r : r * ratio;
            pts.push([Number((cx + Math.cos(a) * rad).toFixed(2)), Number((cy + Math.sin(a) * rad).toFixed(2))]);
        }
        trazos.push(pts);
    } else if (tipo === "espiral") {
        nombre = `Espiral ${n} vueltas (${(r * 2).toFixed(0)} mm)`;
        const pts = [];
        const pasos = n * 28;
        for (let i = 0; i <= pasos; i++) {
            const t = i / pasos;
            const a = t * n * Math.PI * 2;
            const rad = t * r;
            pts.push([Number((cx + Math.cos(a) * rad).toFixed(2)), Number((cy + Math.sin(a) * rad).toFixed(2))]);
        }
        trazos.push(pts);
    } else if (tipo === "cuadricula") {
        const celdas = Math.min(12, n);
        const w = r * 2;
        const x0 = cx - r, y0 = cy - r;
        nombre = `Cuadricula ${celdas}x${celdas} (${w.toFixed(0)} mm)`;
        for (let i = 0; i <= celdas; i++) {
            const offset = (i / celdas) * w;
            trazos.push([[Number((x0 + offset).toFixed(2)), Number(y0.toFixed(2))], [Number((x0 + offset).toFixed(2)), Number((y0 + w).toFixed(2))]]);
            trazos.push([[Number(x0.toFixed(2)), Number((y0 + offset).toFixed(2))], [Number((x0 + w).toFixed(2)), Number((y0 + offset).toFixed(2))]]);
        }
    } else if (tipo === "mira") {
        nombre = `Mira Alineacion (${(r * 2).toFixed(0)} mm)`;
        trazos.push([[Number((cx - r).toFixed(2)), Number(cy.toFixed(2))], [Number((cx + r).toFixed(2)), Number(cy.toFixed(2))]]);
        trazos.push([[Number(cx.toFixed(2)), Number((cy - r).toFixed(2))], [Number(cx.toFixed(2)), Number((cy + r).toFixed(2))]]);
        const circ = [];
        for (let i = 0; i <= 32; i++) {
            const a = (i / 32) * Math.PI * 2;
            circ.push([Number((cx + Math.cos(a) * r * 0.65).toFixed(2)), Number((cy + Math.sin(a) * r * 0.65).toFixed(2))]);
        }
        trazos.push(circ);
    }

    cambiarVista("drawing");
    agregarFiguraAlDibujo(nombre, null, { trazos, seleccionar: true });
    seleccionarHerramientaDibujo("select");
    mostrarMensajeConsola(`${nombre} insertada en el centro de la zona.`);
}

function optimizarOrdenFigurasDibujo() {
    if (dibujo.figuras.length < 2) {
        mostrarMensajeConsola("Se necesitan al menos 2 figuras para optimizar el orden de recorrido.");
        return;
    }
    const restantes = [...dibujo.figuras];
    const ordenadas = [];
    let curX = 0, curY = 0;

    while (restantes.length > 0) {
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < restantes.length; i++) {
            const t = trazosDeFigura(restantes[i]);
            if (!t.length || !t[0].length) continue;
            const [sx, sy] = t[0][0];
            const d = Math.hypot(sx - curX, sy - curY);
            if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        const elegida = restantes.splice(bestIdx, 1)[0];
        ordenadas.push(elegida);
        const ts = trazosDeFigura(elegida);
        if (ts.length) {
            const ult = ts[ts.length - 1];
            if (ult.length) {
                curX = ult[ult.length - 1][0];
                curY = ult[ult.length - 1][1];
            }
        }
    }

    dibujo.figuras = ordenadas;
    renderizarListaFigurasDibujo();
    actualizarEstadisticasDibujo();
    mostrarMensajeConsola("Orden de figuras optimizado por vecino mas cercano para minimizar viajes en vacio.");
}

function fijarVelocidadConfigModal(hz) {
    const inVelCfg = document.getElementById("input-config-velocidad-hz");
    if (inVelCfg) inVelCfg.value = hz;
}

function alternarModoHerramientaRapido() {
    const siguiente = estado.modo_herramienta === "laser" ? "dibujo" : "laser";
    cambiarModoHerramientaEstudio(siguiente);
}

// ==========================================================================
// ZOOM Y DESPLAZAMIENTO (PAN) EN EL LIENZO DE SIMULACION CINEMATICA
// ==========================================================================
const vistaSim = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    arrastrando: false,
    lastX: 0,
    lastY: 0
};

function actualizarBadgeZoomSim() {
    const lbl = document.getElementById("lbl-sim-zoom");
    if (lbl) lbl.textContent = `${Math.round(vistaSim.zoom * 100)}%`;
}

function zoomVistaSim(factor, cxCanvas = null, cyCanvas = null) {
    const cv = document.getElementById("canvas-sim");
    const oldZ = vistaSim.zoom;
    const newZ = Math.max(0.5, Math.min(6.0, oldZ * factor));
    if (cv) {
        const w = cv.width || 1;
        const h = cv.height || 1;
        const px = cxCanvas !== null ? cxCanvas : w / 2;
        const py = cyCanvas !== null ? cyCanvas : h / 2;
        const worldX = (px - (w / 2 + vistaSim.panX)) / oldZ + w / 2;
        const worldY = (py - (h / 2 + vistaSim.panY)) / oldZ + h / 2;
        vistaSim.zoom = newZ;
        vistaSim.panX = px - w / 2 - (worldX - w / 2) * newZ;
        vistaSim.panY = py - h / 2 - (worldY - h / 2) * newZ;
    } else {
        vistaSim.zoom = newZ;
    }
    actualizarBadgeZoomSim();
}

function resetVistaSim() {
    vistaSim.zoom = 1.0;
    vistaSim.panX = 0;
    vistaSim.panY = 0;
    actualizarBadgeZoomSim();
}

function configurarEventosLienzoSim() {
    const cv = document.getElementById("canvas-sim");
    if (!cv) return;
    cv.style.cursor = "grab";

    cv.addEventListener("wheel", (e) => {
        e.preventDefault();
        const rect = cv.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        zoomVistaSim(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
    }, { passive: false });

    cv.addEventListener("mousedown", (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        e.preventDefault();
        vistaSim.arrastrando = true;
        vistaSim.lastX = e.clientX;
        vistaSim.lastY = e.clientY;
        cv.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", (e) => {
        if (!vistaSim.arrastrando) return;
        vistaSim.panX += e.clientX - vistaSim.lastX;
        vistaSim.panY += e.clientY - vistaSim.lastY;
        vistaSim.lastX = e.clientX;
        vistaSim.lastY = e.clientY;
    });

    window.addEventListener("mouseup", () => {
        if (!vistaSim.arrastrando) return;
        vistaSim.arrastrando = false;
        cv.style.cursor = "grab";
    });

    cv.addEventListener("dblclick", () => {
        resetVistaSim();
    });
}

async function encuadrarDisenoEnMesa() {
    if (anim.enMovimiento || dibujo.ejecutando) return;
    if (dibujo.figuras.length === 0) {
        mostrarMensajeConsola("No hay figuras en el lienzo para encuadrar.", true);
        return;
    }
    const caja = cajaDeTrazos(dibujo.figuras.flatMap(f => trazosDeFigura(f)));
    if (!caja) return;

    const esc = Math.max(0.01, estado.pasos_por_mm || 80);
    const x0 = Math.round(caja.x * esc);
    const y0 = Math.round(caja.y * esc);
    const x1 = Math.round((caja.x + caja.w) * esc);
    const y1 = Math.round((caja.y + caja.h) * esc);
    const velViaje = Math.max(300, parseInt(estado.laser?.velocidad_viaje_hz || 2000, 10));

    dibujo.ejecutando = true;
    mostrarMensajeConsola(`Encuadrando diseno en mesa (${caja.w.toFixed(1)} x ${caja.h.toFixed(1)} mm) con salida en 0W...`);
    const esquinas = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    for (let i = 0; i < esquinas.length; i++) {
        if (!dibujo.ejecutando) break;
        await irAPuntoXYPulsos(esquinas[i][0], esquinas[i][1], `Encuadre Diseno (${i + 1}/5)`, {
            laser_activo: false,
            laser_pwm: 0,
            velocidad_hz: velViaje
        });
    }
    dibujo.ejecutando = false;
    mostrarMensajeConsola("Encuadre de diseno completado sin emision (0.00 W).");
}




