# open-sessions

Mod para Claude Code que muestra, en un panel junto al chat, todas las sesiones de Claude Code
abiertas en tus PCs (macOS, Windows y Linux) y el estado de cada una:

- 🔴 **te espera**: pide un permiso o una decisión (con el motivo cuando lo hay)
- 🟠 **ocupada**: está trabajando
- 🔵 **libre**: terminó su turno

Cada sesión muestra su nombre, el título del chat, la carpeta, el estado y cuánto tiempo lleva
en él ("ocupada · 12 min"). Las sesiones aparecen agrupadas por PC. El comando `/sesiones`
vuelve a abrir el panel si lo cerraste.

Al tocar una sesión de la misma PC se abre: las de la app de escritorio en su chat, y las de la
terminal enfocando su panel de [herdr](https://herdr.dev) (si corren dentro de herdr). Las
sesiones de otras PCs solo se muestran.

El botón **copiar** junto a cada sesión copia su nombre. Pegado en otra conversación ("pásale
esto a orkestra-37"), Claude puede enviarle un mensaje a esa sesión.

## Avisos

- Cuando una sesión te espera: aviso y sonido de tres pitidos.
- Cuando una sesión termina (pasa de ocupada a libre): aviso, sonido ascendente y la marca
  **✓ terminó** hasta que la tocas o vuelve a trabajar.
- Cuando un subagente del chat actual te espera o termina: aviso.

El sonido suena una sola vez aunque tengas varias sesiones con el mod abiertas. Solo suena en
macOS: en Windows y Linux Claude Code no tiene reproductor.

## Secciones

Si el chat actual lanzó subagentes, la sección **Subagentes** muestra cada uno con su tipo,
modelo y estado; los terminados quedan atenuados (hasta los últimos cinco).

Abajo, la sección **Uso** muestra cuánto contexto lleva la sesión actual y cuánto queda de los
límites de 5 horas y 7 días de tu cuenta, con la hora en que se reinicia cada uno.

Cada sección (cada PC, Subagentes y Uso) se pliega y despliega al tocar su título. El título
de cada PC cuenta siempre sus sesiones por estado (●🔴 ●🟠 ●🔵 y ✓ las terminadas sin ver), y
una sección plegada sigue mostrando las sesiones que te esperan o terminaron sin que las vieras,
para que nunca se te pase una.

## Cómo se comparten las sesiones entre PCs

Cada PC lee sus propias sesiones de `~/.claude/sessions` y las publica en un **Gist secreto**
de tu cuenta de GitHub (descripción `claude-open-sessions`), que el mod crea la primera vez.
Cada PC lee del mismo Gist las sesiones de las demás.

- Se sube el nombre de la sesión, el título del chat, la carpeta del proyecto, el estado y desde
  cuándo, y el nombre de la PC. Nada del contenido de las conversaciones.
- Las sesiones de las otras PCs se actualizan cada ~15 segundos.
- Cada cambio de estado se escribe al momento; si nada cambia, la PC escribe cada 5 minutos para
  decir que sigue encendida. Una PC que lleva 10 minutos sin escribir se oculta.
- GitHub guarda cada escritura como una revisión del Gist. Si quieres empezar de cero, borra el
  Gist: el mod crea uno nuevo.

## Requisitos

[GitHub CLI](https://cli.github.com) (`gh`) instalado y con sesión iniciada en la **misma cuenta
de GitHub** en cada PC:

```bash
gh auth login
```

Sin `gh`, el panel muestra solo las sesiones de la PC en la que corre.

## Instalación

```
/plugin install open-sessions --marketplace ThomasPraun/claude-mods
```

Más opciones en el [README del repositorio](../../README.md).
