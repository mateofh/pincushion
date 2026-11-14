# Guion de pruebas de UX (lo que ejecuta el dueño)

Lo automatizable está en Playwright (`npm test`). Este guion cubre lo que **no se puede automatizar**: el bookmarklet instalado en navegadores reales, lectores de pantalla y sesiones con personas. Origen: `docs/PLAN.md`, sección "Plan de pruebas de UX y navegación", punto 7.

**Antes de empezar**: instancia accesible desde cada dispositivo (con `APP_ORIGIN` correcto), usuarios demo cargados con `npm run db:seed` (`alice@example.com`, `bob@example.com`, `dana@example.com`; contraseña `pincushion-demo`, ver README) y `/healthz` en verde. Para las sesiones con personas usa **`dana`** (cuenta vacía), o crea un usuario nuevo con `npm run user:create`.

**Meta global**: al menos 80 % de éxito sin ayuda en las 5 tareas y SUS medio de 75 o más.

---

## 1. Bookmarklet real por navegador

Requisito: haber iniciado sesión y abrir `/bookmarklet`.

### Escritorio (arrastrar a la barra)

| Navegador | Pasos | Resultado esperado |
|---|---|---|
| Chrome | Muestra la barra de favoritos (`Ctrl/Cmd+Shift+B`). Arrastra el enlace de `/bookmarklet` a la barra. | Aparece un favorito "+ Pincushion". |
| Firefox | Muestra la barra (`Ctrl+Shift+B`). Arrastra el enlace a la barra. | Igual. |
| Safari (macOS) | Muestra la barra (Visualización > Mostrar barra de favoritos). Arrastra el enlace. | Igual. |

Para cada uno:
1. Abre `/bookmarklet/prueba` y sigue las instrucciones ("Haz clic en el bookmarklet…").
2. Pulsa el favorito desde la página de prueba. Debe verse "✓ Funciona: guardado de prueba recibido a las HH:MM".
3. Guarda desde **3 sitios con CSP estricta**: un repositorio de GitHub, la portada de un periódico y una SPA (por ejemplo una app de mapas o de notas). Anota en cada caso:
   - ¿Se abrió el popup, o el navegador bloqueó la ventana y navegó la pestaña (fallback)?
   - Popup: título, descripción y favicon visibles; mensaje "Guardado ✓" o "Ya estaba guardado".
   - En la Biblioteca el enlace aparece y, tras unos segundos, pasa de "Obteniendo datos…" a "Datos obtenidos".
4. Páginas no guardables (`about:blank`, `chrome://settings`, un `file://`): debe aparecer un mensaje claro, sin error técnico.
5. Rota el token en `/bookmarklet` y pulsa el bookmarklet viejo: debe decir que ya no es válido y cómo instalar el nuevo.

### Móvil (copiar y pegar)

**Safari iOS**
1. En Safari abre cualquier página y añádela a marcadores (Compartir > «Añadir marcador»).
2. En otra pestaña abre `/bookmarklet`, abre "En el móvil" > "iPhone o iPad (Safari)" y usa "Copiar código".
3. En Marcadores pulsa «Editar» y entra en el marcador que creaste.
4. Cambia el nombre a "+ Pincushion" y pega el código en la dirección (sustituye la URL).
5. Abre una página, abre Marcadores y toca "+ Pincushion".

**Chrome Android**
1. Copia el código desde `/bookmarklet` > "En el móvil" > "Android (Chrome)".
2. Guarda una página como marcador (menú ⋮, estrella). Edítalo desde Marcadores: nombre "+ Pincushion" y el código como URL.
3. Para usarlo, escribe "Pincushion" en la barra de direcciones y toca el marcador sugerido (Chrome Android no ejecuta marcadores desde el menú).

En ambos: ¿el popup cabe en pantalla?, ¿se entiende sin zoom?, ¿el guardado aparece luego en la Biblioteca desde otro dispositivo?

Registra: navegador/versión, sistema, resultado (ok / falla / ok con fricción), captura si falla.

---

## 2. Pasada con lector de pantalla

Recorre **J1 a J3** completos con **VoiceOver en iOS Safari** y con **NVDA (Windows, Firefox o Chrome) o VoiceOver (macOS)**:

- **J1**: instalar/usar el bookmarklet y guardar una página.
- **J2**: seleccionar 3 enlaces, añadir etiqueta, moverlos a una colección nueva.
- **J3**: buscar una frase recordada a medias, abrir el resultado, marcar favorito.

