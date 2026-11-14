# Marca de Pincushion

Pincushion usa el **Sistema de Diseño de Mateo Folador** (`docs/marca/sistema-de-diseno-mateo-folador.html`, v1.0, mayo 2026) como brand book. Este documento dice cómo se aplica a una herramienta de uso diario y dónde se ajusta por accesibilidad. Los tokens viven en `src/styles/tokens.css`.

## Principios aplicados

- **Tipo grande, claro, contundente.** Los `h1` de cada pantalla usan Inter Tight 800 con tracking apretado (−0,03 em). En listas y formularios manda la legibilidad: Inter 400/500 a 15–16 px.
- **Azul con propósito.** El azul marca lo importante: el botón primario "Guardar enlace", el enlace activo, el foco, las coincidencias de búsqueda (`<mark>` con `--mf-blue-soft`). Nunca llena bloques.
- **Grilla siempre presente.** La retícula sutil aparece en el fondo de la Biblioteca vacía, la pantalla de entrar y la configuración del bookmarklet. No va detrás de listas densas, donde estorba la lectura.
- **Dark first en el marco, Paper en el contenido.** La barra superior y la barra lateral van en Ink 950/900 (territorio de la web de la marca). El área de enlaces va en Paper, porque son listas largas que se leen.

## Logo de producto

- Wordmark en el bloque tipográfico de la marca: dos líneas, mayúsculas, Inter Tight 800, tracking apretado → **PIN / CUSHION**.
- Variante avatar para favicon e iconos pequeños: **"PC" apilado en cuadrado azul** (mismo tratamiento que "MF").
- Pie discreto en Ajustes: "Diseñado con el sistema de Mateo Folador".
- No se deforma, no se italiza, no lleva contornos, sombras ni colores fuera del sistema.

## Componentes

- **Botones pill**: primario (azul, texto blanco), secundario (Graphite), ghost (borde Graphite) y ghost-light sobre Ink. Alturas 36 / 48 / 56 px; en táctil nunca por debajo de 44 px.
- **Badges** pill de 28 px para estados: azul (info), success (obtenido), warn (falló), light (etiqueta). Siempre con texto, nunca solo el punto de color.
- **Tarjetas**: Paper warm, borde `--mf-paper-grid`, radio 18 px, `--shadow-soft`. Las sombras profundas con tinte azul solo en superficies Ink.
- **Mono** (JetBrains Mono, mayúsculas, tracking amplio) solo para metadatos: dominio, fecha, conteos.

## Ajustes por accesibilidad (WCAG AA)

El brand book usa colores que no llegan a 4,5:1 con texto normal. Se conservan para lo decorativo y se añaden variantes de texto:

| Uso | Brand book | En Pincushion | Contraste |
|---|---|---|---|
| Fondo del botón primario con texto blanco | `#1F8BFF` (3,4:1) | `--mf-blue-600` `#0B6BDB` | 5,1:1 |
| Enlaces y texto azul sobre Paper | `#1F8BFF` | `--mf-blue-600` | 4,7:1 (Paper) · 5,1:1 (blanco) |
| Texto de error | `#FF6B57` | `--mf-warn-text` `#B8321F` | ≥ 5:1 |
| Texto de éxito | `#2ECC8B` | `--mf-success-text` `#0F7A50` | ≥ 5:1 |
| Favorito | `#F5C24A` (estrella) | estrella + texto "Favorito"; texto en `--mf-gold-text` | ≥ 4,5:1 |

`#1F8BFF` se mantiene para el anillo de foco, cifras grandes, el acento en titulares grandes (≥ 24 px) y superficies Ink, donde sí cumple.

## Tipografías

Se sirven desde el propio servidor (paquetes `@fontsource`), no desde Google Fonts: la CSP solo permite recursos propios y así no se filtran visitas a terceros.