Comprueba en cada paso:
- Los landmarks y el título de la página permiten orientarse (banner, navegación, contenido principal).
- Cada control tiene nombre ("Seleccionar «título»", "Marcar como favorito"); el estado favorito/seleccionado se anuncia sin depender del color.
- Los mensajes de éxito/error (`role="status"`) se anuncian solos tras guardar, mover o buscar ("N resultados para «q»").
- Los estados de la obtención de datos ("Obteniendo datos…" → "Datos obtenidos" / "No se pudo leer la página") se anuncian.
- El foco tras enviar un formulario va a la confirmación o al encabezado principal, y Escape cierra los diálogos devolviendo el foco.
- El popup del bookmarklet es utilizable sin ver la pantalla.

Anota cada obstáculo con la plantilla de hallazgos (sección 6).

---

## 3. Antes de las sesiones: pruebas rápidas

### Evaluación heurística (Nielsen)

Recorre **Biblioteca, Guardar, Buscar y Bookmarklet** y puntúa cada heurística de 0 a 4 (0 = sin problema, 4 = catastrófico), anotando la evidencia:

1. Visibilidad del estado del sistema (¿se ve qué pasa con la obtención de datos, la selección, el filtro activo?).
2. Coincidencia entre el sistema y el mundo real (glosario: enlace, colección, etiqueta, favorito, papelera; fechas en español).
3. Control y libertad del usuario (Deshacer, Cancelar, Quitar filtros, Papelera).
4. Consistencia y estándares (barra global, botón "Guardar enlace" siempre en el mismo lugar).
5. Prevención de errores (confirmaciones con alcance, aviso de duplicado).
6. Reconocer antes que recordar (vacíos con guía, etiquetas autocompletadas).
7. Flexibilidad y eficiencia (atajo `/`, lote, vista tarjetas/lista).
8. Diseño estético y minimalista.
9. Ayudar a reconocer, diagnosticar y recuperarse de errores (mensajes humanos con código de referencia y siguiente paso).
10. Ayuda y documentación (guía de primer uso, instrucciones móviles del bookmarklet).

### Prueba de 5 segundos de la Biblioteca vacía

Con 5 personas distintas (pueden ser las mismas de las sesiones, antes de empezar): inicia sesión como `dana@example.com`, muestra la Biblioteca vacía **5 segundos**, oculta la pantalla y pregunta: "¿Qué harías primero?" y "¿Para qué sirve esto?". Éxito: dicen algo equivalente a instalar el bookmarklet o pegar un enlace.

---

## 4. Sesiones moderadas con 5 personas

### Perfil de participantes

- 5 personas que guardan enlaces para leer o consultar después, sin conocimientos técnicos especiales.
- **Al menos 2** que usan sobre todo el teléfono.
- Ninguna ha visto Pincushion. Mezcla de navegadores (Chrome, Safari, Firefox).
- Sesión de 30 a 40 minutos, en persona o por videollamada con pantalla compartida. Una persona modera y otra anota.

### Consentimiento (leer en voz alta)

> Vamos a probar una aplicación, no a evaluarte a ti: no hay respuestas incorrectas y, si algo no se entiende, el problema es de la aplicación. Tomaremos notas, y con tu permiso grabaremos la pantalla y el audio solo para analizar la sesión; no compartiremos la grabación fuera del equipo y la borraremos al terminar el análisis. Puedes parar o saltarte una tarea cuando quieras. ¿Estás de acuerdo en participar y en que grabemos?

Anota nombre/seudónimo y el "sí" de la persona. No se recoge más información personal de la necesaria.

### Guion de bienvenida (sin explicar la interfaz)

> Gracias por venir. Esto es una aplicación para guardar enlaces y volver a encontrarlos. Te iré dando tareas. Piensa en voz alta: di qué esperas, qué ves y qué te confunde. Yo no te ayudaré ni te diré dónde pulsar; si te atascas, dímelo y seguimos con la siguiente tarea. Todos los datos son de ejemplo.

Reglas del moderador: no explicar botones ni textos; no sugerir; si preguntan "¿pulso aquí?", responder "¿qué crees que pasaría?"; dar la ayuda solo tras **2 minutos** de bloqueo y anotarla como "con ayuda".

### Datos preparados

Una cuenta limpia (`dana` o un usuario nuevo) con el bookmarklet **sin instalar**. Para las tareas 2 a 4 usa una cuenta con enlaces (`alice@example.com`, con 26 enlaces del seed; la importación no existe en esta versión) en otro perfil de navegador. Elige antes la frase de la tarea 3 (que aparezca solo en el texto guardado de un artículo) y un enlace para borrar en la tarea 4.

### Las 5 tareas

| # | Tarea (lo que se le lee a la persona) | Criterio de éxito | Pasos esperados |
|---|---|---|---|
| 1 | "Quieres guardar con un solo clic las páginas que encuentres mientras navegas. Prepáralo y guarda esta página: <URL>." | El bookmarklet está en la barra, lo usa y ve la confirmación "Guardado". | 1 clic una vez instalado, 0 campos obligatorios. |
| 2 | "Tienes tres enlaces de cocina sueltos. Ponles la etiqueta «cena» y muévelos a una colección nueva llamada «Recetas»." | Los 3 enlaces tienen la etiqueta y están en la colección, y se ven en la barra lateral con su conteo. | Seleccionar 3 + 2 acciones de lote, sin salir de la Biblioteca. |
| 3 | "Recuerdas un artículo que hablaba de «<frase>», pero no su título. Encuéntralo y márcalo como favorito." | Abre el enlace correcto y lo deja como favorito (sigue siéndolo tras recargar). | Escribir en el buscador + 1 clic al resultado + 1 clic en favorito. |
| 4 | "Borraste por error un enlace hace un momento. Recupéralo." | El enlace vuelve a estar activo en la Biblioteca. | "Deshacer" (1 clic) o Papelera > Restaurar. |
| 5 | "Desde tu teléfono, guarda esta página: <URL>." (con el teléfono de la persona o uno de prueba; si no tiene el bookmarklet, vale pegar la URL en "Guardar enlace") | El enlace queda guardado y aparece luego en el escritorio. | Pegar + 1 clic, o bookmarklet. |

Para cada tarea registra:
- **Resultado**: éxito sin ayuda / éxito con ayuda / abandono.
- **Tiempo** (desde que se lee la tarea hasta que dice "listo" o abandona).
- **Caminos equivocados**: pantallas o clics que no llevaban a nada.
- Frases textuales y expresiones de confusión.

### SEQ después de cada tarea

Pregunta: **"En general, ¿qué tan fácil o difícil fue completar esta tarea?"** de 1 (muy difícil) a 7 (muy fácil). Anota el número y el porqué.

### Cuestionario SUS (al final)

Pide que valore de 1 (totalmente en desacuerdo) a 5 (totalmente de acuerdo), reaccionando rápido:

1. Creo que me gustaría usar Pincushion con frecuencia.
2. Encontré Pincushion innecesariamente complejo.
3. Pensé que Pincushion era fácil de usar.
4. Creo que necesitaría el apoyo de una persona técnica para poder usar Pincushion.
5. Encontré que las diversas funciones de Pincushion estaban bien integradas.
6. Pensé que había demasiada inconsistencia en Pincushion.
7. Imagino que la mayoría de las personas aprenderían a usar Pincushion muy rápidamente.
8. Encontré Pincushion muy incómodo de usar.
9. Me sentí muy seguro/a usando Pincushion.
10. Necesité aprender muchas cosas antes de poder empezar con Pincushion.

**Cómo puntuar**: para las afirmaciones impares (1, 3, 5, 7, 9) resta 1 a la respuesta; para las pares (2, 4, 6, 8, 10) resta la respuesta a 5. Suma los 10 resultados (cada uno de 0 a 4) y multiplica por 2,5: da de 0 a 100. Calcula la media de las 5 personas. **Meta: SUS ≥ 75** (≈ 68 es la media general de la industria).

### Resumen de métricas

| Métrica | Cómo se calcula | Meta |
|---|---|---|
| Éxito sin ayuda | tareas con éxito sin ayuda / (5 × personas) | ≥ 80 % |
| Tiempo | mediana por tarea | registrar; comparar entre rondas |
| Caminos equivocados | media por tarea | registrar |
| SEQ | media por tarea | ≥ 5,5 (referencia habitual ≈ 5,5) |
| SUS | media de las 5 personas | ≥ 75 |

---

## 5. Cierre de cada sesión

Pregunta abierta: "¿Qué fue lo mejor? ¿Qué fue lo más frustrante? ¿Qué esperabas encontrar que no estaba?". Agradece y anota en la hoja de la persona.

---

## 6. Plantilla de hallazgos

Un hallazgo por fila. **Severidad**:
- **Bloqueante**: la persona no pudo completar la tarea, o perdió datos. Impide el lanzamiento.
- **Grave**: completó la tarea con gran dificultad, con ayuda o tras varios caminos equivocados. Se corrige antes del lanzamiento.
- **Menor**: fricción, confusión pasajera o mejora estética. Va al backlog.

| ID | Tarea | Participante(s) | Qué pasó (evidencia, cita textual) | Pantalla/estado | Severidad | Hipótesis de causa | Cambio propuesto | Estado |
|---|---|---|---|---|---|---|---|---|
| H-01 | | | | | Bloqueante / Grave / Menor | | | abierto |

Prioriza por **severidad × cuántas personas lo sufrieron**. Un hallazgo que afecta a 3 de 5 personas es un problema real aunque sea "menor". Tras corregir, repite con 2-3 personas nuevas las tareas afectadas.

### Registro de resultados (copiar por persona)

| Persona | Móvil/escritorio | T1 | T2 | T3 | T4 | T5 | SEQ T1..T5 | SUS |
|---|---|---|---|---|---|---|---|---|
| P1 | | | | | | | | |
